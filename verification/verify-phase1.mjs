import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const folder = dirname(dirname(fileURLToPath(import.meta.url)));
const source = (name) => readFileSync(join(folder, name), "utf8");
const context = vm.createContext({ URLSearchParams, AbortController, console });
vm.runInContext(source("core.js"), context);
vm.runInContext(source("auto.js"), context);
vm.runInContext(source("rules.js"), context);
vm.runInContext(source("bulk.js"), context);
const core = vm.runInContext("__MCS_PHASE1_CORE__", context);
const autoModule = vm.runInContext("__MCS_AUTO__", context);
const ruleModule = vm.runInContext("__MCS_RULES__", context);
const bulkModule = vm.runInContext("__MCS_BULK__", context);
const ruleSelectors = [".msc-correction-enabled", ".msc-rule-open", ".msc-rule-upload", ".msc-rule-options", ".msc-rule-type", ".msc-rule-language", ".msc-rule-notice", ".msc-rule-list", ".msc-rule-source", ".msc-rule-preview", ".msc-rule-result", ".msc-rule-preview-status", ".msc-bulk", ".msc-toggle-bulk", ".msc-bulk-box", ".msc-bulk-load", ".msc-bulk-all", ".msc-bulk-selected", ".msc-bulk-list", ".msc-bulk-preview", ".msc-bulk-apply", ".msc-bulk-result", ".msc-bulk-comparisons"];
const check = (actual, expected) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected);

const messages = Array.from({ length: 451 }, (_, i) => ({
  id: `id ${String(i + 1).padStart(3, "0")}|가`,
  chatId: "a",
  createdAt: new Date(1_700_000_000_000 + Math.floor(i / 4) * 1000).toISOString(),
  role: i % 2 === 0 ? "user" : "assistant",
  swipeCount: i === 1 ? 7 : 0,
}));
let chat = { id: "a", name: "테스트 대화", metadata: { branchName: "분기 A", automaticSummaryEnabled: true, summaryEntries: [
  { id: "second", content: "B", enabled: true, messageIds: [messages[3].id, messages[2].id] },
  { id: "first", content: "A", enabled: true, messageIds: [messages[0].id, messages[1].id] },
  { id: "disabled", content: "C", enabled: false, messageIds: [messages[10].id] },
] } };
let calls = [];
let rows = messages;
let mutateOnce = false;
async function fetcher(path, init) {
  calls.push({ path, method: init.method });
  assert.equal(init.method, "GET");
  if (path === "/api/connections") return reply([{ id: "m1", name: "Text", model: "gpt", provider: "openai" }, { id: "m2", name: "Image", model: "img", provider: "image_generation" }]);
  const url = new URL(path, "http://localhost");
  if (url.pathname === "/api/chats/a") return reply(chat);
  if (url.pathname === "/api/chats/a/message-count") return reply({ count: rows.length });
  if (url.pathname === "/api/chats/a/messages") {
    const limit = Number(url.searchParams.get("limit"));
    const before = url.searchParams.get("before");
    const index = before?.indexOf("|") ?? -1;
    const bound = before ? { createdAt: before.slice(0, index), id: decodeURIComponent(before.slice(index + 1)) } : null;
    let selected = rows.filter((row) => !bound || row.createdAt < bound.createdAt || row.createdAt === bound.createdAt && row.id < bound.id).slice(-limit);
    if (mutateOnce) { mutateOnce = false; rows = rows.slice(0, -1); }
    return reply(selected);
  }
  throw new Error(`unexpected request ${path}`);
}
function reply(value) { return { ok: true, json: async () => structuredClone(value) }; }
const reader = core.makeReader(fetcher);
let snapshot = await reader.readSnapshot("a");
assert.equal(snapshot.messageCount, 451);
assert.equal(snapshot.assistantTurns, 225);
assert.equal(snapshot.boundary.lastCovered.id, messages[3].id);
assert.equal(snapshot.boundary.certain, true);
assert.equal(snapshot.boundary.assistantAfterCandidate, 223);
assert.equal(snapshot.boundary.coveredCount, 4);
assert.equal(snapshot.boundary.gapCount, 0);
assert.equal(snapshot.summary.automaticSummaryEnabled, true);
assert.ok(calls.filter((call) => call.path.includes("/messages?")).length >= 4);
assert.ok(calls.some((call) => call.path.includes("before=") && call.path.includes("%25")));
check(await reader.readConnections(), [{ id: "m1", name: "Text", model: "gpt" }]);

