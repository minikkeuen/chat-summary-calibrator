import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Worker as ThreadWorker } from "node:worker_threads";
import { randomUUID } from "node:crypto";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const folder = dirname(dirname(fileURLToPath(import.meta.url)));
const source = (name) => readFileSync(join(folder, name), "utf8");
const markup = source("extension.js");
const advancedEnd = markup.indexOf('<section class="msc-box msc-bulk-box">');
const correctionTitle = markup.indexOf('<h3>표현 보정 설정</h3>');
const bulkTitle = markup.indexOf('<h3>기존 요약 일괄 보정</h3>');
const previewTitle = markup.indexOf('<details class="msc-rule-test">');
assert.ok(advancedEnd >= 0 && advancedEnd < correctionTitle && correctionTitle < bulkTitle && bulkTitle < previewTitle);
assert.match(markup, /<strong>요약 표현 보정<\/strong>/);
assert.match(markup, /<details class="msc-rule-test">\s*<summary>미리보기<\/summary>/);
const context = vm.createContext({ console, URLSearchParams, AbortController });
for (const name of ["rules.js", "core.js", "auto.js", "bulk.js"]) vm.runInContext(source(name), context);
const rules = vm.runInContext("__MCS_RULES__", context);
const core = vm.runInContext("__MCS_PHASE1_CORE__", context);
const autoModule = vm.runInContext("__MCS_AUTO__", context);
const bulkModule = vm.runInContext("__MCS_BULK__", context);
const plain = (value) => JSON.parse(JSON.stringify(value));
const info = (name, type = "replace", language = "all") => ({ id: randomUUID(), name, type, language });
const file = (find, replace, type = "replace", language = "all") => rules.parseFile(JSON.stringify([{ "찾을 표현": find, "바꿀 표현": replace }]), info(`${type}_${language}.json`, type, language));
const quality = (ruleFiles, correctionEnabled = true) => ({ ...core.DEFAULT_SETTINGS, connectionId: "model", correctionEnabled, ruleFiles });

assert.deepEqual(plain(rules.inferFile("replace_ko.csv")), { type: "replace", language: "ko" });
assert.deepEqual(plain(rules.inferFile("REGEX_ALL.JSON")), { type: "regex", language: "all" });
assert.equal(rules.inferFile("custom.csv"), null);
assert.equal(rules.inferFile("replace_ko.txt"), null);
const csv = rules.parseFile('\uFEFF찾을 표현,바꿀 표현\r\n"a,b","c""d"\r\n"여러\n줄",한줄\r\n삭제,\r\n', info("custom.csv", "replace", "ko"));
assert.deepEqual(plain(csv.rules), [{ find: "a,b", replace: 'c"d' }, { find: "여러\n줄", replace: "한줄" }, { find: "삭제", replace: "" }]);
assert.deepEqual(plain(rules.parseFile("a,b", info("replace_all.csv")).rules), [{ find: "a", replace: "b" }]);
assert.equal(rules.parseFile('[{"find":"a","replace":"b"}]', info("replace_all.json")).rules[0].find, "a");
for (const text of ['"unfinished,b', 'a"b,c', '"a"x,b', "a,b,c", ",b", "", "찾을 표현,바꿀 표현"]) assert.throws(() => rules.parseFile(text, info("bad.csv")));
for (const text of ["{", "{}", "[]", '[{"find":"a"}]', '[{"찾을 표현":"a","바꿀 표현":2}]']) assert.throws(() => rules.parseFile(text, info("bad.json")));
assert.throws(() => file("[", "x", "regex"), /잘못된 정규식/);
assert.throws(() => file("/a/gg", "x", "regex"), /잘못된 정규식/);
assert.throws(() => rules.parseFile("a,b", info("bad.txt")));
assert.throws(() => rules.parseFile("x".repeat(100_001), info("large.csv")));

assert.equal(rules.apply("a a $&", quality([file("a", "$&")])).text, "$& $& $&"); // Literal replacements never expand $ tokens.
assert.equal(rules.apply("AB ab", quality([file("/(a)(b)/gi", "$2$1", "regex")])).text, "BA ba");
assert.equal(rules.apply("AB ab", quality([file("/ab/i", "x", "regex")])).text, "x ab");
assert.equal(rules.apply("ab ab", quality([file("ab", "x", "regex")])).text, "x x");
assert.equal(rules.apply("a", quality([file("a", "b"), file("b", "c")])).text, "c");
assert.equal(rules.apply("a", quality([file("a", " a "), file(" a ", "b")])).text, "b");
const rowOrder = rules.parseFile("a,b\nb,c", info("replace_all.csv"));
assert.equal(rules.apply("a", quality([rowOrder])).text, "c");
assert.equal(rules.apply("a", quality([{ ...file("a", "b"), enabled: false }, file("b", "c")])).text, "a");
assert.equal(rules.apply("a", quality([file("a", "b")], false)).changed, false);
assert.equal(rules.apply("same", quality([file("other", "x")])).changed, false);

