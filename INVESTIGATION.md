# 일반 Chat Summary 보정 확장 사전 조사

조사일: 2026-10-26

조사 대상: `/Users/min/Marinara-Engine-2.5`의 실제 소스. 디렉터리 이름과 달리 루트 `package.json` 버전은 **2.5.1**이며 HEAD는 `0fe5e2700733b2178b94e7210f883398959be192`입니다. 조사 시 작업 트리는 깨끗했습니다. 실행 중인 인스턴스의 버전과 동일하다고 가정하지 않습니다.

## 결론

**현재 확인한 공개 확장 API만으로는 요청한 자동 적용 확장을 구현할 수 없습니다.** 일반 Chat Summary를 읽는 것과, 검색·선택된 요약의 주입용 사본만 반환값으로 교체하는 것은 별개의 기능입니다. 후자의 API가 없습니다.

사용자의 “공개 API로 구현할 수 없다면 임의로 우회하지 말고 제약과 대안을 보고” 지시에 따라 런타임 우회 코드, 동작하지 않는 활성화 UI, 설치용 ZIP은 만들지 않았습니다. 이 폴더에는 조사 보고서만 있습니다. Engine, 기존 확장, 저장 데이터 및 실행 중인 인스턴스는 변경하지 않았습니다. GUI 실행과 모델 호출도 하지 않았습니다.

## 생성·저장·조회·주입 경로

아래 경로는 Engine 루트를 기준으로 합니다.

| 단계 | 실제 경로와 동작 |
| --- | --- |
| 수동 생성 | `packages/server/src/routes/chats.routes.ts:5615`의 `POST /:id/generate-summary`. 선택한 대화와 이전 요약, 요약 프롬프트로 모델을 호출하고 `parseChatSummaryResult`로 결과를 읽습니다. 마지막 메시지/범위 지정 생성 및 기존 항목 결합 분기가 있습니다. |
| 자동 생성 | `packages/server/src/routes/generate.routes.ts:11700` 부근의 `runAutomaticRoleplaySummary`. 간격, 범위, 연결 설정을 확인하고 모델 결과를 처리합니다. Advanced Memory 사용 시 이 경로를 건너뜁니다. |
| 항목 구성 | `packages/shared/src/utils/chat-summary-entries.ts`의 `appendChatSummaryEntryToMetadata`와 `compileChatSummaryEntries`. 항목은 `summaryEntries`, 활성 항목 본문을 순서대로 합친 텍스트는 `summary`입니다. |
| 저장 | `packages/server/src/services/storage/chats.storage.ts`의 `patchMetadata`. `packages/server/src/db/schema/chats.ts:30`의 채팅 `metadata` 필드에 보관합니다. 파일 기반 저장 계층을 사용하므로 SQLite 전용 구조로 가정하면 안 됩니다. |
| 일반 조회·UI | `packages/server/src/routes/chats.routes.ts:1335`의 채팅 조회가 metadata를 반환하고, `packages/client/src/components/chat/ChatSummaryPanel.tsx`가 요약 및 항목을 표시합니다. 항목 수정은 `/:id/summary-entries`가 처리하며 합성 `summary`도 다시 계산합니다. |
| RP 주입용 선택 | `packages/server/src/services/generation/roleplay-summary-retrieval.ts:42`의 `resolveRoleplayChatSummary`, `:61`의 `resolveRoleplayChatSummaryForPrompt`. RP 모드만 처리합니다. 일반적으로 `metadata.summary`를 읽고, 과거 메시지 재생성 시 해당 메시지를 포함하는 항목을 제외합니다. 의미 검색 설정에 따라 최근 항목 및 관련 과거 항목을 선택하며, 실패하면 기존 요약으로 복귀합니다. |
| 생성 경로 연결 | `packages/server/src/routes/generate.routes.ts:3054`에서 `activeChatSummary`를 구하고 `:3747`에서 assembler의 `chatSummary`로 전달합니다. Advanced Memory 사용 시 일반 요약은 null입니다. |
| 마커 주입 | `packages/server/src/services/prompt/marker-expander.ts:588`에서 `chat_summary` 본문의 매크로를 해석하고 프롬프트용으로 정리합니다. |
| 마커 없는 프리셋 | `packages/server/src/services/prompt/assembler.ts:774` 및 `:1088`의 `appendFallbackChatSummaryToSystemPrompt`. 요약을 `Chat Summary` 구획으로 감싸 선행 system 메시지 블록 끝에 넣습니다. |
| 미리보기 | `packages/server/src/routes/generate/dry-run-route.ts:990`도 같은 요약 선택 함수를 사용합니다. `injectChatSummary` 요청 플래그에 따른 별도 주입 제어가 있습니다. 실제 생성과 일치시키려면 이 경로도 지원해야 합니다. |

