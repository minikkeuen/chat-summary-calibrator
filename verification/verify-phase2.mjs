import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const folder = dirname(dirname(fileURLToPath(import.meta.url)));
const context = vm.createContext({ URLSearchParams, AbortController, console });
vm.runInContext(readFileSync(join(folder, "core.js"), "utf8"), context);
vm.runInContext(readFileSync(join(folder, "auto.js"), "utf8"), context);
vm.runInContext(readFileSync(join(folder, "rules.js"), "utf8"), context);
vm.runInContext(readFileSync(join(folder, "bulk.js"), "utf8"), context);
const core = vm.runInContext("__MCS_PHASE1_CORE__", context);
const autoModule = vm.runInContext("__MCS_AUTO__", context);
const ruleModule = vm.runInContext("__MCS_RULES__", context);
const bulkModule = vm.runInContext("__MCS_BULK__", context);
const ruleSelectors = [".msc-correction-enabled", ".msc-rule-open", ".msc-rule-upload", ".msc-rule-options", ".msc-rule-type", ".msc-rule-language", ".msc-rule-notice", ".msc-rule-list", ".msc-rule-source", ".msc-rule-preview", ".msc-rule-result", ".msc-rule-preview-status", ".msc-bulk", ".msc-toggle-bulk", ".msc-bulk-box", ".msc-bulk-load", ".msc-bulk-all", ".msc-bulk-selected", ".msc-bulk-list", ".msc-bulk-preview", ".msc-bulk-apply", ".msc-bulk-result", ".msc-bulk-comparisons"];
const copy = (value) => structuredClone(value);
const respond = (value, status = 200) => ({ ok: status < 400, status, json: async () => copy(value) });

