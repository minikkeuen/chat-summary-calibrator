/* Explicit, in-memory preview and content-only edits of existing summaries. */
const __MCS_BULK__ = (() => {
  "use strict";
  const ruleSignature = (settings) => JSON.stringify([settings.correctionEnabled, settings.ruleFiles]);
  function summariesFromChat(core, chat) {
    if (chat?.mode !== "roleplay") throw new Error("일반 Chat Summary를 사용하는 RP 채팅에서만 보정할 수 있습니다.");
    const metadata = core.metadataOf(chat);
    if (metadata.summaryEntries != null && !Array.isArray(metadata.summaryEntries)) throw new Error("요약 목록 형식을 확인할 수 없습니다.");
    if (Array.isArray(metadata.summaryEntries)) {
      const ids = metadata.summaryEntries.map((entry) => entry?.id);
      return metadata.summaryEntries.map((entry, index) => ({
        key: String(index), id: entry?.id, legacy: false,
        title: typeof entry?.title === "string" && entry.title.trim() ? entry.title.trim() : `요약 ${index + 1}`, enabled: entry?.enabled !== false,
        original: entry?.content,
        problem: typeof entry?.id !== "string" || !entry.id.trim() || ids.indexOf(entry.id) !== ids.lastIndexOf(entry.id) ? "요약 식별 정보가 없거나 중복되어 저장할 수 없습니다." : typeof entry.content !== "string" || !entry.content.trim() ? "유효한 요약 본문이 없습니다." : "",
      }));
    }
    return typeof metadata.summary === "string" && metadata.summary.trim() ? [{ key: "legacy", legacy: true, title: "Legacy 요약", enabled: true, original: metadata.summary, problem: "" }] : [];
  }
  function statistics(items) {
    const saved = items.filter((item) => item.status === "saved");
    return {
      processed: items.length, modified: saved.length,
      replacements: saved.reduce((sum, item) => sum + item.replacementCount, 0),
      unchanged: items.filter((item) => item.status === "unchanged").length,
      failed: items.filter((item) => ["correction_failed", "save_failed"].includes(item.status)).length,
      uncertain: items.filter((item) => item.status === "uncertain").length,
      excluded: items.filter((item) => ["source_changed", "deleted", "not_saved"].includes(item.status)).length,
    };
  }
  function createService({ core, reader, fetcher, processor, estimateTextTokens }) {
    const saving = new Set();
    async function load(chatId, signal) {
      const chat = await reader.readChat(chatId, signal);
      if (chat?.id !== chatId) throw new Error("현재 채팅을 확인할 수 없습니다.");
      return { chatId, title: core.chatDisplayName(chat), structured: Array.isArray(core.metadataOf(chat).summaryEntries), rows: summariesFromChat(core, chat) };
    }
    async function preview(snapshot, selectedKeys, settings, signal) {
      const selected = new Set(selectedKeys);
      const rows = snapshot.rows.filter((row) => selected.has(row.key));
      if (!rows.length) throw new Error("보정할 요약을 선택해 주세요.");
      const frozenSettings = JSON.parse(JSON.stringify(settings));
      const items = [];
      for (const row of rows) {
        if (signal?.aborted) throw new Error("일괄 보정 미리보기가 취소되었습니다.");
        const item = { ...row, content: row.original, replacementCount: 0, warnings: [], status: "correction_failed", reason: row.problem };
        if (!row.problem) {
          try {
            const result = await processor.process(row.original, { ...frozenSettings, correctionEnabled: true }, signal);
            item.content = result.text; item.warnings = result.warnings ?? [];
            item.replacementCount = result.replacementCount ?? 0;
            item.status = result.changed ? "ready" : item.warnings.length ? "correction_failed" : "unchanged";
            item.reason = item.status === "correction_failed" ? item.warnings.join("\n") : "";
          } catch (error) { if (signal?.aborted) throw error; item.reason = error.message; }
        }
        items.push(item);
      }
      return { chatId: snapshot.chatId, title: snapshot.title, ruleSignature: ruleSignature(frozenSettings), items };
    }
    async function apply(approved, settings, signal, onResult = () => {}) {
      if (ruleSignature(settings) !== approved.ruleSignature) throw new Error("규칙 설정이 변경되었습니다. 미리보기를 다시 생성해 주세요.");
      if (saving.has(approved.chatId)) throw new Error("이 채팅의 일괄 보정 저장이 진행 중입니다.");
      const chatId = approved.chatId;
      saving.add(chatId);
      const items = approved.items.map((item) => ({ ...item }));
      try {
        for (const item of items) {
          if (item.status !== "ready") continue;
          if (signal?.aborted) { item.status = "not_saved"; item.reason = "작업이 중단되어 저장하지 않았습니다."; continue; }
          let current;
          try { current = await load(chatId, signal); }
          catch (error) { item.status = signal?.aborted ? "not_saved" : "save_failed"; item.reason = `저장 전 조회 실패: ${error.message}`; onResult(items); continue; }
          const latest = current.rows.find((row) => item.legacy ? row.legacy : !row.legacy && row.id === item.id);
          if (!latest) {
            item.status = item.legacy && current.structured ? "source_changed" : "deleted";
            item.reason = item.status === "source_changed" ? "Legacy 요약이 구조화된 요약으로 변경되었습니다." : "요약이 삭제되었거나 저장 구조가 변경되었습니다.";
            onResult(items); continue;
          }
          if (latest.original !== item.original || latest.problem) { item.status = "source_changed"; item.reason = "원문이 변경되었습니다. 다시 확인해 주세요."; onResult(items); continue; }
          if (signal?.aborted) { item.status = "not_saved"; item.reason = "작업이 중단되어 저장하지 않았습니다."; continue; }
          let body;
          try {
            body = item.legacy ? { summary: item.content } : { operation: "replace", entry: { id: item.id, content: item.content, tokenEstimate: estimateTextTokens(item.content.trim()) } };
          } catch (error) { item.status = "save_failed"; item.reason = `토큰 추정 실패: ${error.message}`; onResult(items); continue; }
          try {
            // An in-flight edit is allowed to finish: aborting the response would hide a committed write.
            const response = await fetcher(`/api/chats/${encodeURIComponent(chatId)}/${item.legacy ? "metadata" : "summary-entries"}`, { method: "PATCH", credentials: "same-origin", cache: "no-store", headers: core.MUTATION_HEADERS, body: JSON.stringify(body) });
            if (!response.ok) {
              item.status = response.status >= 500 || response.status === 408 ? "uncertain" : "save_failed";
              item.reason = `Engine 저장 응답 ${response.status}${item.status === "uncertain" ? " · 저장 여부를 다시 확인해 주세요." : ""}`;
            } else {
              const saved = await response.json();
              const metadata = core.metadataOf(saved);
              const content = item.legacy ? !Array.isArray(metadata.summaryEntries) && metadata.summary : metadata.summaryEntries?.find((entry) => entry.id === item.id)?.content;
              item.status = saved?.id === chatId && content === item.content ? "saved" : "uncertain";
              item.reason = item.status === "uncertain" ? "저장 응답에서 적용 결과를 확인하지 못했습니다. 요약을 다시 조회해 주세요." : "";
            }
          } catch (error) { item.status = "uncertain"; item.reason = `저장 여부 확인 필요: ${error.message}`; }
          onResult(items);
        }
        return { ...approved, items, stats: statistics(items) };
      } finally { saving.delete(chatId); }
    }
    return Object.freeze({ load, preview, apply, isSaving: (chatId) => saving.has(chatId) });
  }
  // Bounded token diff; very long comparisons highlight the encompassing changed span.
  function diffText(before, after) {
    if (before === after) return { before: [{ text: before, changed: false }], after: [{ text: after, changed: false }] };
    const tokenize = (text) => text.match(/\s+|[\p{L}\p{N}_]+|[^\s]/gu) ?? [];
    const a = tokenize(before), b = tokenize(after);
    const left = [], right = [];
    function push(parts, text, changed) { if (!text) return; if (parts.at(-1)?.changed === changed) parts.at(-1).text += text; else parts.push({ text, changed }); }
    if (a.length * b.length <= 80_000) {
      const width = b.length + 1, table = new Uint16Array((a.length + 1) * width);
      for (let i = a.length - 1; i >= 0; i -= 1) for (let j = b.length - 1; j >= 0; j -= 1) table[i * width + j] = a[i] === b[j] ? table[(i + 1) * width + j + 1] + 1 : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
      let i = 0, j = 0;
      while (i < a.length || j < b.length) {
        if (i < a.length && j < b.length && a[i] === b[j]) { push(left, a[i], false); push(right, b[j], false); i += 1; j += 1; }
        else if (i < a.length && (j === b.length || table[(i + 1) * width + j] >= table[i * width + j + 1])) push(left, a[i++], true);
        else push(right, b[j++], true);
      }
    } else {
      const aa = Array.from(before), bb = Array.from(after);
      let start = 0, end = 0;
      while (start < aa.length && start < bb.length && aa[start] === bb[start]) start += 1;
      while (end < aa.length - start && end < bb.length - start && aa[aa.length - 1 - end] === bb[bb.length - 1 - end]) end += 1;
      for (const [tokens, parts] of [[aa, left], [bb, right]]) { push(parts, tokens.slice(0, start).join(""), false); push(parts, tokens.slice(start, tokens.length - end).join(""), true); push(parts, tokens.slice(tokens.length - end).join(""), false); }
    }
    return { before: left, after: right };
  }
  return Object.freeze({ ruleSignature, summariesFromChat, statistics, diffText, createService });
})();
