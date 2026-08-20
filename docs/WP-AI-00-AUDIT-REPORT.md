# [WP-AI-00 SWIMNOTE APP-WIDE AI/API ARCHITECTURE AUDIT REPORT]

> **READ-ONLY AUDIT** — 코드 수정 없음, DB write 없음, 외부 API 호출 없음  
> Branch: `deploy-photo-clone` | SHA: `b81d23a8` (audit 시점 HEAD, 이후 `7fe9659f`로 hotfix 적용)  
> 작성일: 2026-08-21

---

## 1. Repository / Branch / SHA

| 항목 | 값 |
|---|---|
| Repository | swimnote/swimnote (GitHub) |
| Branch | deploy-photo-clone |
| SHA (audit 기준) | b81d23a8 |
| API Server | artifacts/api-server/src/ |
| Mobile App | artifacts/swim-app/ |
| Web | artifacts/swimnote-web/ |

---

## 2. Current Architecture Summary

```
[Mobile App (Expo/React Native)]
  ↓ HTTPS REST API calls
[API Server (Express/TypeScript on Render.com)]
  ↓ Supabase PostgreSQL (운영 DB, superAdminDb)
  ↓ Cloudflare R2 (object storage)
  ↓ OpenAI API (GPT-4o-mini + Whisper-1) — 직접 호출
  ↓ Growth Report Engine (외부 AI Engine HTTP, GROWTH_REPORT_ENGINE_URL)
  ↓ Parent Curriculum Engine (외부 AI Engine HTTP, separate URL)
  ↓ Naver SENS / Aligo / CoolSMS (SMS)
  ↓ Expo Push (FCM/APNs)
  ↓ RevenueCat (iOS 구독 결제)
  ↓ PortOne / Toss (한국 결제)
[Worker Mode (별도 프로세스)]
  → 11개 background job/scheduler
```

**AI Architecture 현황**:
- 5개 GPT 직접 호출 (route 레벨, AiGateway 미사용)
- AiGateway (`lib/runtime/ai-gateway.ts`) 존재하나 production import 없음 — RT1 인프라로만 존재
- Growth Report / Curriculum Search는 **외부 AI Engine HTTP**에 위임 (모델 불명)
- 공통 RT1 런타임 (`lib/runtime/`) 정의 완료, 아직 route 레벨에 미연결

---

## 3. Existing External API Inventory

| # | Provider | Purpose | Trigger | Logging | 비용 |
|---|---|---|---|---|---|
| 1 | **OpenAI GPT-4o-mini** | Teacher diary 생성, Support fallback, Story summary | USER_ACTION | saveAiTrace (event_logs) | 유료 |
| 2 | **OpenAI Whisper-1** | 음성→텍스트 (교사 음성 메모) | USER_ACTION | 콘솔 (duration/cost 미계측) | 유료 |
| 3 | **Naver Cloud SENS** | SMS (OTP, 알림) | USER_ACTION / SYSTEM | 마스킹 콘솔 | 유료/건당 |
| 4 | **Aligo SMS** | SMS (대안 프로바이더) | USER/SYSTEM | 오류만 throw | 유료/건당 |
| 5 | **CoolSMS** | SMS (대안 프로바이더) | USER/SYSTEM | 오류만 throw | 유료/건당 |
| 6 | **Expo Push (FCM/APNs)** | 푸시 알림 | SYSTEM_MAINTENANCE | push_logs DB | 무료(플랫폼) |
| 7 | **Cloudflare R2** | 사진/영상 오브젝트 스토리지 | USER/SYSTEM | 오류 콘솔 | 유료(용량/egress) |
| 8 | **RevenueCat** | iOS 구독 결제 검증 | USER_ACTION | 이벤트 로그 | 무료(플랫폼) |
| 9 | **PortOne** | 한국 카드 결제 | USER/SYSTEM | 오류만 | 유료(수수료) |
| 10 | **Toss Payments** | 한국 카드 결제(대안) | USER/SYSTEM | 오류만 | 유료(수수료) |
| 11 | **Kakao** | 소셜 로그인/공유 | USER_ACTION | 없음 | 무료 |
| 12 | **Expo EAS / Updates** | OTA 업데이트 | SYSTEM(앱 시작) | 없음 | 유료(플랜) |
| 13 | **Growth Report Engine** | 성장 리포트 AI 분석 | SYSTEM_MAINTENANCE | saveAiTrace (token null) | 유료(외부) |
| 14 | **Parent Curriculum Engine** | 커리큘럼 검색 AI | USER_ACTION | saveAiTrace (token null) | 유료(외부) |
| 15 | **Google Fonts / jsDelivr** | 웹 폰트/라이브러리 | 페이지 로드 | 없음 | 무료 |

