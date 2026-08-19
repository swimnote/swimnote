# WP-CS24 — Support Learning Loop & Knowledge Candidate Operations
**완료 날짜:** 2026-08-19  
**SHA:** 29f90acc  
**테스트:** 50 신규 TC / 3141 전체 TC 통과  

---

## 배경 / 왜 신규 테이블이 필요한가

기존 `flushSupportTrace()`는 `event_logs.metadata.stages` JSONB 배열로 저장.  
Candidate Engine에서 필요한 구조화 쿼리가 불가:
- `normalized_query`가 어디에도 저장 안 됨 (raw message 금지 원칙)
- `resolution_source` / `matched_knowledge_id`는 `stages[]` 내부 중첩 → 집계 불가
- `llm_called`, `human_requested` 필드 없음
- → **additive 신규 테이블** 2개 추가 (기존 event_logs 변경 없음)

---

## 구현 범위

### A. 마이그레이션 (2개)

| 파일 | 테이블 | 목적 |
|------|--------|------|
| `pool-db-cs-24a.ts` | `support_query_log` | normalized_query + resolution_source + match 정보 구조화 저장 |
| `pool-db-cs-24b.ts` | `support_knowledge_candidates` | PENDING 고정, AUTO_ACTIVATE 완전 금지 |

**안전 보장:**
- `support_knowledge_candidates.status`: CHECK(PENDING/APPROVED/REJECTED/MERGED) — DB 레벨 강제
- `support_query_log`: normalized_query만 저장, raw message/PII 금지

### B. Candidate Engine (`support-candidate-engine.ts`)

| 함수 | 역할 |
|------|------|
| `classifyQuery()` | DYNAMIC_DATA_REQUIRED / POLICY_REQUIRED / AMBIGUOUS / NORMAL 분류 |
| `logSupportQuery()` | Query Log 삽입 (fire-and-forget, best-effort) |
| `evaluateForCandidacy()` | LLM/NO_MATCH만 후보화 — DYNAMIC/POLICY 생성 금지 |
| `findExistingCandidate()` | exact match → stemmed token overlap ≥80% 그루핑 |
| `promoteUtteranceExtension()` | DYNAMIC/POLICY → 403, KI role 상속, utterance=active |
| `promoteNewCanonical()` | PII 검사 + KI status=**pending** (AUTO_ACTIVATE 불가) |
| `getLearningMetrics()` | 15개 운영 지표 집계 |

**AUTO_ACTIVATE 방지 레이어:**
1. Engine: `evaluateForCandidacy` → INSERT status='PENDING' 하드코딩
2. API: DYNAMIC/POLICY approve → 403
3. DB: `support_knowledge_candidates.status` CHECK constraint
4. Promote: `promoteNewCanonical` → KI status='pending' (CS16 governance 필요)

### C. API Routes (`support-learning.ts`) — super_admin / platform_admin 전용

```
GET  /super/support/knowledge-candidates         목록 (priority/recent/count 정렬)
GET  /super/support/knowledge-candidates/:id     상세 + recent_cases
POST /super/support/knowledge-candidates         Admin-created Candidate
PATCH .../approve-utterance                      utterance 추가 → status=MERGED
PATCH .../approve-canonical                      새 KI 생성 → status=APPROVED
PATCH .../reject                                 거부
PATCH .../merge                                  occurrence_count 합산 + src→MERGED
PATCH .../reclassify                             재분류
GET  /super/support/learning-metrics             15개 운영 지표
```

### D. Web UI (`SuperKnowledgeCandidates.tsx`)

- **4탭:** PENDING / APPROVED / REJECTED / MERGED
- **정렬:** priority(가중치 점수) / 최근 / 횟수
- **메트릭 패널:** 15개 지표 (direct_db_rate, gpt_fallback_rate 등)
- **다이얼로그:** Utterance 추가 / 신규 Canonical 생성(+PII 경고) / 거부(사유) / 병합(target_id)
- **분류 배지:** ⚠ Dynamic / ⚠ Policy → approve 버튼 숨김
- **슈퍼어드민 진입:** SuperLayout "Learning Loop" 메뉴 → `/super/knowledge-candidates`

### E. `support-respond.ts` 훅

결정론적 경로와 LLM 경로 양쪽에 fire-and-forget 훅 추가:
```typescript
// normalized_query만 저장 (raw message/PII 금지)
void logSupportQuery(cs24Entry).catch(() => {});
void evaluateForCandidacy(cs24Entry).catch(() => {});
```
- HTTP response latency 영향 없음 (await 없음)
- 오류 무시 — 절대 throw 없음

---

## 테스트 결과

| 범위 | TC 수 | 결과 |
|------|-------|------|
| CS24-01~05: classifyQuery | 5 | ✅ PASS |
| CS24-06~10: logSupportQuery | 5 | ✅ PASS |
| CS24-11~18: evaluateForCandidacy grouping | 8 | ✅ PASS |
| CS24-19~24: candidate type detection | 6 | ✅ PASS |
| CS24-25~28: DYNAMIC/POLICY approve 차단 | 4 | ✅ PASS |
| CS24-29~32: promoteUtteranceExtension | 4 | ✅ PASS |
| CS24-33~36: promoteNewCanonical | 4 | ✅ PASS |
| CS24-37~40: AUTO_ACTIVATE=0 검증 | 4 | ✅ PASS |
| CS24-41~46: Security (leakage=0) | 6 | ✅ PASS |
| CS24-47~50: getLearningMetrics | 4 | ✅ PASS |
| **신규 소계** | **50** | **50/50** |
| **전체 회귀** | **3141** | **3141/3141** |

---

## 운영 메트릭 정의 (getLearningMetrics 출력)

| 지표 | 의미 |
|------|------|
| `direct_db_rate` | Knowledge 직접 매칭 비율 (목표 ↑) |
| `gpt_fallback_rate` | GPT 폴백 비율 (목표 ↓) |
| `human_request_rate` | Human 에스컬레이션 비율 (목표 ↓) |
| `no_match_total` | 완전 미매칭 쿼리 수 (Candidate 우선순위 소스) |
| `candidates_created` | 생성된 Candidate 총 수 |
| `utterances_added` | 승인 완료 Utterance 추가 수 |
| `canonicals_added` | 승인 완료 (pending) Canonical 수 |

---

## 절대 원칙 (변경 불가)

1. **AUTO_ACTIVATE 금지** — Engine/API/DB/Promote 4중 차단
2. **DYNAMIC/POLICY 생성 금지** — Static Knowledge로 커버 불가
3. **PII 금지** — raw message 저장 금지, normalized_query만, answer PII 검사
4. **Role/Mode 확대 금지** — utterance는 KI role 상속만
5. **전체 승인 흐름** — PENDING → Human Review → APPROVED/MERGED (시스템 자동 없음)

---

## Render 배포 상태

- GitHub push: SHA 29f90acc ✓
- Render.com: push 트리거됨 → 자동 빌드/배포 진행 중
- CS24A/CS24B 마이그레이션: 서버 시작 시 자동 실행 (IF NOT EXISTS 패턴)
- OTA: 앱 코드 변경 없음 → 불필요

## 다음 단계 권장

1. **Production DB 마이그레이션** (Render 재배포 시 자동 실행)
2. **첫 실사용 데이터 수집** — support/respond 트래픽 발생 시 support_query_log 자동 적재
3. **Candidate 검토** — `/super/knowledge-candidates` 에서 PENDING 목록 확인 후 승인/거부
