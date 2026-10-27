import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const folder = dirname(dirname(fileURLToPath(import.meta.url)));
const source = (name) => readFileSync(join(folder, name), "utf8");
const context = vm.createContext({ URLSearchParams, AbortController, console });
for (const name of ["rules.js", "core.js", "auto.js", "bulk.js"]) vm.runInContext(source(name), context);
const core = vm.runInContext("__MCS_PHASE1_CORE__", context);
const rules = vm.runInContext("__MCS_RULES__", context);
const bulk = vm.runInContext("__MCS_BULK__", context);
const auto = vm.runInContext("__MCS_AUTO__", context);
const copy = (value) => JSON.parse(JSON.stringify(value));
const file = (find, replace, type = "replace") => rules.parseFile(JSON.stringify([{ find, replace }]), { id: "rule", name: `${type}_all.json`, type, language: "all" });
const quality = (files = [file("old", "new")]) => ({ ...core.DEFAULT_SETTINGS, ruleFiles: files, correctionEnabled: false });
const corrected = (text, files) => rules.apply(text, { ...quality(files), correctionEnabled: true });

// Counts exclude identical matches, failed files and do not change JS replacement semantics.
assert.equal(corrected("old old", [file("old", "new")]).replacementCount, 2);
assert.equal(corrected("old old", [file("old", "old")]).replacementCount, 0);
assert.equal(corrected("old old", [file("old", "new", "regex")]).replacementCount, 2);
assert.equal(corrected("ab", [file("/(a)|(b)/g", "$1", "regex")]).replacementCount, 1);
assert.equal(corrected("a", [file("/(?=a)/g", "!", "regex")]).replacementCount, 1);
assert.equal(corrected("a", [file("/$/", "", "regex")]).replacementCount, 0);
for (const [pattern, flags] of [["(a)(b)?", "g"], ["(?<first>a)(?<second>b)?", "g"], ["a", "gi"], [".", "gu"], ["a", "y"]]) {
  for (const replacement of ["$$", "$&", "$`", "$'", "$0", "$00", "$01", "$09", "$1", "$2", "$10", "$12", "$99", "$<first>", "$<missing>", "$<unfinished", "x$1$$$&"]) {
    const text = "ab a😀";
    const expected = text.replace(new RegExp(pattern, flags), replacement);
    const result = corrected(text, [file(`/${pattern}/${flags}`, replacement, "regex")]);
    assert.equal(result.text, expected === text ? text : expected.trim(), `${pattern}/${flags}: ${replacement}`);
  }
}
const badFile = { ...file("a", "b"), rules: [{ find: "a", replace: "b" }, { find: "b", replace: "" }] };
const recovered = corrected("a", [badFile, file("a", "c")]);
assert.equal(recovered.text, "c"); assert.equal(recovered.replacementCount, 1); assert.equal(recovered.warnings.length, 1);
const reversed = corrected("a", [file("a", "b"), file("b", "a")]);
assert.equal(reversed.text, "a"); assert.equal(reversed.changed, false); assert.equal(reversed.replacementCount, 2);
assert.equal(rules.apply("old", quality()).replacementCount, 0);