---

## 4. Existing GPT/OpenAI Call Inventory

모든 5개 production GPT 호출은 **AiGateway를 거치지 않고 getOpenAI() 직접 호출**.

| # | 파일 | Route | 모델 | Feature | Input Source | Output | Retry | Timeout | Token 계측 | Cost 로깅 |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | routes/ai.ts | POST /ai/diary | gpt-4o-mini | 교사 일지 생성(legacy) | 교사 메모+학생명 | JSON {common, students[]} | 없음 | configurable gptTimeoutMs | ✅ | ✅ saveAiTrace |
| 2 | routes/ai-v1.ts | POST /v1/teacher-diary/generate | gpt-4o-mini | 교사 일지 v1 (template-assisted) | 메모+템플릿 DB | JSON diary common+students | 없음 | configurable gptTimeoutMs | ✅ | ✅ saveAiTrace |
| 3 | routes/support-respond.ts | POST /support/respond | gpt-4o-mini | Support fallback LLM | DB evidence + 대화 | JSON {confidence, answer, requires_human} | 없음 | 28,000ms | ✅ | ✅ saveAiTrace |
| 4 | routes/support-cases.ts | POST /cases/:id/gpt-escalation | gpt-4o-mini | Support 2차 에스컬레이션 | DB knowledge(5개)+대화 | JSON {answer, used_knowledge_ids} | 없음 | **없음** | ✅ | ✅ (latency 0 버그) |
| 5 | routes/story.ts | POST /diaries/:id/story-summary | gpt-4o-mini | 일지→Instagram 요약 | DB diary 내용 | 짧은 한국어 요약 | 1회(길이) | 25,000ms | ✅ | ✅ saveAiTrace |

**AiGateway (lib/runtime/ai-gateway.ts)**:
- 존재하나 production import 없음 — RT1 인프라 전용
- retry/timeout/structured output/usage return 완비
- 현재 5개 직접 호출 모두 AiGateway로 마이그레이션 필요

---

## 5. SYSTEM_MAINTENANCE API Call Inventory

| Job | Schedule | 외부 AI/유료 API | 반복 위험 | 비용 위험 |
|---|---|---|---|---|
| backup-batch.ts | 매일 03:00 KST (+ 1h 자동백업 check) | R2 오브젝트 스토리지 | 없음 | LOW (데이터 크기 비례) |
| parent-link-scheduler.ts | 매분 | 없음 | 없음 | LOW |
| auto-attendance-scheduler.ts | 15분마다 | 없음 | 없음 | LOW |
| push-scheduler.ts | 매분 + 08:00 KST | Expo Push | 없음 | LOW (수신자 수 비례) |
| deactivation-cleanup.ts | 매일 03:00 KST | 없음 | 없음 | NONE |
| readonly-trigger.ts | 매일 04:00 KST | 없음 | 없음 | NONE |
| standby-sync.ts | 5분/30분/6시간마다 | 없음 | 없음 (preflight 완료) | LOW |
| video-expiry-cleanup.ts | 시작+주기적 | R2 삭제 | 없음 | LOW |
| **growth-report-analysis-worker.ts** | **5분마다+시작 45s** | **외부 Growth Report Engine** | **⚠️ HIGH** | **HIGH** |
| growth-report-scheduler.ts | 매일 01:00 KST | 없음(스케줄만) | 없음 | LOW |
| retry-queue-worker.ts | 5분마다 | 없음(재시도 queue) | 없음 | LOW |

**⚠️ SYSTEM_MAINTENANCE 비용 위험 TOP 1: growth-report-analysis-worker**
- 5분마다 실행, 10개 report/run
- 각 report: Pass 1 + Pass 2 = **최대 2회 외부 AI Engine 호출**
- 실패 시 최대 3회 재시도 (기본값) → **최대 6 Engine calls/report**
- 120초 timeout × 10개 = 이론적 최대 20분/run (lock 10분으로 제한)
- `GROWTH_REPORT_ENGINE_URL` 미설정 시 fail-closed (안전)
- **모델/토큰 비용 완전 불투명** (token null, 외부 Engine 정보 없음)

