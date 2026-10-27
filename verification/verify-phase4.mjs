import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const folder = dirname(dirname(fileURLToPath(import.meta.url)));
const context = vm.createContext({ URLSearchParams, AbortController, console });
vm.runInContext(readFileSync(join(folder, "core.js"), "utf8"), context);
const core = vm.runInContext("__MCS_PHASE1_CORE__", context);
const plain = (value) => JSON.parse(JSON.stringify(value));

const messages = Array.from({ length: 9 }, (_, index) => ({
  id: `m${index + 1}`,
  createdAt: new Date(1_700_000_000_000 + index * 1000).toISOString(),
  role: index === 8 ? "user" : index % 2 ? "assistant" : "user",
  content: `새 내용 ${index + 1}`,
  extra: "{}",
  activeSwipeIndex: 0,
  swipeCount: 0,
}));
const prior = [
  { id: "middle", content: "요약 중간", enabled: true, messageIds: ["m3", "m4"] },
  { id: "newest", content: "요약 최근", enabled: true, messageIds: ["m5", "m6"] },
  { id: "oldest", content: "요약 오래됨", enabled: true, messageIds: ["m1", "m2"] },
  { id: "disabled", content: "비활성 요약", enabled: false, messageIds: ["m7", "m8"] },
];
const snapshot = { chatId: "chat", mode: "roleplay", messageCount: messages.length, messages, summary: { entries: prior, legacy: false }, boundary: core.analyzeBoundary(messages, prior) };
assert.deepEqual(plain(core.recentSummaryReferences(snapshot, 2).map((entry) => entry.id)), ["middle", "newest"]);
assert.deepEqual(plain(core.recentSummaryReferences(snapshot, 0)), []);
assert.equal(core.selectManualRange(snapshot).startIndex, 7);
const range = core.selectManualRange(snapshot);
assert.deepEqual(plain(range.messageIds), ["m7", "m8"]);
assert.deepEqual(plain(core.selectOverlapMessages(snapshot, range, 0).map((row) => row.id)), []);
assert.deepEqual(plain(core.selectOverlapMessages(snapshot, range, 1).map((row) => row.id)), ["m5", "m6"]);
assert.deepEqual(plain(core.selectOverlapMessages(snapshot, range, 2).map((row) => row.id)), ["m3", "m4", "m5", "m6"]);
assert.deepEqual(plain(core.selectOverlapMessages(snapshot, range, 9).map((row) => row.id)), ["m1", "m2", "m3", "m4", "m5", "m6"]);

const quality = { ...core.DEFAULT_SETTINGS, referenceCount: 2, overlapEnabled: true, overlapTurns: 2, dedupEnabled: true, summaryPrompt: "사용자 정의 지침" };
const enginePromptContent = `You are Automatic Chat Summary. Summarize only NEW durable roleplay events not already captured in the existing summary.
Focus on plot turns, character developments, relationships, current situation, locations, quests, goals, threats, and unresolved tension.
Write an appendable continuation. Do not rewrite or repeat the previous summary. If nothing durable changed, return an empty summary. Match the existing summary style.`;
assert.ok(core.DEFAULT_PROMPT.startsWith(`${enginePromptContent}\n`), "The Engine default content instructions stay intact");
assert.match(core.DEFAULT_PROMPT, /Return only the summary text, without a title, JSON, code fences, or explanation\./);
const oldDefault = "당신은 RP 대화의 신규 사건을 기록하는 요약자입니다. 실제 행동·발언·결과·관계 변화를 시간순으로 간결하고 정확하게 기록하세요. 추측이나 단정적인 성격 평가를 새 사실처럼 쓰지 마세요. 설명이나 코드 블록 없이 요약 본문만 출력하세요.";
assert.equal(core.settingsFromStorage(core.storagePatch({ summaryPrompt: oldDefault })).summaryPrompt, core.DEFAULT_PROMPT);
assert.equal(core.settingsFromStorage(core.storagePatch({ summaryPrompt: "사용자 정의 지침" })).summaryPrompt, "사용자 정의 지침");
const generatedPrompt = core.buildManualPrompt(snapshot, range, quality);
assert.ok(generatedPrompt[0].content.includes("사용자 정의 지침"));
assert.ok(generatedPrompt[0].content.includes("반복된 행동만으로"));
assert.ok(generatedPrompt[0].content.includes("신규 요약 대상"));
assert.ok(generatedPrompt[1].content.includes("요약 중간"));
assert.ok(generatedPrompt[1].content.includes("요약 최근"));
assert.ok(!generatedPrompt[1].content.includes("요약 오래됨"));
assert.ok(!generatedPrompt[1].content.includes("비활성 요약"));
assert.ok(generatedPrompt[1].content.includes("[참고 3] user"));
assert.ok(generatedPrompt[1].content.includes("[7] user: 새 내용 7"));
assert.ok(!generatedPrompt[1].content.includes("새 내용 9"));
assert.ok(generatedPrompt[1].content.indexOf("[오버랩 참고") < generatedPrompt[1].content.indexOf("[신규 요약 대상"));
const noReferences = core.buildManualPrompt(snapshot, range, { ...quality, referenceCount: 0, overlapEnabled: false, dedupEnabled: false });
assert.ok(!noReferences[1].content.includes("요약 최근"));
assert.ok(!noReferences[1].content.includes("[참고 3]"));
assert.ok(!noReferences[0].content.includes("반복된 행동만으로"));
assert.ok(noReferences[0].content.includes("신규 요약 대상"));
const zeroTurns = core.buildManualPrompt(snapshot, range, { ...quality, overlapTurns: 0 });
assert.ok(!zeroTurns[1].content.includes("[참고 3]"));
const blankNormalized = core.buildManualPrompt(snapshot, range, { ...quality, summaryPrompt: "첫 줄\n\n\n\n마지막 줄" });
assert.ok(blankNormalized[0].content.includes("첫 줄\n\n마지막 줄"));
assert.ok(!blankNormalized[0].content.includes("\n\n\n"));

