/* Local expression rules. No Engine requests or summary storage. */
const __MCS_RULES__ = (() => {
  "use strict";
  // This factory also runs in the short-lived regex worker.
  function ruleTools() {
    const languages = ["ko", "en", "ja", "zh", "all"];
    function inferFile(name) {
      const match = /^(replace|regex)_(ko|en|ja|zh|all)\.(csv|json)$/i.exec(name);
      return match ? { type: match[1].toLowerCase(), language: match[2].toLowerCase() } : null;
    }
    function regexFor(find) {
      if (!find.startsWith("/")) return new RegExp(find, "g");
      const end = find.lastIndexOf("/");
      if (end < 1) throw new Error("/표현/플래그 형식을 확인해 주세요.");
      return new RegExp(find.slice(1, end), find.slice(end + 1));
    }
    function replaceRule(text, rule, type) {
      if (type !== "regex") {
        if (rule.find === rule.replace) return { text, count: 0 };
        const parts = text.split(rule.find);
        return { text: parts.join(rule.replace), count: parts.length - 1 };
      }
      let count = 0;
      const result = text.replace(regexFor(rule.find), (...args) => {
        const named = typeof args.at(-1) === "object" ? args.pop() : undefined;
        const input = args.pop(), offset = args.pop(), match = args.shift();
        // JavaScript GetSubstitution semantics, including $10 -> $1 + "0" when only capture 1 exists.
        const replacement = rule.replace.replace(/\$([$&`']|\d{1,2}|<[^>]*>)/g, (literal, token) => {
          if (token === "$") return "$";
          if (token === "&") return match;
          if (token === "`") return input.slice(0, offset);
          if (token === "'") return input.slice(offset + match.length);
          if (token[0] === "<") return named === undefined ? literal : named[token.slice(1, -1)] ?? "";
          const number = Number(token);
          if (number > 0 && number <= args.length) return args[number - 1] ?? "";
          const first = Number(token[0]);
          return token.length === 2 && first > 0 && first <= args.length ? (args[first - 1] ?? "") + token[1] : literal;
        });
        if (replacement !== match) count += 1;
        return replacement;
      });
      return { text: result, count };
    }
    function validateFile(file) {
      if (!file || typeof file.name !== "string" || !["replace", "regex"].includes(file.type) || !languages.includes(file.language)) throw new Error("규칙 파일의 유형·언어를 확인해 주세요.");
      if (!Array.isArray(file.rules) || !file.rules.length || file.rules.length > 1000) throw new Error("파일당 규칙은 1~1,000개여야 합니다.");
      file.rules.forEach((rule, index) => {
        if (!rule || typeof rule.find !== "string" || !rule.find.length || typeof rule.replace !== "string") throw new Error(`${index + 1}번 규칙: 찾을 표현은 비어 있지 않은 문자열, 바꿀 표현은 문자열이어야 합니다.`);
        if (file.type === "regex") {
          try { regexFor(rule.find); }
          catch (error) { throw new Error(`${index + 1}번 규칙: 잘못된 정규식 · ${error.message}`); }
        }
      });
      return file;
    }
    function csvRows(text) {
      const rows = [];
      let row = [], field = "", quoted = false, closed = false;
      function finishRow() {
        row.push(field);
        if (!(row.length === 1 && row[0] === "")) rows.push(row);
        row = []; field = ""; closed = false;
      }
      for (let i = 0; i < text.length; i += 1) {
        const char = text[i];
        if (quoted) {
          if (char !== '"') field += char;
          else if (text[i + 1] === '"') { field += '"'; i += 1; }
          else { quoted = false; closed = true; }
        } else if (char === ",") { row.push(field); field = ""; closed = false; }
        else if (char === "\n" || char === "\r") { finishRow(); if (char === "\r" && text[i + 1] === "\n") i += 1; }
        else if (char === '"' && field === "" && !closed) quoted = true;
        else if (closed || char === '"') throw new Error("CSV 따옴표 또는 구분자 형식이 올바르지 않습니다.");
        else field += char;
      }
      if (quoted) throw new Error("CSV의 닫히지 않은 따옴표를 확인해 주세요.");
      finishRow();
      return rows;
    }
    function parseFile(text, info) {
      if (typeof text !== "string" || text.length > 100_000) throw new Error("규칙 파일은 100,000자 이하로 나누어 주세요.");
      text = text.replace(/^\uFEFF/, "");
      let rules;
      if (/\.csv$/i.test(info.name)) {
        const rows = csvRows(text);
        if (rows[0]?.[0] === "찾을 표현" && rows[0]?.[1] === "바꿀 표현" && rows[0].length === 2) rows.shift();
        rules = rows.map((row, index) => {
          if (row.length !== 2) throw new Error(`CSV ${index + 1}번 규칙: 두 열(찾을 표현,바꿀 표현)이 필요합니다.`);
          return { find: row[0], replace: row[1] };
        });
      } else if (/\.json$/i.test(info.name)) {
        let value;
        try { value = JSON.parse(text); } catch { throw new Error("JSON 문법이 올바르지 않습니다."); }
        if (!Array.isArray(value)) throw new Error("JSON 최상위 값은 규칙 객체 배열이어야 합니다.");
        rules = value.map((row, index) => {
          const keys = row && typeof row === "object" ? Object.keys(row) : [];
          const korean = keys.length === 2 && keys.includes("찾을 표현") && keys.includes("바꿀 표현");
          const english = keys.length === 2 && keys.includes("find") && keys.includes("replace");
          if (!korean && !english) throw new Error(`JSON ${index + 1}번 규칙: 찾을 표현·바꿀 표현 두 필드가 필요합니다.`);
          return { find: row[korean ? "찾을 표현" : "find"], replace: row[korean ? "바꿀 표현" : "replace"] };
        });
      } else throw new Error("CSV 또는 JSON 파일을 선택해 주세요.");
      return validateFile({ ...info, enabled: true, rules });
    }
    function detectLanguage(text) {
      if (/\p{Letter}/u.test(text.replace(/[\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Latin}\p{Script=Han}\p{Script=Bopomofo}ー々〆]/gu, ""))) return "all";
      const signals = [];
      if (/\p{Script=Hangul}/u.test(text)) signals.push("ko");
      if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text)) signals.push("ja");
      if (/\p{Script=Latin}/u.test(text)) signals.push("en");
      if (/\p{Script=Bopomofo}/u.test(text)) signals.push("zh");
      // Han is shared by Chinese, Japanese and Korean. It is not a unique language signal.
      if (signals.length !== 1) return "all";
      if (signals[0] === "en" && /\p{Script=Han}/u.test(text)) return "all";
      return signals[0];
    }
    function apply(text, settings = {}) {
      if (typeof text !== "string" || text.length > 20_000) throw new Error("미리보기·보정 원문은 20,000자 이하여야 합니다.");
      const language = detectLanguage(text);
      if (settings.correctionEnabled !== true) return { text, changed: false, language, replacementCount: 0, warnings: [] };
      let result = text;
      let replacementCount = 0;
      const warnings = [];
      for (const file of settings.ruleFiles ?? []) {
        if (file?.enabled === false) continue;
        if (language !== "all" && file?.language !== "all" && file?.language !== language) continue;
        try {
          validateFile(file);
          let candidate = result;
          let fileCount = 0;
          for (const rule of file.rules) {
            const replaced = replaceRule(candidate, rule, file.type);
            candidate = replaced.text;
            fileCount += replaced.count;
            if (!candidate.trim() || candidate.length > 20_000) throw new Error("빈 요약 또는 20,000자를 넘는 결과를 만드는 규칙입니다.");
          }
          result = candidate;
          replacementCount += fileCount;
        } catch (error) { warnings.push(`${typeof file?.name === "string" ? file.name : "규칙 파일"}: ${error.message}`); }
      }
      if (result !== text) result = result.trim();
      return { text: result, changed: result !== text, language, replacementCount, warnings };
    }
    return { inferFile, validateFile, parseFile, detectLanguage, apply };
  }
  const tools = ruleTools();
  function createProcessor() {
    const active = new Set();
    let disposed = false;
    function process(text, settings, signal) {
      if (signal?.aborted || disposed) return Promise.reject(new Error("표현 보정이 취소되었습니다."));
      if (!settings?.correctionEnabled || !settings.ruleFiles?.some((file) => file?.enabled !== false)) return Promise.resolve(tools.apply(text, { correctionEnabled: false }));
      return new Promise((resolve, reject) => {
        let worker, timer, url;
        const cancel = () => finish(null, new Error("표현 보정이 취소되었습니다."));
        function finish(result, error) {
          clearTimeout(timer);
          worker?.terminate();
          if (url) URL.revokeObjectURL(url);
          signal?.removeEventListener("abort", cancel);
          active.delete(cancel);
          if (error) reject(error); else resolve(result);
        }
        function fallback(message) { finish({ text, changed: false, language: tools.detectLanguage(text), replacementCount: 0, warnings: [message] }); }
        try {
          url = URL.createObjectURL(new Blob([`const tools = (${ruleTools.toString()})(); onmessage = (event) => { try { postMessage({ result: tools.apply(event.data.text, event.data.settings) }); } catch (error) { postMessage({ error: error.message }); } };`], { type: "text/javascript" }));
          worker = new Worker(url);
          worker.onmessage = (event) => event.data.error ? fallback(event.data.error) : finish(event.data.result);
          worker.onerror = (event) => { event.preventDefault(); fallback("표현 보정 실행 실패 · 원문을 유지했습니다."); };
          timer = setTimeout(() => fallback("표현 보정이 1초를 초과했습니다. 규칙을 확인해 주세요. 원문을 유지했습니다."), 1000);
          active.add(cancel);
          signal?.addEventListener("abort", cancel, { once: true });
          worker.postMessage({ text, settings: { correctionEnabled: true, ruleFiles: settings.ruleFiles } });
        } catch { fallback("이 환경에서 표현 보정 작업을 실행할 수 없어 원문을 유지했습니다."); }
      });
    }
    function dispose() { disposed = true; for (const cancel of [...active]) cancel(); }
    return Object.freeze({ process, dispose });
  }
  return Object.freeze({ ...tools, createProcessor });
})();