---

## 6. Feature-by-Feature AI/API Opportunity Matrix

| 기능군 | 현재 상태 | Type | Priority | efficiency | UX | accuracy | labor | cost | difficulty | risk |
|---|---|---|---|---|---|---|---|---|---|---|---|
| AUTH | JWT/세션 | E — Deterministic | — | — | — | — | — | — | — | — |
| ROLE/PERMISSION | 서버 검증 | E — Deterministic | — | — | — | — | — | — | — | — |
| POOL MANAGEMENT | CRUD | E — Deterministic | — | — | — | — | — | — | — | — |
| STUDENT MANAGEMENT | CRUD+기록 | E — Deterministic | — | — | — | — | — | — | — | — |
| CLASS MANAGEMENT | CRUD | E — Deterministic | — | — | — | — | — | — | — | — |
| ATTENDANCE | 자동 감지 | E — Deterministic | — | — | — | — | — | — | — | — |
| MAKEUP/REQUEST | 규칙 기반 | E — Deterministic | — | — | — | — | — | — | — | — |
| NOTICE | CRUD | E — Deterministic | — | — | — | — | — | — | — | — |
| SCHEDULE | 시간표 CRUD | E — Deterministic | — | — | — | — | — | — | — | — |
| PUSH | FCM/APNs | D — Expo (기존 적용) | — | — | — | — | — | — | — | — |
| PHOTO | R2 업로드 | E — Deterministic | P2 | LOW | LOW | LOW | LOW | LOW | LOW | LOW |
| VIDEO | R2 + 만료 정리 | D — External(미래) | P2 | MED | MED | HIGH | MED | HIGH | HIGH | MED |
| ALBUM | 사진 묶음 | E — Deterministic | — | — | — | — | — | — | — | — |
| PARENT FEED | 알림+일지 | E — Deterministic | — | — | — | — | — | — | — | — |
| DIARY (Teacher write) | 수동 입력 | E — Deterministic | — | — | — | — | — | — | — | — |
| **AI DIARY** | GPT-4o-mini | **A — Nano Grounded** | **P0** | HIGH | HIGH | MED | HIGH | HIGH | MED | MED |
| **CURRICULUM SEARCH** | 외부 Engine | **A — Nano Grounded** | **P0** | HIGH | HIGH | HIGH | HIGH | HIGH | MED | MED |
| GROWTH EVENTS | X모드 매칭 | E + partial A | P1 | MED | MED | MED | MED | MED | MED | LOW |
| **GROWTH REPORT** | 외부 Engine | **C — Advanced GPT** | **P0** | HIGH | HIGH | HIGH | HIGH | HIGH | HIGH | HIGH |
| **CUSTOMER SUPPORT** | GPT-4o-mini+규칙 | **A/B — Nano Grounded** | **P0** | HIGH | HIGH | MED | HIGH | MED | MED | LOW |
| X MODE | 결제+규칙 | E — Deterministic | — | — | — | — | — | — | — | — |
| X ENTITLEMENT | 결제 검증 | E — Deterministic | — | — | — | — | — | — | — | — |
| X MATERIAL SUBMISSION | DOCX 파싱 | E — Deterministic | — | — | — | — | — | — | — | — |
| SUBSCRIPTION | RevenueCat/Toss | D — External (기존) | — | — | — | — | — | — | — | — |
| PAYMENT | PortOne/Toss | D — External (기존) | — | — | — | — | — | — | — | — |
| ADMIN | 관리 CRUD | E — Deterministic | — | — | — | — | — | — | — | — |
| SUPER ADMIN | 내부 관리 | E — Deterministic | — | — | — | — | — | — | — | — |
| SEARCH | SQL ILIKE | B — Nano (P1) | P1 | MED | MED | MED | MED | LOW | LOW | LOW |
| DATA IMPORT | DOCX 파서 | E — Deterministic | — | — | — | — | — | — | — | — |
| DATA EXPORT | 수동 | D(P2 — PDF/PPT) | P2 | HIGH | HIGH | LOW | HIGH | HIGH | HIGH | MED |
| BACKGROUND JOBS | cron | E — Deterministic | — | — | — | — | — | — | — | — |
| **PROF. KNOWLEDGE** | Supabase inline | A(P0 — indexing) | P0 | HIGH | HIGH | HIGH | HIGH | LOW | MED | LOW |
| AI ENGINE CONNECTION | HTTP 외부 | 기존 적용 | — | — | — | — | — | — | — | — |
| PPT/PDF/DOC GENERATION | file_url 필드만 | D — External(P2) | P2 | HIGH | HIGH | LOW | HIGH | HIGH | HIGH | MED |
| MONITORING/OPS | console/DB | B(P1 — 비용추적) | P1 | HIGH | LOW | HIGH | HIGH | LOW | LOW | LOW |