참고: `conversation/auto-summary.service.ts`의 일별·주별 요약은 Conversation 모드의 별도 기능입니다. 이번 대상은 RP에 전달되는 일반 rolling Chat Summary이며 이 일별·주별 기억은 대상에서 제외합니다.

## 공개 API 조사 결과

| 후보 | 가능한 기능 | 요구사항 충족 여부 |
| --- | --- | --- |
| Capability `api.registerPromptContext` | 읽기 전용 채팅 문맥을 받고 패키지 소유의 문맥 텍스트를 반환합니다. `chatMeta`에는 저장된 요약이 있을 수 있습니다. | 기존 일반 요약의 교체·제외 반환값이 없으므로 불가합니다. 저장된 요약은 의미 검색 및 재생성 제외 처리 이후의 주입 텍스트와도 다를 수 있습니다. |
| `CapabilityPromptContribution` | `text`와 `provides`를 반환합니다. | `provides`의 시스템 대체 기능은 활성 game experience의 inventory에 한정됩니다. Chat Summary 대체 항목은 없습니다. |
| 패키지 Agent Data 배치 | `injectCapabilityContexts`에서 패키지 자신의 runtime agent section을 채우거나 system 문맥을 추가합니다. | 일반 `chat_summary` 마커의 소유권을 얻는 기능이 아닙니다. 보정 요약을 추가하면 원본과 함께 전달될 수 있습니다. |
| Capability persistence | 권한 범위 내에서 채팅 metadata 조회 및 쓰기가 가능합니다. | 저장된 원본을 바꾸는 방식은 요구사항 위반입니다. 잠시 바꾸고 복원해도 동시 요청, 실패, 취소에 안전하지 않습니다. |
| Browser Personal Extension | 자체 저장소, 설정 패널, 활성 채팅 식별자, 허용된 캐릭터·페르소나 필드를 사용할 수 있습니다. | 일반 안전 실행 환경에는 요약 metadata 조회와 프롬프트 변환 API가 없습니다. |
| Server Personal Extension | 격리된 프로세스에서 제한된 자체 기능을 실행합니다. | 호스트 생성 파이프라인의 요약 변환 지점을 노출하지 않습니다. |
| Full page External Extension | 페이지 및 네트워크에 대한 넓은 접근이 가능합니다. | 권한이 넓다는 사실은 공식 요약 변환 API가 있다는 뜻이 아닙니다. 내부 함수 교체, 요청 가로채기 등은 우회이므로 사용하지 않습니다. 서버가 구성하는 요약을 브라우저 요청 변경만으로 안전하게 교체하는 계약도 없습니다. |
| 내장 Only Prompt 정규식 | 저장 메시지를 바꾸지 않고 프롬프트용 대화 메시지에 치환을 적용합니다. | `generate.routes.ts:3459`는 assembler 이전의 `mappedMessages`에 적용합니다. 일반 Chat Summary 전용 처리 지점이 아니므로 이번 대체 수단으로 사용할 수 없습니다. |

근거:

