---
name: RT2 Semantic Slot Correction 완료
description: RT2 Round 3 — SemanticAction/Object extractors, opposite-action penalty, object-mismatch penalty, evidence eligibility rule
---

# RT2 Semantic Slot Correction (Round 3)

**Branch:** deploy-photo-clone  
**SHA:** 7d4d1320  
**Tests:** 51 TC (41→51, +10 신규)  
**Production 6-query recheck:** ALL GATES PASSED

## 핵심 구현

### Semantic Slots (`extractSlots(text)`)
- `SemanticAction`: ENABLE/DISABLE/SUBMIT/VIEW/SEARCH/REGISTER/DELETE/CREATE/LOGIN/PAY/DOWNLOAD/UPLOAD/EDIT/UNKNOWN
- `SemanticObject`: NOTIFICATION/CURRICULUM_SEARCH/GROWTH_REPORT/X_MODE/MATERIAL_SUBMISSION/APP_INSTALL/LOGIN/PHOTO/DIARY/SCHEDULE/SUBSCRIPTION/STUDENT/POOL/UNKNOWN
- DISABLE/ENABLE를 먼저 패턴 검사 (순서 중요 — ENABLE→DISABLE 혼동 방지)
- MATERIAL_SUBMISSION을 APP_INSTALL보다 먼저 (X_MODE 하위 카테고리 처리)

### Scoring 추가사항
- `OBJ_MATCH`: +25 / `OBJ_MISMATCH`: -25
- `OPP_ACTION` (ENABLE↔DISABLE, CREATE↔DELETE, REGISTER↔DELETE, SUBMIT↔DOWNLOAD): -35
- `ACT_MATCH`: +15
- `GENERIC_SETTINGS_ERR_PENALTY`: -20 (query에 오류 신호 없는데 KI가 troubleshoot)
- DB_DIRECT 금지 조건에 OPP_ACTION, OBJ_MISMATCH 추가

### Evidence Eligibility Rule
- OPP_ACTION → 항상 제외 (반대 행동은 오해 유발)
- OBJ_MISMATCH + no ACT_MATCH → 제외
- OBJ_MISMATCH + ACT_MATCH 있음 → **허용** (행동 일치 시 객체 서브카테고리 차이 허용)

**Why:** Q6 "X 모드 자료 제출" 쿼리에서 query_object=X_MODE, KI_object=MATERIAL_SUBMISSION → OBJ_MISMATCH 태그 붙지만 ACT_MATCH(SUBMIT)이 있으므로 evidence 포함

### 한계/잔여 이슈
1. Q3 DISABLE 알림: DB에 DISABLE-intent 알림 KI 없음 → GROUNDED_AI policy; 새 KI 추가 필요
2. Q6 query_object: "x 모드"가 먼저 감지되어 X_MODE; MATERIAL_SUBMISSION은 sub-object; 계층 모델 미구현

## Production Recheck 결과 (6-query)
| Query | Top-1 KI | Score | Policy | Gate |
|---|---|---|---|---|
| Q1 학부모리포트 설명 | 학부모용 성장리포트가 뭔가요 | 95 | DB_DIRECT | ✅ |
| Q2 성장리포트 뭐야 | 학부모용 성장리포트가 뭔가요 | 100 | DB_DIRECT | ✅ |
| Q3 알림끄는거 어디서 | 어떤 경우에 알림이 오나요? | 75 | GROUNDED_AI | ✅ (ENABLE 아님) |
| Q4 푸시 알림 설정 | 어떤 경우에 알림이 오나요? | 85 | DB_DIRECT | ✅ (ERROR_TROUBLESHOOT 아님) |
| Q5 커리큘럼 검색 안돼 | X 설정 중에는 AI 커리큘럼 사용 불가 | 95 | DB_DIRECT | ✅ |
| Q6 X 모드 자료 제출 | X 모드 자료 제출 방법 | 100 | GROUNDED_AI | ✅ (APP_INSTALL 아님) |
