---
name: P0/P1 X Gate Fix
description: P0/P1 release blocker fix — X mode client guards + server X entitlement guards
---

## SHA: 482a65f7

## Client Changes (iOS OTA 01a08504)
- `(parent)/growth-report-paid.tsx`: useMode + isXMode guard, BASE redirect back/home
- `(admin)/x-hub.tsx`: useMode guard, mode!=='x' → dashboard redirect  
- `(admin)/x-setup.tsx`: useMode + isXMode guard, x_pending allowed, BASE→settings redirect

## Server Changes (Render live)
- `parent-paid-insight.ts`: hasXEntitlement() on all 4 routes (questions/analysis/status/history)
- `x-setup.ts`: hasXEntitlement() on all 6 pool_admin routes (status/upload×4/submit/delete)

## hasXEntitlement() Pattern
```sql
SELECT (COALESCE(x_paid_entitlement,false) OR COALESCE(x_manual_entitlement,false) OR COALESCE(x_management_override,false)) AS has_x
FROM swimming_pools WHERE id = $poolId
```
Returns 403 XMODE_REQUIRED if false.

## Key Rules
- x-setup server: x_pending allowed (submit setup docs)
- x-hub client: mode==='x' only (operational KPI)  
- paid-insight: X entitlement required (no x_pending allowed)
- x-setup client: isXMode (x|x_pending) allowed

## False Positives (no fix)
- growth-report.tsx (BASE content), attendance.tsx (correct route already)
- x-mode-hub.tsx (intentional all-mode X purchase hub)
- notices.tsx AI (BASE-included, no policy gate defined)
- dashboard.tsx:591 x_pending badge (intentional)

## Deferred
- diary-hub.tsx → /(teacher)/diary viewOnly: no admin diary-view route exists; low security risk
