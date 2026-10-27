import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const folder = dirname(dirname(fileURLToPath(import.meta.url)));
const context = vm.createContext({ URLSearchParams, AbortController, console });
vm.runInContext(readFileSync(join(folder, "core.js"), "utf8"), context);
vm.runInContext(readFileSync(join(folder, "auto.js"), "utf8"), context);
const core = vm.runInContext("__MCS_PHASE1_CORE__", context);
const autoModule = vm.runInContext("__MCS_AUTO__", context);
const response = (value, status = 200) => ({ ok: status < 400, status, json: async () => structuredClone(value) });
const flush = () => new Promise((resolve) => setTimeout(resolve, 5));

function harness({ assistantTurns = 10, originalAuto = true, failSave = false } = {}) {
  const rows = [];
  let ordinal = 0;
  function add(role) {
    const row = { id: `${role}-${++ordinal}`, chatId: "chat", role, content: `${role} ${ordinal}`, extra: "{}", createdAt: new Date(1_700_000_000_000 + ordinal * 1000).toISOString(), activeSwipeIndex: 0, swipeCount: 0 };
    rows.push(row);
    return row;
  }
  for (let i = 0; i < assistantTurns; i += 1) { add("user"); add("assistant"); }
  const chat = { id: "chat", mode: "roleplay", metadata: { automaticSummaryEnabled: originalAuto, summaryEntries: [], summary: null } };
  let settings = { connectionId: "model", intervalTurns: 10, managedChats: {} };
  const calls = [], notices = [], runs = [];
  let generationActive = false, failModel = false, manualBusy = false, sequence = 0, modelGate = null;
  const fetcher = async (path, init) => {
    calls.push({ path, method: init.method });
    if (path === "/api/generate/status/chat") return response({ active: generationActive });
    if (path === "/api/chats/chat/metadata" && init.method === "PATCH") {
      assert.equal(init.headers["x-marinara-csrf"], "1");
      Object.assign(chat.metadata, JSON.parse(init.body));
      return response(chat);
    }
    throw new Error(`unexpected ${path}`);
  };
  let snapshotReads = 0;
  const reader = {
    readChat: async () => structuredClone(chat),
    readSnapshot: async () => {
      snapshotReads += 1;
      const summary = core.summaryInfo(chat);
      return { chatId: "chat", mode: "roleplay", messageCount: rows.length, messages: structuredClone(rows), summary, boundary: core.analyzeBoundary(rows, summary.entries, summary.legacy) };
    },
  };
  const manualService = { async run(chatId, connectionId, id, signal, onPhase, options) {
    runs.push({ chatId, connectionId, id, fence: options.sourceFence, signal });
    if (failModel) { failModel = false; throw new Error("model failed"); }
    if (modelGate) await modelGate(signal);
    if (signal.aborted) throw new Error("aborted");
    const cutoff = rows.findIndex((row) => row.id === options.sourceFence.throughMessageId) + 1;
    const start = chat.metadata.summaryEntries.at(-1)?.rangeEndIndex ?? 0;
    const selected = rows.slice(start, cutoff);
    chat.metadata.summaryEntries.push({ id, content: `summary-${id}`, enabled: true, sourceMode: "range", rangeStartIndex: start + 1, rangeEndIndex: cutoff, messageIds: selected.map((row) => row.id) });
    chat.metadata.summary = chat.metadata.summaryEntries.map((entry) => entry.content).join("\n\n");
    return { kind: "saved", messageCount: selected.length };
  } };
  const controller = autoModule.createAutoController({ core, fetcher, reader, manualService,
    getSettings: () => settings,
    saveSettings: async (change) => { if (failSave) return false; settings = typeof change === "function" ? change(settings) : change; return true; },
    onState: (chatId, notice) => notices.push({ chatId, ...notice }),
    isManualBusy: () => manualBusy,
    newId: () => `new-${++sequence}`,
  });
  const fence = () => structuredClone({ throughMessageId: rows.at(-1)?.id, messages: rows.slice(-10) });
  function send({ saveInput = true } = {}) {
    const captured = fence();
    const promise = controller.submit("chat", captured);
    if (saveInput) add("user");
    return promise;
  }
  return { rows, chat, calls, notices, runs, controller, add, fence, send,
    get settings() { return settings; }, get snapshotReads() { return snapshotReads; },
    set generationActive(value) { generationActive = value; }, set failModel(value) { failModel = value; },
    set manualBusy(value) { manualBusy = value; }, set modelGate(value) { modelGate = value; },
  };
}

