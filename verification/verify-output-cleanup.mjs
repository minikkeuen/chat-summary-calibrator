import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const context = vm.createContext({ console, URLSearchParams, AbortController });
for (const name of ["rules.js", "core.js", "auto.js", "bulk.js"]) vm.runInContext(readFileSync(new URL(`../${name}`, import.meta.url), "utf8"), context);
const core = vm.runInContext("__MCS_PHASE1_CORE__", context);
const rules = vm.runInContext("__MCS_RULES__", context);
const autoModule = vm.runInContext("__MCS_AUTO__", context);
const bulkModule = vm.runInContext("__MCS_BULK__", context);
const plain = (value) => JSON.parse(JSON.stringify(value));
const clean = core.cleanSummaryOutput;
const narrative = "Alice met Bob and revealed the secret.";

for (const [input, expected] of [
  [`\`\`\`\n${narrative}\n\`\`\``, narrative],
  [`\`\`\`text\n${narrative}\n\`\`\``, narrative],
  [`\`\`\`markdown\n# Events\n- ${narrative}\n\`\`\``, `# Events\n- ${narrative}`],
  [`~~~~text\n${narrative}\n~~~~`, narrative],
  [`\`\`\`text\r\nFirst.\r\nSecond.\r\n\`\`\``, "First.\r\nSecond."],
  ["\`\`\`\n\`\`\`", ""],
  ["\`\`\`text\n   \n\`\`\`", ""],
  [`요약: ${narrative}`, narrative],
  [` SUMMARY  : \n${narrative}`, narrative],
  [`다음은   요약입니다 : ${narrative}`, narrative],
  [`HERE IS THE SUMMARY: ${narrative}`, narrative],
  [`"${narrative}"`, narrative],
  [`'${narrative}'`, narrative],
  [`“${narrative}”`, narrative],
  [`‘${narrative}’`, narrative],
  ['"Alice said ‘hello’ and left."', "Alice said ‘hello’ and left."],
  ["'Alice didn't reveal Bob's secret.'", "Alice didn't reveal Bob's secret."],
  ["‘Alice didn’t reveal Bob’s secret.’", "Alice didn’t reveal Bob’s secret."],
  [`\`\`\`text\nSummary: "${narrative}"\n\`\`\``, narrative],
  [`Summary: \`\`\`text\n"${narrative}"\n\`\`\``, narrative],
  [`"Summary: ${narrative}"`, narrative],
  [`Summary: Summary: ${narrative}`, `Summary: ${narrative}`],
  [`\`\`\`\n\`\`\`text\n${narrative}\n\`\`\`\n\`\`\``, `\`\`\`\n\`\`\`text\n${narrative}\n\`\`\`\n\`\`\``],
]) assert.equal(clean(input), expected, input);

// Ordinary prose, internal formatting and ambiguous wrappers stay intact.
for (const input of [
  narrative, "# Events\n- Alice met Bob.\n- They left.",
  "Alice said, \"Summary: meet me tomorrow.\"", "The Summary: a heading in a sentence.",
]) assert.equal(clean(input), input);
for (const input of [
  "Summary:", "요약:   ", "Here is a summary: Alice left.",
  `Before\n\`\`\`text\n${narrative}\n\`\`\``,
  `\`\`\`text\n${narrative}\n\`\`\`\nAfter`,
  `\`\`\`text\n${narrative}`, `\`\`\`text\n${narrative}\n\`\``,
  "\`\`\`text\nFirst\n\`\`\`\n\`\`\`text\nSecond\n\`\`\`",
  `"${narrative}`, `${narrative}"`, `"${narrative}'`,
  '"Alice said "hello" and left."', '"Alice" and "Bob"',
  '"Alice: I will return."', '" > I will return."', '"Alice left.\\"',
  "''", '""', "\"{\"summary\":\"Alice left.\"}\"",
  '{"summary":"Alice left."}',
]) assert.equal(clean(input), input.trim(), input);
assert.equal(clean('"Alice said \'hello\'."'), "Alice said 'hello'.");
assert.equal(clean('"Alice\\nleft."'), "Alice\\nleft.", "Do not decode escapes");

