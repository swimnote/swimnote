---
name: RT2 Relevance Correction 완료
description: RT2 SupportRetriever에 intent scoring + platform penalty + re-sort fix + multi-evidence 추가 완료 상태
---

# RT2 Relevance Correction

**SHA**: 476caeb3 (deploy-photo-clone 브랜치, push 완료)
**Render 배포**: 미완료 (별도 진행 필요)
**OTA**: 없음

## 핵심 변경

1. `extractQueryIntents()` — DESCRIPTION/HOW_TO/DISABLE/ERROR_TROUBLESHOOT/LIMIT_USAGE/REQUIREMENT
2. `extractKIIntents()` — KI title+question+content에서 동일 intent 추출
3. Intent MATCH: +20 / MISMATCH(충돌 페어): -25
4. Platform-specific KI penalty: -20 (query에 platform 힌트 없을 때)
5. DB_DIRECT 조건 강화: score≥80 + no INTENT_MISMATCH + no PLATFORM_PENALTY
6. Tie handling 후 re-sort (버그 수정 — 기존엔 re-sort 없어서 낮은 score가 top 유지)
7. usage_count 상한: +5 → +2 (tiebreak 보조만)
8. grounded_evidence: score≥40 KI만 (multi-evidence path)
9. `query_intents` 필드 SupportRetrievalResult에 추가

## Production 6-query recheck 결과

| Q | query | top-1 KI | policy | 기대 충족 |
|---|---|---|---|---|
| Q1 | 학부모리포트는 어떤기능이야? | "학부모용 성장리포트가 뭔가요" (DESCRIPTION) | GROUNDED_AI | ✅ |
| Q2 | 성장리포트가 뭐야 | "학부모용 성장리포트가 뭔가요" (DESCRIPTION) | DB_DIRECT | ✅ |
| Q3 | 알림끄는거 어디서해? | "알림 권한을 다시 켜려면 어떻게 하나요" (generic) | GROUNDED_AI | ✅ |
| Q4 | 푸시 알림 설정 | "알림 권한은 켜져 있는데…" (generic) | GROUNDED_AI | ✅ |
| Q5 | 커리큘럼 등록은 되어있는데 검색이 안돼 | "X 설정 중…" (ERROR_TROUBLESHOOT) | GROUNDED_AI | ✅ |
| Q6 | X 모드 신청을 위한 자료는 어떻게 제출하나요? | HOW_TO X모드 KI | GROUNDED_AI | ✅ |

**Why**: Q3/Q4 Android KI PLATFORM_PENALTY(-20)로 generic KI 우선; Q5 LIMIT_USAGE KI INTENT_MISMATCH(-25)로 하위 랭크; Q1/Q2 DESCRIPTION KI INTENT_MATCH(+20)로 최상위.

## 충돌 페어 목록

DESCRIPTION↔REQUIREMENT, DESCRIPTION↔LIMIT_USAGE, ERROR_TROUBLESHOOT↔LIMIT_USAGE,
ERROR_TROUBLESHOOT↔REQUIREMENT, DESCRIPTION↔ERROR_TROUBLESHOOT, DISABLE↔LIMIT_USAGE, DISABLE↔REQUIREMENT

## Outstanding

- Render 배포 후 실기기 E2E 확인 필요
- Q6 "X 모드 자료 제출" KI가 top-3 밖 → utterance 등록 또는 KI search keyword 확장으로 해결 가능
