---
name: P0 X Pool-Wide Immediate Activation 완료
description: paid X 결제 → mode=x 즉시 (설정 완료 무관), X Setup 화면 재정의, sub_admin 지원 추가
---

## 완료 상태 (2026-08-16)

- SHA: fc087251
- Branch: deploy-photo-clone
- Render deploy: dep-da0mqi61egvs73942tng (build_in_progress → live)
- OTA production: 652e8c3d-3f73-49bc-bef8-11718c0109a9 (iOS 1.6.3)
- OTA preview:    25ac6b25-b4ac-49a6-a33e-1d9b4774c744 (iOS 1.6.3)
- Tests: 1153 passed (37 files)

## 핵심 정책 변경 (P0)

computeMode() 시그니처 변경:
- OLD: `computeMode(entitlement: boolean, configStatus: XModeStatus): PoolMode`
- NEW: `computeMode(pool: {x_paid_entitlement, x_manual_entitlement, x_force_disabled, xmode_config_status}): PoolMode`

P0 정책:
- `x_force_disabled = true` → normal (최우선)
- `x_paid_entitlement = true` → x (설정 완료 무관 — 결제 자체가 X 활성 조건)
- `x_manual_entitlement = true` → config READY이면 x, 아니면 x_pending
- 그 외 → normal

## 변경된 파일

**Server:**
- `lib/xmode.ts` — computeMode 시그니처 + 정책 변경, resolvePoolMode 호출 수정
- `routes/super.ts` — xmode_operators SQL + filter=xmode SQL + computeMode 호출 3곳
- `routes/pools.ts` — sub_admin 분기 추가 (GET /pools/x-mode)

**Analytics SQL (P0 rule):**
```sql
-- xmode_operators:
NOT COALESCE(x_force_disabled, false)
AND (COALESCE(x_paid_entitlement, false)
  OR (COALESCE(x_manual_entitlement, false) AND xmode_config_status = 'READY'))

-- filter=xmode:
NOT COALESCE(p.x_force_disabled, false)
AND (COALESCE(p.x_paid_entitlement, false)
  OR (COALESCE(p.x_manual_entitlement, false) AND p.xmode_config_status = 'READY'))
```

**Tests:**
- `super-xmode-kpi.test.ts` — A/B/C/D 섹션 전체 P0 기준으로 업데이트
- `x02c-billing-contract.test.ts` — MODE-1 paid+NOT_CONFIGURED→x (기존 x_pending → 변경)

**App:**
- `context/ModeContext.tsx` — sub_admin `_isSupportedRole` 추가
- `app/(admin)/x-subscription.tsx` — PendingView 카피("X 이용 시작") + ActiveView "X모드 세팅하기" CTA
- `app/(admin)/x-mode-hub.tsx` — mode=x 섹션에 "X모드 세팅하기" → x-setup CTA 추가
- `app/(admin)/settings.tsx` — mode=x+pool_admin에게 "X모드 세팅하기" 별도 행 추가
- `app/(admin)/x-setup.tsx` — dashboard redirect 제거; 타이틀="X모드 세팅하기"; READY state renderReady() 추가
- `app/(admin)/dashboard.tsx` — x_pending 카피: "X 커리큘럼 설정을 진행해주세요"
- `app/(parent)/home.tsx` — 성장 리포트 카드 + AI 기능 버튼 → x_pending도 노출

**Why:**
P0 spec: 결제 즉시 X 활성화 정책. Super Admin 승인 대기 제거.
Manual 경로는 기존 동작 유지(config READY 필요).

**How to apply:**
- computeMode 호출부 추가 시 반드시 pool 객체 전달 (bool 단독 사용 불가)
- analytics SQL 변경 시 위 P0 rule 패턴 사용
- x-setup은 이제 "X모드 세팅하기" 다목적 화면; READY/NOT_CONFIGURED/CURRICULUM_PENDING 3개 state 렌더링