for (const [text, expected] of [["친구를 만났다", "ko"], ["A friend arrived", "en"], ["友人に会った", "ja"], ["注音ㄅㄆ", "zh"], ["朋友见面", "all"], ["친구 Alice", "all"], ["友人 Alice", "all"], ["친구と友人", "all"], ["Latin русский", "all"], ["123!?", "all"]]) assert.equal(rules.detectLanguage(text), expected, text);
const languageFiles = [file("만났다", "재회했다", "replace", "ko"), file("friend", "ally", "replace", "en"), file("友人", "仲間", "replace", "ja"), file("朋友", "同伴", "replace", "zh"), file("!", ".")];
assert.equal(rules.apply("친구를 만났다!", quality(languageFiles)).text, "친구를 재회했다.");
assert.equal(rules.apply("friend!", quality(languageFiles)).text, "ally.");
assert.equal(rules.apply("友人と会う!", quality(languageFiles)).text, "仲間と会う.");
assert.equal(rules.apply("朋友!", quality(languageFiles)).text, "同伴."); // Shared Han is uncertain: all languages, including zh.
assert.equal(rules.apply("친구를 만났다 friend 友人 朋友!", quality(languageFiles)).text, "친구를 재회했다 ally 仲間 同伴.");

// A bad file is rolled back as a unit; other files still run in the same order.
const partial = { ...file("a", "b"), rules: [{ find: "a", replace: "b" }, { find: "b", replace: "" }] };
const badRegex = { ...file("a", "b", "regex"), rules: [{ find: "[", replace: "x" }] };
const recovered = rules.apply("a", quality([partial, badRegex, file("a", "c")]));
assert.equal(recovered.text, "c"); assert.equal(recovered.warnings.length, 2);
assert.equal(rules.apply("aa", quality([file("a", "x".repeat(11_000))])).text, "aa");
const restored = core.settingsFromStorage(core.storagePatch(quality(languageFiles)));
assert.deepEqual(plain(restored.ruleFiles), plain(languageFiles));
assert.equal(restored.correctionEnabled, true);
assert.equal(core.settingsFromStorage(core.storagePatch({ connectionId: "model" })).correctionEnabled, false);

// Run the browser worker source in a real Node worker thread, without a browser or Engine.
const blobs = new Map();
let workerCount = 0;
class BrowserWorker {
  constructor(url) {
    workerCount += 1;
    this.ready = blobs.get(url).text().then((code) => {
      if (this.stopped) return;
      this.worker = new ThreadWorker(`const { parentPort } = require("node:worker_threads"); globalThis.postMessage = (data) => parentPort.postMessage(data); parentPort.on("message", (data) => globalThis.onmessage({data})); ${code}`, { eval: true });
      this.worker.on("message", (data) => this.onmessage?.({ data }));
      this.worker.on("error", (error) => this.onerror?.({ preventDefault() {}, message: error.message }));
    });
  }
  postMessage(value) { this.ready.then(() => { if (!this.stopped) this.worker.postMessage(plain(value)); }); }
  terminate() { this.stopped = true; void this.worker?.terminate(); }
}
const workerContext = vm.createContext({ Blob, Worker: BrowserWorker, URL: { createObjectURL(blob) { const id = randomUUID(); blobs.set(id, blob); return id; }, revokeObjectURL(id) { blobs.delete(id); } }, setTimeout, clearTimeout });
vm.runInContext(source("rules.js"), workerContext);
const workerRules = vm.runInContext("__MCS_RULES__", workerContext);
const processor = workerRules.createProcessor();
const countedWorker = await processor.process("a", quality([file("a", "b")]));
assert.equal(countedWorker.text, "b"); assert.equal(countedWorker.replacementCount, 1);
assert.equal(blobs.size, 0);
const previousWorkers = workerCount;
assert.equal((await processor.process("a", quality([file("a", "b")], false))).text, "a");
assert.equal(workerCount, previousWorkers);
const stuckText = `${"a".repeat(1000)}!`;
const timeout = await processor.process(stuckText, quality([file("(a+)+$", "b", "regex")]));
assert.equal(timeout.text, stuckText); assert.match(timeout.warnings[0], /1초/); assert.equal(blobs.size, 0);
assert.equal(timeout.replacementCount, 0);
const abort = new AbortController();
const cancelled = processor.process(stuckText, quality([file("(a+)+$", "b", "regex")]), abort.signal);
abort.abort(); await assert.rejects(cancelled, /취소/); assert.equal(blobs.size, 0);
processor.dispose(); await assert.rejects(processor.process("a", quality([])), /취소/);
const disposedProcessor = workerRules.createProcessor();
const disposedRun = disposedProcessor.process(stuckText, quality([file("(a+)+$", "b", "regex")]));
disposedProcessor.dispose(); await assert.rejects(disposedRun, /취소/); assert.equal(blobs.size, 0);
const unsupportedContext = vm.createContext({ URL, Blob, setTimeout, clearTimeout });
vm.runInContext(source("rules.js"), unsupportedContext);
const unsupported = vm.runInContext("__MCS_RULES__.createProcessor()", unsupportedContext);
const fallback = await unsupported.process("a", quality([file("a", "b")]));
assert.equal(fallback.text, "a"); assert.equal(fallback.warnings.length, 1);
unsupported.dispose();

