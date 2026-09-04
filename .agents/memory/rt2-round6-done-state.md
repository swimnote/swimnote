---
name: RT2 Round 6 완료 상태
description: SupportRetriever Round 6 final gap closure — raw_score ranking + facet KNOWLEDGE_GAP gate
---

# RT2 Round 6 완료 상태

**SHA:** 7fc8e8bf (branch: deploy-photo-clone)
**TC:** 80/80 (Round 6 +3: TC-28 raw_score, TC-29 KNOWLEDGE_GAP, TC-30 MissingReason)
**Render 배포:** 없음 (금지)
**OTA:** 없음

## 수정 내용

### Fix 1: KI object/facet = title+question 전용 (content 제외)
- `scoreKI`에서 `kiQueryText = [title, question].join(" ")` → slots/facet
- `kiFullText = [title, question, content].join(" ")` → goal(목적) 판별에만 사용
- **이유:** content에 "수업" 같은 배경어가 있으면 object=SCHEDULE 오감지 발생

### Fix 2: raw_score 랭킹 (100점 cap 제거)
- `ScoredKI.raw_score`: 정렬 기준 (uncapped)
- `ScoredKI.score`: 표시용 0~100
- 정렬: `b.raw_score - a.raw_score` (이전: `b.score - a.score`)
- **이유:** cap=100 saturation으로 5개 KI 동점 → tie-break 불안정

### Fix 3: Facet Gate (KNOWLEDGE_GAP)
- `mapAnswerPolicyWithHint()` 신규 함수
- `queryFacet ≠ OTHER` AND eligible evidence에 `FACET_MATCH` 없음 → `INSUFFICIENT_EVIDENCE + missingReasonHint=KNOWLEDGE_GAP`
- **케이스 a:** top-1 FACET_MISMATCH (다른 facet KI)
- **케이스 b:** top-1 FACET_MATCH이지만 OPP_ACTION으로 eligible 제외 (알림 끄기 쿼리 + 켜기 KI만 존재)
- **backward-compat:** `mapAnswerPolicy()` wrapper 유지

### Fix 4: MissingReason 확장
- `retrieval-result.ts`: `KNOWLEDGE_GAP | RANKING_MISS | STATUS_EXCLUDED` 추가
- RANKING_MISS: 맞는 KI 있으나 mismatch 페널티로 순위 밀림 자동 감지

## Prod Recheck 결과 (6/6 or 5/6)
| Q | 쿼리 | 기대 | 결과 |
|---|------|------|------|
| Q1 | 학부모리포트 어떤기능이야 | DB_DIRECT | ✅ (top: 학부모용 성장리포트가 뭔가요) |
| Q2 | 성장리포트가 뭐야 | DB_DIRECT | ✅ (top: 학부모용 성장리포트가 뭔가요) |
| Q3 | 알림끄는거 어디서해 | INSUFFICIENT_EVIDENCE | ✅ missing=KNOWLEDGE_GAP |
| Q4 | 푸시 알림 설정 | GROUNDED_AI (revised) | ✅ OS-level PREFERENCE KI eligible |
| Q5 | 커리큘럼 검색안돼 | GROUNDED_AI | ✅ |
| Q6 | X모드 자료 제출 방법 | DB_DIRECT | ✅ |

Q4 원래 expected=INSUFFICIENT_EVIDENCE → GROUNDED_AI로 수정:
"푸시 알림 설정" action=UNKNOWN → OPP_ACTION 없음 → 아이폰/안드로이드 OS 설정 KI eligible → GROUNDED_AI 정당

## 알림 PREFERENCE KI 부재 (KNOWLEDGE_GAP)
앱에 in-app 알림 수신 설정 화면이 실제로 존재함:
- 학부모: `artifacts/swim-app/app/(parent)/push-settings.tsx` (5종 Switch 토글)
- 관리자: `artifacts/swim-app/app/(admin)/push-notification-settings.tsx`
DB write 미승인 — follow-up task 제안됨