const hole = core.analyzeBoundary(messages.slice(0, 4), [{ content: "X", enabled: true, messageIds: [messages[0].id, messages[3].id], hiddenMessageIds: [messages[1].id] }]);
assert.equal(hole.gapCount, 2);
assert.equal(hole.certain, false);
const missing = core.analyzeBoundary(messages.slice(0, 4), [{ content: "X", messageIds: ["deleted", messages[1].id] }]);
assert.equal(missing.missingSourceCount, 1);
assert.equal(missing.certain, false);
const unknown = core.analyzeBoundary(messages.slice(0, 4), [{ content: "legacy", enabled: true }]);
assert.equal(unknown.unknownEntries, 1);
assert.equal(unknown.lastCovered, null);
assert.equal(core.analyzeBoundary(messages.slice(0, 4), [], true).certain, false);
assert.equal(core.countAssistantTurns([{ role: "user" }, { role: "assistant", swipeCount: 9 }, { role: "assistant" }]), 2);

mutateOnce = true;
snapshot = await reader.readSnapshot("a");
assert.equal(snapshot.messageCount, 450);
rows = messages;
const settings = core.settingsFromStorage({});
check(settings, JSON.parse(JSON.stringify(core.DEFAULT_SETTINGS)));
check(core.settingsFromStorage(core.storagePatch({ autoRequested: true, connectionId: "m1", intervalTurns: 18 })), { ...JSON.parse(JSON.stringify(core.DEFAULT_SETTINGS)), connectionId: "m1", intervalTurns: 18 });
assert.throws(() => core.settingsFromStorage({ [core.STORAGE_KEY]: { schemaVersion: 99 } }));

