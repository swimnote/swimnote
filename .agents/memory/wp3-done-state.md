---
name: WP3 완료 상태
description: APP 구독 UI / X Trial UX / Storage / DATA Pack 안내 — 코드 전용 WP
---

# WP3 완료

**SHA**: 75431ceb  
**Branch**: release/v2.0.0  
**TC**: 80TC 신규 (wp3-subscription-ui.test.ts)  
**Render**: 미배포  
**OTA**: 없음  
**EAS**: 없음

## 변경 파일

### subscription.tsx (전면 리팩터)
- 2.0 플랜 섹션: SWIMNOTE + X300/X500/X1000
- Trial CTA (mode=normal, !x_trial_active, !x_trial_used, !isLegacySubscriber)
- Trial Active (mode=x_trial): 남은 시간 표시
- Trial 사용 완료 (x_trial_used && !x_trial_active): 체험 사용 완료 안내
- x_pending: "SWIMNOTE X 활성화 완료 / 센터 맞춤 세팅 준비 중"
- x_active: 현재 플랜 표시
- StorageWidget: usedMb/limitMb → 사용량 바 + 80/90/100% 경고 메시지
- DATA100/DATA300 disabled 카드 (WP4 연결 전 "준비 중")
- Legacy Coach/Premier: 기존 구독자만 현재 플랜 상태 표시, 신규 판매 CTA 없음
- POST /billing/x-trial-activate + 5개 오류 코드 한국어 처리

### x-subscription.tsx
- PurchasePhase += "X_TRIAL_ACTIVE"
- mode === "x_trial" → setPhase("X_TRIAL_ACTIVE")
- TrialActiveView 컴포넌트: 체험 중 카드 + X 정식 구독 CTA

### subscriptionPlans.ts (헬퍼 추가)
- `formatMemberLimit(max_members)`: 999999+ → "무제한"
- `isLegacyTier(tier)`: Coach/Premier legacy 판별
- `storageWarningLevel(usedMb, limitMb)`: normal/warning/critical/full
- `recommendXPlanTier(activeMembers)`: x300/x500/x1000/enterprise
- `DATA_PACKS`: data100(+100GB/₩7,900) + data300(+300GB/₩22,900)
- `NEW_X_PLANS`, `NEW_2_PLANS` 상수

## 정책 결정
- XModeGuard trialAllowed: 모든 growth 화면 false (trial 수영장=AI ENGINE 없음)
- SWIMNOTE WP4 연결 전: 구매 CTA "준비 중" disabled
- X 플랜 구독 → x-subscription 화면으로 라우팅 (기존 흐름 유지)
- active_member_count: PoolInfo 타입 미확장으로 주석 처리 (확장 시 활성화)

**Why**: WP4 연결 전이므로 실제 구매 연결 없음; UI/상태만 구현