function fixture(output, correctionEnabled = true) {
  const rows = ["user", "assistant", "user"].map((role, i) => ({ id: `m${i + 1}`, role, content: `대화${i}`, createdAt: `2026-01-01T00:00:0${i}.000Z`, extra: "{}" }));
  const chat = { id: "chat", mode: "roleplay", metadata: { automaticSummaryEnabled: false, summaryEntries: [], summary: "" } };
  const calls = [];
  const seen = [];
  const settings = { ...core.DEFAULT_SETTINGS, correctionEnabled, connectionId: "model", intervalTurns: 1, managedChats: { chat: { original: true } }, ruleFiles: [rules.parseFile('[{"find":"Alice","replace":"Alicia"}]', { id: "file", name: "replace_all.json", type: "replace", language: "all" })] };
  const reader = { async readSnapshot() { const summary = core.summaryInfo(chat); return plain({ chatId: "chat", mode: "roleplay", messages: rows, messageCount: rows.length, summary, boundary: core.analyzeBoundary(rows, summary.entries) }); } };
  const fetcher = async (path, init) => {
    const body = JSON.parse(init.body); calls.push({ path, body });
    if (path === "/api/generate/raw") return { ok: true, json: async () => body.returnPrompt ? { prompt: { messages: body.messages } } : { content: output } };
    assert.equal(path, "/api/chats/chat/summary-entries");
    assert.equal(body.operation, "replace");
    chat.metadata.summaryEntries.push({ ...body.entry, hiddenMessageIds: ["m1"] });
    rows[0].extra = '{"hiddenFromAI":true}';
    chat.metadata.summary = body.entry.content;
    return { ok: true, json: async () => plain(chat) };
  };
  const service = core.makeManualService(fetcher, reader, (text, quality) => { seen.push(text); return rules.apply(text, quality); });
  return { rows, chat, calls, reader, service, settings, seen };
}

for (const automatic of [false, true]) {
  const f = fixture(`\`\`\`text\nSummary: "${narrative}"\n\`\`\``);
  if (automatic) {
    const controller = autoModule.createAutoController({ core, reader: f.reader, fetcher: () => assert.fail("No extra Engine call"), manualService: f.service, getSettings: () => f.settings, saveSettings: () => true, onState() {}, isManualBusy: () => false, newId: () => "auto-new" });
    await controller.submit("chat", { throughMessageId: "m2", messages: [plain(f.rows[1])] });
  } else {
    await f.service.run("chat", "model", "manual-new", new AbortController().signal, () => {}, { quality: f.settings });
  }
  assert.deepEqual(f.seen, [narrative], "Clean before applying expression rules");
  assert.equal(f.chat.metadata.summary, narrative.replace("Alice", "Alicia"));
  assert.deepEqual(f.chat.metadata.summaryEntries[0].messageIds, ["m1", "m2"]);
  assert.deepEqual(f.chat.metadata.summaryEntries[0].hiddenMessageIds, ["m1"]);
  assert.equal(f.calls.filter((call) => call.path === "/api/generate/raw" && !call.body.returnPrompt).length, 1);
  assert.equal(f.calls.filter((call) => call.path.endsWith("summary-entries")).length, 1);
}
{
  const f = fixture(`Summary: ${narrative}`, false);
  await f.service.run("chat", "model", "no-rules", undefined, () => {}, { quality: f.settings });
  assert.equal(f.chat.metadata.summary, narrative);
  assert.deepEqual(f.seen, []);
}
for (const output of ["\`\`\`\n\`\`\`", "   ", `\`\`\`text\n${"a".repeat(20001)}\n\`\`\``]) {
  const f = fixture(output);
  await assert.rejects(f.service.run("chat", "model", "invalid", undefined, () => {}, { quality: f.settings }), /유효한 요약 본문/);
  assert.equal(f.chat.metadata.summaryEntries.length, 0);
  assert.equal(f.calls.filter((call) => call.path.endsWith("summary-entries")).length, 0);
  assert.deepEqual(f.seen, []);
}
// Existing summary previews use only the existing rule engine, never output cleanup.
{
  const original = `Summary: "${narrative}"`;
  const f = fixture("");
  const bulk = bulkModule.createService({ core, reader: { async readChat() { return { id: "chat", mode: "roleplay", metadata: { summary: original } }; } }, fetcher: () => assert.fail("Preview must not save"), processor: { process: (text, settings) => rules.apply(text, settings) }, estimateTextTokens: (text) => text.length });
  const snapshot = await bulk.load("chat");
  const preview = await bulk.preview(snapshot, ["legacy"], f.settings);
  assert.equal(preview.items[0].content, original.replace("Alice", "Alicia"));
}
console.log("Output cleanup verification passed: conservative wrappers, combinations, preserved body/quotes/CRLF, manual/auto parity, cleanup before rules, empty/length rejection, exact provenance/hiding, no extra model/storage calls, bulk isolation.");