- `packages/server/src/services/capability-packages/capability-prompt-context.service.ts:13-61`: 요청·기여·반환 계약. `:109` 이후 collector는 텍스트 블록을 수집합니다. 요청의 문맥은 읽기 전용 계약이며 객체 참조를 악용해 수정하면 안 됩니다.
- `packages/server/src/services/generation/capability-prompt-runtime.ts:10-29`: 패키지 소유 구획 교체 또는 system 메시지에 추가합니다. 기존 일반 요약을 수정하지 않습니다.
- `packages/server/src/services/capability-packages/capability-module-runtime.service.ts:78-104` 및 `:387`: 등록 API와 `prompt-context` 권한 검사입니다.
- `packages/shared/src/types/capability-runtime.ts`, `packages/shared/src/types/generation-integration.ts`: 데이터·모델 호출 등 host 기능은 있으나 기존 RP 요청의 요약만 변환하는 등록 계약은 없습니다.
- `docs/extending/personal-extensions.md`의 Runtime isolation, Use active chat context, Legacy and full page extensions: 일반 확장의 접근 범위를 명시합니다.
- `packages/server/src/services/regex/regex-application.ts:187`: 대화 메시지의 역할에 따른 정규식 적용입니다.

Unified Memory는 `/Users/min/Marinara-Dev/extensions/unified-memory/server.mjs:2742`에서 별도의 prompt-context contributor를 등록합니다. 이 패키지의 문맥을 전역 system 문자열 치환으로 건드리는 접근은 제외해야 합니다. Engine의 Advanced Memory 또한 별도 기능이므로 Unified Memory와 동일한 대상으로 취급하지 않습니다.

## 향후 권장 연결 지점 — 현재 API가 아닌 제안

권장 방식은 Engine이 **일반 RP Chat Summary 전용의 공개 변환 훅**을 제공한 뒤 독립 Capability Package가 이를 사용하는 것입니다. 아래 내용은 설계 제안이며 적용하거나 구현하지 않았습니다.

1. 검색·항목 선택·재생성 제외 처리가 끝난 일반 요약의 주입용 사본만 전달합니다. 저장 metadata 객체나 전체 프롬프트를 수정할 권한을 주지 않습니다.
2. 일반 요약의 마커 및 fallback 배치를 모두 거치는 공통 지점을 사용합니다. `assemblePrompt`의 일반 요약 처리 경계가 후보지만, 공용 assembler에 무조건 적용하면 다른 호출까지 영향을 받습니다. **주 RP 생성 요청이라는 목적 정보**를 명시적으로 전달하고 전용 미리보기 경로에도 동일하게 적용해야 합니다.
3. 요약의 캐릭터 지식 범위 문법, 매크로, XML/Markdown 래핑을 보호합니다. 가능하면 호스트가 범위·매크로 구조를 보존한 본문 조각만 노출합니다. 출력은 토큰 예산 계산 이전에 확정하고, responder별 처리 및 그룹 생성에서 중복 적용되지 않도록 합니다.
4. `roleplay`의 일반 요약만 허용합니다. 요약 생성·결합·갱신 요청, 보조 에이전트 문맥, Conversation 기억, Advanced Memory, Unified Memory 및 다른 패키지 문맥에는 적용하지 않습니다. 동일한 요약 선택 함수가 보조 에이전트에서도 호출되므로 그 함수 전체에 무조건 연결해서는 안 됩니다.
5. 오류·시간 초과·빈 결과·잘못된 반환형·출력 한도 초과에는 해당 주입 전 원본 사본을 반환합니다. 등록 해제 및 비활성화 시 원래 동작으로 복귀해야 합니다. 여러 변환기 간 순서와 실패 처리도 계약으로 고정합니다.

Engine 변경은 사용자 승인 이후의 별도 작업입니다. 이 보고서는 Engine 변경 승인이나 구현 완료를 의미하지 않습니다.

## 연결 지점 확보 후의 규칙·UI 설계

