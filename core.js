/* Shared summary logic and Engine HTTP adapters. Loaded before auto.js and extension.js. */
const __MCS_PHASE1_CORE__ = (() => {
  "use strict";
  const STORAGE_KEY = "marinara-chat-summary-calibrator.phase1";
  const PAGE_SIZE = 200;
  const MAX_ATTEMPTS = 3;
  const MUTATION_HEADERS = Object.freeze({ "Content-Type": "application/json", "x-marinara-csrf": "1" });
  const DEFAULT_PROMPT = "당신은 RP 대화의 신규 사건을 기록하는 요약자입니다. 실제 행동·발언·결과·관계 변화를 시간순으로 간결하고 정확하게 기록하세요. 추측이나 단정적인 성격 평가를 새 사실처럼 쓰지 마세요. 설명이나 코드 블록 없이 요약 본문만 출력하세요.";
  const SCOPE_PROMPT = "반드시 '신규 요약 대상'에 있는 메시지만 새 요약의 근거로 사용하세요. 기존 요약과 오버랩은 이해를 돕는 참고 문맥이며 새 사건처럼 다시 요약하거나 기존 요약 전체를 재작성하지 마세요. 실제 저장 출처는 프롬프트와 무관하게 애드온이 선택한 신규 메시지로만 정합니다.";
  const DEDUP_PROMPT = "이전 요약에 이미 기록된 사실을 불필요하게 반복하지 마세요. 동일한 성격·감정·관계 묘사를 거듭 강조하지 마세요. 반복된 행동만으로 성격이나 감정이 더 극단적으로 변했다고 해석하지 마세요. 새로운 사건·행동·결과·관계 변화는 기록하고, 기존 사실에 실질적 변화가 생기면 그 변화를 기록하세요. 오버랩은 참고 문맥일 뿐입니다. 중복 억제를 이유로 중요한 신규 사건을 누락하지 마세요. 기존 요약은 재작성하지 말고 신규 내용만 생성하세요.";
  const DEFAULT_SETTINGS = Object.freeze({ connectionId: "", intervalTurns: 5, managedChats: Object.freeze({}), referenceCount: 3, overlapEnabled: false, overlapTurns: 2, dedupEnabled: true, summaryPrompt: DEFAULT_PROMPT, correctionEnabled: false, ruleFiles: Object.freeze([]) });

  function settingsFromStorage(record) {
    const value = record && record[STORAGE_KEY];
    if (value == null) return { ...DEFAULT_SETTINGS };
    if (!value || typeof value !== "object" || value.schemaVersion !== 1 || !value.settings || typeof value.settings !== "object") {
      throw new Error("저장된 설정 형식을 알 수 없습니다. 설정을 변경하지 않았습니다.");
    }
    const raw = value.settings;
    const managedChats = {};
    if (raw.managedChats && typeof raw.managedChats === "object" && !Array.isArray(raw.managedChats)) {
      for (const [chatId, state] of Object.entries(raw.managedChats)) {
        if (chatId && chatId.length <= 512 && state && typeof state === "object" && [true, false, null].includes(state.original)) managedChats[chatId] = { original: state.original, ...(state.originalLegacy === true ? { originalLegacy: true } : {}) };
      }
    }
    return {
      connectionId: typeof raw.connectionId === "string" ? raw.connectionId.slice(0, 512) : "",
      intervalTurns: Number.isInteger(raw.intervalTurns) && raw.intervalTurns >= 1 && raw.intervalTurns <= 200 ? raw.intervalTurns : 5,
      managedChats,
      referenceCount: Number.isInteger(raw.referenceCount) && raw.referenceCount >= 0 && raw.referenceCount <= 20 ? raw.referenceCount : 3,
      overlapEnabled: raw.overlapEnabled === true,
      overlapTurns: Number.isInteger(raw.overlapTurns) && raw.overlapTurns >= 0 && raw.overlapTurns <= 50 ? raw.overlapTurns : 2,
      dedupEnabled: raw.dedupEnabled !== false,
      summaryPrompt: typeof raw.summaryPrompt === "string" && raw.summaryPrompt.trim() && raw.summaryPrompt.length <= 12000 ? raw.summaryPrompt : DEFAULT_PROMPT,
      correctionEnabled: raw.correctionEnabled === true,
      ruleFiles: Array.isArray(raw.ruleFiles) ? raw.ruleFiles : [],
      ...(raw.presetState && typeof raw.presetState === "object" && !Array.isArray(raw.presetState) ? { presetState: raw.presetState } : {}),
    };
  }

  function storagePatch(settings) {
    return { [STORAGE_KEY]: { schemaVersion: 1, settings: { ...settings } } };
  }

  function metadataOf(chat) {
    const raw = chat && chat.metadata;
    if (typeof raw === "string") {
      try { const parsed = JSON.parse(raw); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; }
      catch { return {}; }
    }
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  }

  function summaryInfo(chat) {
    const metadata = metadataOf(chat);
    const entries = Array.isArray(metadata.summaryEntries) ? metadata.summaryEntries : [];
    const legacy = entries.length === 0 && typeof metadata.summary === "string" && metadata.summary.trim() !== "";
    const rawAuto = metadata.automaticSummaryEnabled;
    const legacyAuto = metadata.enableAgents === true && Array.isArray(metadata.activeAgentIds) && metadata.activeAgentIds.includes("chat-summary");
    return {
      entries,
      legacy,
      automaticSummaryEnabled: rawAuto === true ? true : rawAuto === false ? false : legacyAuto,
      signature: JSON.stringify({ entries, summary: metadata.summary ?? null, rawAuto, enableAgents: metadata.enableAgents ?? null, activeAgentIds: metadata.activeAgentIds ?? null, hideSummarisedMessages: metadata.hideSummarisedMessages ?? null, summaryTailMessages: metadata.summaryTailMessages ?? null }),
    };
  }
  function chatDisplayName(chat) {
    const title = typeof chat?.name === "string" && chat.name.trim() ? chat.name.trim() : "제목 없는 채팅";
    const branch = metadataOf(chat).branchName;
    return typeof branch === "string" && branch.trim() ? `${title} · ${branch.trim()}` : title;
  }
  function summaryEntryDisplay(entry, messages, index, positions = new Map(messages.map((message, position) => [message.id, position + 1]))) {
    const located = (Array.isArray(entry?.messageIds) ? entry.messageIds : []).map((id) => positions.get(id)).filter(Number.isInteger);
    const names = { "Manual summary": "수동 요약", "Automated summary": "자동 요약", "Legacy summary": "이전 요약" };
    const rawTitle = typeof entry?.title === "string" ? entry.title.trim() : "";
    const title = names[rawTitle] ?? (rawTitle || `요약 ${index + 1}`);
    const range = located.length ? `메시지 ${Math.min(...located)}~${Math.max(...located)} · ${located.length}개 대화` : "출처 범위 확인 불가";
    const date = typeof entry?.createdAt === "string" && Number.isFinite(Date.parse(entry.createdAt)) ? new Date(entry.createdAt).toLocaleString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
    const preview = typeof entry?.content === "string" ? entry.content.replace(/\s+/g, " ").trim() : "";
    return `${index + 1}. ${title} · ${entry?.enabled === false ? "비활성" : "활성"}\n${range}${date ? ` · ${date}` : ""}${preview ? `\n${preview.slice(0, 100)}${preview.length > 100 ? "…" : ""}` : ""}`;
  }

  function compareMessage(a, b) {
    return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  }

  function analyzeBoundary(messages, entries, legacy = false) {
    const positions = new Map(messages.map((message, index) => [message.id, index]));
    const covered = new Set();
    const missing = new Set();
    let unknownEntries = 0;
    let activeEntries = 0;
    for (const entry of entries) {
      if (!entry || typeof entry !== "object" || entry.enabled === false || typeof entry.content !== "string" || !entry.content.trim()) continue;
      activeEntries += 1;
      const ids = Array.isArray(entry.messageIds) ? entry.messageIds.filter((id) => typeof id === "string" && id) : [];
      if (!ids.length) { unknownEntries += 1; continue; }
      for (const id of ids) (positions.has(id) ? covered : missing).add(id);
    }
    if (legacy) unknownEntries += 1;
    let lastIndex = -1;
    for (const id of covered) lastIndex = Math.max(lastIndex, positions.get(id));
    let gapCount = 0;
    for (let i = 0; i <= lastIndex; i += 1) if (!covered.has(messages[i].id)) gapCount += 1;
    return {
      activeEntries,
      lastCovered: lastIndex < 0 ? null : { id: messages[lastIndex].id, position: lastIndex + 1 },
      coveredCount: covered.size,
      assistantAfterCandidate: messages.slice(lastIndex + 1).filter((message) => message.role === "assistant").length,
      missingSourceCount: missing.size,
      unknownEntries,
      gapCount,
      certain: lastIndex >= 0 && missing.size === 0 && unknownEntries === 0 && gapCount === 0,
    };
  }

  function countAssistantTurns(messages) { return messages.filter((message) => message.role === "assistant").length; }
  function cursorFor(message) { return `${message.createdAt}|${encodeURIComponent(message.id)}`; }
  function chatPath(chatId) { return `/api/chats/${encodeURIComponent(chatId)}`; }

  function makeReader(fetcher) {
    async function get(path, signal) {
      const response = await fetcher(path, { method: "GET", credentials: "same-origin", cache: "no-store", signal });
      if (!response.ok) throw new Error(`Engine 조회 실패 (${response.status})`);
      return response.json();
    }
    async function readChat(chatId, signal) { return get(chatPath(chatId), signal); }
    async function readCount(chatId, signal) {
      const value = await get(`${chatPath(chatId)}/message-count`, signal);
      if (!Number.isSafeInteger(value?.count) || value.count < 0) throw new Error("메시지 개수 응답이 올바르지 않습니다.");
      return value.count;
    }
    async function page(chatId, limit, before, signal) {
      const params = new URLSearchParams({ limit: String(limit) });
      if (before) params.set("before", before);
      const rows = await get(`${chatPath(chatId)}/messages?${params}`, signal);
      if (!Array.isArray(rows) || rows.length > limit || rows.some((row) => !row || typeof row.id !== "string" || !row.id || typeof row.createdAt !== "string" || !Number.isFinite(Date.parse(row.createdAt)) || (row.chatId != null && row.chatId !== chatId))) {
        throw new Error("메시지 페이지 응답이 올바르지 않습니다.");
      }
      for (let i = 1; i < rows.length; i += 1) if (compareMessage(rows[i - 1], rows[i]) >= 0) throw new Error("메시지 페이지 순서가 올바르지 않습니다.");
      return rows;
    }
    async function readMessages(chatId, expectedCount, signal) {
      if (!expectedCount) return [];
      const pages = [];
      const seen = new Set();
      let before;
      let previousOldest;
      while (seen.size < expectedCount) {
        if (signal?.aborted) throw new Error("조회가 취소되었습니다.");
        const rows = await page(chatId, PAGE_SIZE, before, signal);
        if (!rows.length) throw new Error("조회 중 메시지 범위가 변경되었습니다.");
        const oldest = rows[0];
        if (previousOldest && compareMessage(oldest, previousOldest) >= 0) throw new Error("메시지 커서가 진행되지 않았습니다.");
        for (const row of rows) {
          if (seen.has(row.id)) throw new Error("중복 메시지가 반환되었습니다.");
          seen.add(row.id);
        }
        pages.push(rows.map((row) => ({ id: row.id, createdAt: row.createdAt, role: row.role, characterId: row.characterId, content: row.content, extra: row.extra, activeSwipeIndex: row.activeSwipeIndex, swipeCount: row.swipeCount })));
        if (seen.size > expectedCount) throw new Error("조회 중 메시지 수가 변경되었습니다.");
        previousOldest = oldest;
        before = cursorFor(oldest);
      }
      const messages = pages.reverse().flat();
      for (let i = 1; i < messages.length; i += 1) if (compareMessage(messages[i - 1], messages[i]) >= 0) throw new Error("메시지 전체 순서가 올바르지 않습니다.");
      return messages;
    }
    async function readSnapshot(chatId, signal) {
      let lastError;
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
        if (signal?.aborted) throw new Error("조회가 취소되었습니다.");
        try {
          const chat = await readChat(chatId, signal);
          if (!chat || chat.id !== chatId) throw new Error("현재 채팅을 찾을 수 없습니다.");
          const count = await readCount(chatId, signal);
          const messages = await readMessages(chatId, count, signal);
          const newest = await page(chatId, Math.min(PAGE_SIZE, Math.max(1, count)), undefined, signal);
          const tail = messages.slice(-newest.length);
          if (newest.length !== Math.min(PAGE_SIZE, count) || newest.some((row, i) => messageStamp(row) !== messageStamp(tail[i]))) throw new Error("조회 중 최근 메시지가 변경되었습니다.");
          const [checkCount, checkChat] = await Promise.all([readCount(chatId, signal), readChat(chatId, signal)]);
          if (checkCount !== count || summaryInfo(checkChat).signature !== summaryInfo(chat).signature) throw new Error("조회 중 채팅 정보가 변경되었습니다.");
          const summary = summaryInfo(chat);
          return { chatId, displayName: chatDisplayName(chat), mode: chat.mode, messageCount: count, messages, assistantTurns: countAssistantTurns(messages), summary, boundary: analyzeBoundary(messages, summary.entries, summary.legacy) };
        } catch (error) {
          if (signal?.aborted) throw error;
          lastError = error;
        }
      }
      throw new Error(`안정된 채팅 상태를 조회하지 못했습니다: ${lastError?.message ?? "알 수 없는 오류"}`);
    }
    async function readConnections(signal) {
      const rows = await get("/api/connections", signal);
      if (!Array.isArray(rows)) throw new Error("모델 연결 목록 응답이 올바르지 않습니다.");
      const excluded = new Set(["image_generation", "video_generation", "decision", "embedding", "speech_to_text", "text_to_speech"]);
      return rows.filter((row) => row && typeof row.id === "string" && typeof row.name === "string" && typeof row.model === "string" && row.model.trim() && !excluded.has(row.provider)).map((row) => ({ id: row.id, name: row.name, model: row.model }));
    }
    return Object.freeze({ readSnapshot, readConnections, readChat });
  }

  function parsedExtra(raw) {
    if (typeof raw === "string") { try { const value = JSON.parse(raw); return value && typeof value === "object" ? value : {}; } catch { return {}; } }
    return raw && typeof raw === "object" ? raw : {};
  }
  function messageStamp(message, ignoreSummaryHide = false) {
    const extra = parsedExtra(message.extra);
    const normalizedExtra = ignoreSummaryHide ? Object.fromEntries(Object.entries(extra).filter(([key]) => key !== "hiddenFromAI")) : extra;
    return JSON.stringify([message.id, message.createdAt, message.role, message.characterId, message.content, normalizedExtra, message.activeSwipeIndex, message.swipeCount]);
  }
  function selectManualRange(snapshot, sourceFence = null) {
    if (snapshot.mode && snapshot.mode !== "roleplay") throw new Error("일반 Chat Summary를 사용하는 RP 채팅에서만 수동 요약할 수 있습니다.");
    const hasActive = snapshot.summary.entries.some((entry) => entry && entry.enabled !== false && typeof entry.content === "string" && entry.content.trim());
    if ((hasActive || snapshot.summary.legacy) && !snapshot.boundary.certain) throw new Error("기존 요약의 출처 범위를 확정할 수 없어 신규 대화를 선택하지 않았습니다.");
    const start = hasActive ? snapshot.boundary.lastCovered.position : 0;
    let end = snapshot.messages.length;
    if (sourceFence) {
      const last = snapshot.messages.findIndex((row) => row.id === sourceFence.throughMessageId);
      if (last < 0) throw new Error("전송 전 대화 경계 메시지가 사라져 요약하지 않았습니다.");
      end = last + 1;
    } else while (end > start && snapshot.messages[end - 1].role === "user") end -= 1;
    if (end <= start) return null;
    const selected = snapshot.messages.slice(start, end);
    if (selected.length > 500) throw new Error("요약 범위가 Engine의 500개 메시지 제한을 넘습니다. 대화를 나누어 요약해야 합니다.");
    if (selected.some((row) => !["user", "assistant", "system", "narrator"].includes(row.role) || typeof row.content !== "string" || !row.content.trim() || parsedExtra(row.extra).hiddenFromAI === true)) throw new Error("범위에 숨김 또는 텍스트가 없는 메시지가 있어 출처를 정확하게 저장할 수 없습니다.");
    return { startIndex: start + 1, endIndex: end, messages: selected, messageIds: selected.map((row) => row.id) };
  }
  function validateSendFence(snapshot, fence) {
    const rows = fence?.messages;
    if (!fence?.throughMessageId || !Array.isArray(rows) || !rows.length || rows.at(-1).id !== fence.throughMessageId) throw new Error("전송 전 대화 경계를 확인하지 못했습니다.");
    const last = snapshot.messages.findIndex((row) => row.id === fence.throughMessageId);
    const start = last - rows.length + 1;
    if (start < 0 || rows.some((row, index) => messageStamp(row, true) !== messageStamp(snapshot.messages[start + index], true))) throw new Error("전송 전 메시지가 변경되었거나 캐시와 달라 요약하지 않았습니다.");
    if (snapshot.messages[last + 1] && snapshot.messages[last + 1].role !== "user") throw new Error("전송 직전 캐시보다 새로운 대화가 있어 이번 입력의 자동 요약을 건너뛰었습니다.");
  }
  function comparisonLength(before, range, sourceFence) {
    return sourceFence ? range.endIndex : before.messages.length;
  }
  function autoDue(snapshot, sourceFence, intervalTurns) {
    if (!Number.isInteger(intervalTurns) || intervalTurns < 1) throw new Error("자동 요약 주기가 올바르지 않습니다.");
    const range = selectManualRange(snapshot, sourceFence);
    if (!range) return { due: false, turnsSinceBoundary: 0 };
    const turnsSinceBoundary = range.messages.filter((row) => row.role === "assistant").length;
    return { due: turnsSinceBoundary >= intervalTurns, turnsSinceBoundary };
  }
  function recentSummaryReferences(snapshot, count) {
    if (!Number.isInteger(count) || count < 0 || count > 20) throw new Error("이전 요약 참고 개수가 올바르지 않습니다.");
    if (count === 0) return [];
    const positions = new Map(snapshot.messages.map((message, index) => [message.id, index]));
    const references = snapshot.summary.entries.map((entry, order) => {
      if (!entry || entry.enabled === false || typeof entry.content !== "string" || !entry.content.trim()) return null;
      const ids = Array.isArray(entry.messageIds) ? entry.messageIds : [];
      const located = ids.map((id) => positions.get(id)).filter((value) => Number.isInteger(value));
      if (!located.length) throw new Error("기존 요약의 출처 순서를 확인할 수 없습니다.");
      return { entry, order, last: Math.max(...located), first: Math.min(...located) };
    }).filter(Boolean);
    references.sort((a, b) => a.last - b.last || a.first - b.first || a.order - b.order);
    return references.slice(-count).map((item) => item.entry);
  }
  function selectOverlapMessages(snapshot, range, turns) {
    if (!Number.isInteger(turns) || turns < 0 || turns > 50) throw new Error("오버랩 턴수가 올바르지 않습니다.");
    if (turns === 0 || range.startIndex <= 1) return [];
    const prefix = snapshot.messages.slice(0, range.startIndex - 1);
    const assistants = [];
    for (let i = 0; i < prefix.length; i += 1) if (prefix[i].role === "assistant") assistants.push(i);
    if (!assistants.length) return [];
    const chosen = assistants.slice(-turns);
    const previousAssistant = assistants[assistants.length - chosen.length - 1] ?? -1;
    const selected = prefix.slice(previousAssistant + 1, assistants.at(-1) + 1);
    if (selected.some((row) => typeof row.content !== "string" || !row.content.trim())) throw new Error("오버랩 범위에 텍스트가 없는 메시지가 있습니다.");
    if (selected.some((row) => range.messageIds.includes(row.id))) throw new Error("오버랩과 신규 요약 출처가 겹칩니다.");
    return selected;
  }
  function buildManualPrompt(snapshot, range, quality = DEFAULT_SETTINGS) {
    const referenceCount = quality.referenceCount ?? DEFAULT_SETTINGS.referenceCount;
    const overlapTurns = quality.overlapEnabled ? quality.overlapTurns ?? DEFAULT_SETTINGS.overlapTurns : 0;
    const previous = recentSummaryReferences(snapshot, referenceCount);
    const overlap = selectOverlapMessages(snapshot, range, overlapTurns);
    const custom = typeof quality.summaryPrompt === "string" && quality.summaryPrompt.trim() && quality.summaryPrompt.length <= 12000 ? quality.summaryPrompt : DEFAULT_PROMPT;
    const system = `${custom.trim()}\n\n${SCOPE_PROMPT}${quality.dedupEnabled === false ? "" : `\n\n${DEDUP_PROMPT}`}`;
    const references = previous.length ? previous.map((entry, index) => `${index + 1}. ${entry.content.trim()}`).join("\n\n") : "없음";
    const overlapText = overlap.length ? overlap.map((row) => `[참고 ${snapshot.messages.findIndex((message) => message.id === row.id) + 1}] ${row.role}: ${row.content}`).join("\n\n") : "없음";
    const transcript = range.messages.map((row, index) => `[${range.startIndex + index}] ${row.role}: ${row.content}`).join("\n\n");
    const user = `[기존 요약 참고: ${previous.length}개 · 신규 출처 아님]\n${references}\n\n[오버랩 참고: ${overlapTurns}턴 설정 · 신규 출처 아님]\n${overlapText}\n\n[신규 요약 대상: ${range.messages.length}개 메시지 · 이 부분만 새 요약]\n${transcript}`;
    // /api/generate/raw normalizes excessive blank lines before its context-fit check.
    const normalizeRawContent = (content) => content.replace(/\n([ \t]*\n){2,}/g, "\n\n");
    const normalizedSystem = normalizeRawContent(system);
    const normalizedUser = normalizeRawContent(user);
    if (normalizedSystem.length > 20_000 || normalizedUser.length > 60_000) throw new Error("요약 입력이 안전한 크기 제한을 넘습니다. 짧은 범위로 나누어 실행해 주세요.");
    return [{ role: "system", content: normalizedSystem }, { role: "user", content: normalizedUser }];
  }
  // Remove each supported outer wrapper at most once; never parse or rewrite the body.
  function cleanSummaryOutput(text) {
    let content = text.trim();
    const used = new Set();
    const prefixPattern = /^(?:요약|summary|다음은\s+요약입니다|here\s+is\s+the\s+summary)\s*:\s*/i;
    for (let step = 0; step < 3; step += 1) {
      let next = null;
      let kind;
      if (!used.has("fence")) {
        const lines = content.split(/\r?\n/);
        const opening = /^(`{3,}|~{3,})([^\r\n]*)$/.exec(lines[0]);
        if (opening && !(opening[1][0] === "`" && opening[2].includes("`"))) {
          const closing = new RegExp(`^[ \\t]*${opening[1][0]}{${opening[1].length},}[ \\t]*$`);
          const end = lines.findIndex((line, index) => index > 0 && closing.test(line));
          if (end === lines.length - 1 && end > 0) {
            // Slice the original string so internal line endings are preserved.
            next = content.slice(content.indexOf("\n") + 1, content.lastIndexOf("\n")).trim();
            kind = "fence";
          }
        }
      }
      if (next === null && !used.has("prefix")) {
        const prefix = prefixPattern.exec(content);
        if (prefix && content.slice(prefix[0].length).trim()) {
          next = content.slice(prefix[0].length).trim();
          kind = "prefix";
        }
      }
      if (next === null && !used.has("quote")) {
        const pairs = { '"': '"', "'": "'", "“": "”", "‘": "’" };
        const start = content[0];
        const end = pairs[start];
        if (end && content.length > 2 && content.endsWith(end)) {
          const inner = content.slice(1, -1);
          // A closing quote escaped by a backslash is not an outer delimiter.
          const trailingSlashes = /\\*$/.exec(inner)[0].length;
          // Additional same-style quotes may be dialogue, separate quotations or
          // another wrapper. Leave those ambiguous cases intact. Apostrophes
          // inside words do not act as quote delimiters.
          let ambiguous = trailingSlashes % 2 !== 0;
          for (let i = 0; i < inner.length && !ambiguous; i += 1) {
            if (inner[i] !== start && inner[i] !== end) continue;
            if ((inner[i] === "'" || inner[i] === "’") && /\p{L}/u.test(inner[i - 1] ?? "") && /\p{L}/u.test(inner[i + 1] ?? "")) continue;
            ambiguous = true;
          }
          // Explicit quotation/attribution markup is content, not a wrapper.
          if (!ambiguous && inner.trim() && (!/^\s*(?:>|[\p{L}\p{N}_ .·-]{1,60}:\s)/u.test(inner) || prefixPattern.test(inner.trimStart()))) {
            next = inner.trim();
            kind = "quote";
          }
        }
      }
      if (next === null) break;
      used.add(kind);
      content = next;
    }
    return content;
  }
  function assertStillSame(before, after, range, sourceFence = null) {
    if (after.summary.signature !== before.summary.signature || after.mode !== before.mode || (sourceFence ? after.messages.length < comparisonLength(before, range, sourceFence) : after.messageCount !== before.messageCount || after.messages.length !== before.messages.length)) throw new Error("생성 중 채팅 또는 기존 요약이 변경되어 저장하지 않았습니다.");
    const compareThrough = comparisonLength(before, range, sourceFence);
    for (let i = 0; i < compareThrough; i += 1) if (messageStamp(before.messages[i]) !== messageStamp(after.messages[i])) throw new Error("생성 중 메시지가 변경되어 저장하지 않았습니다.");
    const reselected = selectManualRange(after, sourceFence);
    if (!reselected || reselected.startIndex !== range.startIndex || reselected.endIndex !== range.endIndex || JSON.stringify(reselected.messageIds) !== JSON.stringify(range.messageIds)) throw new Error("요약 대상 범위가 변경되어 저장하지 않았습니다.");
  }
  function makeManualService(fetcher, reader, correctSummary = (text) => ({ text, changed: false, warnings: [] })) {
    const activeChats = new Set();
    async function request(path, method, body, signal) {
      const response = await fetcher(path, { method, credentials: "same-origin", cache: "no-store", headers: MUTATION_HEADERS, body: JSON.stringify(body), signal });
      const value = await response.json();
      if (!response.ok) throw new Error(`Engine ${method} 실패 (${response.status}): ${typeof value?.error === "string" ? value.error : "응답 오류"}`);
      if (path === "/api/generate/raw" && !body.returnPrompt && response.headers?.get?.("X-Marinara-Fallback-Used")) throw new Error("선택한 모델 대신 Engine fallback 모델이 사용되어 요약을 저장하지 않았습니다.");
      return value;
    }
    async function compensate(chatId, entryId, signal) {
      try { await request(`${chatPath(chatId)}/summary-entries`, "PATCH", { operation: "delete", entryId }, signal); }
      catch (error) { throw new Error(`저장 검증 실패 후 생성 항목을 되돌리지 못했습니다: ${error.message}`); }
    }
    async function execute(chatId, connectionId, entryId, signal, onPhase, options) {
      if (!connectionId) throw new Error("요약 모델 연결을 선택해 주세요.");
      onPhase("대화와 요약 범위 확인 중");
      const before = await reader.readSnapshot(chatId, signal);
      if (before.summary.entries.some((entry) => entry?.id === entryId)) throw new Error("요약 항목 ID가 이미 사용 중입니다.");
      if (before.summary.entries.filter((entry) => entry?.origin === "automated" && entry.enabled !== false && !entry.hiddenMessageIds?.length).length > 200) throw new Error("기존 자동 요약 항목이 Engine 보존 상한을 넘어 기존 항목 보존을 보장할 수 없습니다.");
      if (options?.sourceFence) validateSendFence(before, options.sourceFence);
      const sourceFence = options?.sourceFence ?? null;
      const range = selectManualRange(before, sourceFence);
      if (!range || options?.minimumTurns && countAssistantTurns(range.messages) < options.minimumTurns) return { kind: "empty" };
      const quality = options?.quality ?? DEFAULT_SETTINGS;
      const prompt = buildManualPrompt(before, range, quality);
      const rawBody = { connectionId, messages: prompt, parameters: { maxTokens: 1200 }, streaming: false };
      onPhase("모델 입력 크기와 누락 여부 확인 중");
      const fitted = await request("/api/generate/raw", "POST", { ...rawBody, returnPrompt: true }, signal);
      const fittedMessages = fitted?.prompt?.messages;
      if (!Array.isArray(fittedMessages) || fittedMessages.length !== prompt.length || fittedMessages.some((row, index) => row.role !== prompt[index].role || row.content !== prompt[index].content)) throw new Error("선택한 모델의 컨텍스트에 신규 대화 전체가 들어가지 않아 모델을 호출하지 않았습니다.");
      onPhase(`${range.messages.length}개 메시지 요약 생성 중`);
      const generated = await request("/api/generate/raw", "POST", { ...rawBody, runId: entryId }, signal);
      if (generated.aborted) throw new Error("모델 호출이 중단되었습니다.");
      const original = typeof generated.content === "string" ? cleanSummaryOutput(generated.content) : "";
      if (!original || original.length > 20_000) throw new Error("모델이 유효한 요약 본문을 반환하지 않았습니다.");
      if (quality.correctionEnabled) onPhase("요약문 표현 보정 중");
      const corrected = quality.correctionEnabled ? await correctSummary(original, quality, signal) : { text: original, changed: false, warnings: [] };
      const content = corrected.text;
      if (typeof content !== "string" || !content.trim() || content.length > 20_000) throw new Error("표현 보정 결과가 유효하지 않아 저장하지 않았습니다.");
      const correction = { changed: corrected.changed, replacementCount: corrected.replacementCount ?? 0, warnings: corrected.warnings ?? [] };
      onPhase("저장 전 메시지와 기존 요약 재확인 중");
      const latest = await reader.readSnapshot(chatId, signal);
      assertStillSame(before, latest, range, sourceFence);
      if (signal?.aborted) throw new Error("저장 전에 작업이 취소되었습니다.");
      onPhase("기존 Chat Summary에 저장 중");
      const saved = await request(`${chatPath(chatId)}/summary-entries`, "PATCH", { operation: "replace", entry: {
        id: entryId, kind: "rolling", origin: "manual", title: "Manual summary", content, enabled: true, sourceMode: "range",
        rangeStartIndex: range.startIndex, rangeEndIndex: range.endIndex, messageCount: range.messages.length, messageIds: range.messageIds,
      } });
      const savedInfo = summaryInfo(saved);
      const entry = savedInfo.entries.find((item) => item?.id === entryId);
      const sameIds = entry && JSON.stringify(entry.messageIds) === JSON.stringify(range.messageIds);
      const oldEntriesPreserved = JSON.stringify(savedInfo.entries.filter((item) => item?.id !== entryId)) === JSON.stringify(before.summary.entries);
      const composed = savedInfo.entries.filter((item) => item?.enabled !== false).map((item) => item.content.trim()).filter(Boolean).join("\n\n").trim();
      const hiddenIdsValid = !entry?.hiddenMessageIds || entry.hiddenMessageIds.every((id) => range.messageIds.includes(id));
      const valid = entry && entry.content === content && entry.enabled !== false && entry.sourceMode === "range" && entry.rangeStartIndex === range.startIndex && entry.rangeEndIndex === range.endIndex && sameIds && hiddenIdsValid && oldEntriesPreserved && metadataOf(saved).summary === composed;
      if (!valid) {
        if (entry) await compensate(chatId, entryId);
        throw new Error("Engine이 저장한 출처·기존 요약을 검증하지 못해 생성 항목을 되돌렸습니다.");
      }
      let after;
      try { after = await reader.readSnapshot(chatId); }
      catch (error) {
        return { kind: "saved", verification: "pending", messageCount: range.messages.length, entryId, content, correction };
      }
      const afterEntry = after.summary.entries.find((item) => item?.id === entryId);
      const sourceSame = afterEntry && JSON.stringify(afterEntry.messageIds) === JSON.stringify(range.messageIds);
      const compareThrough = comparisonLength(before, range, sourceFence);
      const contentSame = after.messages.length >= compareThrough && before.messages.slice(0, compareThrough).every((message, index) => messageStamp(message, true) === messageStamp(after.messages[index], true));
      const hiddenConfirmed = (afterEntry?.hiddenMessageIds ?? []).every((id) => parsedExtra(after.messages.find((message) => message.id === id)?.extra).hiddenFromAI === true);
      if (!sourceSame || !contentSame || !hiddenConfirmed) {
        await compensate(chatId, entryId);
        throw new Error("저장 직후 메시지·출처가 변경되어 생성 항목을 되돌렸습니다.");
      }
      return { kind: "saved", messageCount: range.messages.length, entryId, content, correction };
    }
    async function run(chatId, connectionId, entryId, signal, onPhase = () => {}, options = {}) {
      if (activeChats.has(chatId)) throw new Error("이 채팅의 수동 요약이 이미 진행 중입니다.");
      activeChats.add(chatId);
      try { return await execute(chatId, connectionId, entryId, signal, onPhase, options); }
      finally { activeChats.delete(chatId); }
    }
    return Object.freeze({ run });
  }

  return Object.freeze({ STORAGE_KEY, MUTATION_HEADERS, DEFAULT_PROMPT, DEFAULT_SETTINGS, settingsFromStorage, storagePatch, metadataOf, summaryInfo, chatDisplayName, summaryEntryDisplay, analyzeBoundary, countAssistantTurns, cursorFor, makeReader, selectManualRange, validateSendFence, autoDue, recentSummaryReferences, selectOverlapMessages, buildManualPrompt, cleanSummaryOutput, assertStillSame, makeManualService });
})();
