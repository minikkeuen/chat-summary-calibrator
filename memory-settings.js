/* Engine-owned chat memory settings; no extension-side persistence. */
const __MCS_MEMORY_SETTINGS__ = (() => {
  "use strict";
  const fields = new Set(["enableMemoryRecall", "hideSummarisedMessages", "summaryTailMessages", "semanticSummaryRetrievalEnabled", "semanticSummaryRecentCount", "semanticSummaryOlderCount", "semanticSummaryMinSimilarity"]);
  function valid(key, value) {
    if (!fields.has(key)) return false;
    if (["enableMemoryRecall", "hideSummarisedMessages", "semanticSummaryRetrievalEnabled"].includes(key)) return typeof value === "boolean";
    if (typeof value !== "number" || !Number.isFinite(value)) return false;
    if (key === "semanticSummaryMinSimilarity") return value >= 0 && value <= 1;
    return Number.isSafeInteger(value) && value >= 0 && (key === "summaryTailMessages" || value <= 20);
  }
  function values(chat, metadataOf) {
    const m = metadataOf(chat);
    const advancedActive = m.advancedMemory?.enabled === true;
    const semanticValid = ["semanticSummaryRecentCount", "semanticSummaryOlderCount", "semanticSummaryMinSimilarity"].every((key) => m[key] === undefined || valid(key, m[key]));
    const tail = m.summaryTailMessages == null ? 10 : Math.floor(Number(m.summaryTailMessages));
    return {
      recallUnavailable: advancedActive,
      enableMemoryRecall: !advancedActive && (m.enableMemoryRecall !== undefined ? m.enableMemoryRecall === true : chat.mode === "conversation" || m.sceneStatus === "active"),
      hideSummarisedMessages: m.hideSummarisedMessages === true,
      summaryTailMessages: Number.isFinite(tail) && tail >= 0 ? tail : 0,
      semanticSummaryRetrievalEnabled: m.semanticSummaryRetrievalEnabled === true,
      semanticSummaryRecentCount: semanticValid && m.semanticSummaryRecentCount !== undefined ? m.semanticSummaryRecentCount : 2,
      semanticSummaryOlderCount: semanticValid && m.semanticSummaryOlderCount !== undefined ? m.semanticSummaryOlderCount : 3,
      semanticSummaryMinSimilarity: semanticValid && m.semanticSummaryMinSimilarity !== undefined ? m.semanticSummaryMinSimilarity : 0.15,
    };
  }
  function create({ fetcher, reader, core, onChange }) {
    let active = null, revision = 0, state = null, disposed = false;
    const inFlight = new Map();
    const emit = (status, message = "") => { if (!disposed) onChange({ chatId: active, status, message, values: state && values(state, core.metadataOf) }); };
    async function load(chatId) {
      active = chatId; state = null;
      const token = ++revision;
      if (!chatId) { emit("empty", "현재 채팅이 없습니다."); return; }
      emit("loading", "기억 설정을 불러오는 중입니다.");
      try {
        const pending = inFlight.get(chatId);
        if (pending) await pending;
        const chat = await reader.readChat(chatId);
        if (!chat || chat.id !== chatId) throw new Error("채팅 응답을 확인할 수 없습니다.");
        if (disposed || token !== revision || active !== chatId) return;
        state = chat; emit("ready");
      } catch (error) {
        if (disposed || token !== revision || active !== chatId) return;
        state = null; emit("error", `기억 설정 조회 실패: ${error.message}`);
      }
    }
    async function save(key, value) {
      const chatId = active;
      if (!chatId || !state || inFlight.has(chatId)) return;
      if (!valid(key, value)) { emit("ready", "입력 범위를 확인해 주세요."); return; }
      const token = ++revision;
      emit("saving", "저장 중입니다.");
      const operation = (async () => {
        try {
          let body = { [key]: value };
          if (key === "enableMemoryRecall" && value === true) {
            const fresh = await reader.readChat(chatId);
            if (!fresh || fresh.id !== chatId) throw new Error("채팅 응답을 확인할 수 없습니다.");
            if (core.metadataOf(fresh).advancedMemory?.enabled === true) throw new Error("현재 채팅에서는 기억 검색을 변경할 수 없습니다.");
          }
          if (key === "semanticSummaryRetrievalEnabled" && value === true) {
            const fresh = await reader.readChat(chatId);
            if (!fresh || fresh.id !== chatId) throw new Error("채팅 응답을 확인할 수 없습니다.");
            const m = core.metadataOf(fresh);
            if (m.semanticSummaryRecentCount == null) body.semanticSummaryRecentCount = 5;
            if (m.semanticSummaryOlderCount == null) body.semanticSummaryOlderCount = 5;
          }
          const response = await fetcher(`/api/chats/${encodeURIComponent(chatId)}/metadata`, { method: "PATCH", credentials: "same-origin", cache: "no-store", headers: core.MUTATION_HEADERS, body: JSON.stringify(body) });
          if (!response.ok) throw new Error(`Engine 저장 실패 (${response.status})`);
          const chat = await response.json();
          if (!chat || chat.id !== chatId || !chat.metadata) throw new Error("저장 응답을 확인할 수 없습니다.");
          const saved = core.metadataOf(chat);
          if (Object.entries(body).some(([name, expected]) => saved[name] !== expected)) throw new Error("저장된 값을 확인할 수 없습니다.");
          if (!disposed && active === chatId && token === revision) { state = chat; emit("ready", "저장했습니다."); }
        } catch (error) {
          let latest = null;
          try { latest = await reader.readChat(chatId); if (latest?.id !== chatId) latest = null; } catch { /* A failed read leaves controls disabled. */ }
          if (!disposed && active === chatId && token === revision) { state = latest; emit(latest ? "ready" : "error", `저장 확인 실패: ${error.message}`); }
        }
      })();
      inFlight.set(chatId, operation);
      try { await operation; } finally { if (inFlight.get(chatId) === operation) inFlight.delete(chatId); }
    }
    async function apply(chatId, body, ensureEligible) {
      if (!chatId || inFlight.has(chatId)) throw new Error("기억 설정 변경이 진행 중입니다.");
      if (Object.entries(body).some(([key, value]) => !valid(key, value))) throw new Error("프리셋 기억 설정이 올바르지 않습니다.");
      const token = ++revision;
      if (active === chatId) emit("saving", "프리셋을 적용 중입니다.");
      const operation = (async () => {
        const fresh = await reader.readChat(chatId);
        if (!fresh || fresh.id !== chatId) throw new Error("채팅 응답을 확인할 수 없습니다.");
        if (body.enableMemoryRecall && core.metadataOf(fresh).advancedMemory?.enabled === true) throw new Error("현재 채팅에 기억 검색을 적용할 수 없습니다.");
        if (ensureEligible && !ensureEligible(fresh)) throw new Error("채팅 설정이 변경되어 자동 적용을 중지했습니다.");
        const response = await fetcher(`/api/chats/${encodeURIComponent(chatId)}/metadata`, { method: "PATCH", credentials: "same-origin", cache: "no-store", headers: core.MUTATION_HEADERS, body: JSON.stringify(body) });
        if (!response.ok) throw new Error(`Engine 저장 실패 (${response.status})`);
        const updated = await response.json();
        if (updated?.id !== chatId || Object.entries(body).some(([key, value]) => core.metadataOf(updated)[key] !== value)) throw new Error("Engine 저장 결과를 확인할 수 없습니다.");
        return updated;
      })();
      inFlight.set(chatId, operation);
      try {
        const updated = await operation;
        if (!disposed && active === chatId && token === revision) { state = updated; emit("ready"); }
        return updated;
      } catch (error) {
        if (!disposed && active === chatId && token === revision) { state = null; emit("error", `프리셋 적용 실패: ${error.message}`); }
        throw error;
      } finally { if (inFlight.get(chatId) === operation) inFlight.delete(chatId); }
    }
    async function snapshot(chatId) {
      const pending = inFlight.get(chatId);
      if (pending) await pending;
      const chat = await reader.readChat(chatId);
      if (chat?.id !== chatId) throw new Error("채팅 응답을 확인할 수 없습니다.");
      return chat;
    }
    return Object.freeze({ load, save, apply, snapshot, dispose() { disposed = true; revision += 1; state = null; } });
  }
  return Object.freeze({ valid, values, create });
})();
