import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const context = vm.createContext({ console });
vm.runInContext(readFileSync(new URL("../core.js", import.meta.url), "utf8"), context);
vm.runInContext(readFileSync(new URL("../memory-settings.js", import.meta.url), "utf8"), context);
const core = vm.runInContext("__MCS_PHASE1_CORE__", context);
const memory = vm.runInContext("__MCS_MEMORY_SETTINGS__", context);
const plain = (v) => JSON.parse(JSON.stringify(v));
const clone = (v) => structuredClone(v);
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const chats = {
  a: { id: "a", mode: "roleplay", metadata: { custom: { keep: true } } },
  b: { id: "b", mode: "conversation", metadata: { semanticSummaryRetrievalEnabled: true, semanticSummaryRecentCount: 2, semanticSummaryOlderCount: 3 } },
  c: { id: "c", mode: "roleplay", metadata: { sceneStatus: "active", semanticSummaryRecentCount: 7 } },
};
let calls = [], notifications = [], failPatch = false, failRead = false, patchGate = null, readGate = null;
const reader = { async readChat(id) { if (readGate) { const gate = readGate; readGate = null; await gate.promise; } if (failRead) throw Error("offline"); return clone(chats[id]); } };
const fetcher = async (path, init) => {
  assert.equal(init.method, "PATCH"); assert.equal(init.credentials, "same-origin"); assert.equal(init.headers["x-marinara-csrf"], "1");
  const id = decodeURIComponent(path.match(/^\/api\/chats\/(.+)\/metadata$/)[1]);
  const body = JSON.parse(init.body); calls.push({ id, body });
  if (patchGate) { const gate = patchGate; patchGate = null; await gate.promise; }
  if (failPatch) return { ok: false, status: 503 };
  Object.assign(chats[id].metadata, body);
  return { ok: true, json: async () => clone(chats[id]) };
};
const service = memory.create({ fetcher, reader, core, onChange: (state) => notifications.push(plain(state)) });
const last = () => notifications.at(-1);
await service.load("a");
assert.equal(last().values.enableMemoryRecall, false); assert.equal(last().values.summaryTailMessages, 10);
assert.equal(last().values.semanticSummaryRecentCount, 2); assert.equal(last().values.semanticSummaryOlderCount, 3); assert.equal(calls.length, 0);
await service.load("b"); assert.equal(last().values.enableMemoryRecall, true); assert.equal(last().values.semanticSummaryRecentCount, 2); assert.equal(last().values.semanticSummaryOlderCount, 3);
await service.save("semanticSummaryRetrievalEnabled", false); await service.save("semanticSummaryRetrievalEnabled", true);
assert.deepEqual(calls.at(-1).body, { semanticSummaryRetrievalEnabled: true });
await service.load("a"); await service.save("semanticSummaryRetrievalEnabled", true);
assert.deepEqual(calls.at(-1).body, { semanticSummaryRetrievalEnabled: true, semanticSummaryRecentCount: 5, semanticSummaryOlderCount: 5 });
assert.deepEqual(chats.a.metadata.custom, { keep: true });
await service.save("semanticSummaryRetrievalEnabled", false); await service.save("semanticSummaryRetrievalEnabled", true);
assert.deepEqual(calls.at(-1).body, { semanticSummaryRetrievalEnabled: true });
await service.load("c"); assert.equal(last().values.enableMemoryRecall, true); await service.save("semanticSummaryRetrievalEnabled", true);
assert.deepEqual(calls.at(-1).body, { semanticSummaryRetrievalEnabled: true, semanticSummaryOlderCount: 5 });
for (const [field, value] of [["enableMemoryRecall", true], ["enableMemoryRecall", false], ["hideSummarisedMessages", true], ["hideSummarisedMessages", false], ["summaryTailMessages", 100], ["semanticSummaryRecentCount", 20], ["semanticSummaryOlderCount", 0], ["semanticSummaryMinSimilarity", 0.6]]) {
  await service.save(field, value); assert.deepEqual(calls.at(-1).body, { [field]: value }); assert.equal(last().values[field], value);
}
let count = calls.length;
for (const [field, value] of [["summaryTailMessages", -1], ["summaryTailMessages", 1.5], ["semanticSummaryRecentCount", 21], ["semanticSummaryOlderCount", -1], ["semanticSummaryMinSimilarity", 1.1], ["semanticSummaryMinSimilarity", NaN], ["custom", 1]]) await service.save(field, value);
assert.equal(calls.length, count); assert.match(last().message, /범위/);
failPatch = true; await service.save("summaryTailMessages", 4); assert.match(last().message, /실패/); assert.equal(last().values.summaryTailMessages, 100); failPatch = false;
// Preserve Engine's mutually exclusive mode rather than changing it indirectly.
chats.c.metadata.advancedMemory = { enabled: true }; await service.load("c"); assert.equal(last().values.recallUnavailable, true); count = calls.length; await service.save("enableMemoryRecall", true); assert.equal(calls.length, count); assert.equal(chats.c.metadata.advancedMemory.enabled, true); delete chats.c.metadata.advancedMemory;
// An old read cannot overwrite the newly active chat.
readGate = deferred(); const oldGate = readGate; const oldRead = service.load("a"); await tick(); await service.load("b"); oldGate.resolve(); await oldRead; assert.equal(last().chatId, "b"); assert.equal(last().values.enableMemoryRecall, true);
// A duplicate save is ignored; leaving and returning waits for the original write.
await service.load("a"); patchGate = deferred(); const gate = patchGate; const first = service.save("summaryTailMessages", 22); await tick(); count = calls.length; await service.save("summaryTailMessages", 23); assert.equal(calls.length, count);
await service.load("b"); const back = service.load("a"); await tick(); assert.equal(last().status, "loading"); gate.resolve(); await first; await back; assert.equal(last().chatId, "a"); assert.equal(last().values.summaryTailMessages, 22);
// Unknown commit state is resolved by a fresh read; inaccessible reads disable editing.
failPatch = true; failRead = true; await service.save("summaryTailMessages", 6); assert.equal(last().status, "error"); assert.equal(last().values, null); failPatch = false; failRead = false;
await service.load(null); assert.equal(last().status, "empty"); service.dispose();
console.log("Memory settings verification passed: defaults, seven fields, first activation, partial values, validation, minimal patches, failure recovery, duplicates and chat races.");