---

## 7. Customer Support Assessment

**A. Customer Support**

| 항목 | 현재 상태 |
|---|---|
| **Runtime** | User → POST /support/respond → 7-layer 규칙 chain → GPT fallback |
| **DB Source** | support_knowledge_items, utterances, support_ticket_replies, support_cases (모두 Supabase inline) |
| **AI Model** | gpt-4o-mini (직접 OpenAI 호출, AiGateway 미사용) |
| **Retrieval** | ILIKE + JS token overlap scoring (O(N) 메모리 scan); concept lexicon 기반 |
| **Weakness** | ① regex/rule로는 오탈자/부정/복합 의도 처리 불가 ② KI 증가 시 DB full scan 병목 ③ LLM timeout 28초, retry 없음 ④ 2차 에스컬레이션 timeout 누락 ⑤ cost 불완전 (token O, USD X) ⑥ deterministic_total 코드상 0 고정 |
| **Nano 위치** | query intent classification, Korean paraphrase/오탈자 정규화, follow-up 감지, candidate re-ranking → 기존 retrieval 보조 계층으로 사용 |
| **Professional DB** | 없음 — Supabase inline |
| **External API** | 없음 (추가 불필요) |
| **Cost 계측** | token O / USD 미계산 / 에스컬레이션 latency_ms=0 버그 |

**주요 개선 포인트**:
1. 5개 직접 GPT 호출 → AiGateway 통일 (retry/timeout/structured output)
2. query preprocessing에 nano 추가 → regex 대체 → 정확도 개선
3. 에스컬레이션 route timeout 추가 (현재 없음 → 비용 위험)
4. USD cost 계산 saveAiTrace에 추가

---

## 8. Curriculum Search Assessment

**B. Parent Curriculum Search**

| 항목 | 현재 상태 |
|---|---|
| **Runtime** | Parent → POST /parent/students/:id/curriculum-search → intent parse → evidence retrieval → 외부 Engine HTTP |
| **DB Source** | curriculum_items, growth_events, class_diary_student_notes, student_levels, parent_ai_daily_usage, parent_curriculum_messages |
| **AI Model** | 외부 Engine 불명 (token null, meta.model 미기록) |
| **Retrieval** | SQL 관계형 (growth_events + diary join), 최대 2,000 curriculum items 전체 전달 |
| **Weakness** | ① 외부 Engine 모델/토큰 완전 불투명 ② intent parser가 규칙 기반 (의미 이해 없음) ③ scope 최대 2,000 items 전체 전달 → Engine 부하 ④ 대화 맥락 6턴 500자로 제한 ⑤ USD/token 비용 observability 없음 |
| **Nano 위치** | intent normalization/classification (현재 규칙), conversation context 요약 압축, evidence re-ranking |
| **Professional DB** | 없음 — Supabase inline curriculum_items |
| **External API** | 현재 외부 Engine 사용 중 |
| **Cost 계측** | saveAiTrace 있으나 token null — 외부 Engine 토큰 정보 없음 |

---

## 9. AI Diary Assessment

**C. AI Diary (Teacher)**