function fixture({ prior = false, trailingUser = true, tail = 2 } = {}) {
  const state = {
    chat: { id: "chat", mode: "roleplay", metadata: { hideSummarisedMessages: true, summaryTailMessages: tail, summary: prior ? "이전 사건" : null, summaryEntries: prior ? [{ id: "old", kind: "rolling", origin: "manual", title: "Old", content: "이전 사건", enabled: true, sourceMode: "range", messageCount: 2, rangeStartIndex: 1, rangeEndIndex: 2, messageIds: ["m1", "m2"], tokenEstimate: 4, createdAt: "2025-01-01T00:00:00.000Z", updatedAt: "2025-01-01T00:00:00.000Z" }] : [] } },
    rows: ["user", "assistant", "user", "assistant", ...(trailingUser ? ["user"] : [])].map((role, i) => ({ id: `m${i + 1}`, chatId: "chat", role, content: `내용 ${i + 1}`, extra: prior && i < 2 ? JSON.stringify({ hiddenFromAI: true }) : "{}", createdAt: new Date(1_700_000_000_000 + i * 1000).toISOString(), activeSwipeIndex: 0, swipeCount: 0 })),
    calls: [], rawCalls: 0, saveCalls: 0, failModel: false, fallback: false, onModel: null, onSave: null, cutPrompt: false, failPostRead: false,
  };
  state.fetch = async (path, init) => {
    state.calls.push({ path, method: init.method, body: init.body ? JSON.parse(init.body) : null });
    if (init.method !== "GET") assert.equal(init.headers["x-marinara-csrf"], "1");
    const url = new URL(path, "http://localhost");
    if (url.pathname === "/api/chats/chat") {
      if (state.saveCalls && state.failPostRead) throw new Error("temporary read outage");
      return respond(state.chat);
    }
    if (url.pathname === "/api/chats/chat/message-count") return respond({ count: state.rows.length });
    if (url.pathname === "/api/chats/chat/messages") {
      const limit = Number(url.searchParams.get("limit"));
      const before = url.searchParams.get("before");
      let list = state.rows;
      if (before) {
        const [date, encodedId] = before.split("|");
        const id = decodeURIComponent(encodedId);
        list = list.filter((row) => row.createdAt < date || row.createdAt === date && row.id < id);
      }
      return respond(list.slice(-limit));
    }
    if (url.pathname === "/api/generate/raw") {
      const body = JSON.parse(init.body);
      state.rawCalls += 1;
      if (body.returnPrompt) return respond({ prompt: { messages: state.cutPrompt ? [{ role: "system", content: "truncated" }] : body.messages } });
      if (state.failModel) return respond({ error: "model failed" }, 500);
      if (state.onModel) await state.onModel();
      const result = respond({ content: "새로운 사건과 관계의 변화", runId: body.runId });
      if (state.fallback) result.headers = { get: (name) => name === "X-Marinara-Fallback-Used" ? "fallback" : null };
      return result;
    }
    if (url.pathname === "/api/chats/chat/summary-entries") {
      const body = JSON.parse(init.body);
      if (body.operation === "delete") {
        const entry = state.chat.metadata.summaryEntries.find((item) => item.id === body.entryId);
        for (const id of entry?.hiddenMessageIds ?? []) {
          const row = state.rows.find((message) => message.id === id);
          if (row) row.extra = "{}";
        }
        state.chat.metadata.summaryEntries = state.chat.metadata.summaryEntries.filter((item) => item.id !== body.entryId);
        state.chat.metadata.summary = state.chat.metadata.summaryEntries.filter((item) => item.enabled).map((item) => item.content).join("\n\n") || null;
        return respond(state.chat);
      }
      state.saveCalls += 1;
      if (state.onSave) await state.onSave();
      const draft = body.entry;
      const included = state.rows.slice(draft.rangeStartIndex - 1, draft.rangeEndIndex).filter((row) => JSON.parse(row.extra).hiddenFromAI !== true);
      const hidden = included.slice(0, Math.max(0, included.length - tail)).map((row) => row.id);
      for (const id of hidden) state.rows.find((row) => row.id === id).extra = JSON.stringify({ hiddenFromAI: true });
      const entry = { ...draft, messageIds: included.map((row) => row.id), hiddenMessageIds: hidden, tokenEstimate: 8, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
      state.chat.metadata.summaryEntries.push(entry);
      state.chat.metadata.summary = state.chat.metadata.summaryEntries.filter((item) => item.enabled).map((item) => item.content).join("\n\n");
      return respond(state.chat);
    }
    throw new Error(`Unexpected ${path}`);
  };
  state.reader = core.makeReader(state.fetch);
  state.service = core.makeManualService(state.fetch, state.reader);
  return state;
}

async function run(state, id = "new") { return state.service.run("chat", "model", id, new AbortController().signal); }

// First summary starts at the beginning; the current trailing user input is excluded.
{
  const state = fixture();
  const result = await run(state);
  assert.equal(result.kind, "saved");
  assert.equal(result.messageCount, 4);
  assert.deepEqual(state.chat.metadata.summaryEntries[0].messageIds, ["m1", "m2", "m3", "m4"]);
  assert.deepEqual(state.chat.metadata.summaryEntries[0].hiddenMessageIds, ["m1", "m2"]);
  assert.equal(JSON.parse(state.rows[4].extra).hiddenFromAI, undefined);
  assert.equal(state.rawCalls, 2); // context fit check, then one real model call
  assert.equal(state.saveCalls, 1);
  assert.equal(state.chat.metadata.summary, "새로운 사건과 관계의 변화");
  assert.equal((await run(state, "retry")).kind, "empty");
  assert.equal(state.rawCalls, 2);
}

// Existing summaries are kept; only new messages follow the provenance boundary.
{
  const state = fixture({ prior: true });
  const original = copy(state.chat.metadata.summaryEntries[0]);
  const result = await run(state);
  assert.equal(result.messageCount, 2);
  assert.deepEqual(state.chat.metadata.summaryEntries[0], original);
  assert.deepEqual(state.chat.metadata.summaryEntries[1].messageIds, ["m3", "m4"]);
  assert.equal(state.chat.metadata.summary, "이전 사건\n\n새로운 사건과 관계의 변화");
  assert.ok(state.calls.find((call) => call.path === "/api/generate/raw" && !call.body.returnPrompt).body.messages[1].content.includes("이전 사건"));
}

// No new completed conversation: no model call and no storage write.
{
  const state = fixture({ prior: true });
  state.rows.splice(2, 2);
  const result = await run(state);
  assert.equal(result.kind, "empty");
  assert.equal(state.rawCalls, 0);
  assert.equal(state.saveCalls, 0);
}

// Context fitting and model failure never mutate summaries.
{
  const state = fixture();
  state.cutPrompt = true;
  await assert.rejects(run(state), /컨텍스트/);
  assert.equal(state.rawCalls, 1);
  assert.equal(state.saveCalls, 0);
}
{
  const state = fixture();
  state.failModel = true;
  await assert.rejects(run(state), /model failed/);
  assert.equal(state.saveCalls, 0);
  assert.equal(state.chat.metadata.summaryEntries.length, 0);
}
{
  const state = fixture();
  state.fallback = true;
  await assert.rejects(run(state), /fallback/);
  assert.equal(state.saveCalls, 0);
}

// Changes while the model runs are detected before saving.
for (const change of [
  (state) => { state.rows[1].content = "edited"; },
  (state) => { state.rows.splice(1, 1); },
  (state) => { state.rows[1].activeSwipeIndex = 1; state.rows[1].content = "swiped"; },
  (state) => { state.chat.metadata.summaryEntries.push({ id: "other", content: "user edit", enabled: true, messageIds: ["m1"] }); },
]) {
  const state = fixture();
  state.onModel = async () => change(state);
  await assert.rejects(run(state), /변경/);
  assert.equal(state.saveCalls, 0);
}

// Send-time fence excludes both the just-submitted user and RP's later assistant.
{
  const state = fixture({ trailingUser: false });
  const sourceFence = { throughMessageId: state.rows.at(-1).id, messages: copy(state.rows) };
  state.rows.push({ ...state.rows.at(-1), id: "m5", role: "user", content: "현재 전송", createdAt: new Date(1_700_000_000_000 + 5000).toISOString() });
  state.onModel = async () => state.rows.push({ ...state.rows.at(-1), id: "m6", role: "assistant", content: "현재 RP 응답", createdAt: new Date(1_700_000_000_000 + 6000).toISOString() });
  const result = await state.service.run("chat", "model", "send-fence", new AbortController().signal, () => {}, { sourceFence, minimumTurns: 2 });
  assert.equal(result.kind, "saved");
  assert.deepEqual(state.chat.metadata.summaryEntries[0].messageIds, ["m1", "m2", "m3", "m4"]);
  assert.equal(state.chat.metadata.summaryEntries[0].hiddenMessageIds.includes("m5"), false);
  assert.equal(state.chat.metadata.summaryEntries[0].messageIds.includes("m6"), false);
}
// If another summary advances the provenance boundary before the service starts, the send is no longer due.
{
  const state = fixture({ trailingUser: false });
  const sourceFence = { throughMessageId: "m4", messages: copy(state.rows) };
  state.chat.metadata.summaryEntries.push({ id: "other", content: "already summarized", enabled: true, messageIds: ["m1", "m2", "m3", "m4"] });
  state.chat.metadata.summary = "already summarized";
  assert.equal((await state.service.run("chat", "model", "later", new AbortController().signal, () => {}, { sourceFence, minimumTurns: 2 })).kind, "empty");
  assert.equal(state.rawCalls, 0);
}

// The Engine accepted the entry; a later read outage leaves it saved for manual confirmation.
{
  const state = fixture();
  state.onSave = async () => { state.failPostRead = true; };
  const result = await run(state, "pending-check");
  assert.equal(result.kind, "saved");
  assert.equal(result.verification, "pending");
  assert.deepEqual(state.chat.metadata.summaryEntries[0].messageIds, ["m1", "m2", "m3", "m4"]);
  assert.equal(state.calls.some((call) => call.body?.operation === "delete"), false);
}

// Save-time range drift is detected from the returned Engine entry and undone.
{
  const state = fixture();
  state.onSave = async () => { state.rows.splice(1, 1); };
  await assert.rejects(run(state), /되돌렸습니다/);
  assert.equal(state.chat.metadata.summaryEntries.length, 0);
  assert.equal(state.chat.metadata.summary, null);
}

// An uncertain old boundary blocks both model generation and saving.
{
  const state = fixture({ prior: true });
  delete state.chat.metadata.summaryEntries[0].messageIds;
  await assert.rejects(run(state), /출처 범위/);
  assert.equal(state.rawCalls, 0);
}
{
  const state = fixture();
  state.rows[1].extra = JSON.stringify({ hiddenFromAI: true });
  await assert.rejects(run(state), /숨김/);
  assert.equal(state.rawCalls, 0);
}
{
  const state = fixture({ trailingUser: false });
  const template = state.rows[0];
  state.rows = Array.from({ length: 502 }, (_, i) => ({ ...template, id: `range-${i}`, createdAt: new Date(1_700_000_000_000 + i * 1000).toISOString(), role: i % 2 ? "assistant" : "user" }));
  await assert.rejects(run(state), /500개/);
  assert.equal(state.rawCalls, 0);
}
{
  const state = fixture();
  const snapshot = await state.reader.readSnapshot("chat");
  snapshot.summary.entries = Array.from({ length: 4 }, (_, i) => ({ content: `참고 ${i + 1}`, enabled: true, messageIds: [state.rows[i].id] }));
  const prompt = core.buildManualPrompt(snapshot, { startIndex: 1, messages: state.rows.slice(0, 2) });
  assert.ok(!prompt[1].content.includes("참고 1"));
  assert.ok(prompt[1].content.includes("참고 2"));
  assert.ok(prompt[1].content.includes("참고 4"));
}

// The service rejects a second run for the same chat while the first model call is pending.
{
  const state = fixture();
  let release;
  state.onModel = () => new Promise((resolve) => { release = resolve; });
  const first = run(state);
  for (let i = 0; i < 30 && !release; i += 1) await new Promise((resolve) => setTimeout(resolve, 1));
  assert.ok(release);
  await assert.rejects(run(state, "second"), /이미 진행/);
  release();
  assert.equal((await first).kind, "saved");
  assert.equal(state.saveCalls, 1);
}

// Headless Full Page lifecycle: the manual button invokes the service once.
{
  class Target {
    events = new Map();
    addEventListener(name, fn) { const set = this.events.get(name) ?? new Set(); set.add(fn); this.events.set(name, set); }
    removeEventListener(name, fn) { this.events.get(name)?.delete(fn); }
    emit(name) { for (const fn of this.events.get(name) ?? []) fn({}); }
  }
  class Node extends Target {
    constructor() { super(); this.hidden = false; this.disabled = false; this.value = ""; this.checked = false; this.textContent = ""; this.children = []; this.style = {}; }
    set innerHTML(_) { this.parts = Object.fromEntries([".msc-launcher", ".msc-panel", ".msc-status", ".msc-details", ".msc-error", ".msc-auto", ".msc-model", ".msc-interval", ".msc-manual", ".msc-refresh", ".msc-close", ".msc-references", ".msc-overlap", ".msc-overlap-turns", ".msc-dedup", ".msc-prompt", ".msc-reset-prompt", ".msc-advanced", ".msc-work", ".msc-toggle-advanced", ".msc-toggle-work", ".msc-advanced-box", ".msc-work-box", ".msc-header"].map((key) => [key, new Node()])); this.parts[".msc-panel"].hidden = true; this.parts[".msc-advanced"].hidden = true; this.parts[".msc-work"].hidden = true; }
    querySelectorAll() { return []; }
    querySelector(key) { if ([".msc-memory", ".msc-toggle-memory", ".msc-memory-box", ".msc-memory-options", ".msc-memory-status", ".msc-preset-auto", ".msc-preset-apply", ".msc-preset-save", ".msc-preset-status"].includes(key)) return this.parts[key] ??= new Node(); if (ruleSelectors.includes(key)) return this.parts[key] ??= new Node(); return this.parts[key]; }
    appendChild(node) { this.children.push(node); }
    replaceChildren() { this.children = []; }
    setAttribute() {}
    remove() { this.removed = true; }
  }
  const state = fixture();
  const body = new Node();
  const document = { body, createElement: () => new Node(), getElementById: () => null };
  const window = new Target();
  const timers = new Map();
  let nextTimer = 1;
  let cleanup;
  const marinara = {
    fetch: state.fetch, log: { debug() {}, info() {}, warn() {}, error() {} },
    storage: { get: async () => core.storagePatch({ autoRequested: false, connectionId: "model", intervalTurns: 10 }), patch: async (value) => value },
    setInterval(fn) { const id = nextTimer++; timers.set(id, fn); return id; }, clearInterval(id) { timers.delete(id); }, onCleanup(fn) { cleanup = fn; },
  };
  const host = { version: 1, stores: { chat: { getState: () => ({ activeChatId: "chat" }), subscribe: () => () => {} } } };
  const ui = vm.createContext({ __MCS_MEMORY_SETTINGS__: { create: () => ({ load() {}, save() {}, dispose() {} }) }, __MCS_PHASE1_CORE__: core, __MCS_AUTO__: autoModule, __MCS_RULES__: ruleModule, __MCS_BULK__: bulkModule, marinara, document, window, __MARINARA_HOST__: host, crypto: { randomUUID: () => "ui-new" }, AbortController, URLSearchParams, console });
  vm.runInContext(readFileSync(join(folder, "extension.js"), "utf8"), ui);
  await new Promise((resolve) => setTimeout(resolve, 5));
  const root = body.children[0];
  root.parts[".msc-launcher"].emit("click");
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(root.parts[".msc-manual"].disabled, false);
  root.parts[".msc-manual"].emit("click");
  root.parts[".msc-manual"].emit("click");
  for (let i = 0; i < 30 && state.saveCalls === 0; i += 1) await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(state.saveCalls, 1);
  assert.equal(state.calls.filter((call) => call.path === "/api/generate/raw" && !call.body.returnPrompt).length, 1);
  await cleanup();
  assert.equal(timers.size, 0);
  assert.equal(root.removed, true);
}

console.log("Phase 2 verification passed: first/continuation/empty, model and context failures, edit/delete/swipe/summary drift, save drift compensation, provenance, deduplication, hide/tail and composition.");
