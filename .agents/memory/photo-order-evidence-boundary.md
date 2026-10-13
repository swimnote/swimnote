---
name: 사진 순서 실기기 증거 경계
description: 사용자가 확인한 iOS picker 정상 결과와 사진 제보 provenance 조사 범위
---

2026-10-14 사용자는 실제 App Store iPhone의 임시 진단 화면에서 03→01→07→02→10→04→06→09→05→08 선택 순서와 picker result.assets 표시 순서가 정확히 같았다고 확인했다.

**Why:** 사용자는 이 실기기 확인과 앞선 forensic 결과를 근거로 iOS orderedSelection, picker 결과, client index, 압축, 정상 direct upload, upload_sort_order, DB/API/teacher 전체앨범 순서를 최종 PASS로 고정하고 재조사·수정을 금지했다. R2 병렬 완료도 제보 원인으로 사용하지 않는다.

**How to apply:** 이 사진 순서 제보의 후속 조사에서는 먼저 실제 문제 묶음의 생성경로와 범위를 특정한다. 정상 batch의 metadata만으로 사용자 제보 원인이나 화면 진입점을 확정하지 않는다. 새 반증 또는 사용자 지시 없이 이미 PASS인 구간을 반복 조사하거나 수정하지 않는다.

## 사진 선택 UX와 업로드 순서의 별도 경계

2026-10-14 사용자는 내부 앨범의 드래그 선택 개선을 요청하고, 짧은 탭은 선택/해제·즉시 세로 밀기는 일반 스크롤·잠깐 누른 뒤 이동은 연속 선택/해제라는 제스처 구분을 승인했다. 시스템 사진 picker 교체는 조사 결과를 먼저 보고한 뒤 별도 승인을 받아야 한다.

**Why:** 선택 편의 개선은 기존 사진 순서 보존 계약을 약화할 이유가 아니다. 사용자는 orderedSelection=false로의 단순 변경과 upload_sort_order·upload_batch_id·direct upload·DB 정렬 변경을 금지했다.

**How to apply:** 내부 선택 UX와 기기 사진첩 picker 교체를 별도 작업으로 취급한다. 기존 화면별 선택 제한과 저장/첨부 순서는 유지한다. 촬영시각 기준 라이브러리 표시 순서와 사용자의 선택 순서를 혼동하지 않는다.

## 기기 사진첩 교체의 네이티브 검증 경계

사진 라이브러리 모듈이 바이너리에 포함된 사실만으로 JS OTA 교체가 가능하다고 판정하지 않는다. 실제 배포 바이너리의 플랫폼별 읽기 권한 계약까지 먼저 확인한다.

**Why:** iOS의 모듈 컴파일·링크와 Android의 모듈 autolinking을 확인했어도, Android 빌드의 권한 제거 정책 때문에 앱 내부 사진첩 읽기는 별도 네이티브 변경이 필요했다. 모듈 존재와 읽기 권한 확보는 독립 조건이다.

**How to apply:** 새 picker 구현 전에 iOS와 Android를 각각 검증한다. native change가 필요하면 OTA 금지라는 사용자 지시를 준수하며, 권한 정책을 임의 변경하거나 한 플랫폼의 확인을 다른 플랫폼에 일반화하지 않는다.