| 항목 | 현재 상태 |
|---|---|
| **Runtime** | 교사 → 음성(Whisper) 또는 텍스트 → POST /ai/diary 또는 /v1/teacher-diary/generate → template 검색(SQL) → GPT-4o-mini |
| **DB Source** | diary_templates (최대 500개 로드), class_groups, student_class_history |
| **AI Model** | Whisper-1 (STT) + gpt-4o-mini (생성) 직접 호출 |
| **Template 선택** | SQL LIKE keyword score (lexical, 5개 기준점, ≥1.40 필요); 의미 이해 없음 |
| **Weakness** | ① 레거시 ai.ts / v1 ai-v1.ts 이중 구현 ② template 선택이 lexical → 오탈자/동의어 미처리 ③ cross-pool fallback 허용 (스타일 유출) ④ GPT 500개 템플릿 중 1개만 활용 → 나머지 낭비 ⑤ Whisper cost 미계측 (duration/token 없음) ⑥ AiGateway 미사용 |
| **Nano 위치** | ① template 선택 re-ranking (≤5 후보 → nano) ② output repair/length validator ③ 학생 관련 의미 분류 |
| **Professional DB** | 없음 |
| **External API** | 불필요 (현재 OpenAI만으로 충분) |
| **Cost 계측** | GPT token O / Whisper cost X (audio duration 없음) |

**Input token 규모**: 약 600~1,200 prompt tokens / call (template 포함 시)

---

## 10. Growth Report Assessment

**D. Growth Report**

| 항목 | 현재 상태 |
|---|---|
| **Runtime** | 월 1회 cycle → worker 5분마다 → 외부 Engine HTTP (Pass 1: 문항생성 / Pass 2: 분석+리포트) |
| **DB Source** | growth_reports, growth_events, student_levels, class_diaries, attendance, curriculum_items, growth_report_questions/answers |
| **AI Model** | 외부 Engine "Growth Report GPT" (모델 불명, token null) |
| **현재 약점** | ① 외부 Engine 모델/비용 완전 불투명 ② 최대 12 longitudinal periods 스냅샷 → 큰 payload ③ Pass 1~2 각 3회 재시도 → 최대 6 Engine calls/report ④ attendance duration_min = null ⑤ curriculum stage/mastery = null (Engine에 위임) ⑥ 비용 observability 없음 |
| **현재 데이터** | diary content, growth_events(confidence+evidence), student_levels, attendance, curriculum_items, parent answers |
| **미래 필요 처리** | STT (음성 코치 코멘트), Image analysis (자세/영법), Video analysis (프레임 분석), PPT/PDF 생성 |
| **Nano 위치** | 없음 (외부 Engine이 담당) — 단, Engine 응답 검증/grounding check에서 경량 구조 검사 가능 |
| **Cost 계측** | saveAiTrace 있으나 model/token null — 실질적 비용 불투명 |

---

## 11. Professional AI Engine Connection Status

| 구성 요소 | 상태 |
|---|---|
| Growth Report Engine URL | `GROWTH_REPORT_ENGINE_URL` env — **존재 (코드에 참조됨)**, 실제 URL은 env secret |
| Growth Report Engine Client | `src/lib/growth-report-engine-client.ts` — **존재, 운영 중** |
| Parent Curriculum Engine | `src/lib/parent-curriculum-engine-client.ts` — **존재, 운영 중** |
| Teacher Diary Engine | **FOUND** — `src/routes/ai-v1.ts`가 POST `/api/v1/teacher-diary/generate`를 외부 Engine으로 전달 |
| Professional Knowledge DB | **NOT FOUND IN CURRENT REPOSITORY** — `PROFESSIONAL_KNOWLEDGE` enum은 future type으로만 선언 |
| Vector/Embedding DB | **NOT FOUND IN CURRENT REPOSITORY** |
| pgvector | **NOT FOUND IN CURRENT REPOSITORY** |
| Separate AI knowledge store | **NOT FOUND** — support knowledge는 Supabase inline |

---

## 12. Common Runtime Reuse Assessment

**lib/runtime/ 현황** (RT1 완료, route 연결 대기 중):

