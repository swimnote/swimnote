---
name: APP TypeScript Hotfix 완료
description: 21개 pre-existing TS errors → 0 수정 + iOS OTA 재배포 완료 상태
---

SHA 6ed60ce1; branch release/v2.0.0

## 수정된 파일 (10개)
1. hooks/useTabScrollReset.ts — generic <T extends Scrollable>로 전환 (KeyboardAwareScrollViewRef 호환)
2. app/(admin)/admin-revenue.tsx — useTabScrollReset<KeyboardAwareScrollViewRef>
3. app/(admin)/parents-list.tsx — StudentDetail에 parent_phone2/3/4 추가 (DB 실제 존재 컬럼)
4. app/(admin)/subscription.tsx — X_ENTITLEMENT import 추가; null-guard active[entitlementId]; productIdentifier→identifier (RC 9.7)
5. app/(auth)/kakao-link.tsx — isTeacherRole = role==="teacher"만 (admin early-return후 dead code 제거)
6. app/(parent)/additional-guardians.tsx — ParentScreenHeader에서 unsupported insets prop 제거
7. app/(parent)/growth-report-history.tsx — apiRequest().json() 추가 (Response→HistoryResponse 안전 변환)
8. app/(parent)/photos.tsx — useLocalSearchParams를 expo-router import에 추가
9. app/(teacher)/revenue.tsx — useTabScrollReset<KeyboardAwareScrollViewRef>
10. components/common/MessengerScreen.tsx — expo-file-system→legacy; handleDeleteMessage: number|string

## 핵심 발견
- RC 9.7 / purchases-typescript-internal@17.29: PurchasesStoreProduct.identifier (productIdentifier 제거됨)
- apiRequest()는 Response 반환 → 파싱 화면에서 .json() 필수
- expo-file-system v55: cacheDirectory/EncodingType는 /legacy import에만 존재
- useTabScrollReset 제네릭화로 ScrollView/KeyboardAwareScrollViewRef 양쪽 호환

## 결과
- pnpm run typecheck: 0 errors ✅
- WP7 gate: 602 PASSED / 0 FAILED / 3 SKIPPED ✅
- iOS OTA: Group 819d02f6 / Update 01a06c53 / production-v2 / 2.1.0
- Android: NOT PUBLISHED
- Render: NO / Production DB: NO