// Send starts before saving the current user; RP never needs to finish.
{
  const h = harness();
  await h.controller.enable("chat");
  const baselineReads = h.snapshotReads;
  await flush();
  assert.equal(h.snapshotReads, baselineReads); // no periodic/background scan
  assert.equal(h.controller.tick, undefined);
  h.generationActive = true;
  const oldIds = h.rows.map((row) => row.id);
  await h.send({ saveInput: false });
  assert.equal(h.runs.length, 1);
  assert.deepEqual(h.chat.metadata.summaryEntries[0].messageIds, oldIds);
  assert.equal(h.calls.filter((call) => call.path.includes("/status/")).length, 1); // activation only
  h.add("user"); h.add("assistant");
  await h.send();
  assert.equal(h.runs.length, 1); // only one assistant since provenance
  await h.controller.disable("chat");
  assert.equal(h.chat.metadata.automaticSummaryEnabled, true);
}

// Legacy summary-agent membership must not make Engine's switch appear on after activation.
{
  const h = harness({ originalAuto: null });
  h.chat.metadata.enableAgents = true;
  h.chat.metadata.activeAgentIds = ["lorebook", "chat-summary", "tracker"];
  await h.controller.enable("chat");
  assert.equal(h.chat.metadata.automaticSummaryEnabled, false);
  assert.deepEqual(h.chat.metadata.activeAgentIds, ["lorebook", "tracker"]);
  assert.equal(h.settings.managedChats.chat.originalLegacy, true);
  assert.equal(core.settingsFromStorage(core.storagePatch(h.settings)).managedChats.chat.originalLegacy, true);
  await h.controller.disable("chat");
  assert.equal(h.chat.metadata.automaticSummaryEnabled, null);
  assert.deepEqual(h.chat.metadata.activeAgentIds, ["lorebook", "tracker", "chat-summary"]);
}
// An explicit false with a legacy id is also normalized while the Calibrator is enabled.
{
  const h = harness({ originalAuto: false });
  h.chat.metadata.activeAgentIds = ["chat-summary", "other"];
  await h.controller.enable("chat");
  assert.deepEqual(h.chat.metadata.activeAgentIds, ["other"]);
  await h.controller.shutdown();
  assert.equal(h.chat.metadata.automaticSummaryEnabled, false);
  assert.deepEqual(h.chat.metadata.activeAgentIds, ["other", "chat-summary"]);
}

// Reapplying a preset must disable Engine auto again if a chat profile turned it on.
{
  const h = harness(); await h.controller.enable("chat");
  h.chat.metadata.automaticSummaryEnabled = true;
  h.chat.metadata.activeAgentIds = ["chat-summary", "tracker"];
  await h.controller.enable("chat");
  assert.equal(h.chat.metadata.automaticSummaryEnabled, false);
  assert.deepEqual(h.chat.metadata.activeAgentIds, ["tracker"]);
  assert.equal(h.settings.managedChats.chat.original, true);
  await h.controller.disable("chat");
  assert.equal(h.chat.metadata.automaticSummaryEnabled, true);
}

// Failure consumes just this event; the next input retries all unprocessed sources.
{
  const h = harness(); await h.controller.enable("chat");
  h.failModel = true; await h.send();
  assert.equal(h.chat.metadata.summaryEntries.length, 0);
  h.add("assistant"); await h.send();
  assert.equal(h.runs.length, 2);
  assert.equal(h.chat.metadata.summaryEntries[0].messageIds.length, 22);
  await h.controller.shutdown();
}

// The old summary boundary, not total-count modulo, controls eligibility.
{
  const h = harness({ assistantTurns: 16, originalAuto: false });
  const prior = h.rows.slice(0, 12);
  h.chat.metadata.summaryEntries.push({ id: "old", content: "old", enabled: true, messageIds: prior.map((row) => row.id), rangeEndIndex: 12 });
  h.chat.metadata.summary = "old";
  await h.controller.enable("chat"); await h.send();
  assert.equal(h.runs.length, 1);
  assert.deepEqual(h.chat.metadata.summaryEntries[1].messageIds, h.rows.slice(12, -1).map((row) => row.id));
  await h.controller.disable("chat");
  assert.equal(h.chat.metadata.automaticSummaryEnabled, false);
}

