---
name: 시범사업 X 수동 부여 정책
description: SUPERADMIN 직접 수동 X 부여의 pre-curriculum 예외와 일반 경로 분리
---

시범사업 수영장도 기존 수동 X 사용권 경로를 사용한다. 2026-10-13 정책 변경으로 가입 → SUPERADMIN 직접 X 플랜 선택·수동 부여 → X 모드 진입 → 이후 Local Curriculum 등록이 허용된다. management override로 대체하거나 RevenueCat 결제 상태를 위조하지 않는다.

**Why:** 사용자는 신규 수영장이 X 화면에서 커리큘럼을 나중에 등록할 수 있도록 SUPERADMIN 직접 수동 부여에만 예외를 명시했다. 이전의 커리큘럼 선행 정책은 이 경로에 한해서 폐기되었다.

**How to apply:** 일반 가입·결제·자동 entitlement의 prerequisite는 유지한다. 사용권과 실제 curriculum readiness를 구분하며 커리큘럼이 없으면 준비 완료를 위조하지 않는다. 데이터가 필요한 AI 기능의 안전한 empty/not-ready 처리를 유지한다. Pre-curriculum 수동 부여는 즉시 Growth Report 보충을 보류하며 기존 월간 evidence 정책을 변경하지 않는다.