// Both manual and auto store only the corrected new content, with identical provenance/hiding.
function fixture() {
  const rows = ["user", "assistant", "user"].map((role, i) => ({ id: `m${i + 1}`, role, content: `대화${i}`, createdAt: `2026-01-01T00:00:0${i}.000Z`, extra: "{}" }));
  const chat = { id: "chat", mode: "roleplay", metadata: { automaticSummaryEnabled: false, summaryEntries: [], summary: "" } };
  const calls = [];
  const reader = { async readSnapshot() { const summary = core.summaryInfo(chat); return plain({ chatId: "chat", mode: "roleplay", messages: rows, messageCount: rows.length, summary, boundary: core.analyzeBoundary(rows, summary.entries) }); } };
  const fetcher = async (path, init) => {
    const body = JSON.parse(init.body); calls.push({ path, body });
    if (path === "/api/generate/raw") return { ok: true, json: async () => body.returnPrompt ? { prompt: { messages: body.messages } } : { content: "과도한 표현" } };
    assert.equal(path, "/api/chats/chat/summary-entries");
    assert.equal(body.operation, "replace");
    chat.metadata.summaryEntries.push({ ...body.entry, hiddenMessageIds: ["m1"] });
    rows[0].extra = '{"hiddenFromAI":true}';
    chat.metadata.summary = body.entry.content;
    return { ok: true, json: async () => plain(chat) };
  };
  const service = core.makeManualService(fetcher, reader, (text, settings) => rules.apply(text, settings));
  return { rows, chat, reader, service, calls };
}
for (const automatic of [false, true]) {
  const f = fixture();
  const settings = quality([badRegex, file("과도한", "절제된", "replace", "ko")]);
  if (automatic) {
    settings.managedChats = { chat: { original: true } }; settings.intervalTurns = 1;
    const notices = [];
    const controller = autoModule.createAutoController({ core, reader: f.reader, fetcher: () => assert.fail("No extra Engine call"), manualService: f.service, getSettings: () => settings, saveSettings: () => true, onState(chatId, notice) { notices.push(notice); }, isManualBusy: () => false, newId: () => "auto-new" });
    await controller.submit("chat", { throughMessageId: "m2", messages: [plain(f.rows[1])] });
    assert.match(notices.at(-1).error, /잘못된 정규식/);
  } else {
    const result = await f.service.run("chat", "model", "manual-new", new AbortController().signal, () => {}, { quality: settings });
    assert.equal(result.correction.warnings.length, 1);
  }
  assert.equal(f.chat.metadata.summaryEntries[0].content, "절제된 표현");
  assert.deepEqual(f.chat.metadata.summaryEntries[0].messageIds, ["m1", "m2"]);
  assert.deepEqual(f.chat.metadata.summaryEntries[0].hiddenMessageIds, ["m1"]);
  assert.equal(f.calls.filter((call) => call.path === "/api/generate/raw" && !call.body.returnPrompt).length, 1);
  assert.equal(f.calls.filter((call) => call.path.endsWith("summary-entries")).length, 1);
}
for (const settings of [quality([file("none", "x")]), quality([file("과도한", "절제된")], false)]) {
  const f = fixture(); await f.service.run("chat", "model", "unchanged", new AbortController().signal, () => {}, { quality: settings });
  assert.equal(f.chat.metadata.summary, "과도한 표현");
  assert.equal(f.calls.filter((call) => call.path.endsWith("summary-entries")).length, 1);
}