| Component | 파일 | 상태 | 재사용 가능 기능 |
|---|---|---|---|
| RequestContext | request-context.ts | ✅ 완료 | tenant isolation, role, normalized query, mode |
| RetrievalResult | retrieval-result.ts | ✅ 완료 | HIGH/MED/LOW/NONE scoring, ai_callable, MissingReason |
| EvidencePack | evidence-pack.ts | ✅ 완료 | cross-tenant guard, confidence, text/sourceId extract |
| AnswerPolicy | answer-policy.ts | ✅ 완료 | DB_DIRECT/GROUNDED_AI/HUMAN_REQUIRED/INSUFFICIENT |
| AiGateway | ai-gateway.ts | ✅ 완료, **미연결** | retry, timeout, structured output, token return |
| Diagnostics | diagnostics.ts | ✅ 완료 | PII guard, telemetry, event_log safe metadata |
| RuntimeErrors | runtime-errors.ts | ✅ 완료 | typed retry/non-retry errors |
| SupportLexicon | support-lexicon.ts | ✅ (Support 전용) | 개념 lexicon — 범용 확장 가능 |

**핵심 문제**: 5개 GPT 직접 호출이 모두 AiGateway를 우회. retry/timeout/structured output/cost가 route마다 개별 구현됨.

**재사용 권고**:
- 기존 모든 GPT 호출 → `callGateway()` 마이그레이션
- RequestContext → Support/Curriculum/Diary/Growth 공통 request validation에 사용
- EvidencePack → support retrieval + curriculum retrieval에 공통 적용
- Diagnostics → 모든 AI trace에 공통 적용

---

## 13. Cost Observability Current State

### 현재 계측 현황

| 항목 | 계측 여부 | 위치 |
|---|---|---|
| GPT provider | ✅ | saveAiTrace.provider=openai |
| GPT model | ✅ | saveAiTrace.model |
| input_tokens | ✅ (GPT 직접 호출) | saveAiTrace + event_logs |
| output_tokens | ✅ (GPT 직접 호출) | saveAiTrace |
| estimated_cost (USD) | ✅ | ai-pricing.ts × tokens (GPT만) |
| latency_ms | ✅ | saveAiTrace |
| pool_id | ✅ | saveAiTrace |
| trigger_type | ⚠️ 부분 | feature만 있음, USER_ACTION/SYSTEM 구분 없음 |
| Whisper token/duration | ❌ | 없음 |
| Growth Engine token | ❌ | null — 외부 Engine |
| Curriculum Engine token | ❌ | null — 외부 Engine |
| SMS 건수/비용 | ❌ | 없음 |
| R2 egress/비용 | ❌ | 없음 |
| 에스컬레이션 latency | ❌ (bug) | latency_ms=0 고정 |

### 누락된 핵심 필드

```typescript
// 현재 saveAiTrace에 없는 것:
trigger_type: "USER_ACTION" | "SYSTEM_MAINTENANCE" | "ADMIN_MANUAL" | "BATCH_JOB"
retry_count: number
cached_tokens: number
estimated_cost_usd: number   // USD로 명시 (있으나 일부 누락)
whisper_audio_seconds: number
engine_model: string | null  // 외부 Engine이 반환하는 경우
```

---

## 14. P0 Candidates

| # | 기능 | 타입 | 효과 | 난이도 | 위험 |
|---|---|---|---|---|---|
| **P0-1** | **Support GPT → AiGateway 마이그레이션** | 인프라 | retry/timeout 표준화, 에스컬레이션 timeout 추가, cost 정확화 | LOW | LOW |
| **P0-2** | **Diary GPT → AiGateway 마이그레이션 + legacy ai.ts 제거** | 인프라 | 코드 단순화, retry 추가, Whisper cost 계측 | LOW | LOW |
| **P0-3** | **Support query → nano pre-classification** | AI 기능 | regex 복잡도 감소, 오탈자/부정/복합 의도 처리 | MED | LOW |
| **P0-4** | **trigger_type 필드 추가 (USER_ACTION/SYSTEM/BATCH)** | Observability | 비용 가시성 즉시 개선 | LOW | NONE |
| **P0-5** | **Growth Engine call 비용 proxy logging** | Observability | Engine 비용 추정 가능 (call count × 단가) | LOW | NONE |
| **P0-6** | **에스컬레이션 route timeout 추가** | 안정성 | 무제한 대기 제거 (현재 timeout 없음) | LOW | LOW |
| **P0-7** | **Diary template 선택 → nano re-ranking** | AI 정확도 | 의미 기반 template 선택 (lexical 한계 극복) | MED | LOW |
| **P0-8** | **Whisper cost 계측 (duration/USD)** | Observability | STT 비용 가시성 | LOW | NONE |
| **P0-9** | **Support KI retrieval → candidate set 제한 + nano rerank** | 성능 | DB full scan O(N) 제거, 정확도 향상 | MED | LOW |
| **P0-10** | **Growth worker retry 안전장치 강화** | 안정성 | 최대 6 Engine calls/report → 비용 폭탄 방지 | LOW | LOW |