- AI 호출 없이 JavaScript로 실행하며 설정은 확장 자체 저장소에 보관합니다.
- 활성화, 규칙 추가·수정·삭제·비활성화, 그룹 관리, 강도, 원본·결과 비교는 공개 UI로 구현할 수 있습니다. 다만 실제 주입 텍스트를 읽는 API가 없으면 비교는 사용자가 붙여넣은 샘플에 한정됩니다.
- 자유 서술에서 단어를 발견했다는 이유만으로 치환하지 않습니다. 명시적인 성격 필드나 사용자가 승인한 구조·문구에만 한정하고, 그 밖의 문장은 감지 결과만 보여줍니다.
- 소유욕·독점욕·집착 그룹은 반복 후보를 찾는 용도입니다. 그룹 반복만으로 서로 다른 인물의 표현을 합치거나 사건을 지우지 않습니다. 구조상 인물 범위가 명확할 때만 같은 인물 내에서 집계합니다.
- 실제 행동·발언·인용·부정·변화·조건·비교·원인 설명과 성격 평가가 섞인 문장은 보존합니다. 규칙만으로 의미 안전성을 보장할 수 없는 자유 서술은 자동 수정하지 않습니다.
- 사용자 사전도 무제한 전역 치환으로 실행하지 않습니다. 허용 범위, 정확한 일치 조건, 비어 있지 않은 대체값이 필요합니다. 안전성을 확인할 수 없는 규칙은 미리보기 전용으로 둡니다.
- 강도는 허용된 규칙 수준과 반복 감지 기준을 선택합니다. 높은 강도가 사건·행동·대사 보호를 해제하지는 않습니다.
- 반복 적용 불변성은 사전 순환과 연쇄뿐 아니라 그룹 빈도 변화까지 검증해야 합니다. 단일 패스로 후보를 결정하고, 후보 출력에 재적용했을 때 달라지면 원본으로 복귀하는 검증을 포함합니다. 출력의 바이트 동일성 `T(T(x)) === T(x)`를 검사하고 성능 한도를 둡니다.
- 필수 검증 사례는 비활성화 원본 유지, 예외 원본 복귀, 부정·인용·행동 보존, 인물별 범위, 유니코드·매크로 보존, 겹치는 그룹, 치환 연쇄·순환, 반복 불변성, 마커/fallback/그룹 생성/미리보기 일치, 원본 저장 불변, 다른 기억 비개입입니다.

## 현재 선택 가능한 대안

| 대안 | 가능 범위 | 한계 |
| --- | --- | --- |
| 공식 일반 요약 변환 API 제공 후 확장 개발 | 요청한 자동 적용 기능을 구현할 기반이 됩니다. | Engine 측 API 추가가 먼저 필요하며 별도 승인이 필요합니다. 권장안입니다. |
| 수동 붙여넣기 비교 도구 | 규칙 편집과 샘플 비교를 독립 확장으로 개발할 수 있습니다. | RP 전달 결과에는 적용되지 않습니다. 원래 요청을 완료하는 대안이 아닙니다. |
| 프리셋에 해석 지침 추가 | 요약을 읽을 때 성격 평가를 과장하지 말라는 안내를 줄 수 있습니다. | 요약 텍스트 보정이 아니며 별도 프롬프트 요소를 바꾸고 모델의 지시 준수에 의존합니다. 이번 범위에서는 적용하지 않았습니다. |

저장 요약 덮어쓰기, 생성 프롬프트 수정, 원본과 보정본 동시 주입, 서버 내부 함수 교체, 전체 프롬프트 문자열 가로채기는 요구사항을 충족하지 않아 제외합니다.

## 검증 범위

로컬 소스·타입·문서·호출 지점을 정적으로 추적했습니다. 소스나 런타임을 수정하지 않았으므로 설치·의존성 갱신·전체 Engine 테스트는 실행하지 않았습니다. 실행 중 인스턴스의 실제 프롬프트 또는 UI 동작을 검증했다는 의미는 아닙니다.
