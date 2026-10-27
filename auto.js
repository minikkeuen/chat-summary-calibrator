/* Send-time automation and Engine policy. No polling or persistent turn ledger. */
const __MCS_AUTO__ = (() => {
  "use strict";
  function metadata(chat) {
    const value = chat?.metadata;
    if (typeof value === "string") { try { return JSON.parse(value) ?? {}; } catch { return {}; } }
    return value && typeof value === "object" ? value : {};
  }
  function createAutoController({ core, fetcher, reader, manualService, getSettings, saveSettings, onState, isManualBusy, newId, onIdle = () => {} }) {
    const pending = new Map();
    const jobs = new Map();
    const policyBusy = new Set();
    const policyPromises = new Set();
    let stopping = false;

    async function json(path, method = "GET", body, signal) {
      const response = await fetcher(path, { method, credentials: "same-origin", cache: "no-store", ...(body ? { headers: core.MUTATION_HEADERS, body: JSON.stringify(body) } : {}), signal });
      const value = await response.json();
      if (!response.ok) throw new Error(`Engine ${method} 실패 (${response.status}): ${value?.error ?? "응답 오류"}`);
      return value;
    }
    function state(chatId, kind, text, error = "") { onState(chatId, { kind, text, error }); }
    function managed(chatId) { return Object.prototype.hasOwnProperty.call(getSettings()?.managedChats ?? {}, chatId); }
    function queue(chatId) {
      if (!pending.has(chatId)) pending.set(chatId, []);
      return pending.get(chatId);
    }
    async function generationActive(chatId) {
      const value = await json(`/api/generate/status/${encodeURIComponent(chatId)}`);
      if (typeof value?.active !== "boolean") throw new Error("Engine 생성 상태를 확인하지 못했습니다.");
      return value.active;
    }
    async function setEngineAuto(chatId, value, restoreLegacy = false) {
      const path = `/api/chats/${encodeURIComponent(chatId)}/metadata`;
      const latest = await reader.readChat(chatId);
      if (!latest || latest.id !== chatId) throw new Error("현재 채팅을 확인할 수 없습니다.");
      const active = metadata(latest).activeAgentIds;
      const body = { automaticSummaryEnabled: value };
      if (Array.isArray(active)) {
        if (value === false && active.includes("chat-summary")) body.activeAgentIds = active.filter((id) => id !== "chat-summary");
        if (restoreLegacy && !active.includes("chat-summary")) body.activeAgentIds = [...active, "chat-summary"];
      } else if (restoreLegacy) body.activeAgentIds = ["chat-summary"];
      await json(path, "PATCH", body);
      const check = await reader.readChat(chatId);
      if (metadata(check).automaticSummaryEnabled !== value ||
          (body.activeAgentIds && JSON.stringify(metadata(check).activeAgentIds) !== JSON.stringify(body.activeAgentIds))) {
        throw new Error("Engine 자동 요약 설정 변경을 확인하지 못했습니다.");
      }
    }
    async function enableInternal(chatId) {
      if (stopping || policyBusy.has(chatId)) return;
      policyBusy.add(chatId);
      try {
        const settings = getSettings();
        if (managed(chatId)) {
          const existing = await reader.readChat(chatId);
          if (!existing || existing.id !== chatId) throw new Error("현재 채팅을 확인할 수 없습니다.");
          const meta = metadata(existing);
          if (meta.automaticSummaryEnabled !== false || (Array.isArray(meta.activeAgentIds) && meta.activeAgentIds.includes("chat-summary"))) {
            if (await generationActive(chatId)) throw new Error("Engine RP 생성이 진행 중입니다. 종료 후 다시 활성화해 주세요.");
            await setEngineAuto(chatId, false);
          }
          state(chatId, "waiting", "자동 요약 대기 중");
          return;
        }
        if (!settings?.connectionId) throw new Error("자동 요약에 사용할 모델 연결을 먼저 선택해 주세요.");
        const chat = await reader.readChat(chatId);
        if (chat?.mode !== "roleplay") throw new Error("RP 채팅에서만 자동 요약을 사용할 수 있습니다.");
        if (await generationActive(chatId)) throw new Error("Engine RP 생성이 진행 중입니다. 종료 후 다시 활성화해 주세요.");
        const snapshot = await reader.readSnapshot(chatId);
        if ((snapshot.boundary.activeEntries > 0 || snapshot.summary.legacy) && !snapshot.boundary.certain) throw new Error("기존 요약의 출처 범위를 확인할 수 없어 자동 요약을 켤 수 없습니다.");
        const originalRaw = metadata(chat).automaticSummaryEnabled;
        const original = typeof originalRaw === "boolean" ? originalRaw : null;
        const originalLegacy = Array.isArray(metadata(chat).activeAgentIds) && metadata(chat).activeAgentIds.includes("chat-summary");
        if (!await saveSettings((current) => ({ ...current, managedChats: { ...current.managedChats, [chatId]: { original, ...(originalLegacy ? { originalLegacy: true } : {}) } } }))) throw new Error("애드온 설정을 저장하지 못해 Engine 설정을 변경하지 않았습니다.");
        try {
          if (originalRaw !== false || originalLegacy) await setEngineAuto(chatId, false);
          const confirmed = await reader.readChat(chatId);
          if (metadata(confirmed).automaticSummaryEnabled !== false) throw new Error("Engine 기본 자동 요약이 꺼지지 않아 애드온 자동 실행을 시작하지 않았습니다.");
        } catch (error) {
          state(chatId, "paused", "Engine 기본 자동 요약 중단을 확인하지 못했습니다.", error.message);
          throw error;
        }
        state(chatId, "waiting", "자동 요약 대기 중");
      } finally { policyBusy.delete(chatId); }
    }
    async function adoptBranch(chatId) {
      if (stopping || policyBusy.has(chatId) || managed(chatId)) return;
      policyBusy.add(chatId);
      try {
        const chat = await reader.readChat(chatId);
        const meta = metadata(chat);
        const parent = meta.branchParentChatId;
        if (chat?.mode !== "roleplay" || !parent || !getSettings()?.managedChats?.[parent] || meta.automaticSummaryEnabled !== false) return;
        if (!await saveSettings((current) => {
          const inherited = current.managedChats?.[parent];
          return inherited ? { ...current, managedChats: { ...current.managedChats, [chatId]: { original: inherited.original, ...(inherited.originalLegacy ? { originalLegacy: true } : {}) } } } : current;
        })) throw new Error("분기 자동 요약 적용 상태를 저장하지 못했습니다.");
        if (managed(chatId)) state(chatId, "waiting", "분기 채팅 자동 요약 대기 중");
      } finally { policyBusy.delete(chatId); }
    }
    async function disableInternal(chatId) {
      if (policyBusy.has(chatId)) throw new Error("채팅 설정 전환이 진행 중입니다.");
      policyBusy.add(chatId);
      try {
        const settings = getSettings();
        const record = settings?.managedChats?.[chatId];
        if (!record) return;
        const job = jobs.get(chatId);
        if (job) { job.controller.abort(); await job.promise.catch(() => {}); }
        const chat = await reader.readChat(chatId);
        // If the user has already turned Engine auto summary on, keep that choice.
        if (metadata(chat).automaticSummaryEnabled === false && (record.original !== false || record.originalLegacy === true)) await setEngineAuto(chatId, record.original, record.originalLegacy === true);
        if (!await saveSettings((current) => {
          const managedChats = { ...current.managedChats };
          delete managedChats[chatId];
          return { ...current, managedChats };
        })) throw new Error("복원 후 애드온 적용 상태를 저장하지 못했습니다.");
        pending.delete(chatId);
        state(chatId, "off", "애드온 자동 요약 꺼짐");
      } finally { policyBusy.delete(chatId); }
    }
    async function drain(chatId) {
      if (stopping || jobs.has(chatId) || isManualBusy(chatId) || policyBusy.has(chatId) || !managed(chatId)) return;
      const current = queue(chatId);
      if (!current.length) return;
      const controller = new AbortController();
      const fenceId = current[0]?.throughMessageId;
      const promise = (async () => {
        while (current.length && !stopping && managed(chatId) && !policyBusy.has(chatId) && !controller.signal.aborted) {
          const fence = current.shift();
          if (jobs.has(chatId)) jobs.get(chatId).fenceId = fence.throughMessageId;
          try {
            const snapshot = await reader.readSnapshot(chatId, controller.signal);
            if (snapshot.summary.automaticSummaryEnabled) { state(chatId, "paused", "Engine 기본 자동 요약이 켜져 있어 애드온 실행을 중지했습니다."); return; }
            core.validateSendFence(snapshot, fence);
            const due = core.autoDue(snapshot, fence, getSettings().intervalTurns);
            if (!due.due) { state(chatId, "waiting", `자동 요약 대기 중 · 신규 assistant ${due.turnsSinceBoundary}/${getSettings().intervalTurns}턴`); continue; }
            if (!getSettings().connectionId) { state(chatId, "failed", "요약 모델을 선택해 주세요."); return; }
            state(chatId, "running", `${due.turnsSinceBoundary}턴 자동 요약 중`);
            const entryId = newId();
            if (typeof entryId !== "string" || !entryId) throw new Error("안전한 요약 항목 ID를 만들 수 없습니다.");
            const result = await manualService.run(chatId, getSettings().connectionId, entryId, controller.signal,
              (phase) => state(chatId, "running", phase), { sourceFence: fence, minimumTurns: getSettings().intervalTurns, quality: getSettings() });
            const warnings = result.correction?.warnings ?? [];
            const correctionText = warnings.length ? " · 표현 보정 경고" : result.correction?.changed ? " · 표현 보정 적용" : "";
            state(chatId, "waiting", (result.kind === "saved" ? result.verification === "pending" ? `${result.messageCount}개 메시지 저장됨 · 저장 후 확인 필요` : `${result.messageCount}개 메시지 자동 요약 완료 · 다음 입력 대기` : "요약할 대상 없음 · 다음 입력 대기") + correctionText, warnings.length ? `표현 보정: ${warnings.join("\n")}` : "");
          } catch (error) {
            if (!controller.signal.aborted) state(chatId, "failed", "자동 요약 실패 · 다음 사용자 입력에서 재시도", error.message);
            // Consume only this send event. The next send retries from unchanged provenance.
          }
        }
      })();
      jobs.set(chatId, { controller, promise, fenceId });
      try { await promise; }
      finally {
        if (jobs.get(chatId)?.promise === promise) jobs.delete(chatId);
        onIdle(chatId);
        if (current.length && !stopping && managed(chatId)) void drain(chatId);
      }
    }
    async function submit(chatId, fence) {
      if (stopping || policyBusy.has(chatId) || !managed(chatId)) return;
      if (!fence?.throughMessageId) {
        state(chatId, "failed", "전송 전 대화 경계를 확인하지 못했습니다. 다음 입력에서 재시도합니다.");
        return;
      }
      const current = queue(chatId);
      if (current.some((item) => item.throughMessageId === fence.throughMessageId) || jobs.get(chatId)?.fenceId === fence.throughMessageId) return;
      // Copy immediately: neither subsequent cache edits nor chat switching can move the fence.
      current.push(JSON.parse(JSON.stringify(fence)));
      await drain(chatId);
    }
    function kick(chatId) { if (managed(chatId)) void drain(chatId); }
    async function shutdown() {
      stopping = true;
      await Promise.allSettled([...policyPromises]);
      for (const job of jobs.values()) job.controller.abort();
      await Promise.allSettled([...jobs.values()].map((job) => job.promise));
      const ids = Object.keys(getSettings()?.managedChats ?? {});
      const results = await Promise.allSettled(ids.map((chatId) => disableInternal(chatId)));
      const failures = results.filter((result) => result.status === "rejected");
      if (failures.length) throw new Error(`${failures.length}개 채팅의 Engine 자동 요약 설정을 복원하지 못했습니다.`);
    }
    function track(promise) {
      policyPromises.add(promise);
      void promise.then(() => policyPromises.delete(promise), () => policyPromises.delete(promise));
      return promise;
    }
    return Object.freeze({ enable: (chatId) => track(enableInternal(chatId)), adoptBranch: (chatId) => track(adoptBranch(chatId)), disable: (chatId) => track(disableInternal(chatId)), submit, kick, shutdown, isRunning: (chatId) => jobs.has(chatId), isManaged: managed });
  }
  // DOM integration is an extension-only adapter, not an Engine send Hook.
  function installSendObserver({ target, getHost, isManaged, onSend, onError }) {
    function capture(event) {
      try {
        const host = getHost();
        const chatId = host?.version === 1 ? host.stores?.chat?.getState?.().activeChatId : null;
        if (!chatId || !isManaged(chatId)) return;
        const node = event.target;
        const container = node?.closest?.(".chat-input-container");
        if (!container) return;
        const composer = container.querySelector('textarea[data-chat-composer="true"]');
        const button = container.querySelector("button.mari-chat-send-btn");
        if (!composer || composer.disabled || composer.getAttribute("data-chat-id") !== chatId) return;
        let isPostOnly = false;
        if (event.type === "click") {
          const postOnly = node.closest?.("button.mari-chat-quick-reply");
          if (postOnly?.title?.startsWith("Post only:")) {
            if (postOnly.disabled) return;
            isPostOnly = true;
          } else if (!button || button.disabled || !button.querySelector("svg.lucide-send") || node.closest?.("button.mari-chat-send-btn") !== button) return;
        } else if (event.type === "keydown") {
          if (!button || button.disabled || !button.querySelector("svg.lucide-send") || node !== composer || event.key !== "Enter" || event.shiftKey || event.repeat || event.isComposing || event.keyCode === 229 || host.stores?.ui?.getState?.().enterToSendRP !== true || container.querySelector('[data-chat-input-popup="commands"]')) return;
        } else return;
        // Empty sends are continue/retry; slash commands have their own behavior.
        const text = composer.value?.trim();
        if ((!text && !isPostOnly) || text?.startsWith("/") || /^\{\{\s*(?:prompt|prompt_preview|preview_prompt)\s*\}\}$/i.test(text ?? "")) return;
        const key = ["chats", "messages", chatId];
        const query = host.queryClient?.getQueryState?.(key);
        if (!query || query.isInvalidated || query.fetchStatus !== "idle") {
          onError(chatId, "전송 전 메시지 캐시가 최신 상태인지 확인할 수 없어 이번 자동 요약을 건너뛰었습니다.");
          return;
        }
        const cached = host.queryClient.getQueryData(key);
        const page = cached?.pages?.[0];
        const last = Array.isArray(page) ? page.at(-1) : null;
        if (!last?.id || last.chatId !== chatId || String(last.id).startsWith("temp-")) {
          onError(chatId, "전송 전 메시지 캐시를 확인하지 못해 자동 요약을 건너뛰었습니다.");
          return;
        }
        const fence = JSON.parse(JSON.stringify({ throughMessageId: last.id, messages: [last] }));
        // Never prevent, delay, or await Engine's input handling.
        Promise.resolve(onSend(chatId, fence)).catch((error) => onError(chatId, error.message));
      } catch (error) { onError(null, error.message); }
    }
    target.addEventListener("click", capture, true);
    target.addEventListener("keydown", capture, true);
    return () => { target.removeEventListener("click", capture, true); target.removeEventListener("keydown", capture, true); };
  }
  return Object.freeze({ createAutoController, installSendObserver });
})();
