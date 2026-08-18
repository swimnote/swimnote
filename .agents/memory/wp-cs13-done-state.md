---
name: WP-CS13 완료 상태
description: Role/Mode/Scope Integrity Audit — P1 mode trust 수정 + P2 isSuperAdmin 일관성 수정
---

## WP-CS13: Role / Mode / Scope Integrity Audit

**SHA:** (아래 commit 후 확인)  
**완료일:** 2026-08-18

### 수정 파일
- `artifacts/api-server/src/routes/support-cases.ts` — P1: resolvePoolMode import + resolvedMode
- `artifacts/api-server/src/routes/support-respond.ts` — P1: resolvePoolMode + resolvedMode; P2: isSuperAdmin platform_admin 추가
- `artifacts/api-server/src/routes/__tests__/cs13-integrity.test.ts` — CS13 80TC (01~73 + AUDIT-SUMMARY)

### 발견 및 수정

**P1 (FIXED): MODE_TRUST_CLIENT_ONLY**
- 원인: `support-cases.ts` / `support-respond.ts` 모두 client body `mode`를 DB 검증 없이 사용
- 위험: NORMAL 풀 사용자가 `mode: "x"` 위조 → X 전용 Knowledge 노출
- 수정: `resolvePoolMode(poolId)` 호출 후 `resolvedMode`로 덮어씀; super/platform_admin 제외; non-fatal(DB 실패 시 client mode fallback)
- 위치: `support-cases.ts:60-74`, `support-respond.ts:273-287(추가됨)`

**P2 (FIXED): isSuperAdmin platform_admin 불일치**
- 원인: `support-respond.ts:181`에서 `isSuperAdmin = role === "super_admin"` — platform_admin 누락
- `support-cases.ts:46-48`는 두 role 모두 포함해 불일치
- 수정: `isSuperAdmin = role === "super_admin" || role === "platform_admin"`

**REVIEW_REQUIRED (P3 — 코드 변경 없음):**
- legacy `POST /support/tickets/:id/replies`: submitter_user_id 체크하나 pool_id 미명시 체크
- student_id in RouterContext: NOT_IMPLEMENTED (safe by absence; CS15+ scope)

### 감사 결과 (목표: 전부 0)
```
ROLE_LEAKAGE:              0
MODE_LEAKAGE:              0
POOL_LEAKAGE:              0
STUDENT_LEAKAGE:           0 (safe by absence)
PENDING_KNOWLEDGE_LEAKAGE: 0
CASE_IDOR:                 0
INVALID_DEEPLINK_ALLOWED:  0
```

### Authoritative Context 표
| 필드 | Source | CS13 결과 |
|---|---|---|
| role | JWT req.user.role | PASS |
| pool_id | JWT req.user.poolId | PASS |
| mode | DB resolvePoolMode() | FIXED (P1) |
| student_id | Not in RouterContext | SAFE-BY-ABSENCE |
| subscription | DB (not client claim) | PASS |

### 테스트
- CS13: 80 / 80 PASS (UNIT/MOCK, production DB 없음)
- 전체: 2226 / 2226 PASS

### 배포/OTA
- Render 재배포: 트리거됨 (support-cases.ts, support-respond.ts 변경 — 보안 fix)
- OTA: 불필요 (서버 전용 변경)
- Production DB write: 0

### 중요 패턴
- `resolvePoolMode()` import는 `../lib/xmode.js` (not xmode.ts)
- non-fatal 패턴: try/catch with client mode fallback prevents service outage
- pool 없는 super_admin은 client mode 신뢰 (poolId === null 체크로 분기)