// Manual lock retains the original send fence, even if RP appends its response.
{
  const h = harness(); await h.controller.enable("chat"); h.manualBusy = true;
  const oldIds = h.rows.map((row) => row.id);
  await h.send(); h.add("assistant");
  assert.equal(h.runs.length, 0);
  h.manualBusy = false; h.controller.kick("chat"); await flush();
  assert.deepEqual(h.chat.metadata.summaryEntries[0].messageIds, oldIds);
  await h.controller.shutdown();
}

// Duplicate event while running does not create another run; later appends are excluded.
{
  const h = harness(); await h.controller.enable("chat");
  let release;
  h.modelGate = () => new Promise((resolve) => { release = resolve; });
  const fence = h.fence();
  const first = h.controller.submit("chat", fence);
  await flush();
  await h.controller.submit("chat", fence);
  h.add("user"); h.add("assistant");
  assert.equal(h.runs.length, 1);
  release(); await first;
  assert.equal(h.chat.metadata.summaryEntries[0].messageIds.length, 20);
  await h.controller.shutdown();
}

// Branches inherit Engine auto=false; adopt parent policy and restore the parent's original setting.
{
  const branch = { id: "branch", mode: "roleplay", metadata: { branchParentChatId: "parent", automaticSummaryEnabled: false } };
  let settings = { connectionId: "model", intervalTurns: 5, managedChats: { parent: { original: true } } };
  const controller = autoModule.createAutoController({ core,
    fetcher: async (path, init) => {
      assert.equal(path, "/api/chats/branch/metadata");
      assert.equal(init.headers["x-marinara-csrf"], "1");
      branch.metadata.automaticSummaryEnabled = JSON.parse(init.body).automaticSummaryEnabled;
      return response(branch);
    },
    reader: { readChat: async () => structuredClone(branch) },
    manualService: { run: async () => { throw new Error("unexpected generation"); } },
    getSettings: () => settings,
    saveSettings: async (change) => { settings = change(settings); return true; },
    onState: () => {}, isManualBusy: () => false, newId: () => "unused",
  });
  await controller.adoptBranch("branch");
  assert.equal(controller.isManaged("branch"), true);
  assert.equal(settings.managedChats.branch.original, true);
  await controller.disable("branch");
  assert.equal(branch.metadata.automaticSummaryEnabled, true);
  assert.equal(controller.isManaged("branch"), false);
  assert.equal(controller.isManaged("parent"), true);
}

// Send fence edits, deleted anchors, and Swipe changes stop automatic generation.
for (const mutate of [
  (h) => { h.rows.at(-1).content = "edited"; },
  (h) => { h.rows.pop(); },
  (h) => { h.rows.at(-1).activeSwipeIndex = 1; },
]) {
  const h = harness(); await h.controller.enable("chat");
  const fence = h.fence(); mutate(h);
  await h.controller.submit("chat", fence);
  assert.equal(h.runs.length, 0);
  assert.equal(h.notices.at(-1).kind, "failed");
  await h.controller.shutdown();
}
{
  const h = harness(); await h.controller.enable("chat");
  h.rows.pop(); await h.send(); // only nine current assistant rows
  assert.equal(h.runs.length, 0);
  h.add("assistant"); await h.send();
  assert.equal(h.runs.length, 1);
  await h.controller.shutdown();
}

// A stale cache anchor must not omit an assistant message already on the server.
{
  const h = harness(); await h.controller.enable("chat");
  const fence = h.fence();
  h.add("assistant"); h.add("user");
  await h.controller.submit("chat", fence);
  assert.equal(h.runs.length, 0);
  assert.match(h.notices.at(-1).error, /캐시보다 새로운 대화/);
  await h.controller.shutdown();
}

// Policy failures and direct user changes retain the original protection.
{
  const h = harness(); h.generationActive = true;
  await assert.rejects(h.controller.enable("chat"), /진행 중/);
  assert.equal(h.chat.metadata.automaticSummaryEnabled, true);
}
{
  const h = harness({ failSave: true });
  await assert.rejects(h.controller.enable("chat"), /저장하지 못해/);
  assert.equal(h.calls.filter((call) => call.method === "PATCH").length, 0);
}
{
  const h = harness(); await h.controller.enable("chat");
  h.chat.metadata.automaticSummaryEnabled = true; await h.send();
  assert.equal(h.runs.length, 0);
  await h.controller.disable("chat");
  assert.equal(h.chat.metadata.automaticSummaryEnabled, true);
}
// Disable aborts a model in flight, restores policy, and rejects later events.
{
  const h = harness(); await h.controller.enable("chat");
  h.modelGate = (signal) => new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
  const first = h.send(); await flush(); await h.controller.disable("chat"); await first;
  assert.equal(h.chat.metadata.summaryEntries.length, 0);
  await h.send(); assert.equal(h.runs.length, 1);
  assert.equal(h.chat.metadata.automaticSummaryEnabled, true);
}

