import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const source = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
const context = vm.createContext({ URLSearchParams, AbortController, console });
for (const file of ["core.js", "memory-settings.js", "rules.js", "bulk.js", "auto.js"]) vm.runInContext(source(file), context);
const core = vm.runInContext("__MCS_PHASE1_CORE__", context);
const memory = vm.runInContext("__MCS_MEMORY_SETTINGS__", context);
const rules = vm.runInContext("__MCS_RULES__", context);
const bulk = vm.runInContext("__MCS_BULK__", context);
class Element {
  constructor() { this.listeners = new Map(); this.children = []; this.style = {}; this.value = ""; this.checked = false; this.disabled = false; this.hidden = false; this.textContent = ""; this.attrs = {}; }
  set innerHTML(html) { this.parts = {}; for (const match of html.matchAll(/class="([^"]+)"/g)) for (const name of match[1].split(" ")) this.parts[`.${name}`] = new Element(); this.parts[".msc-panel"].hidden = true; }
  addEventListener(name, fn) { const list = this.listeners.get(name) ?? []; list.push(fn); this.listeners.set(name, list); }
  removeEventListener() {}
  emit(name) { for (const fn of this.listeners.get(name) ?? []) fn({ target: this }); }
  querySelector(name) { return this.parts?.[name] ?? null; }
  querySelectorAll() { return []; }
  setAttribute(k, v) { this.attrs[k] = v; }
  appendChild(child) { this.children.push(child); }
  replaceChildren() { this.children = []; }
  remove() {}
}
const copy = (x) => JSON.parse(JSON.stringify(x));
const base = { id: "a", mode: "roleplay", createdAt: "2020-01-01T00:00:00Z", metadata: { enableMemoryRecall: true, summaryTailMessages: 12, semanticSummaryRecentCount: 7, hideSummarisedMessages: true, other: "keep" } };
const chats = { a: base }; let current = "a", storage = {}, cleanup, next = 0;
const calls = [];
const fetcher = async (path, options = {}) => {
  const method = options.method ?? "GET";
  calls.push({ path, method, body: options.body && JSON.parse(options.body) });
  if (path === "/api/connections") return { ok: true, json: async () => [] };
  const match = path.match(/^\/api\/chats\/([^/]+)(\/metadata)?$/);
  if (!match) throw Error(`Unexpected ${path}`);
  const chat = chats[decodeURIComponent(match[1])];
  if (!chat) return { ok: false, status: 404, json: async () => ({}) };
  if (method === "PATCH") Object.assign(chat.metadata, JSON.parse(options.body));
  return { ok: true, json: async () => copy(chat) };
};
const body = new Element(), window = new Element(), subscriptions = new Set(), profileEvents = new Set();
window.innerWidth = 1200; window.innerHeight = 900;
const host = { version: 1, queryClient: { getMutationCache: () => ({ subscribe(fn) { profileEvents.add(fn); return () => profileEvents.delete(fn); } }) }, stores: { chat: { getState: () => ({ activeChatId: current }), subscribe: (fn) => { subscriptions.add(fn); return () => subscriptions.delete(fn); } } } };
const managed = new Set();
const auto = { createAutoController: () => ({ enable: async (id) => managed.add(id), disable: async (id) => managed.delete(id), isManaged: (id) => managed.has(id), isRunning: () => false, kick() {}, shutdown: async () => {} }), installSendObserver: () => () => {} };
const marinara = { fetch: fetcher, estimateTextTokens: () => 1, log: { debug() {}, warn() {}, error() {} }, storage: { get: async () => copy(storage), patch: async (data) => { storage = { ...storage, ...copy(data) }; } }, setInterval: () => ++next, clearInterval() {}, onCleanup: (fn) => { cleanup = fn; } };
const document = { body, createElement: () => new Element(), getElementById: () => null, querySelector: () => null };
const ui = vm.createContext({ __MCS_PHASE1_CORE__: core, __MCS_MEMORY_SETTINGS__: memory, __MCS_RULES__: rules, __MCS_BULK__: bulk, __MCS_AUTO__: auto, __MARINARA_HOST__: host, marinara, document, window, AbortController, URLSearchParams, console });
vm.runInContext(source("extension.js"), ui);
const part = (name) => body.children[0].parts[`.msc-${name}`];
const wait = async (fn) => { for (let i = 0; i < 200 && !fn(); i++) await new Promise((r) => setTimeout(r, 2)); assert.ok(fn(), "timed out"); };
await wait(() => calls.some((call) => call.path === "/api/connections"));
await wait(() => !part("preset-save").disabled);
part("preset-save").emit("click"); await wait(() => part("preset-status").textContent.includes("저장했습니다"));
const storedPreset = storage[core.STORAGE_KEY].settings.presetState.preset;
assert.equal(storedPreset.memory.summaryTailMessages, 12); assert.equal(storedPreset.memory.semanticSummaryRecentCount, 7);
assert.deepEqual(Object.keys(storedPreset).sort(), ["autoSummary", "memory"]);
assert.equal(calls.filter((x) => x.method === "PATCH").length, 0);
part("preset-auto").checked = true; part("preset-auto").emit("change"); await wait(() => storage[core.STORAGE_KEY].settings.presetState.auto === true);
const cutoff = storage[core.STORAGE_KEY].settings.presetState.enabledAt;
chats.b = { id: "b", mode: "roleplay", createdAt: new Date(cutoff + 1000).toISOString(), metadata: { other: "intact" } };
current = "b"; for (const fn of subscriptions) fn();
await wait(() => storage[core.STORAGE_KEY].settings.presetState.history?.b === "applied");
assert.equal(chats.b.metadata.summaryTailMessages, 12); assert.equal(chats.b.metadata.other, "intact");
const patches = calls.filter((x) => x.path === "/api/chats/b/metadata").length;
current = "a"; for (const fn of subscriptions) fn(); current = "b"; for (const fn of subscriptions) fn(); await new Promise((r) => setTimeout(r, 15));
assert.equal(calls.filter((x) => x.path === "/api/chats/b/metadata").length, patches);
// A chat profile applied after activation must not win the race with the Calibrator preset.
Object.assign(chats.b.metadata, { appliedChatPresetId: "profile", summaryTailMessages: 4, semanticSummaryRecentCount: 1 });
const mutation = { state: { variables: { chatId: "b", presetId: "profile" }, data: copy(chats.b) } };
for (const fn of profileEvents) fn({ type: "updated", action: { type: "success" }, mutation });
await wait(() => chats.b.metadata.summaryTailMessages === 12 && chats.b.metadata.semanticSummaryRecentCount === 7);

chats.c = { id: "c", mode: "roleplay", createdAt: new Date(cutoff + 2000).toISOString(), metadata: { summaryTailMessages: 99 } };
current = "c"; for (const fn of subscriptions) fn(); await new Promise((r) => setTimeout(r, 15)); assert.equal(chats.c.metadata.summaryTailMessages, 99);
chats.c.metadata.advancedMemory = { enabled: true };
part("preset-apply").emit("click"); await wait(() => chats.c.metadata.summaryTailMessages === 12);
await wait(() => part("preset-status").textContent.includes("기억 검색을 변경하지 않았습니다"));
assert.equal(chats.c.metadata.advancedMemory.enabled, true);
assert.equal(chats.c.metadata.enableMemoryRecall, undefined);
assert.equal(storage[core.STORAGE_KEY].settings.referenceCount, 3);
// A new chat already populated by an Engine chat profile is eligible.
chats.profiled = { id: "profiled", mode: "roleplay", createdAt: new Date(cutoff + 5000).toISOString(), metadata: { appliedChatPresetId: "profile", summaryTailMessages: 2, semanticSummaryRetrievalEnabled: false } };
current = "profiled"; for (const fn of subscriptions) fn();
await wait(() => chats.profiled.metadata.summaryTailMessages === 12);
assert.equal(chats.profiled.metadata.appliedChatPresetId, "profile");
chats.old = { id: "old", mode: "roleplay", createdAt: new Date(cutoff - 1000).toISOString(), metadata: {} };
current = "old"; for (const fn of subscriptions) fn(); await new Promise((r) => setTimeout(r, 15));
assert.deepEqual(chats.old.metadata, {});
part("preset-auto").checked = false; part("preset-auto").emit("change"); await wait(() => storage[core.STORAGE_KEY].settings.presetState.auto === false);
chats.off = { id: "off", mode: "roleplay", createdAt: new Date(cutoff + 3000).toISOString(), metadata: {} };
current = "off"; for (const fn of subscriptions) fn(); await new Promise((r) => setTimeout(r, 15));
assert.deepEqual(chats.off.metadata, {});
await cleanup();
console.log("Preset verification passed: explicit snapshot, no shared settings, guarded automatic application, history, manual apply, and existing metadata preservation.");