class FakeEventTarget {
  listeners = new Map();
  addEventListener(type, callback) { const set = this.listeners.get(type) ?? new Set(); set.add(callback); this.listeners.set(type, set); }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  emit(type, event = {}) { for (const callback of this.listeners.get(type) ?? []) callback(event); }
}
class FakeElement extends FakeEventTarget {
  constructor(tag = "div") { super(); this.tagName = tag; this.hidden = false; this.disabled = false; this.value = ""; this.checked = false; this.textContent = ""; this.children = []; this.attributes = {}; this.id = ""; this.style = {}; this.parentElement = null; }
  set innerHTML(_) { this.parts = Object.fromEntries([".msc-launcher", ".msc-panel", ".msc-status", ".msc-details", ".msc-error", ".msc-auto", ".msc-model", ".msc-interval", ".msc-manual", ".msc-refresh", ".msc-close", ".msc-references", ".msc-overlap", ".msc-overlap-turns", ".msc-dedup", ".msc-prompt", ".msc-reset-prompt", ".msc-advanced", ".msc-work", ".msc-toggle-advanced", ".msc-toggle-work", ".msc-advanced-box", ".msc-work-box", ".msc-header"].map((name) => [name, new FakeElement()])); this.parts[".msc-panel"].hidden = true; this.parts[".msc-advanced"].hidden = true; this.parts[".msc-work"].hidden = true; this.parts[".msc-auto"].disabled = true; this.parts[".msc-interval"].disabled = true; this.parts[".msc-model"].disabled = true; this.parts[".msc-manual"].disabled = true; }
  querySelectorAll() { return []; }
  querySelector(selector) { if ([".msc-memory", ".msc-toggle-memory", ".msc-memory-box", ".msc-memory-options", ".msc-memory-status", ".msc-preset-auto", ".msc-preset-apply", ".msc-preset-save", ".msc-preset-status"].includes(selector)) return this.parts[selector] ??= new FakeElement(); if (ruleSelectors.includes(selector)) return this.parts[selector] ??= new FakeElement(); return this.parts[selector]; }
  setAttribute(key, value) { this.attributes[key] = value; }
  contains(node) { return node === this || this.children.includes(node); }
  getBoundingClientRect() { return { left: Number.parseFloat(this.style.left) || 100, top: Number.parseFloat(this.style.top) || 60, width: 380, height: 400 }; }
  appendChild(node) { node.parentElement = this; this.children.push(node); }
  prepend(node) { node.parentElement = this; this.children.unshift(node); }
  replaceChildren() { this.children = []; }
  remove() { this.removed = true; if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((node) => node !== this); this.parentElement = null; }
}
const body = new FakeElement();
let active = "a";
let subscriptions = new Set();
const host = { version: 1, stores: { chat: { getState: () => ({ activeChatId: active }), subscribe: (fn) => { subscriptions.add(fn); return () => subscriptions.delete(fn); } } } };
const window = new FakeEventTarget();
window.innerWidth = 1200;
window.innerHeight = 900;
const timers = new Map();
let timerId = 1;
let cleanup;
let ownRecord = {};
let patches = [];
let failNextPatch = false;
const marinara = {
  fetch: fetcher,
  log: { debug() {}, info() {}, warn() {}, error() {} },
  storage: { async get() { return ownRecord; }, async patch(value) { patches.push(value); if (failNextPatch) { failNextPatch = false; throw new Error("storage unavailable"); } ownRecord = { ...ownRecord, ...value }; return ownRecord; } },
  setInterval(fn, ms) { const id = timerId++; timers.set(id, { fn, ms }); return id; },
  clearInterval(id) { timers.delete(id); },
  onCleanup(fn) { cleanup = fn; },
};
let nav = new FakeElement();
const document = { body, querySelector: () => nav, getElementById(id) { return body.children.find((node) => node.id === id && !node.removed) ?? null; }, createElement(tag) { return new FakeElement(tag); } };
const ui = vm.createContext({ __MCS_MEMORY_SETTINGS__: { create: () => ({ load() {}, save() {}, dispose() {} }) }, __MCS_PHASE1_CORE__: core, __MCS_AUTO__: autoModule, __MCS_RULES__: ruleModule, __MCS_BULK__: bulkModule, document, window, marinara, localStorage: { getItem() { return null; } }, __MARINARA_HOST__: host, AbortController, Promise, URLSearchParams, console });
vm.runInContext(source("extension.js"), ui);
await new Promise((resolve) => setTimeout(resolve, 5));
const root = body.children.at(-1);
assert.ok(root);
assert.equal(root.parts[".msc-auto"].disabled, false);
assert.equal(root.parts[".msc-interval"].value, "5");
assert.equal(root.parts[".msc-panel"].hidden, true);
assert.ok(root.parts[".msc-status"].textContent.includes("현재 채팅"));
assert.equal(nav.children[0].children[0], root.parts[".msc-launcher"]);
assert.equal(root.parts[".msc-advanced"].hidden, true);
assert.equal(root.parts[".msc-work"].hidden, true);
root.parts[".msc-advanced-box"].emit("click", { target: root.parts[".msc-toggle-advanced"] });
assert.equal(root.parts[".msc-advanced"].hidden, false);
assert.equal(root.parts[".msc-work"].hidden, true);
root.parts[".msc-work-box"].emit("click", { target: root.parts[".msc-toggle-work"] });
assert.equal(root.parts[".msc-work"].hidden, false);
root.parts[".msc-advanced-box"].emit("click", { target: root.parts[".msc-prompt"] });
assert.equal(root.parts[".msc-advanced"].hidden, false);
root.parts[".msc-advanced-box"].emit("click", { target: root.parts[".msc-toggle-advanced"] });
assert.equal(root.parts[".msc-advanced"].hidden, true);
root.parts[".msc-header"].emit("pointerdown", { button: 0, pointerId: 1, clientX: 110, clientY: 70, target: root.parts[".msc-header"], preventDefault() {} });
window.emit("pointermove", { pointerId: 1, clientX: 310, clientY: 170 });
assert.equal(root.parts[".msc-panel"].style.left, "300px");
assert.equal(root.parts[".msc-panel"].style.top, "160px");
window.emit("pointerup");
nav = new FakeElement();
for (const { fn, ms } of timers.values()) if (ms === 1600) fn();
assert.equal(nav.children[0].children[0], root.parts[".msc-launcher"]);
root.parts[".msc-launcher"].emit("click");
await new Promise((resolve) => setTimeout(resolve, 5));
assert.equal(root.parts[".msc-panel"].hidden, false);
assert.equal([...timers.values()].some((timer) => timer.ms === 30000), false);
assert.ok(root.parts[".msc-status"].textContent.includes("225턴"));
assert.ok(root.parts[".msc-status"].textContent.includes("테스트 대화 · 분기 A"));
assert.ok(root.parts[".msc-status"].textContent.includes("( 메시지 451개 · 225턴 · 요약 3개 )"));
assert.ok(!root.parts[".msc-details"].textContent.includes(messages[3].id));
assert.ok(!root.parts[".msc-details"].textContent.includes("second"));
assert.ok(!root.parts[".msc-details"].textContent.includes("요약 항목 (원래 순서)"));
assert.ok(root.parts[".msc-details"].textContent.includes("Engine 자동 요약: 켜짐"));
const requestsAfterFirstOpen = calls.length;
root.parts[".msc-launcher"].emit("click");
root.parts[".msc-launcher"].emit("click");
window.emit("focus");
window.emit("marinara:generation-complete");
await new Promise((resolve) => setTimeout(resolve, 2));
assert.equal(calls.length, requestsAfterFirstOpen);
root.parts[".msc-refresh"].emit("click");
await new Promise((resolve) => setTimeout(resolve, 3));
assert.ok(calls.length > requestsAfterFirstOpen);
root.parts[".msc-interval"].value = "18";
root.parts[".msc-interval"].emit("change");
await new Promise((resolve) => setTimeout(resolve, 1));
assert.equal(patches.length, 1);
assert.equal(patches[0][core.STORAGE_KEY].settings.intervalTurns, 18);
assert.equal(root.parts[".msc-references"].value, "3");
assert.equal(root.parts[".msc-overlap-turns"].disabled, true);
root.parts[".msc-references"].value = "0";
root.parts[".msc-references"].emit("change");
root.parts[".msc-overlap"].checked = true;
root.parts[".msc-overlap"].emit("change");
root.parts[".msc-overlap-turns"].value = "3";
root.parts[".msc-overlap-turns"].emit("change");
root.parts[".msc-dedup"].checked = false;
root.parts[".msc-dedup"].emit("change");
root.parts[".msc-prompt"].value = "사용자 정의 프롬프트";
root.parts[".msc-prompt"].emit("change");
await new Promise((resolve) => setTimeout(resolve, 5));
assert.equal(ownRecord[core.STORAGE_KEY].settings.referenceCount, 0);
assert.equal(ownRecord[core.STORAGE_KEY].settings.overlapTurns, 3);
assert.equal(ownRecord[core.STORAGE_KEY].settings.dedupEnabled, false);
assert.equal(ownRecord[core.STORAGE_KEY].settings.summaryPrompt, "사용자 정의 프롬프트");
  active = "b";
  root.parts[".msc-refresh"].emit("click"); // Refresh must work before the chat-switch timer fires.
  await new Promise((resolve) => setTimeout(resolve, 3));
  assert.ok(root.parts[".msc-status"].textContent.includes("조회 실패"));
  active = "a";
  for (const fn of subscriptions) fn();