const savedSettings = { ...quality, managedChats: { chat: { original: true } } };
assert.deepEqual(plain(core.settingsFromStorage(core.storagePatch(savedSettings))), plain(savedSettings));
assert.equal(core.settingsFromStorage(core.storagePatch({ ...savedSettings, summaryPrompt: core.DEFAULT_PROMPT })).summaryPrompt, core.DEFAULT_PROMPT);
assert.equal(core.settingsFromStorage(core.storagePatch({ connectionId: "model", intervalTurns: 10, managedChats: {} })).referenceCount, 3);

// Both entry points call the same service with the same quality settings; overlap never enters range provenance.
function serviceFixture() {
  const chat = { id: "chat", mode: "roleplay", metadata: { summaryEntries: prior.slice(0, 3).map((entry) => ({ ...entry })), summary: "요약 중간\n\n요약 최근\n\n요약 오래됨", hideSummarisedMessages: true, summaryTailMessages: 1 } };
  const rows = messages.map((row) => ({ ...row, chatId: "chat" }));
  const calls = [];
  const reader = { async readSnapshot() {
    const data = plain(chat);
    const summary = core.summaryInfo(data);
    return { chatId: "chat", mode: "roleplay", messageCount: rows.length, messages: plain(rows), summary, boundary: core.analyzeBoundary(rows, summary.entries, summary.legacy) };
  } };
  async function fetcher(path, init) {
    const body = JSON.parse(init.body);
    calls.push({ path, body });
    if (path === "/api/generate/raw") return { ok: true, json: async () => body.returnPrompt ? { prompt: { messages: body.messages } } : { content: "신규 사건만", runId: body.runId } };
    if (path === "/api/chats/chat/summary-entries") {
      const hiddenMessageIds = body.entry.messageIds.slice(0, -1);
      for (const id of hiddenMessageIds) rows.find((row) => row.id === id).extra = JSON.stringify({ hiddenFromAI: true });
      const entry = { ...body.entry, hiddenMessageIds, tokenEstimate: 3, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
      chat.metadata.summaryEntries.push(entry);
      chat.metadata.summary = chat.metadata.summaryEntries.filter((item) => item.enabled).map((item) => item.content).join("\n\n");
      return { ok: true, json: async () => plain(chat) };
    }
    throw new Error(path);
  }
  return { chat, rows, calls, service: core.makeManualService(fetcher, reader) };
}
for (const automatic of [false, true]) {
  const fixture = serviceFixture();
  const result = await fixture.service.run("chat", "model", automatic ? "auto" : "manual", new AbortController().signal, () => {}, automatic ? { sourceFence: { throughMessageId: "m8", messages: [structuredClone(fixture.rows[7])] }, minimumTurns: 1, quality } : { quality });
  assert.equal(result.kind, "saved");
  assert.deepEqual(fixture.chat.metadata.summaryEntries.at(-1).messageIds, ["m7", "m8"]);
  assert.equal(fixture.chat.metadata.summaryEntries.at(-1).rangeStartIndex, 7);
  assert.equal(fixture.chat.metadata.summaryEntries.at(-1).rangeEndIndex, 8);
  assert.deepEqual(fixture.chat.metadata.summaryEntries.at(-1).hiddenMessageIds, ["m7"]);
  assert.equal(fixture.rows.slice(0, 6).some((row) => JSON.parse(row.extra).hiddenFromAI === true), false);
  assert.ok(fixture.calls.find((call) => call.path === "/api/generate/raw" && !call.body.returnPrompt).body.messages[1].content.includes("[참고 3]"));
  assert.equal(fixture.chat.metadata.summaryEntries.length, 4);
}

console.log("Phase 4 verification passed: chronological references, 0 references, disabled entries, 0/multi-turn overlap, provenance separation, dedup toggle, custom/default prompt, and shared manual/automatic service.");