---

## 15. P1 Candidates

| # | 기능 | 설명 | 난이도 | 비용 |
|---|---|---|---|---|
| P1-1 | Story summary → nano 이관 | gpt-4o-mini → nano (짧은 요약, 정확도 요구 낮음) | LOW | LOW |
| P1-2 | Support → AiGateway 완전 연결 (RequestContext/EvidencePack) | RT1 인프라 실제 활용 | MED | LOW |
| P1-3 | Curriculum intent parser → nano | 규칙 기반 intent → nano classification | MED | LOW |
| P1-4 | SMS 비용 계측 (건수 × 단가) | Aligo/CoolSMS도 logging 추가 | LOW | NONE |
| P1-5 | Push 실패 rate 모니터링 대시보드 | push_logs 집계 → super admin | LOW | NONE |
| P1-6 | Diary 학생 언급 추출 → nano | 현재 client-provided → DB 기반 nano 추출 | MED | MED |
| P1-7 | Growth event confidence → nano enrichment | 현재 규칙 기반 confidence → nano 보조 | MED | MED |
| P1-8 | USD cost 필드 saveAiTrace 완전 표준화 | 모든 feature에 estimated_cost_usd 통일 | LOW | NONE |

---

## 16. P2 Candidates

| # | 기능 | 설명 |
|---|---|---|
| P2-1 | Photo/Video → 영법 분석 API | 외부 Video analysis (Twelve Labs 등) — Growth Report 연계 |
| P2-2 | PPT/PDF 생성 | PptxGenJS 또는 외부 service → growth_reports.file_url 실제 생성 |
| P2-3 | STT for coach audio | Whisper 활용 코치 음성 코멘트 → growth_events 자동 추가 |
| P2-4 | OCR for uploaded documents | 수업 자료 사진 → 텍스트 추출 → curriculum 보완 |
| P2-5 | Translation (KO→EN) | 학부모 다국어 지원 |
| P2-6 | Geocoding for pool search | 수영장 위치 기반 검색 |
| P2-7 | Email (SMTP/SendGrid) | SMS 대안 또는 리포트 발송 |
| P2-8 | Vector/embedding search for knowledge | pgvector 추가 → KI 검색 의미 개선 |

---

## 17. NO-AI / Deterministic-only Features

아래 기능은 AI 없이 유지하는 것이 더 적절하며, AI를 적용하면 안 됨:

| 기능 | 이유 |
|---|---|
| **AUTH (JWT/세션)** | 확정적 판단 필수, 오류 허용 없음 |
| **ROLE/PERMISSION** | tenant isolation 핵심, AI 판단 불가 |
| **PAYMENT/BILLING** | 금융 오류 허용 없음 |
| **SUBSCRIPTION/ENTITLEMENT** | RevenueCat/Toss 검증은 deterministic |
| **QUOTA enforcement** | 이중 차감 방지 — DB 원자성 필수 |
| **DB integrity (migrations)** | SQL DDL은 AI 판단 불가 |
| **ATTENDANCE 자동 감지** | 시간 기반 규칙, 오류 허용 없음 |
| **TENANT isolation** | pool_id 격리는 절대 AI에 맡기면 안 됨 |
| **Push token 관리** | 기기/토큰 레지스트리 관리 |
| **X mode entitlement** | 결제 검증 결과 기반 |

---

## 18. External APIs Worth Evaluating

| API | 목적 | 현재 병목 | 효과 | 우선순위 |
|---|---|---|---|---|
| **OpenAI Whisper-1** | STT (이미 사용 중) | Whisper cost 미계측 | 계측 추가로 충분 | P0 (계측) |
| **Twelve Labs / Video AI** | 영법 분석 | Growth Report 미래 요구 | 수영 동작 분석 자동화 | P2 |
| **PptxGenJS (npm)** | PPT 생성 | growth_reports.file_url 미구현 | 서버 측 생성 가능 | P2 |
| **pdf-lib / LibreOffice** | PDF 생성 | 없음 | 리포트 PDF 발송 | P2 |