// Capture adapter: real event paths, no delay/preventDefault, localized button-independent guards.
{
  const callbacks = new Map(), sent = [], errors = [];
  const target = {
    addEventListener(type, fn, capture) { assert.equal(capture, true); callbacks.set(type, fn); },
    removeEventListener(type, fn, capture) { assert.equal(capture, true); assert.equal(callbacks.get(type), fn); callbacks.delete(type); },
  };
  let active = "chat", enterToSend = true, sendIcon = true, popup = false, cacheMissing = false;
  const cachedRow = { id: "a1", chatId: "chat", role: "assistant", content: "old", extra: "{}" };
  const button = { disabled: false, querySelector: () => sendIcon ? {} : null, closest: (selector) => selector === ".chat-input-container" ? container : button };
  const composer = { disabled: false, value: "new input", getAttribute: () => active, closest: (selector) => selector === ".chat-input-container" ? container : null };
  const container = { querySelector: (selector) => selector.startsWith("textarea") ? composer : selector.startsWith("button") ? button : popup ? {} : null };
  let cacheInvalidated = false;
  const host = { version: 1, stores: { chat: { getState: () => ({ activeChatId: active }) }, ui: { getState: () => ({ enterToSendRP: enterToSend }) } }, queryClient: {
    getQueryState: () => ({ isInvalidated: cacheInvalidated, fetchStatus: "idle" }),
    getQueryData: (key) => { assert.deepEqual(Array.from(key), ["chats", "messages", active]); return cacheMissing ? undefined : { pages: [[cachedRow]] }; },
  } };
  const remove = autoModule.installSendObserver({ target, getHost: () => host, isManaged: (id) => id === "chat", onSend: (chatId, fence) => sent.push({ chatId, fence }), onError: (chatId, error) => errors.push({ chatId, error }) });
  const click = () => callbacks.get("click")({ type: "click", target: button, preventDefault() { assert.fail("send must not be blocked"); } });
  const key = (extra = {}) => callbacks.get("keydown")({ type: "keydown", target: composer, key: "Enter", ...extra });
  click(); assert.equal(sent.length, 1); // callback synchronously invoked, no timer
  cachedRow.content = "later edit"; assert.equal(sent[0].fence.messages[0].content, "old");
  key(); assert.equal(sent.length, 2);
  const postOnly = { title: "Post only: Add your message without a reply", disabled: false, closest: (selector) => selector === ".chat-input-container" ? container : postOnly };
  postOnly.closest = (selector) => selector === ".chat-input-container" ? container : selector === "button.mari-chat-quick-reply" ? postOnly : null;
  callbacks.get("click")({ type: "click", target: postOnly });
  assert.equal(sent.length, 3);
  composer.value = ""; // Engine enables Post only for an attachment without text.
  callbacks.get("click")({ type: "click", target: postOnly });
  assert.equal(sent.length, 4);
  composer.value = "new input";
  postOnly.disabled = true; callbacks.get("click")({ type: "click", target: postOnly }); postOnly.disabled = false;
  composer.value = "{{prompt}}"; click(); key(); assert.equal(sent.length, 4); composer.value = "new input";
  key({ shiftKey: true }); key({ isComposing: true }); key({ repeat: true }); key({ keyCode: 229 });
  enterToSend = false; key(); enterToSend = true;
  popup = true; key(); popup = false;
  button.disabled = true; click(); button.disabled = false;
  sendIcon = false; click(); key(); sendIcon = true;
  composer.value = ""; click(); composer.value = "/continue"; click();
  composer.value = "new input"; active = "other"; click(); active = "chat";
  assert.equal(sent.length, 4);
  cacheInvalidated = true; click(); assert.equal(errors.length, 1); cacheInvalidated = false;
  cacheMissing = true; click(); assert.equal(errors.length, 2);
  remove(); assert.equal(callbacks.size, 0);
}

console.log("Phase 3 verification passed: capture/send before persistence, N-turn provenance, immutable fence, concurrent RP exclusion, retry, duplicates/manual lock, mutations, policy restore, cleanup and no automatic polling.");