// Full Page controls: upload classification, persistence, file toggles/deletion and read-only preview.
{
  class Target {
    listeners = new Map();
    addEventListener(type, fn) { const items = this.listeners.get(type) ?? new Set(); items.add(fn); this.listeners.set(type, items); }
    removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
    emit(type, event = {}) { for (const fn of this.listeners.get(type) ?? []) fn(event); }
  }
  class Element extends Target {
    constructor() { super(); this.children = []; this.value = ""; this.textContent = ""; this.disabled = false; this.checked = false; this.style = {}; this.attrs = {}; }
    set innerHTML(html) { this.parts = {}; for (const match of html.matchAll(/class="([^"]+)"/g)) for (const name of match[1].split(" ")) this.parts[`.${name}`] = new Element(); this.parts[".msc-panel"].hidden = true; this.parts[".msc-correction-enabled"].disabled = true; }
    querySelectorAll() { return []; }
    querySelector(selector) { return this.parts?.[selector] ?? null; }
    setAttribute(name, value) { this.attrs[name] = value; }
    getAttribute(name) { return this.attrs[name] ?? null; }
    appendChild(child) { this.children.push(child); }
    replaceChildren() { this.children = []; this.textContent = ""; }
    click() { this.clicked = true; }
    remove() { this.removed = true; }
  }
  const body = new Element(), window = new Target(), timers = new Map();
  let confirmResult = true, confirmationCount = 0;
  window.confirm = (message) => { confirmationCount += 1; assert.match(message, /덮어쓰시겠습니까/); return confirmResult; };
  const document = { body, getElementById: () => null, querySelector: () => null, createElement: () => new Element() };
  let stored = plain(core.storagePatch({ ...core.DEFAULT_SETTINGS, connectionId: "model" })), cleanup, timerId = 0, patchCount = 0, failPatch = false;
  const apiCalls = [];
  const marinara = {
    fetch: async (path) => { apiCalls.push(path); assert.equal(path, "/api/connections"); return { ok: true, json: async () => [] }; },
    storage: { get: async () => plain(stored), patch: async (patch) => { patchCount += 1; if (failPatch) { failPatch = false; throw new Error("offline"); } stored = plain(patch); } },
    log: { warn() {}, error() {}, debug() {} },
    setInterval(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id; }, clearInterval(id) { timers.delete(id); }, onCleanup(fn) { cleanup = fn; },
  };
  const ui = vm.createContext({ __MCS_MEMORY_SETTINGS__: { create: () => ({ load() {}, save() {}, dispose() {} }) }, __MCS_PHASE1_CORE__: core, __MCS_AUTO__: autoModule, __MCS_RULES__: workerRules, __MCS_BULK__: bulkModule, document, window, marinara, crypto: { randomUUID }, AbortController, console });
  const waitFor = async (condition) => { for (let i = 0; i < 300 && !condition(); i += 1) await new Promise((resolve) => setTimeout(resolve, 2)); assert.ok(condition()); };
  vm.runInContext(source("extension.js"), ui);
  let root = body.children.at(-1);
  const part = (name) => root.parts[`.msc-${name}`];
  const savedFiles = () => stored[core.STORAGE_KEY].settings.ruleFiles;
  await waitFor(() => !part("correction-enabled").disabled);
  assert.equal(part("rule-options").hidden, true);
  part("rule-open").emit("click"); assert.equal(part("rule-upload").clicked, true);
  const upload = (name, text) => { part("rule-upload").files = [{ name, size: Buffer.byteLength(text), text: async () => text }]; part("rule-upload").emit("change"); };
  upload("replace_ko.csv", "찾을 표현,바꿀 표현\n과도한,절제된");
  assert.equal(part("rule-type").value, "replace"); assert.equal(part("rule-language").value, "ko"); assert.equal(part("rule-type").disabled, true);
  await waitFor(() => savedFiles().length === 1 && part("rule-notice").textContent.includes("추가했습니다"));
  assert.equal(savedFiles()[0].enabled, true); assert.equal(stored[core.STORAGE_KEY].settings.correctionEnabled, false);
  upload("custom.json", '[{"찾을 표현":"강한","바꿀 표현":"약한"}]');
  assert.equal(part("rule-options").hidden, false); assert.equal(part("rule-type").disabled, false);
  part("rule-type").value = "regex"; part("rule-type").emit("change");
  assert.equal(savedFiles().length, 1);
  part("rule-language").value = "all"; part("rule-language").emit("change");
  await waitFor(() => savedFiles().length === 2 && part("rule-options").hidden);
  await waitFor(() => !part("rule-upload").disabled);
  upload("regex_all.json", '[{"찾을 표현":"[","바꿀 표현":"x"}]');
  await waitFor(() => part("rule-notice").textContent.includes("잘못된 정규식"));
  assert.equal(savedFiles().length, 2);
  upload("replace_all.csv", '"unfinished');
  await waitFor(() => part("rule-notice").textContent.includes("따옴표")); assert.equal(savedFiles().length, 2);
  upload("replace_all.json", "{");
  await waitFor(() => part("rule-notice").textContent.includes("JSON 문법")); assert.equal(savedFiles().length, 2);
  failPatch = true;
  upload("replace_all.csv", "a,b");
  await waitFor(() => part("rule-notice").textContent.includes("저장하지 못했습니다")); assert.equal(savedFiles().length, 2);
  const toggleTarget = { checked: false, getAttribute: (key) => key === "data-rule-toggle" ? "0" : null };
  part("rule-list").emit("change", { target: toggleTarget }); await waitFor(() => savedFiles()[0].enabled === false);
  const original = plain(savedFiles());
  confirmResult = false;
  upload("replace_ko.csv", "과도한,순한");
  await waitFor(() => part("rule-notice").textContent.includes("취소했습니다"));
  assert.deepEqual(savedFiles(), original); assert.equal(confirmationCount, 1);
  confirmResult = true;
  upload("replace_ko.csv", "과도한,순한");
  await waitFor(() => part("rule-notice").textContent.includes("덮어썼습니다"));
  assert.equal(confirmationCount, 2); assert.equal(savedFiles().length, 2);
  assert.equal(savedFiles()[0].id, original[0].id); assert.equal(savedFiles()[0].enabled, false);
  assert.equal(savedFiles()[0].rules[0].replace, "순한"); assert.deepEqual(savedFiles()[1], original[1]);
  const afterReplacement = plain(savedFiles());
  upload("replace_ko.csv", '"unfinished');
  await waitFor(() => part("rule-notice").textContent.includes("따옴표"));
  assert.deepEqual(savedFiles(), afterReplacement); assert.equal(confirmationCount, 2);
  failPatch = true;
  upload("replace_ko.csv", "과도한,실패");
  await waitFor(() => part("rule-notice").textContent.includes("저장하지 못했습니다"));
  assert.deepEqual(savedFiles(), afterReplacement); assert.equal(confirmationCount, 3);
  upload("replace_ko.csv", "과도한,절제된");
  await waitFor(() => savedFiles()[0].rules[0].replace === "절제된" && !part("rule-upload").disabled);
  part("rule-list").emit("click", { target: { getAttribute: (key) => key === "data-rule-delete" ? "1" : null } });
  await waitFor(() => savedFiles().length === 1);
  toggleTarget.checked = true; part("rule-list").emit("change", { target: toggleTarget }); await waitFor(() => savedFiles()[0].enabled === true);
  part("correction-enabled").checked = true; part("correction-enabled").emit("change");
  await waitFor(() => stored[core.STORAGE_KEY].settings.correctionEnabled);
  part("rule-source").value = "매우 과도한 표현";
  const patchesBeforePreview = patchCount;
  part("rule-preview").emit("click"); await waitFor(() => part("rule-result").value === "매우 절제된 표현");
  assert.equal(patchCount, patchesBeforePreview); assert.equal(apiCalls.length, 1);
  part("correction-enabled").checked = false; part("correction-enabled").emit("change");
  await waitFor(() => !stored[core.STORAGE_KEY].settings.correctionEnabled);
  part("rule-preview").emit("click"); await waitFor(() => part("rule-result").value === "매우 과도한 표현");
  assert.match(part("rule-preview-status").textContent, /꺼짐/);
  await cleanup(); assert.equal(timers.size, 0); assert.equal(blobs.size, 0);
  vm.runInContext(source("extension.js"), ui); root = body.children.at(-1);
  await waitFor(() => !part("correction-enabled").disabled);
  assert.equal(part("rule-list").children.length, 1); assert.equal(savedFiles()[0].name, "replace_ko.csv");
  await cleanup(); assert.equal(timers.size, 0);
}

console.log("Phase 5 verification passed: CSV/JSON imports and errors, JS literal/regex semantics, language routing, ordering/toggles, per-file rollback, real worker execution/timeout/cancel, settings migration, manual/automatic corrected save and unchanged provenance/hiding/model-call count, Full Page upload/classification/toggle/delete/persistence/preview/failure UI.");