---

## 19. External APIs NOT Worth Adding

| API | 이유 |
|---|---|
| Elasticsearch / Algolia | DB + nano로 충분; 인프라 복잡도 증가 |
| Translation API | 현재 한국 시장 단일; 불필요 |
| Geocoding | 수영장 검색이 현재 위치 기반이 아님 |
| Analytics 플랫폼 (Mixpanel 등) | event_logs 기반 자체 analytics 충분 |
| Error tracking (Sentry) | 현재 콘솔 로그 + DB audit으로 운영 중 |

---

## 20. Security / Data Isolation Constraints

AI 절대 적용 금지 영역 (현재 코드 확인):

1. **Tenant isolation** — pool_id는 JWT에서 추출, AI input/output으로 변경 불가
2. **Role authorization** — teacher/parent/admin 분기는 서버 미들웨어 전담
3. **Payment / billing key** — PortOne/Toss billing key는 DB에만 저장, prompt 불가
4. **DB write integrity** — AI 응답으로 직접 DB write 금지 (grounding validation 후만 허용)
5. **OTP/SMS** — 인증 코드는 deterministic random, AI 관여 불가
6. **PII in logs** — `diagnostics.ts:assertNoPiiInDiagnostics()` 로 phone/email/row dump 금지 (standby hotfix로 강화됨)
7. **Knowledge activation** — support knowledge 활성화는 human review 필수 (`knowledge-approval.ts`)
8. **Growth report publication** — teacher approve → pool admin publish 2단계 human gate 유지

---

## 21. Recommended Implementation Order

```
즉시 (이번 sprint):
  P0-4  trigger_type 필드 (Observability — 1일)
  P0-6  에스컬레이션 timeout (안정성 — 0.5일)
  P0-8  Whisper cost 계측 (Observability — 0.5일)
  P0-5  Growth Engine call count logging (Observability — 0.5일)
  P0-10 Growth worker retry 안전장치 (안정성 — 1일)

단기 (다음 sprint):
  P0-1  Support GPT → AiGateway 마이그레이션
  P0-2  Diary GPT → AiGateway + legacy ai.ts 정리
  P1-8  USD cost 표준화
  P1-4  SMS 비용 logging

중기:
  P0-3  Support query → nano pre-classification
  P0-7  Diary template → nano re-ranking
  P0-9  Support KI retrieval candidate set 제한
  P1-1  Story summary → nano
  P1-3  Curriculum intent → nano

장기 (P2):
  PPT/PDF 생성
  Video analysis
  STT for coach audio
  pgvector KI 검색
```

---

## P0 TOP 10 (우선순위 순)

| Rank | 항목 | 근거 |
|---|---|---|
| **1** | **에스컬레이션 route timeout 추가** | 현재 timeout 없음 → 무제한 OpenAI 대기 → 비용+안정성 위험 |
| **2** | **trigger_type (USER_ACTION/SYSTEM/BATCH) 필드 추가** | 비용 observability의 가장 빠른 개선 |
| **3** | **Growth worker retry 안전장치 강화** | 최대 6 Engine calls/report × 10/run = 비용 폭탄 가능성 |
| **4** | **Support GPT → AiGateway 마이그레이션** | retry/timeout 표준화, 5개 직접 호출 → 단일 경로 |
| **5** | **Diary GPT → AiGateway + legacy ai.ts 정리** | 이중 구현 제거, Whisper cost 계측 연동 |
| **6** | **Whisper cost 계측 (audio_seconds, USD)** | STT 비용이 현재 완전 불투명 |
| **7** | **Growth Engine call count proxy logging** | 외부 Engine 비용 유일한 proxy 지표 |
| **8** | **Support query → nano pre-classification** | regex 복잡도 최대 감소, 정확도 즉시 개선 |
| **9** | **Diary template → nano re-ranking** | 현재 lexical scoring 한계 — semantic으로 교체 시 품질 개선 |
| **10** | **Support KI retrieval → candidate set 제한 + nano rerank** | DB O(N) full scan 제거, KI 증가 대비 |

---

*보고서 완료. 코드 수정 없음, DB write 없음, 외부 API 호출 없음.*
