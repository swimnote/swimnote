---
name: 2.0.0 3-Bug Patch 완료
description: 탈퇴 불가 / 선생님 홈 FAB 겹침 / Pool Isolation 테스트
---

# 2.0.0 Bug Patch — SHA b4716b90

## Bug 1: 학부모 회원 탈퇴 불가 (P0 FIXED)

**Root Cause**: `WithdrawalModal.tsx` → `handleConfirm()` 첫 줄 `if (!choice || loading) return;`
무료 플랜 UI는 choice 선택지가 없어 항상 null → 항상 early return → API 미호출

**Fix**: 무료 플랜 전용 `handleFreeConfirm()` 추가 — `if (loading) return;` 후 `onConfirm(true)` 직접 호출
유료 플랜 기존 로직(handleConfirm + choice 체크) 영향 없음.

## Bug 2: 선생님 홈 화면 마지막 항목 FAB에 가림 (FIXED)

**Root Cause**: `today-schedule.tsx` schedule ScrollView에 `contentContainerStyle` 없음
FAB(`position:absolute, bottom: insets.bottom+72`, 높이 ≈46px) 이 마지막 schedule 카드 가림.

**Fix**: `contentContainerStyle={{ paddingBottom: 100 }}` 추가

## Parent Home 배열 겹침

정적 코드 분석으로 명확한 overlap 원인 미발견.
- Stack `headerShown: false` ✓
- Root View flex:1 + 수동 insets 처리 ✓
- FlatList flex:1 + BottomBar 정상 flow ✓
- ItemSeparatorComponent height:120은 의도적 디자인
**기기 테스트 후 추가 조사 필요**

## Deploy

- SHA: b4716b90 → release/v2.0.0
- OTA iOS: 01a04e72 (branch release-2.0.0, group 4f255fd5)
- Render: 서버 변경 없음 → 재배포 불필요
- Tests: 13 TC (withdrawal-pool-isolation.test.ts) 전부 통과