function fixture({ legacy = false, processor } = {}) {
  const entry = (id, content, enabled = true) => ({ id, kind: "rolling", origin: "manual", title: `항목 ${id}`, content, enabled, sourceMode: "range", messageIds: [`${id}-u`, `${id}-a`], hiddenMessageIds: [`${id}-u`], rangeStartIndex: 1, rangeEndIndex: 2, messageCount: 2, tokenEstimate: 123, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", promptTemplateId: "keep" });
  const chat = { id: "chat", mode: "roleplay", name: "조사 대화", metadata: { branchName: "분기", automaticSummaryEnabled: false, hideSummarisedMessages: true, summaryTailMessages: 5, advancedMemory: { enabled: false, untouched: "keep" }, custom: { keep: 1 }, ...(legacy ? { summary: "old old" } : { summaryEntries: [entry("one", "old old"), entry("two", "old", false), entry("three", "same")], summary: "old old\n\nsame" }) } };
  const f = { chat, calls: [], behavior: new Map(), readCount: 0, processCount: 0, async onRead() {}, async onPatch() {} };
  const originalMetadata = copy(chat.metadata);
  const fetcher = async (path, init = {}) => {
    const method = init.method ?? "GET";
    f.calls.push({ path, method, body: init.body && JSON.parse(init.body) });
    if (path === "/api/connections") return { ok: true, json: async () => [] };
    if (method === "GET" && path === "/api/chats/chat") { f.readCount += 1; await f.onRead(f.readCount); return { ok: true, json: async () => copy(chat) }; }
    assert.equal(method, "PATCH"); assert.equal(init.headers["x-marinara-csrf"], "1");
    assert.equal(init.signal, undefined, "Do not abort an in-flight edit response");
    const body = JSON.parse(init.body), id = body.entry?.id ?? "legacy", behavior = f.behavior.get(id);
    await f.onPatch(id);
    if (behavior === "400") return { ok: false, status: 400 };
    if (behavior === "offline") throw new Error("network unavailable");
    if (body.entry) {
      assert.equal(path, "/api/chats/chat/summary-entries"); assert.equal(body.operation, "replace");
      assert.deepEqual(Object.keys(body.entry).sort(), ["content", "id", "tokenEstimate"]);
      assert.equal(body.entry.tokenEstimate, body.entry.content.trim().length);
      const index = chat.metadata.summaryEntries.findIndex((item) => item.id === id);
      assert.ok(index >= 0, "Never revive a removed fixture entry");
      chat.metadata.summaryEntries[index] = { ...chat.metadata.summaryEntries[index], ...body.entry, updatedAt: "2026-02-01T00:00:00.000Z" };
      chat.metadata.summary = chat.metadata.summaryEntries.filter((item) => item.enabled).map((item) => item.content.trim()).join("\n\n") || null;
    } else { assert.equal(path, "/api/chats/chat/metadata"); assert.deepEqual(Object.keys(body), ["summary"]); chat.metadata.summary = body.summary; }
    if (behavior === "lost") throw new Error("response lost after commit");
    if (behavior === "500") return { ok: false, status: 500 };
    return { ok: true, json: async () => { if (behavior === "json") throw new Error("invalid JSON response"); if (behavior === "mismatch") return { id: "chat", metadata: {} }; return copy(chat); } };
  };
  const expressionProcessor = processor ?? { async process(text, settings, signal) { f.processCount += 1; if (signal?.aborted) throw new Error("취소"); assert.equal(settings.correctionEnabled, true); return rules.apply(text, settings); } };
  const reader = core.makeReader(fetcher);
  const service = bulk.createService({ core, reader, fetcher, processor: expressionProcessor, estimateTextTokens: (text) => text.length });
  Object.assign(f, { fetcher, reader, service, originalMetadata, processor: expressionProcessor, writes: () => f.calls.filter((call) => call.method === "PATCH") });
  return f;
}
async function previewAll(f, settings = quality()) { const snapshot = await f.service.load("chat"); return f.service.preview(snapshot, snapshot.rows.map((row) => row.key), settings); }
{
  const f = fixture(), settings = quality(), preview = await previewAll(f, settings);
  assert.equal(f.writes().length, 0); assert.equal(settings.correctionEnabled, false);
  assert.equal(preview.items[1].enabled, false); assert.equal(preview.items[2].status, "unchanged");
  const processCount = f.processCount;
  const result = await f.service.apply(preview, settings);
  assert.deepEqual(copy(result.stats), { processed: 3, modified: 2, replacements: 3, unchanged: 1, failed: 0, uncertain: 0, excluded: 0 });
  assert.equal(f.processCount, processCount, "Save approved content without rerunning rules");
  assert.equal(f.readCount, 3, "One load and one validation GET per changed item; no final GET");
  assert.equal(f.writes().length, 2);
  assert.deepEqual(f.chat.metadata.summaryEntries.map((item) => item.id), ["one", "two", "three"]);
  for (let i = 0; i < 2; i += 1) {
    const { content, tokenEstimate, updatedAt, ...metadata } = f.chat.metadata.summaryEntries[i];
    const { content: old, tokenEstimate: oldTokens, updatedAt: oldTime, ...before } = f.originalMetadata.summaryEntries[i];
    assert.deepEqual(metadata, before);
  }
  assert.deepEqual(f.chat.metadata.summaryEntries[2], f.originalMetadata.summaryEntries[2]);
  assert.deepEqual(f.chat.metadata.advancedMemory, f.originalMetadata.advancedMemory);
  assert.equal(f.chat.metadata.summary, "new new\n\nsame");
}
{
  const f = fixture(), snapshot = await f.service.load("chat");
  const preview = await f.service.preview(snapshot, ["1"], quality());
  const result = await f.service.apply(preview, quality());
  assert.equal(result.stats.modified, 1); assert.equal(result.stats.replacements, 1);
  assert.deepEqual(f.chat.metadata.summaryEntries[0], f.originalMetadata.summaryEntries[0]);
  assert.equal(f.chat.metadata.summaryEntries[1].enabled, false);
}
{
  const f = fixture({ legacy: true }), preview = await previewAll(f);
  assert.equal(preview.items.length, 1); assert.equal(preview.items[0].legacy, true);
  const result = await f.service.apply(preview, quality());
  assert.equal(result.stats.modified, 1); assert.equal(result.stats.replacements, 2);
  assert.equal(f.chat.metadata.summary, "new new"); assert.equal("summaryEntries" in f.chat.metadata, false);
  const { summary, ...rest } = f.chat.metadata, { summary: old, ...oldRest } = f.originalMetadata;
  assert.deepEqual(rest, oldRest);
}
{
  const f = fixture({ legacy: true }); f.chat.metadata.summaryEntries = [];
  assert.equal((await f.service.load("chat")).rows.length, 0, "Never process compiled summary when an entries array exists");
}
for (const legacy of [false, true]) {
  const f = fixture({ legacy }), preview = await previewAll(f);
  if (legacy) f.chat.metadata.summary = "user edit";
  else { f.chat.metadata.summaryEntries[0].content = "user edit"; f.chat.metadata.summaryEntries.splice(1, 1); }
  const result = await f.service.apply(preview, quality());
  assert.equal(result.items[0].status, "source_changed");
  if (!legacy) assert.equal(result.items[1].status, "deleted");
  assert.equal(f.writes().length, 0);
}
{
  const f = fixture({ legacy: true }), preview = await previewAll(f);
  f.chat.metadata.summaryEntries = [{ id: "new", content: "external summary" }];
  const result = await f.service.apply(preview, quality());
  assert.equal(result.items[0].status, "source_changed"); assert.equal(f.writes().length, 0);
}
{
  const f = fixture({ legacy: true }), preview = await previewAll(f);
  f.chat.metadata.summaryEntries = [];
  const result = await f.service.apply(preview, quality());
  assert.equal(result.items[0].status, "source_changed"); assert.equal(f.writes().length, 0);
}
for (const behavior of ["400", "500", "offline", "lost", "json", "mismatch"]) {
  const f = fixture(); f.behavior.set("one", behavior);
  const result = await f.service.apply(await previewAll(f), quality());
  assert.equal(result.items[0].status, behavior === "400" ? "save_failed" : "uncertain");
  assert.equal(result.items[1].status, "saved");
  assert.equal(result.stats.modified, 1); assert.equal(result.stats.replacements, 1);
  assert.equal(f.writes().length, 2); assert.equal(f.calls.some((call) => call.body?.operation === "delete"), false);
  if (["lost", "json", "500", "mismatch"].includes(behavior)) assert.equal(f.chat.metadata.summaryEntries[0].content, "new new");
}
{
  const f = fixture(), preview = await previewAll(f);
  f.onRead = async (number) => { if (number === 3) throw new Error("follow-up read unavailable"); };
  const result = await f.service.apply(preview, quality());
  assert.equal(result.items[0].status, "saved"); assert.equal(result.items[1].status, "save_failed");
  assert.equal(result.stats.replacements, 2); assert.equal(f.chat.metadata.summaryEntries[0].content, "new new");
}
{
  const f = fixture(), preview = await previewAll(f), controller = new AbortController();
  f.onPatch = async () => controller.abort();
  const result = await f.service.apply(preview, quality(), controller.signal);
  assert.equal(result.items[0].status, "saved"); assert.equal(result.items[1].status, "not_saved");
  assert.equal(result.stats.modified, 1); assert.equal(result.stats.replacements, 2); assert.equal(f.writes().length, 1);
}
{
  const f = fixture(), preview = await previewAll(f);
  await assert.rejects(f.service.apply(preview, quality([file("old", "different")])), /설정이 변경/);
  assert.equal(f.readCount, 1); assert.equal(f.writes().length, 0);
}
{
  const f = fixture({ processor: { async process(text) { return { text, changed: false, replacementCount: 0, warnings: ["시간 초과"] }; } } });
  const result = await f.service.apply(await previewAll(f), quality());
  assert.equal(result.stats.failed, 3); assert.equal(result.stats.replacements, 0); assert.equal(f.writes().length, 0);
}
{
  const f = fixture(), settings = quality([file("old", "temp"), file("temp", "old")]);
  const result = await f.service.apply(await previewAll(f, settings), settings);
  assert.equal(result.stats.unchanged, 3); assert.equal(result.stats.modified, 0); assert.equal(result.stats.replacements, 0); assert.equal(f.writes().length, 0);
}
{
  const controller = new AbortController();
  const f = fixture({ processor: { async process() { controller.abort(); throw new Error("취소"); } } });
  const snapshot = await f.service.load("chat");
  await assert.rejects(f.service.preview(snapshot, ["0", "1"], quality(), controller.signal), /취소/);
  assert.equal(f.writes().length, 0);
}
for (const [before, after] of [["old a old", "new a new"], ["😀 old", "😀 new"], ["a", ""], ["", "b"], ["same", "same"], ["a ".repeat(1000), "b ".repeat(1000)]]) {
  const diff = bulk.diffText(before, after);
  assert.equal(diff.before.map((part) => part.text).join(""), before);
  assert.equal(diff.after.map((part) => part.text).join(""), after);
  if (before !== after) assert.ok([...diff.before, ...diff.after].some((part) => part.changed));
}

// DOM controls are exercised without starting Marinara, a browser, or a model.
class Target {
  listeners = new Map();
  addEventListener(type, fn) { const set = this.listeners.get(type) ?? new Set(); set.add(fn); this.listeners.set(type, set); }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  emit(type, event = {}) { for (const fn of this.listeners.get(type) ?? []) fn(event); }
}
class Element extends Target {
  constructor() { super(); this.children = []; this.value = ""; this.textContent = ""; this.disabled = false; this.checked = false; this.style = {}; this.attrs = {}; }
  set innerHTML(html) { this.parts = {}; for (const match of html.matchAll(/class="([^"]+)"/g)) for (const name of match[1].split(" ")) this.parts[`.${name}`] = new Element(); for (const name of [".msc-panel", ".msc-bulk", ".msc-advanced", ".msc-work"]) this.parts[name].hidden = true; this.parts[".msc-correction-enabled"].disabled = true; }
  querySelector(selector) { return this.parts?.[selector] ?? null; }
  querySelectorAll(selector) { return this.children.flatMap((child) => [...(selector === "input" && child.type === "checkbox" ? [child] : []), ...child.querySelectorAll(selector)]); }
  setAttribute(name, value) { this.attrs[name] = value; }
  getAttribute(name) { return this.attrs[name] ?? null; }
  appendChild(child) { this.children.push(child); }
  replaceChildren() { this.children = []; this.textContent = ""; }
  contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
  remove() { this.removed = true; }
}
async function uiFixture(options) {
  const f = fixture(options), body = new Element(), window = new Target(), timers = new Map();
  let activeChatId = "chat", cleanup, nextTimer = 0, stored = core.storagePatch({ ...quality(), connectionId: "model" }), manualBusy;
  const subscriptions = new Set();
  const marinara = { fetch: f.fetcher, estimateTextTokens: (text) => text.length, log: { warn() {}, error() {}, debug() {} }, storage: { get: async () => copy(stored), patch: async (value) => { stored = copy(value); } }, setInterval(fn) { const id = ++nextTimer; timers.set(id, fn); return id; }, clearInterval(id) { timers.delete(id); }, onCleanup(fn) { cleanup = fn; } };
  const document = { body, getElementById: () => null, querySelector: () => null, createElement: () => new Element() };
  const ruleApi = { ...rules, createProcessor: () => ({ process: async (text, settings, signal) => { if (signal?.aborted) throw new Error("취소"); return rules.apply(text, settings); }, dispose() {} }) };
  const autoApi = { ...auto, createAutoController(options) { manualBusy = options.isManualBusy; return auto.createAutoController(options); } };
  const host = { version: 1, stores: { chat: { getState: () => ({ activeChatId }), subscribe(fn) { subscriptions.add(fn); return () => subscriptions.delete(fn); } } } };
  const ui = vm.createContext({ __MCS_MEMORY_SETTINGS__: { create: () => ({ load() {}, save() {}, dispose() {} }) }, __MCS_PHASE1_CORE__: core, __MCS_AUTO__: autoApi, __MCS_RULES__: ruleApi, __MCS_BULK__: bulk, marinara, document, window, __MARINARA_HOST__: host, crypto: { randomUUID: () => "new-id" }, AbortController, console });
  vm.runInContext(source("extension.js"), ui);
  const root = body.children[0], part = (name) => root.parts[`.msc-${name}`];
  const waitFor = async (condition) => { for (let i = 0; i < 200 && !condition(); i += 1) await new Promise((resolve) => setTimeout(resolve, 2)); assert.ok(condition()); };
  await waitFor(() => !part("correction-enabled").disabled);
  const load = async () => { part("bulk-load").emit("click"); await waitFor(() => part("bulk-result").textContent.includes("보정할 요약")); };
  const selectAll = () => { part("bulk-all").checked = true; part("bulk-all").emit("change"); };
  const preview = async () => { part("bulk-preview").emit("click"); await waitFor(() => part("bulk-result").textContent.includes("미리보기 ·")); };
  return { ...f, control: f, part, waitFor, load, selectAll, preview, manualBusy: () => manualBusy("chat"), async cleanup() { await cleanup(); assert.equal(timers.size, 0); }, switchChat() { activeChatId = "other"; for (const fn of subscriptions) fn(); } };
}
{
  const u = await uiFixture();
  assert.equal(u.part("bulk").hidden, true);
  u.part("bulk-box").emit("click", { target: u.part("toggle-bulk") }); assert.equal(u.part("bulk").hidden, false);
  assert.equal(u.calls.filter((call) => call.path.includes("messages")).length, 0);
  await u.load(); u.selectAll(); assert.match(u.part("bulk-selected").textContent, /3개/);
  await u.preview(); assert.equal(u.writes().length, 0); assert.equal(u.part("bulk-apply").disabled, false);
  assert.match(u.part("bulk-result").textContent, /예상 치환 3건/);
  assert.equal(u.part("bulk-comparisons").children.length, 3);
  u.part("bulk-list").emit("change", { target: { checked: false, getAttribute: () => "1" } });
  assert.equal(u.part("bulk-apply").disabled, true); assert.match(u.part("bulk-selected").textContent, /2개/);
  u.selectAll(); await u.preview();
  u.part("correction-enabled").checked = true; u.part("correction-enabled").emit("change");
  assert.equal(u.part("bulk-apply").disabled, true);
  u.part("correction-enabled").checked = false; u.part("correction-enabled").emit("change");
  await u.waitFor(() => u.part("correction-enabled").checked === false);
  await u.preview();
  let release, entered = false; const gate = new Promise((resolve) => { release = resolve; });
  u.control.onPatch = async (id) => { if (id === "one") { entered = true; await gate; } };
  const first = u.part("bulk-apply"); first.emit("click");
  await u.waitFor(() => entered);
  assert.equal(u.manualBusy(), true); assert.equal(u.part("manual").disabled, true);
  u.part("manual").emit("click"); first.emit("click");
  assert.equal(u.calls.some((call) => call.path.includes("generate")), false);
  release();
  await u.waitFor(() => u.part("bulk-result").textContent.includes("표현 보정 완료"));
  assert.equal(u.writes().length, 2);
  assert.match(u.part("bulk-result").textContent, /수정된 요약 2개 · 수정된 어휘 3건/);
  assert.equal(u.part("bulk-apply").disabled, true); assert.equal(u.part("bulk-preview").disabled, true);
  assert.equal(u.manualBusy(), false);
  assert.equal(u.calls.some((call) => call.path.includes("messages") || call.path.includes("generate")), false);
  first.emit("click"); assert.equal(u.writes().length, 2);
  await u.cleanup();
}
{
  const u = await uiFixture({ legacy: true }); await u.load(); u.selectAll(); await u.preview();
  u.part("bulk-apply").emit("click"); await u.waitFor(() => u.part("bulk-result").textContent.includes("표현 보정 완료"));
  assert.match(u.part("bulk-result").textContent, /수정된 요약 1개 · 수정된 어휘 2건/);
  assert.equal(u.writes()[0].path, "/api/chats/chat/metadata"); assert.equal("summaryEntries" in u.chat.metadata, false);
  await u.load(); u.selectAll(); await u.preview();
  u.switchChat(); assert.equal(u.part("bulk-apply").disabled, true); assert.equal(u.part("bulk-comparisons").children.length, 0);
  await u.cleanup();
}
{
  const u = await uiFixture(); await u.load(); u.selectAll(); await u.preview();
  let entered = false, release; const gate = new Promise((resolve) => { release = resolve; });
  u.control.onPatch = async () => { entered = true; await gate; };
  u.part("bulk-apply").emit("click"); await u.waitFor(() => entered);
  u.part("correction-enabled").checked = true; u.part("correction-enabled").emit("change");
  release(); await u.waitFor(() => u.part("bulk-result").textContent.includes("표현 보정 완료"));
  assert.equal(u.writes().length, 1);
  assert.match(u.part("bulk-result").textContent, /수정된 요약 1개 · 수정된 어휘 2건/);
  assert.match(u.part("bulk-result").textContent, /저장 제외 1개/);
  await u.cleanup();
}

console.log("Phase 6 verification passed: native JS substitution/count parity, rolled-back/cancelled counts, entries/Legacy selection and exact content-only writes, preview approval, stale/deleted sources, per-item partial failures and unknown commits, no rollback/retry/final GET, metadata/order/hiding preservation, diff, rules/selection/chat invalidation, Full Page controls and completion totals.");