active = "b";
const fetchCountBeforeSwitch = calls.length;
for (const fn of subscriptions) fn();
await new Promise((resolve) => setTimeout(resolve, 3));
assert.equal(calls.length, fetchCountBeforeSwitch);
assert.ok(root.parts[".msc-status"].textContent.includes("새로고침"));
root.parts[".msc-refresh"].emit("click");
await new Promise((resolve) => setTimeout(resolve, 3));
assert.ok(root.parts[".msc-status"].textContent.includes("조회 실패"));
await cleanup();
assert.equal(root.removed, true);
assert.equal(nav.children.length, 0);
assert.equal(timers.size, 0);
assert.equal(subscriptions.size, 0);
assert.equal([...window.listeners.values()].reduce((sum, item) => sum + item.size, 0), 0);
active = "a";
vm.runInContext(source("extension.js"), ui);
await new Promise((resolve) => setTimeout(resolve, 5));
const restoredRoot = body.children.at(-1);
assert.notEqual(restoredRoot, root);
assert.equal(restoredRoot.parts[".msc-interval"].value, "18");
assert.equal(restoredRoot.parts[".msc-references"].value, "0");
assert.equal(restoredRoot.parts[".msc-overlap"].checked, true);
assert.equal(restoredRoot.parts[".msc-overlap-turns"].value, "3");
assert.equal(restoredRoot.parts[".msc-dedup"].checked, false);
assert.equal(restoredRoot.parts[".msc-prompt"].value, "사용자 정의 프롬프트");
restoredRoot.parts[".msc-reset-prompt"].emit("click");
await new Promise((resolve) => setTimeout(resolve, 1));
assert.equal(ownRecord[core.STORAGE_KEY].settings.summaryPrompt, core.DEFAULT_PROMPT);
await cleanup();
assert.equal(timers.size, 0);
let fallbackChat = "a";
const fallbackUi = vm.createContext({ __MCS_MEMORY_SETTINGS__: { create: () => ({ load() {}, save() {}, dispose() {} }) }, __MCS_PHASE1_CORE__: core, __MCS_AUTO__: autoModule, __MCS_RULES__: ruleModule, __MCS_BULK__: bulkModule, document, window, marinara, localStorage: { getItem(key) { return key === "marinara-active-chat-id" ? fallbackChat : null; } }, AbortController, Promise, URLSearchParams, console });
vm.runInContext(source("extension.js"), fallbackUi);
await new Promise((resolve) => setTimeout(resolve, 5));
const fallbackRoot = body.children.at(-1);
fallbackRoot.parts[".msc-launcher"].emit("click");
await new Promise((resolve) => setTimeout(resolve, 5));
assert.ok(fallbackRoot.parts[".msc-status"].textContent.includes("225턴"));
fallbackChat = null;
for (const { fn, ms } of timers.values()) if (ms === 750) fn();
assert.equal(fallbackRoot.parts[".msc-status"].textContent, "활성 채팅이 없습니다.");
await cleanup();
assert.equal(timers.size, 0);
assert.ok(calls.every((call) => call.method === "GET"));

// A failed setting patch must not leak its optimistic value into the next patch.
active = "a";
vm.runInContext(source("extension.js"), ui);
await new Promise((resolve) => setTimeout(resolve, 5));
const raceRoot = body.children.at(-1);
const priorConnection = ownRecord[core.STORAGE_KEY].settings.connectionId;
failNextPatch = true;
raceRoot.parts[".msc-model"].value = "m1";
raceRoot.parts[".msc-model"].emit("change");
raceRoot.parts[".msc-interval"].value = "19";
raceRoot.parts[".msc-interval"].emit("change");
await new Promise((resolve) => setTimeout(resolve, 5));
assert.equal(ownRecord[core.STORAGE_KEY].settings.connectionId, priorConnection);
assert.equal(ownRecord[core.STORAGE_KEY].settings.intervalTurns, 19);
assert.equal(raceRoot.parts[".msc-model"].value, priorConnection);
await cleanup();

console.log("Phase 1 verification passed: pagination, snapshot retry, boundary, turns, settings, lifecycle, chat switch, GET-only access.");
