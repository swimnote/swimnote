---
name: A4 Modal/Alert/Sheet Cleanup 완료
description: A4 — 전체 앱 Modal/Sheet/Alert 전수 감사 + BATCH 2-6 수정. 공통 primitive 개선 + 18개 파일 statusBarTranslucent/onRequestClose/safe area 통일.
---

## 완료 상태

- SHA: a7c8b046
- OTA production: 524ebd4d · OTA preview: a2485ed8
- 수정 파일: 18개

## BATCH 1 — 전수 감사 결과 (주요 발견)

### 기존 공통 Primitives (변경 기반)
| 컴포넌트 | 파일 | 역할 | 상태 |
|---|---|---|---|
| ConfirmModal | components/common/ConfirmModal.tsx | 범용 center 확인 다이얼로그 | ✅ 주요 개선 |
| ModalSheet | components/common/ModalSheet.tsx | 75% 높이 바텀시트+드래그 | ✅ 개선 |
| SubSheetModal | components/common/SubSheetModal.tsx | 서브 바텀시트 | NO CHANGE (이미 양호) |
| WithdrawalModal | components/common/WithdrawalModal.tsx | 탈퇴 확인 | ✅ 버그 수정+개선 |
| MemberStatusChangeModal | components/common/MemberStatusChangeModal.tsx | 학생 상태 변경 | ✅ statusBarTranslucent 추가 |
| ReadOnlyModal | components/common/ReadOnlyModal.tsx | 쓰기 차단 안내 | NO CHANGE (이미 statusBarTranslucent) |

## BATCH 2 — Shared Primitives 수정

### ConfirmModal
- **title** `fontFamily: "Pretendard-Regular"` → `"Pretendard-SemiBold"` (제목 계층 강화)
- **confirmText** → `fontFamily: "Pretendard-Medium"` 추가 (primary 버튼 강조)
- **double-tap guard**: `useRef<boolean>` + `useEffect(!visible → reset)` 패턴 적용. `onPress={handleConfirm}` 로 모든 confirm 탭 단일 진입점.
- **disableBackdropDismiss?: boolean** prop 추가: destructive confirm에서 실수 방지.
- `onPress={loading ? undefined : onConfirm}` → `disabled={loading}` + guard ref로 교체.

### ModalSheet
- header `borderBottomWidth: 1, borderBottomColor: "#FFFFFF"` 제거 (흰색 위 흰색 border — 완전 무의미)
- closeBtn `backgroundColor: "#FFFFFF"` 제거 (흰색 시트 위 흰색 bg — 무의미)

### WithdrawalModal
- **버그 수정**: 무료 플랜 confirm 버튼 `onPress={() => { onClose(); onConfirm(true).catch(()=>{}) }}` → `onPress={handleConfirm}` (유료 플랜과 일관성)
- `statusBarTranslucent` 양쪽 Modal 인스턴스 추가
- `useSafeAreaInsets` 추가 → sheet `paddingBottom: Math.max(insets.bottom, BASE_SHEET_PADDING_BOTTOM)` 인라인 적용

## BATCH 3 — Admin 인라인 모달

| 파일 | 수정 내용 |
|---|---|
| `(admin)/diary-teacher-entries.tsx` | +statusBarTranslucent +onRequestClose |
| `(admin)/diary-write.tsx` | +statusBarTranslucent +onRequestClose |
| `(admin)/data-storage-by-account.tsx` | +statusBarTranslucent |
| `(admin)/feedback-settings.tsx` ×3 | +statusBarTranslucent |

## BATCH 4 — Teacher 모달

| 파일 | 수정 내용 |
|---|---|
| `(teacher)/makeups.tsx` diagVisible | +statusBarTranslucent |
| `(teacher)/my-schedule.tsx` showMoveSheet | +statusBarTranslucent |
| `(teacher)/students.tsx` inline sheet | +statusBarTranslucent |
| `(teacher)/photos.tsx` lightbox | +statusBarTranslucent |
| `(teacher)/student-detail.tsx` phone edit/delete ×2 | +statusBarTranslucent |

## BATCH 5 — Parent 모달

| 파일 | 수정 내용 |
|---|---|
| `(parent)/photos.tsx` lightbox | +statusBarTranslucent |
| `(parent)/photos.tsx` videoDetail | +statusBarTranslucent |

## BATCH 6 — Super Admin 모달

| 파일 | 수정 내용 |
|---|---|
| `(super)/ads.tsx` create | +statusBarTranslucent +onRequestClose |
| `(super)/ads.tsx` deleteConfirm | +statusBarTranslucent +onRequestClose |
| `(super)/notices.tsx` create | +statusBarTranslucent +onRequestClose |
| `(super)/notices.tsx` deleteConfirm | +statusBarTranslucent +onRequestClose |
| `(super)/pools.tsx` bulkModal | +statusBarTranslucent |
| `MemberStatusChangeModal` | +statusBarTranslucent |

## 변경하지 않은 항목 (의도적 NO CHANGE)

- backup.tsx 4개 모달 — SafeAreaView 풀스크린 설계 (transparent 필요 없음)
- security-settings, operator-detail, feature-flags, kill-switch, policy, pool-notices — 이미 statusBarTranslucent 존재
- parent/home.tsx media viewer — 이미 statusBarTranslucent 존재
- teacher/makeups.tsx 3개 대형 모달 — 이미 statusBarTranslucent 존재
- AlbumPickerModal — 풀스크린 slide (transparent 불필요)
- Alert.alert 사용처 — 단순 시스템 alert로 적절, custom 전환 불필요

## 다음 단계

A5 (지정 시) 시작 가능
