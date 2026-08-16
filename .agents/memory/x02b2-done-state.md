---
name: X02-B2 완료 상태
description: Paid/Manual Entitlement Source Separation 구현 완료 정보
---

## X02-B2: Paid/Manual Entitlement Source Separation

**SHA:** b069e7b4  
**브랜치:** deploy-photo-clone  
**TC:** 1109/1109 pass  
**Render:** 재배포 트리거됨  
**Replit Publish:** 별도 필요

### 변경 파일
- `lib/xmode.ts`: `resolveEffectiveXEntitlement()` 신규; `resolvePoolMode()` → 3컬럼 사용
- `lib/x-entitlement.ts`: RC write path → `x_paid_entitlement` only; audit `source: "revenuecat_paid"`
- `routes/super.ts`: manual write → `x_manual_entitlement`; audit `source: "super_admin_manual"`; KPI/list SQL → effective formula
- `routes/pools.ts` WP3: effectiveEntitlement 계산; UPDATE guard SQL
- `jobs/growth-report-scheduler.ts`: `getXEligiblePools` effective formula WHERE

### Effective Formula
```
(COALESCE(x_paid_entitlement, false) OR COALESCE(x_manual_entitlement, false))
AND NOT COALESCE(x_force_disabled, false)
```

### 핵심 원칙
- paid 출처(RC) → `x_paid_entitlement` only 수정
- manual 출처(super admin) → `x_manual_entitlement` only 수정
- `xmode_entitlement` legacy 컬럼 DROP 금지; 읽기 compat 유지
- `PoolModeResult.xmode_entitlement` = effective 값 (backward compat 필드명 유지)
- effective 변경 시에만 audit_log 기록

### Collision Safety
- EXPIRATION + manual=true → effective=true 유지 (audit 없음)
- REFUND + paid=true/manual=true → manual=true이면 effective=true 유지
- force_disabled=true → 어떤 경우에도 effective=false override

### 다음 단계
- Replit Publish (swimnote.kr 업데이트)
- x_pending regression 운영 환경 검증
