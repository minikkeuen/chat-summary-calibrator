/* Full Page External Extension entry. Manual writes use Engine's summary-entries API. */
(() => {
  "use strict";
  const core = __MCS_PHASE1_CORE__;
  const ROOT_ID = "marinara-chat-summary-calibrator";
  if (document.getElementById(ROOT_ID)) {
    marinara.log.warn("Chat Summary Calibrator is already mounted");
    return;
  }
  const reader = core.makeReader(marinara.fetch);
  const rules = __MCS_RULES__;
  const expressionProcessor = rules.createProcessor();
  const manualService = core.makeManualService(marinara.fetch, reader, expressionProcessor.process);
  const bulk = __MCS_BULK__;
  const bulkService = bulk.createService({ core, reader, fetcher: marinara.fetch, processor: expressionProcessor, estimateTextTokens: (text) => marinara.estimateTextTokens(text) });
  const root = document.createElement("div");
  root.id = ROOT_ID;
  root.innerHTML = `
    <button id="marinara-chat-summary-calibrator-launcher" class="msc-launcher mari-topbar-action" type="button" title="요약 관리" aria-label="요약 관리" aria-expanded="false" aria-controls="msc-panel"><svg class="mari-topbar-accent-icon mari-accent-animated" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 12h-5"/><path d="M15 8h-5"/><path d="M19 17V5a2 2 0 0 0-2-2H4"/><path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3"/></svg></button>
    <section class="msc-panel" id="msc-panel" aria-label="마리나라 기억 보정" hidden>
      <header class="msc-header"><strong>마리나라 기억 보정</strong><button class="msc-close" type="button" aria-label="닫기">×</button></header>
      <div class="msc-body">
      <p class="msc-note">요약 결과는 Chat Summary에 저장합니다.</p>
      <label class="msc-row"><span>현재 채팅 자동 요약</span><input class="msc-auto" type="checkbox" disabled></label>
      <small>활성화 시 이 채팅의 Engine 기본 자동 요약을 끄고, 해제 시 이전 값을 복원합니다.</small>
      <label class="msc-field">요약 모델 <select class="msc-model" disabled><option value="">모델 연결 불러오는 중</option></select></label>
      <label class="msc-field">요약 주기 (assistant 턴) <input class="msc-interval" type="number" min="1" max="200" step="1" value="5" disabled></label>
      <div class="msc-actions"><button class="msc-manual" type="button" disabled>요약 생성</button><button class="msc-refresh" type="button">새로고침</button></div>
      <div class="msc-status" role="status" aria-live="polite">채팅 상태 확인 중</div>
      <section class="msc-box msc-memory-box"><div class="msc-box-header msc-toggle-memory" role="button" tabindex="0" aria-expanded="false" aria-controls="msc-memory-content"><strong>기억 설정</strong></div>
        <div class="msc-memory" id="msc-memory-content" hidden>
          <h3>Memory Recall</h3>
          <label class="msc-row"><span>기억 검색 사용</span><input data-memory="enableMemoryRecall" type="checkbox" disabled></label>
          <small>과거 메시지에서 관련 기억을 검색합니다.</small>
          <h3>Chat Summary</h3>
          <label class="msc-row"><span>요약된 메시지 숨기기</span><input data-memory="hideSummarisedMessages" type="checkbox" disabled></label>
          <label class="msc-field">최신 원본 메시지 유지 <input data-memory="summaryTailMessages" type="number" min="0" step="1" disabled></label>
          <small>변경된 유지 개수는 이후 메시지 숨김 처리에 적용됩니다. 이미 숨겨진 메시지는 즉시 변경되지 않을 수 있습니다.</small>
          <label class="msc-row msc-memory-semantic"><span>관련 요약 선택 주입 (Semantic Retrieval)</span><input data-memory="semanticSummaryRetrievalEnabled" type="checkbox" disabled></label>
          <div class="msc-memory-options" hidden>
            <label class="msc-field">최신 요약 유지 <input data-memory="semanticSummaryRecentCount" type="number" min="0" max="20" step="1" disabled></label>
            <label class="msc-field">관련 과거 요약 <input data-memory="semanticSummaryOlderCount" type="number" min="0" max="20" step="1" disabled></label>
            <label class="msc-field">최소 유사도 <input data-memory="semanticSummaryMinSimilarity" type="number" min="0" max="1" step="0.01" disabled></label>
          </div>
          <div class="msc-preset">
            <label class="msc-row"><span>새 채팅방에 자동 적용</span><input class="msc-preset-auto" type="checkbox" disabled></label>
            <div class="msc-actions"><button class="msc-preset-apply" type="button" disabled>프리셋 적용</button><button class="msc-preset-save" type="button" disabled>프리셋 설정 저장</button></div>
            <small class="msc-preset-status" role="status" aria-live="polite"></small>
          </div>
          <small class="msc-memory-status" role="status" aria-live="polite"></small>
        </div>
      </section>
      <section class="msc-box msc-advanced-box"><div class="msc-box-header msc-toggle-advanced" role="button" tabindex="0" aria-expanded="false" aria-controls="msc-advanced-content"><strong>요약 고급 설정</strong></div>
        <div class="msc-advanced" id="msc-advanced-content" hidden>
        <label class="msc-field">이전 요약 참고 개수 <input class="msc-references" type="number" min="0" max="20" step="1" value="3" disabled></label>
        <label class="msc-row msc-advanced-row"><span>오버랩 사용</span><input class="msc-overlap" type="checkbox" disabled></label>
        <label class="msc-field">오버랩 턴수 <input class="msc-overlap-turns" type="number" min="0" max="50" step="1" value="2" disabled></label>
        <label class="msc-row msc-advanced-row"><span>중복 억제</span><input class="msc-dedup" type="checkbox" checked disabled></label>
        <label class="msc-field">요약 프롬프트 <textarea class="msc-prompt" rows="6" maxlength="12000" disabled></textarea></label>
        <button class="msc-reset-prompt" type="button" disabled>기본 프롬프트 복원</button>
        <small>기존 요약·오버랩·신규 대화의 구분과 저장 출처는 프롬프트와 별도로 고정됩니다.</small>
        </div>
      </section>
      <section class="msc-box msc-bulk-box"><div class="msc-box-header msc-toggle-bulk" role="button" tabindex="0" aria-expanded="false" aria-controls="msc-bulk-content"><strong>요약 표현 보정</strong></div>
        <div class="msc-bulk" id="msc-bulk-content" hidden>
        <section class="msc-correction">
          <h3>표현 보정 설정</h3>
          <label class="msc-row"><span>신규 요약 저장 전 보정</span><input class="msc-correction-enabled" type="checkbox" disabled></label>
          <button class="msc-rule-open" type="button" disabled>규칙 파일 불러오기</button><input class="msc-rule-upload" type="file" accept=".csv,.json" hidden disabled>
          <div class="msc-rule-options" hidden>
            <label class="msc-field">규칙 유형 <select class="msc-rule-type" disabled><option value="">유형 선택</option><option value="replace">일반 치환</option><option value="regex">정규식</option></select></label>
            <label class="msc-field">언어 <select class="msc-rule-language" disabled><option value="">언어 선택</option><option value="ko">한국어</option><option value="en">영어</option><option value="ja">일본어</option><option value="zh">중국어</option><option value="all">모든 언어</option></select></label>
          </div>
          <small>replace_ko.csv · regex_all.json처럼 이름을 지정하면 자동 분류합니다. 요약 언어에 따라 순서대로 한 번씩 적용합니다. 혼합·불확실 언어에는 모든 언어 규칙을 적용합니다.</small>
          <div class="msc-rule-notice" role="status" aria-live="polite"></div>
          <div class="msc-rule-list"></div>
        </section>
        <section class="msc-bulk-section">
          <h3>기존 요약 일괄 보정</h3>
          <small>현재 등록된 활성 규칙을 사용합니다. 신규 요약 저장 전 보정의 ON/OFF와 관계없이 명시적으로 실행하며, 미리보기 확인 후 승인한 결과만 저장합니다.</small>
          <button class="msc-bulk-load" type="button" disabled>기존 요약 불러오기</button>
          <label class="msc-row msc-bulk-select"><span>전체 선택</span><input class="msc-bulk-all" type="checkbox" disabled></label>
          <small class="msc-bulk-selected">선택한 요약 0개</small>
          <div class="msc-bulk-list"></div>
          <div class="msc-actions"><button class="msc-bulk-preview" type="button" disabled>선택 요약 미리보기</button><button class="msc-bulk-apply" type="button" disabled>변경 승인·적용</button></div>
          <div class="msc-bulk-result" role="status" aria-live="polite"></div>
          <div class="msc-bulk-comparisons"></div>
        </section>
        <details class="msc-rule-test">
          <summary>미리보기</summary>
          <label class="msc-field">미리보기 원문 <textarea class="msc-rule-source" rows="4" maxlength="20000" placeholder="요약문을 붙여 넣으세요. 미리보기는 저장하지 않습니다." disabled></textarea></label>
          <button class="msc-rule-preview" type="button" disabled>보정 미리보기</button>
          <label class="msc-field">보정 결과 <textarea class="msc-rule-result" rows="4" readonly></textarea></label>
          <small class="msc-rule-preview-status" role="status" aria-live="polite"></small>
        </details>
        </div>
      </section>
      <section class="msc-box msc-work-box"><div class="msc-box-header msc-toggle-work" role="button" tabindex="0" aria-expanded="false" aria-controls="msc-work-content"><strong>작업 정보</strong></div>
        <div class="msc-work" id="msc-work-content" hidden>
        <div class="msc-error"></div>
        <div class="msc-details"></div>
        </div>
      </section>
      </div>
    </section>`;
  document.body.appendChild(root);
  const element = (selector) => root.querySelector(selector);
  const launcher = element(".msc-launcher");
  const panel = element(".msc-panel");
  const status = element(".msc-status");
  const details = element(".msc-details");
  const auto = element(".msc-auto");
  const model = element(".msc-model");
  const interval = element(".msc-interval");
  const refresh = element(".msc-refresh");
  const manual = element(".msc-manual");
  const errorDetails = element(".msc-error");
  const references = element(".msc-references");
  const overlap = element(".msc-overlap");
  const overlapTurns = element(".msc-overlap-turns");
  const dedup = element(".msc-dedup");
  const prompt = element(".msc-prompt");
  const resetPrompt = element(".msc-reset-prompt");
  const correctionEnabled = element(".msc-correction-enabled");
  const ruleOpen = element(".msc-rule-open");
  const ruleUpload = element(".msc-rule-upload");
  const ruleOptions = element(".msc-rule-options");
  const ruleType = element(".msc-rule-type");
  const ruleLanguage = element(".msc-rule-language");
  const ruleNotice = element(".msc-rule-notice");
  const ruleList = element(".msc-rule-list");
  const ruleSource = element(".msc-rule-source");
  const rulePreview = element(".msc-rule-preview");
  const ruleResult = element(".msc-rule-result");
  const rulePreviewStatus = element(".msc-rule-preview-status");
  let pendingRuleFile = null;
  let importingRules = false;
  let previewController = null;
  const presetAuto = element(".msc-preset-auto");
  const presetApply = element(".msc-preset-apply");
  const presetSave = element(".msc-preset-save");
  const presetStatus = element(".msc-preset-status");
  const memoryContent = element(".msc-memory");
  const memoryToggle = element(".msc-toggle-memory");
  const memoryOptions = element(".msc-memory-options");
  const memoryStatus = element(".msc-memory-status");
  const memoryInputs = [...root.querySelectorAll("[data-memory]")];
  const memoryService = __MCS_MEMORY_SETTINGS__.create({
    fetcher: marinara.fetch, reader, core,
    onChange: ({ status: phase, message, values }) => {
      for (const input of memoryInputs) {
        input.disabled = phase !== "ready" || !values || (input.dataset.memory === "enableMemoryRecall" && values.recallUnavailable);
        if (!values) { if (input.type === "checkbox") input.checked = false; else input.value = ""; continue; }
        const value = values[input.dataset.memory];
        if (input.type === "checkbox") input.checked = value; else input.value = String(value);
      }
      memoryOptions.hidden = !values?.semanticSummaryRetrievalEnabled;
      memoryStatus.textContent = message ? userError(message) : values?.recallUnavailable ? "현재 채팅에서는 기억 검색을 변경할 수 없습니다." : "";
    },
  });
  const advancedContent = element(".msc-advanced");
  const workContent = element(".msc-work");
  const advancedToggle = element(".msc-toggle-advanced");
  const workToggle = element(".msc-toggle-work");
  const bulkContent = element(".msc-bulk");
  const bulkToggle = element(".msc-toggle-bulk");
  const bulkLoad = element(".msc-bulk-load");
  const bulkAll = element(".msc-bulk-all");
  const bulkSelectedLabel = element(".msc-bulk-selected");
  const bulkList = element(".msc-bulk-list");
  const bulkPreview = element(".msc-bulk-preview");
  const bulkApply = element(".msc-bulk-apply");
  const bulkResult = element(".msc-bulk-result");
  const bulkComparisons = element(".msc-bulk-comparisons");
  let bulkSnapshot = null, bulkPreviewData = null, bulkController = null;
  const bulkSelection = new Set();
  const dragHeader = element(".msc-header");
  let drag = null;
  let topbarHolder = null;
  let disposed = false;
  let activeChatId = null;
  let requestVersion = 0;
  let controller = null;
  let settings = null;
  let persistedSettings = null;
  const presetJobs = new Map();
  const memoryKeys = ["enableMemoryRecall", "hideSummarisedMessages", "summaryTailMessages", "semanticSummaryRetrievalEnabled", "semanticSummaryRecentCount", "semanticSummaryOlderCount", "semanticSummaryMinSimilarity"];
  let connections = [];
  let saveQueue = Promise.resolve();
  const pendingSettings = [];
  const checkedBranches = new Set();
  let initialScreenRead = false;
  const manualRuns = new Map();
  let manualNotice = null;
  const autoNotices = new Map();
  let autoController = null;
  const listeners = [];
  function listen(target, type, callback) {
    target.addEventListener(type, callback);
    listeners.push(() => target.removeEventListener(type, callback));
  }
  function setStatus(value) { if (!disposed) status.textContent = value; }
  function userError(value) {
    return String(value).replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "내부 식별 정보").replace(/\/api\/[^\s)]+/g, "요청 경로");
  }
  function ensureTopbarButton() {
    if (disposed) return;
    const nav = document.querySelector?.('[data-component="TopBar"] [data-tour="panel-buttons"]');
    if (!nav) { topbarHolder?.remove(); topbarHolder = null; return; }
    if (topbarHolder?.parentElement === nav) return;
    topbarHolder?.remove();
    topbarHolder = document.createElement("div");
    topbarHolder.id = "marinara-chat-summary-calibrator-topbar";
    topbarHolder.style.cssText = "display:flex;flex:0 0 auto;align-items:center";
    topbarHolder.appendChild(launcher);
    nav.prepend(topbarHolder);
  }
  function toggleBox(content, button) {
    content.hidden = !content.hidden;
    button.setAttribute("aria-expanded", String(!content.hidden));
    if (panel.style.left) { const rect = panel.getBoundingClientRect(); positionPanel(rect.left, rect.top); }
  }
  function positionPanel(left, top) {
    const rect = panel.getBoundingClientRect();
    panel.style.left = `${Math.max(8, Math.min(left, window.innerWidth - rect.width - 8))}px`;
    panel.style.top = `${Math.max(8, Math.min(top, window.innerHeight - rect.height - 8))}px`;
    panel.style.right = "auto";
  }
  function bindBox(box, header, content) {
    listen(box, "click", (event) => {
      if (content.hidden || header.contains(event.target)) toggleBox(content, header);
    });
    listen(header, "keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggleBox(content, header); }
    });
  }
  function updateManualButton() { manual.disabled = !settings?.connectionId || !activeChatId || manualRuns.has(activeChatId) || presetJobs.has(activeChatId) || autoController?.isRunning(activeChatId) || bulkService.isSaving(activeChatId) || disposed; }
  function chatIdNow() {
    try {
      const host = globalThis.__MARINARA_HOST__;
      const chatStore = host?.version === 1 && host.stores?.chat;
      if (chatStore && typeof chatStore.getState === "function") {
        const value = chatStore.getState().activeChatId;
        return typeof value === "string" && value.length <= 512 && value ? value : null;
      }
    } catch (error) { marinara.log.debug("Host chat state unavailable", error); }
    try {
      const value = localStorage.getItem("marinara-active-chat-id");
      return typeof value === "string" && value.length <= 512 && value ? value : null;
    } catch { return null; }
  }
  function abortCurrent() { if (controller) controller.abort(); controller = null; }
  function showSnapshot(snapshot) {
    const boundary = snapshot.boundary;
    const baseStatus = `${snapshot.displayName ?? "제목 없는 채팅"} ( 메시지 ${snapshot.messageCount}개 · ${snapshot.assistantTurns}턴 · 요약 ${snapshot.summary.entries.length}개 )`;
    const automatic = autoNotices.get(snapshot.chatId);
    const notice = manualNotice?.chatId === snapshot.chatId ? manualNotice.text : automatic?.text;
    setStatus(notice ? `${notice}\n${baseStatus}` : baseStatus);
    const statusText = boundary.certain ? "출처 ID 경계 확인 · 과거 본문·Swipe 변경은 판정 불가" : "출처 ID 경계 확정 불가";
    details.textContent = `Engine 자동 요약: ${snapshot.summary.automaticSummaryEnabled ? "켜짐" : "꺼짐"}\n` +
      `활성 요약 항목: ${boundary.activeEntries}개 · 요약 출처 메시지: ${boundary.coveredCount}개\n` +
      `${statusText}: ${boundary.lastCovered ? `${boundary.lastCovered.position}번째 메시지` : "출처 없음"}\n` +
      `출처 이후 assistant 후보: ${boundary.assistantAfterCandidate}턴 · 찾을 수 없는 출처: ${boundary.missingSourceCount}개 · 출처 없는 항목: ${boundary.unknownEntries}개 · 중간 공백: ${boundary.gapCount}개`;
    const problem = manualNotice?.chatId === snapshot.chatId && manualNotice.error ? manualNotice.error : automatic?.error;
    errorDetails.textContent = problem ? `오류 상세: ${userError(problem)}` : "";
  }
  async function loadSnapshot() {
    const chatId = activeChatId;
    requestVersion += 1;
    const version = requestVersion;
    abortCurrent();
    details.textContent = "";
    errorDetails.textContent = "";
    if (!chatId) { setStatus("활성 채팅이 없습니다."); return; }
    controller = new AbortController();
    const signal = controller.signal;
    setStatus("현재 채팅 조회 중…");
    try {
      const snapshot = await reader.readSnapshot(chatId, signal);
      if (!disposed && !signal.aborted && version === requestVersion && activeChatId === chatId) showSnapshot(snapshot);
    } catch (error) {
      if (!disposed && !signal.aborted && version === requestVersion) setStatus(`조회 실패: ${userError(error.message)}`);
    } finally { if (version === requestVersion) controller = null; }
  }
  function checkChat() {
    if (disposed) return false;
    const next = chatIdNow();
    if (next === activeChatId) return false;
    activeChatId = next;
    if (persistedSettings) renderPreset();
    void memoryService.load(next);
    bulkController?.abort();
    bulkSnapshot = null; bulkSelection.clear();
    invalidateBulkPreview(""); renderBulkList();
    auto.checked = !!(next && settings?.managedChats?.[next]);
    updateManualButton();
    requestVersion += 1;
    abortCurrent();
    details.textContent = "";
    errorDetails.textContent = "";
    setStatus(next ? panel.hidden ? "창을 열면 현재 채팅 상태를 조회합니다." : "채팅이 변경되었습니다. 새로고침으로 정보를 확인해 주세요." : "활성 채팅이 없습니다.");
    if (next && settings) { checkBranch(next); void maybeAutoPreset(next); }
    return true;
  }
  function checkBranch(chatId) {
    if (checkedBranches.has(chatId) || autoController.isManaged(chatId) || !Object.keys(settings?.managedChats ?? {}).length) return;
    checkedBranches.add(chatId);
    void autoController.adoptBranch(chatId).then(() => checkedBranches.delete(chatId)).catch((error) => {
      checkedBranches.delete(chatId);
      marinara.log.warn("Branch automatic summary adoption failed", error);
      if (!disposed && activeChatId === chatId) { setStatus("분기 자동 요약 적용 실패 · 작업 정보에서 오류를 확인해 주세요."); errorDetails.textContent = `오류 상세: ${userError(error.message)}`; }
    });
  }
  function fillModels() {
    model.replaceChildren();
    const option = (value, label) => { const node = document.createElement("option"); node.value = value; node.textContent = label; model.appendChild(node); };
    option("", "모델 미선택");
    for (const row of connections) option(row.id, `${row.name} · ${row.model}`);
    if (settings?.connectionId && !connections.some((row) => row.id === settings.connectionId)) option(settings.connectionId, "저장된 연결 (현재 목록에 없음)");
    model.value = settings?.connectionId ?? "";
  }
  function renderQualitySettings() {
    if (!settings) return;
    references.value = String(settings.referenceCount);
    overlap.checked = settings.overlapEnabled;
    overlapTurns.value = String(settings.overlapTurns);
    overlapTurns.disabled = !settings.overlapEnabled;
    dedup.checked = settings.dedupEnabled;
    prompt.value = settings.summaryPrompt;
    correctionEnabled.checked = settings.correctionEnabled;
    renderRuleFiles();
    renderRuleUpload();
  }
  const ruleLanguages = { ko: "한국어", en: "영어", ja: "일본어", zh: "중국어", all: "모든 언어" };
  function renderRuleFiles() {
    ruleList.replaceChildren();
    if (!settings.ruleFiles.length) { ruleList.textContent = "등록된 규칙 파일이 없습니다."; return; }
    settings.ruleFiles.forEach((file, index) => {
      const row = document.createElement("div");
      row.className = "msc-rule-item";
      const label = document.createElement("label");
      const enabled = document.createElement("input");
      enabled.type = "checkbox";
      enabled.checked = file?.enabled !== false;
      enabled.setAttribute("data-rule-toggle", String(index));
      const caption = document.createElement("span");
      caption.textContent = `${index + 1}. ${file?.name ?? "읽을 수 없는 규칙 파일"}\n${ruleLanguages[file?.language] ?? "언어 미확인"} · ${file?.type === "regex" ? "정규식" : "일반 치환"} · ${file?.rules?.length ?? 0}개`;
      label.appendChild(enabled); label.appendChild(caption); row.appendChild(label);
      const remove = document.createElement("button");
      remove.type = "button"; remove.textContent = "삭제";
      remove.setAttribute("data-rule-delete", String(index));
      row.appendChild(remove);
      ruleList.appendChild(row);
    });
  }
  function renderRuleUpload() {
    const inferred = pendingRuleFile && rules.inferFile(pendingRuleFile.name);
    ruleOptions.hidden = !pendingRuleFile || !!inferred;
    ruleOpen.disabled = !settings || importingRules;
    ruleUpload.disabled = !settings || importingRules;
    ruleType.disabled = !pendingRuleFile || !!inferred || importingRules;
    ruleLanguage.disabled = ruleType.disabled;
  }
  async function importRules() {
    if (!settings || !pendingRuleFile || !ruleType.value || !ruleLanguage.value || importingRules) return;
    const file = pendingRuleFile;
    const info = { name: file.name, type: ruleType.value, language: ruleLanguage.value, id: globalThis.crypto?.randomUUID?.() };
    importingRules = true; renderRuleUpload();
    ruleNotice.textContent = "규칙 파일 읽는 중…";
    try {
      if (!info.id) throw new Error("이 브라우저에서는 규칙 파일을 추가할 수 없습니다.");
      if (file.size > 400_000) throw new Error("규칙 파일은 100,000자 이하로 나누어 주세요.");
      const parsed = rules.parseFile(await file.text(), info);
      if (disposed) return;
      const matches = settings.ruleFiles.filter((item) => item?.name === file.name);
      const existing = matches[0];
      if (existing && !window.confirm(`${file.name} 파일이 이미 있습니다.${matches.length > 1 ? ` 같은 이름 ${matches.length}개 중 첫 번째 파일을` : " 기존 파일을"} 덮어쓰시겠습니까?`)) {
        ruleNotice.textContent = "규칙 파일 덮어쓰기를 취소했습니다.";
        return;
      }
      const replaceOrAppend = (files) => {
        const index = files.findIndex((item) => item?.name === file.name);
        if (index < 0) return [...files, parsed];
        return files.map((item, position) => position === index ? { ...parsed, id: item.id || parsed.id, enabled: item.enabled !== false } : item);
      };
      const proposed = replaceOrAppend(settings.ruleFiles);
      if (proposed.length > 50 || JSON.stringify(proposed).length > 200_000) throw new Error("규칙은 최대 50개 파일·전체 200,000자까지 저장할 수 있습니다.");
      clearRulePreview();
      const saved = await saveSettings((current) => ({ ...current, ruleFiles: replaceOrAppend(current.ruleFiles) }));
      if (disposed) return;
      if (!saved) throw new Error("규칙 파일 설정을 저장하지 못했습니다.");
      ruleNotice.textContent = `${file.name}: ${parsed.rules.length}개 규칙을 ${existing ? "덮어썼습니다" : "추가했습니다"}.`;
    } catch (error) { if (!disposed) ruleNotice.textContent = userError(error.message); }
    finally {
      pendingRuleFile = null; ruleUpload.value = ""; ruleType.value = ""; ruleLanguage.value = "";
      importingRules = false; if (!disposed) renderRuleUpload();
    }
  }
  function clearRulePreview() {
    previewController?.abort();
    ruleResult.value = "";
    rulePreviewStatus.textContent = "";
  }
  async function previewRules() {
    if (!settings || previewController) return;
    const controller = new AbortController();
    previewController = controller;
    rulePreview.disabled = true;
    const current = settings;
    rulePreviewStatus.textContent = "표현 보정 확인 중…";
    try {
      const result = await expressionProcessor.process(ruleSource.value, current, controller.signal);
      if (disposed || controller.signal.aborted) return;
      if (current.ruleFiles !== settings.ruleFiles || current.correctionEnabled !== settings.correctionEnabled) { rulePreviewStatus.textContent = "규칙이 변경되었습니다. 다시 미리보기를 실행해 주세요."; return; }
      ruleResult.value = result.text;
      rulePreviewStatus.textContent = `${ruleLanguages[result.language] === "모든 언어" ? "혼합·불확실 언어" : ruleLanguages[result.language]} · ${!current.correctionEnabled ? "표현 보정 꺼짐" : result.changed ? "보정 적용" : "변경 없음"} · ${result.replacementCount ?? 0}건 치환${result.warnings.length ? `\n보정 경고: ${result.warnings.join("\n")}` : ""}`;
    } catch (error) { if (!disposed && !controller.signal.aborted) rulePreviewStatus.textContent = userError(error.message); }
    finally { previewController = null; if (!disposed) rulePreview.disabled = false; }
  }
  function renderBulkControls() {
    const busy = !!bulkController;
    bulkLoad.disabled = !settings || !activeChatId || busy;
    bulkAll.disabled = !bulkSnapshot?.rows.length || busy;
    bulkAll.checked = !!bulkSnapshot?.rows.length && bulkSelection.size === bulkSnapshot.rows.length;
    bulkAll.indeterminate = bulkSelection.size > 0 && !bulkAll.checked;
    bulkSelectedLabel.textContent = `선택한 요약 ${bulkSelection.size}개`;
    bulkPreview.disabled = !settings || !bulkSnapshot || bulkSnapshot.chatId !== activeChatId || !bulkSelection.size || busy;
    const ready = bulkPreviewData?.items.filter((item) => item.status === "ready").length ?? 0;
    bulkApply.disabled = !ready || busy;
    bulkApply.textContent = ready ? `변경 ${ready}개 승인·적용` : "변경 승인·적용";
    for (const checkbox of bulkList.querySelectorAll?.("input") ?? []) checkbox.disabled = busy;
  }
  function invalidateBulkPreview(message) {
    bulkController?.abort();
    bulkPreviewData = null;
    bulkComparisons.replaceChildren();
    bulkResult.textContent = message;
    renderBulkControls();
  }
  function bulkTitle(row, index) {
    const names = { "Manual summary": "수동 요약", "Automated summary": "자동 요약", "Legacy summary": "Legacy 요약" };
    return `${index + 1}. ${names[row.title] ?? row.title} · ${row.legacy ? "Legacy" : row.enabled ? "활성" : "비활성"}`;
  }
  function renderBulkList() {
    bulkList.replaceChildren();
    for (const [index, row] of (bulkSnapshot?.rows ?? []).entries()) {
      const label = document.createElement("label");
      label.className = "msc-bulk-choice";
      const checkbox = document.createElement("input"); checkbox.type = "checkbox";
      checkbox.checked = bulkSelection.has(row.key); checkbox.setAttribute("data-summary-key", row.key);
      const caption = document.createElement("span");
      caption.textContent = `${bulkTitle(row, index)}\n${typeof row.original === "string" ? row.original.replace(/\s+/g, " ").slice(0, 90) : "본문 확인 불가"}`;
      label.appendChild(checkbox); label.appendChild(caption); bulkList.appendChild(label);
    }
    renderBulkControls();
  }
  function bulkStatisticsText(items, completed) {
    const stats = bulk.statistics(items);
    if (!completed) {
      const ready = items.filter((item) => item.status === "ready");
      return `미리보기 · 예상 수정 요약 ${ready.length}개 · 예상 치환 ${ready.reduce((sum, item) => sum + item.replacementCount, 0)}건\n변경 없음 ${stats.unchanged}개 · 보정 실패 ${stats.failed}개`;
    }
    return `표현 보정 완료\n처리한 요약 ${stats.processed}개 · 수정된 요약 ${stats.modified}개 · 수정된 어휘 ${stats.replacements}건\n변경 없음 ${stats.unchanged}개 · 실패 ${stats.failed}개 · 확인 필요 ${stats.uncertain}개${stats.excluded ? ` · 저장 제외 ${stats.excluded}개` : ""}`;
  }
  const bulkStatuses = { ready: "변경 예정", unchanged: "변경 없음", correction_failed: "보정 실패", saved: "성공", save_failed: "저장 실패", source_changed: "원문 변경", deleted: "항목 삭제", uncertain: "확인 필요", not_saved: "저장 제외" };
  function renderBulkResults(data, completed = false) {
    bulkResult.textContent = `${data.title}\n${bulkStatisticsText(data.items, completed)}`;
    bulkComparisons.replaceChildren();
    for (const [index, item] of data.items.entries()) {
      const card = document.createElement("details"); card.className = "msc-bulk-item";
      const summary = document.createElement("summary");
      summary.textContent = `${bulkTitle(item, index)} · ${bulkStatuses[item.status]} · ${item.replacementCount}건 치환`;
      card.appendChild(summary);
      const diff = bulk.diffText(typeof item.original === "string" ? item.original : "", typeof item.content === "string" ? item.content : "");
      for (const [label, parts, side] of [["원본 요약", diff.before, "old"], ["보정 결과", diff.after, "new"]]) {
        const heading = document.createElement("strong"); heading.textContent = label; card.appendChild(heading);
        const pre = document.createElement("pre");
        for (const part of parts) { const span = document.createElement("span"); span.textContent = part.text; if (part.changed) span.className = `msc-diff-${side}`; pre.appendChild(span); }
        card.appendChild(pre);
      }
      const messages = [...new Set([item.reason, ...item.warnings].filter(Boolean))];
      if (messages.length) { const warning = document.createElement("p"); warning.className = "msc-bulk-warning"; warning.textContent = userError(messages.join("\n")); card.appendChild(warning); }
      bulkComparisons.appendChild(card);
    }
  }
  async function loadBulkSummaries() {
    if (bulkController || !activeChatId || !settings) return;
    const chatId = activeChatId, controller = new AbortController();
    bulkSnapshot = null; bulkSelection.clear(); invalidateBulkPreview(""); renderBulkList();
    bulkController = controller; renderBulkControls();
    bulkResult.textContent = "기존 요약 조회 중…";
    try {
      const snapshot = await bulkService.load(chatId, controller.signal);
      if (disposed || controller.signal.aborted || chatId !== activeChatId) return;
      bulkSnapshot = snapshot; renderBulkList();
      bulkResult.textContent = `${snapshot.title} · 요약 ${snapshot.rows.length}개\n보정할 요약을 선택해 주세요.`;
    } catch (error) { if (!disposed && !controller.signal.aborted) bulkResult.textContent = `조회 실패: ${userError(error.message)}`; }
    finally { bulkController = null; if (!disposed) renderBulkControls(); }
  }
  async function previewBulkSummaries() {
    if (bulkController || !bulkSnapshot || !bulkSelection.size || !settings) return;
    const snapshot = bulkSnapshot, controller = new AbortController();
    bulkPreviewData = null; bulkComparisons.replaceChildren(); bulkController = controller;
    renderBulkControls(); bulkResult.textContent = "선택 요약 표현 보정 중…";
    try {
      const result = await bulkService.preview(snapshot, [...bulkSelection], settings, controller.signal);
      if (disposed || controller.signal.aborted || bulkSnapshot !== snapshot || result.ruleSignature !== bulk.ruleSignature(settings)) return;
      bulkPreviewData = result; renderBulkResults(result);
    } catch (error) { if (!disposed && !controller.signal.aborted) bulkResult.textContent = `미리보기 실패: ${userError(error.message)}`; }
    finally { bulkController = null; if (!disposed) renderBulkControls(); }
  }
  async function applyBulkSummaries() {
    if (bulkController || !bulkPreviewData || !settings) return;
    const approved = bulkPreviewData, chatId = approved.chatId;
    if (manualRuns.has(chatId) || autoController.isRunning(chatId)) { bulkResult.textContent = "요약 생성·저장이 진행 중입니다. 완료 후 적용해 주세요."; return; }
    const controller = new AbortController(); bulkController = controller; bulkPreviewData = null;
    renderBulkControls();
    try {
      const task = bulkService.apply(approved, settings, controller.signal, (items) => {
        if (!disposed && activeChatId === chatId) { const stats = bulk.statistics(items); bulkResult.textContent = `저장 중 · 성공 ${stats.modified}개 · 실패 ${stats.failed}개 · 확인 필요 ${stats.uncertain}개`; }
      });
      updateManualButton();
      const result = await task;
      if (!disposed) { bulkSnapshot = null; bulkSelection.clear(); renderBulkList(); renderBulkResults(result, true); }
    } catch (error) { if (!disposed) bulkResult.textContent = `적용 실패: ${userError(error.message)}`; }
    finally { bulkController = null; if (!disposed) { renderBulkControls(); updateManualButton(); } autoController.kick(chatId); }
  }
  async function loadConnections() {
    try {
      const rows = await reader.readConnections();
      if (disposed) return;
      connections = rows;
      fillModels();
    } catch (error) {
      if (disposed) return;
      model.replaceChildren();
      const option = document.createElement("option");
      option.value = settings?.connectionId ?? "";
      option.textContent = "모델 연결 목록을 읽을 수 없음";
      model.appendChild(option);
      model.disabled = true;
      marinara.log.warn("Model connection list unavailable", error);
    }
  }
  function saveSettings(change, allowDisposed = false) {
    if (!settings || disposed && !allowDisposed) return Promise.resolve(false);
    const apply = typeof change === "function" ? change : () => change;
    const item = { apply };
    pendingSettings.push(item);
    const previousRules = bulk.ruleSignature(settings);
    settings = apply(settings);
    if (bulk.ruleSignature(settings) !== previousRules) invalidateBulkPreview("규칙 설정이 변경되었습니다. 미리보기를 다시 생성해 주세요.");
    updateManualButton();
    const task = saveQueue.then(async () => {
      try {
        const next = apply(persistedSettings);
        await marinara.storage.patch(core.storagePatch(next));
        persistedSettings = next;
        return true;
      } catch (error) {
        if (!disposed) setStatus(`설정 저장 실패: ${userError(error.message)}`);
        return false;
      } finally {
        pendingSettings.splice(pendingSettings.indexOf(item), 1);
        const previousRules = bulk.ruleSignature(settings);
        settings = pendingSettings.reduce((current, pending) => pending.apply(current), persistedSettings);
        if (!disposed && bulk.ruleSignature(settings) !== previousRules) invalidateBulkPreview("규칙 설정이 변경되었습니다. 미리보기를 다시 생성해 주세요.");
        if (!disposed) {
          auto.checked = !!(activeChatId && settings.managedChats?.[activeChatId]);
          interval.value = String(settings.intervalTurns);
          model.value = settings.connectionId;
          renderQualitySettings(); renderPreset(); updateManualButton();
        }
      }
    });
    saveQueue = task.then(() => undefined);
    return task;
  }
  function renderPreset() {
    const state = settings?.presetState ?? {};
    const busy = !!(activeChatId && presetJobs.has(activeChatId));
    presetAuto.checked = state.auto === true;
    presetAuto.disabled = !settings || busy;
    presetApply.disabled = !settings || !activeChatId || !state.preset || busy;
    presetSave.disabled = !settings || !activeChatId || busy;
  }
  async function updatePresetState(change) {
    return saveSettings((current) => ({ ...current, presetState: change(current.presetState ?? {}) }));
  }
  async function savePreset() {
    const chatId = activeChatId;
    if (!chatId || !settings || presetJobs.has(chatId)) return;
    presetSave.disabled = true;
    try {
      const chat = await memoryService.snapshot(chatId);
      if (disposed || activeChatId !== chatId) return;
      const values = __MCS_MEMORY_SETTINGS__.values(chat, core.metadataOf);
      const memory = Object.fromEntries(memoryKeys.map((key) => [key, values[key]]));
      const preset = { memory, autoSummary: !!settings.managedChats?.[chatId] };
      if (!await updatePresetState((state) => ({ ...state, preset }))) throw new Error("프리셋을 저장하지 못했습니다.");
      if (!disposed && activeChatId === chatId) presetStatus.textContent = "프리셋을 저장했습니다.";
    } catch (error) { if (!disposed && activeChatId === chatId) presetStatus.textContent = `프리셋 저장 실패: ${userError(error.message)}`; }
    finally { if (!disposed) renderPreset(); }
  }
  function eligibleForPreset(chat, chatId, cutoff) {
    const meta = core.metadataOf(chat);
    const created = Date.parse(chat?.createdAt ?? "");
    return chat?.id === chatId && chat.mode === "roleplay" && Number.isFinite(created) && created > cutoff &&
      !meta.branchParentChatId && !meta.summary && !(Array.isArray(meta.summaryEntries) && meta.summaryEntries.length) &&
      (typeof meta.appliedChatPresetId === "string" && meta.appliedChatPresetId.length > 0 ||
        (!settings?.managedChats?.[chatId] && !memoryKeys.some((key) => Object.hasOwn(meta, key)) && !Object.hasOwn(meta, "automaticSummaryEnabled")));
  }
  async function runPreset(chatId, automatic = false) {
    const state = settings?.presetState;
    if (!chatId || !state?.preset || presetJobs.has(chatId)) return;
    const preset = JSON.parse(JSON.stringify(state.preset));
    const cutoff = state.enabledAt;
    const job = (async () => {
      try {
        if (manualRuns.has(chatId) || autoController.isRunning(chatId) || bulkService.isSaving(chatId)) throw new Error("요약 작업이 진행 중입니다.");
        const chat = await memoryService.snapshot(chatId);
        if (disposed || activeChatId !== chatId) return;
        if (automatic && (!settings?.presetState?.auto || !eligibleForPreset(chat, chatId, cutoff))) return;
        if (automatic) {
          const marked = await updatePresetState((current) => ({ ...current, history: { ...(current.history ?? {}), [chatId]: "started" } }));
          if (!marked) throw new Error("자동 적용 이력을 저장하지 못했습니다.");
          if (disposed || activeChatId !== chatId || !settings?.presetState?.auto) return;
        }
        if (!preset.memory || memoryKeys.some((key) => !__MCS_MEMORY_SETTINGS__.valid(key, preset.memory[key])) || typeof preset.autoSummary !== "boolean") throw new Error("프리셋 형식이 올바르지 않습니다.");
        const body = Object.fromEntries(memoryKeys.map((key) => [key, preset.memory[key]]));
        const skipRecall = body.enableMemoryRecall === true && core.metadataOf(chat).advancedMemory?.enabled === true;
        if (skipRecall) delete body.enableMemoryRecall;
        await memoryService.apply(chatId, body, automatic ? (fresh) => activeChatId === chatId && settings?.presetState?.auto === true && eligibleForPreset(fresh, chatId, cutoff) : null);
        if (disposed) throw new Error("확장이 종료되어 자동 요약 설정을 적용하지 못했습니다.");
        if (preset.autoSummary) await autoController.enable(chatId); else await autoController.disable(chatId);
        if (autoController.isManaged(chatId) !== preset.autoSummary) throw new Error("자동 요약 설정을 확인하지 못했습니다.");
        const verified = await reader.readChat(chatId);
        if (verified?.id !== chatId || Object.entries(body).some(([key, value]) => core.metadataOf(verified)[key] !== value)) throw new Error("저장 후 설정이 변경되었습니다. 다시 적용해 주세요.");
        if (automatic) await updatePresetState((current) => ({ ...current, history: { ...(current.history ?? {}), [chatId]: "applied" } }));
        if (!disposed && activeChatId === chatId) { auto.checked = !!settings?.managedChats?.[chatId]; presetStatus.textContent = skipRecall ? "프리셋을 적용했습니다. 현재 기억 모드에서는 기억 검색을 변경하지 않았습니다." : "프리셋을 적용했습니다. Engine 설정 화면이 열려 있으면 새로고침해 주세요."; }
      } catch (error) {
        if (automatic) await updatePresetState((current) => ({ ...current, history: { ...(current.history ?? {}), [chatId]: "failed" } }));
        if (!disposed && activeChatId === chatId) { presetStatus.textContent = `프리셋 적용 실패: ${userError(error.message)}. 일부 설정은 저장되었을 수 있습니다.`; void memoryService.load(chatId); }
      }
    })();
    presetJobs.set(chatId, job); renderPreset(); updateManualButton(); auto.disabled = true;
    try { await job; } finally { if (presetJobs.get(chatId) === job) presetJobs.delete(chatId); if (!disposed) { auto.disabled = false; renderPreset(); updateManualButton(); } }
  }
  async function maybeAutoPreset(chatId) {
    const state = settings?.presetState;
    if (!state?.auto || !state.preset || !Number.isFinite(state.enabledAt) || state.history?.[chatId]) return;
    await runPreset(chatId, true);
  }
  autoController = __MCS_AUTO__.createAutoController({
    core, fetcher: marinara.fetch, reader, manualService,
    getSettings: () => settings,
    saveSettings: (change) => saveSettings(change, true),
    isManualBusy: (chatId) => manualRuns.has(chatId) || bulkService.isSaving(chatId),
    onIdle: () => updateManualButton(),
    newId: () => globalThis.crypto?.randomUUID?.(),
    onState: (chatId, notice) => {
      if (disposed) return;
      if (manualNotice?.chatId === chatId) manualNotice = null;
      autoNotices.set(chatId, notice);
      updateManualButton();
      if (activeChatId === chatId) {
        setStatus(notice.text);
        errorDetails.textContent = notice.error ? `오류 상세: ${userError(notice.error)}` : "";
      }
    },
  });
  async function changeAuto() {
    const chatId = activeChatId;
    if (!chatId || !settings || presetJobs.has(chatId)) return;
    const enable = auto.checked;
    auto.disabled = true;
    try {
      if (enable) await autoController.enable(chatId);
      else await autoController.disable(chatId);
    } catch (error) {
      if (!disposed && activeChatId === chatId) { setStatus(`자동 요약 설정 실패 · 작업 정보에서 오류를 확인해 주세요.`); errorDetails.textContent = `오류 상세: ${userError(error.message)}`; }
    } finally {
      if (!disposed) { auto.disabled = false; auto.checked = !!(activeChatId && settings?.managedChats?.[activeChatId]); }
    }
  }
  async function runManual() {
    const chatId = activeChatId;
    if (!chatId || !settings?.connectionId || manualRuns.has(chatId) || autoController.isRunning(chatId) || bulkService.isSaving(chatId)) return;
    const controller = new AbortController();
    const connectionId = settings.connectionId;
    const entryId = globalThis.crypto?.randomUUID?.();
    if (!entryId) { setStatus("이 브라우저 환경에서는 요약 작업을 시작할 수 없습니다."); return; }
    manualRuns.set(chatId, controller);
    updateManualButton();
    manualNotice = { chatId, text: "수동 요약 준비 중", error: "" };
    errorDetails.textContent = "";
    setStatus(manualNotice.text);
    try {
      const result = await manualService.run(chatId, connectionId, entryId, controller.signal, (phase) => {
        if (disposed) return;
        manualNotice = { chatId, text: phase, error: "" };
        if (activeChatId === chatId) setStatus(phase);
      }, { quality: settings });
      if (disposed) return;
      const warnings = result.correction?.warnings ?? [];
      const correctionText = warnings.length ? " · 표현 보정 경고" : result.correction?.changed ? " · 표현 보정 적용" : "";
      manualNotice = { chatId, text: (result.kind === "empty" ? "새로 요약할 완료 대화가 없습니다." : result.verification === "pending" ? `${result.messageCount}개 메시지 저장됨 · 새로고침으로 확인해 주세요.` : `${result.messageCount}개 메시지를 기존 Chat Summary에 저장했습니다. 새로고침으로 정보를 갱신해 주세요.`) + correctionText, error: warnings.length ? `표현 보정: ${warnings.join("\n")}` : "" };
      if (activeChatId === chatId) { setStatus(manualNotice.text); errorDetails.textContent = userError(manualNotice.error); }
    } catch (error) {
      if (disposed || controller.signal.aborted) return;
      manualNotice = { chatId, text: "수동 요약 실패", error: userError(error.message) };
      if (activeChatId === chatId) { setStatus("수동 요약 실패 · 작업 정보에서 오류를 확인해 주세요."); errorDetails.textContent = `오류 상세: ${userError(error.message)}`; }
    } finally {
      manualRuns.delete(chatId);
      updateManualButton();
      autoController.kick(chatId);
    }
  }
  function updatePanel(open) {
    panel.hidden = !open;
    launcher.setAttribute("aria-expanded", String(open));
    if (open && panel.style.left) { const rect = panel.getBoundingClientRect(); positionPanel(rect.left, rect.top); }
    if (open && !initialScreenRead) { initialScreenRead = true; checkChat(); loadSnapshot(); }
  }
  listen(launcher, "click", () => updatePanel(panel.hidden));
  bindBox(element(".msc-memory-box"), memoryToggle, memoryContent);
  bindBox(element(".msc-advanced-box"), advancedToggle, advancedContent);
  bindBox(element(".msc-work-box"), workToggle, workContent);
  bindBox(element(".msc-bulk-box"), bulkToggle, bulkContent);
  listen(dragHeader, "pointerdown", (event) => {
    if (event.button !== 0 || event.target.closest?.("button")) return;
    const rect = panel.getBoundingClientRect();
    drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
    dragHeader.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  });
  listen(window, "pointermove", (event) => {
    if (drag && event.pointerId === drag.pointerId) positionPanel(drag.left + event.clientX - drag.x, drag.top + event.clientY - drag.y);
  });
  const endDrag = () => { drag = null; };
  listen(window, "pointerup", endDrag);
  listen(window, "pointercancel", endDrag);
  listen(window, "resize", () => { if (!panel.hidden && panel.style.left) { const rect = panel.getBoundingClientRect(); positionPanel(rect.left, rect.top); } });
  listen(element(".msc-close"), "click", () => updatePanel(false));
  listen(refresh, "click", () => { checkChat(); loadSnapshot(); loadConnections(); void memoryService.load(activeChatId); });
  for (const input of memoryInputs) listen(input, "change", () => {
    const value = input.type === "checkbox" ? input.checked : input.value.trim() === "" ? NaN : Number(input.value);
    void memoryService.save(input.dataset.memory, value);
  });
  listen(presetAuto, "change", () => {
    const enabled = presetAuto.checked;
    void updatePresetState((state) => ({ ...state, auto: enabled, ...(enabled ? { enabledAt: Date.now() } : {}) }));
  });
  listen(presetSave, "click", () => { void savePreset(); });
  listen(presetApply, "click", () => { void runPreset(activeChatId); });
  listen(manual, "click", () => { void runManual(); });
  listen(auto, "change", () => { void changeAuto(); });
  listen(model, "change", () => { const connectionId = model.value; void saveSettings((current) => ({ ...current, connectionId })); });
  listen(interval, "change", () => {
    const value = Number(interval.value);
    if (!Number.isInteger(value) || value < 1 || value > 200) { interval.value = String(settings.intervalTurns); return; }
    void saveSettings((current) => ({ ...current, intervalTurns: value }));
  });
  listen(references, "change", () => {
    const value = Number(references.value);
    if (!Number.isInteger(value) || value < 0 || value > 20) { renderQualitySettings(); return; }
    void saveSettings((current) => ({ ...current, referenceCount: value }));
  });
  listen(overlap, "change", () => { const overlapEnabled = overlap.checked; void saveSettings((current) => ({ ...current, overlapEnabled })); overlapTurns.disabled = !overlapEnabled; });
  listen(overlapTurns, "change", () => {
    const value = Number(overlapTurns.value);
    if (!Number.isInteger(value) || value < 0 || value > 50) { renderQualitySettings(); return; }
    void saveSettings((current) => ({ ...current, overlapTurns: value }));
  });
  listen(dedup, "change", () => { const dedupEnabled = dedup.checked; void saveSettings((current) => ({ ...current, dedupEnabled })); });
  listen(prompt, "change", () => {
    if (!prompt.value.trim() || prompt.value.length > 12000) { renderQualitySettings(); return; }
    const summaryPrompt = prompt.value;
    void saveSettings((current) => ({ ...current, summaryPrompt }));
  });
  listen(resetPrompt, "click", () => { prompt.value = core.DEFAULT_PROMPT; void saveSettings((current) => ({ ...current, summaryPrompt: core.DEFAULT_PROMPT })); });
  listen(correctionEnabled, "change", () => {
    clearRulePreview();
    const enabled = correctionEnabled.checked;
    void saveSettings((current) => ({ ...current, correctionEnabled: enabled }));
  });
  listen(ruleOpen, "click", () => ruleUpload.click());
  listen(ruleUpload, "change", () => {
    pendingRuleFile = ruleUpload.files?.[0] ?? null;
    const inferred = pendingRuleFile && rules.inferFile(pendingRuleFile.name);
    ruleType.value = inferred?.type ?? ""; ruleLanguage.value = inferred?.language ?? "";
    ruleNotice.textContent = pendingRuleFile && !inferred ? "파일 이름으로 분류할 수 없습니다. 유형과 언어를 선택해 주세요." : "";
    renderRuleUpload();
    if (inferred) void importRules();
  });
  listen(ruleType, "change", () => { void importRules(); });
  listen(ruleLanguage, "change", () => { void importRules(); });
  listen(ruleList, "change", (event) => {
    const index = event.target.getAttribute?.("data-rule-toggle");
    if (index == null || !settings) return;
    const selected = settings.ruleFiles[Number(index)];
    const enabled = event.target.checked;
    clearRulePreview();
    void saveSettings((current) => ({ ...current, ruleFiles: current.ruleFiles.map((file) => file === selected || selected?.id && file?.id === selected.id ? { ...file, enabled } : file) }));
  });
  listen(ruleList, "click", (event) => {
    const index = event.target.getAttribute?.("data-rule-delete");
    if (index == null || !settings) return;
    const selected = settings.ruleFiles[Number(index)];
    clearRulePreview();
    void saveSettings((current) => ({ ...current, ruleFiles: current.ruleFiles.filter((file) => file !== selected && !(selected?.id && file?.id === selected.id)) }));
  });
  listen(ruleSource, "input", clearRulePreview);
  listen(rulePreview, "click", () => { void previewRules(); });
  listen(bulkLoad, "click", () => { void loadBulkSummaries(); });
  listen(bulkAll, "change", () => {
    if (bulkController) return;
    bulkSelection.clear();
    if (bulkAll.checked) for (const row of bulkSnapshot?.rows ?? []) bulkSelection.add(row.key);
    invalidateBulkPreview(""); renderBulkList();
  });
  listen(bulkList, "change", (event) => {
    if (bulkController) return;
    const key = event.target.getAttribute?.("data-summary-key");
    if (key == null) return;
    if (event.target.checked) bulkSelection.add(key); else bulkSelection.delete(key);
    invalidateBulkPreview(""); renderBulkControls();
  });
  listen(bulkPreview, "click", () => { void previewBulkSummaries(); });
  listen(bulkApply, "click", () => { void applyBulkSummaries(); });
  listen(window, "storage", (event) => { if (event.key === "marinara-active-chat-id") checkChat(); });
  const removeSendObserver = __MCS_AUTO__.installSendObserver({
    target: window,
    getHost: () => globalThis.__MARINARA_HOST__,
    isManaged: (chatId) => !disposed && autoController.isManaged(chatId),
    onSend: (chatId, fence) => autoController.submit(chatId, fence),
    onError: (chatId, message) => {
      if (disposed) return;
      const text = "자동 요약 감지 실패 · 다음 입력에서 재시도";
      if (chatId) autoNotices.set(chatId, { kind: "failed", text, error: message });
      if (chatId === activeChatId) { setStatus(text); errorDetails.textContent = userError(message); }
    },
  });
  let unsubscribeHost = null;
  try {
    const host = globalThis.__MARINARA_HOST__;
    if (host?.version === 1 && typeof host.stores?.chat?.subscribe === "function") unsubscribeHost = host.stores.chat.subscribe(checkChat);
  } catch (error) { marinara.log.debug("Host subscription unavailable", error); }
  let unsubscribeProfileEvents = null;
  const seenProfileMutations = new WeakSet();
  try {
    const cache = globalThis.__MARINARA_HOST__?.queryClient?.getMutationCache?.();
    if (typeof cache?.subscribe === "function") unsubscribeProfileEvents = cache.subscribe((event) => {
      const mutation = event?.mutation;
      const variables = mutation?.state?.variables;
      const chatId = variables?.chatId;
      const data = mutation?.state?.data;
      if (event?.type !== "updated" || event.action?.type !== "success" || !mutation || seenProfileMutations.has(mutation) ||
          !chatId || chatId !== activeChatId || typeof variables?.presetId !== "string" || data?.id !== chatId ||
          core.metadataOf(data).appliedChatPresetId !== variables.presetId || !settings?.presetState?.auto || !settings.presetState.preset) return;
      seenProfileMutations.add(mutation);
      const cutoff = settings.presetState.enabledAt;
      if (!Number.isFinite(cutoff) || !eligibleForPreset(data, chatId, cutoff)) return;
      void (async () => {
        const pending = presetJobs.get(chatId);
        if (pending) await pending;
        if (!disposed && activeChatId === chatId && settings?.presetState?.auto) await runPreset(chatId, true);
      })();
    });
  } catch (error) { marinara.log.debug("Profile event subscription unavailable", error); }
  const pollId = marinara.setInterval(checkChat, 750);
  ensureTopbarButton();
  const topbarTimer = marinara.setInterval(ensureTopbarButton, 1600);
  checkChat();
  Promise.resolve().then(async () => {
    try {
      settings = core.settingsFromStorage(await marinara.storage.get());
      if (disposed) return;
      persistedSettings = settings;
      renderPreset();
      auto.checked = !!(activeChatId && settings.managedChats?.[activeChatId]);
      interval.value = String(settings.intervalTurns);
      renderQualitySettings();
      fillModels();
      auto.disabled = false;
      interval.disabled = false;
      model.disabled = false;
      references.disabled = false;
      overlap.disabled = false;
      dedup.disabled = false;
      prompt.disabled = false;
      resetPrompt.disabled = false;
      correctionEnabled.disabled = false;
      ruleSource.disabled = false;
      rulePreview.disabled = false;
      renderBulkControls();
      updateManualButton();
      if (activeChatId) { checkBranch(activeChatId); void maybeAutoPreset(activeChatId); }
      await loadConnections();
    } catch (error) {
      if (!disposed) { setStatus(`설정 조회 실패: ${userError(error.message)}`); marinara.log.error("Settings unavailable", error); }
    }
  });
  marinara.onCleanup(async () => {
    disposed = true;
    memoryService.dispose();
    requestVersion += 1;
    abortCurrent();
    previewController?.abort();
    bulkController?.abort();
    expressionProcessor.dispose();
    await Promise.allSettled([...presetJobs.values()]);
    for (const run of manualRuns.values()) run.abort();
    manualRuns.clear();
    try { await autoController.shutdown(); }
    catch (error) { marinara.log.error("Automatic summary setting restoration failed", error); }
    for (const unlisten of listeners) unlisten();
    if (typeof unsubscribeHost === "function") unsubscribeHost();
    if (typeof unsubscribeProfileEvents === "function") unsubscribeProfileEvents();
    marinara.clearInterval(pollId);
    removeSendObserver();
    marinara.clearInterval(topbarTimer);
    topbarHolder?.remove();
    root.remove();
  });
})();
