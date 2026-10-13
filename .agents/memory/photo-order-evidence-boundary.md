---
name: 사진 순서 실기기 증거 경계
description: 사용자가 확인한 iOS picker 정상 결과와 사진 제보 provenance 조사 범위
---

2026-10-14 사용자는 실제 App Store iPhone의 임시 진단 화면에서 03→01→07→02→10→04→06→09→05→08 선택 순서와 picker result.assets 표시 순서가 정확히 같았다고 확인했다.

**Why:** 사용자는 이 실기기 확인과 앞선 forensic 결과를 근거로 iOS orderedSelection, picker 결과, client index, 압축, 정상 direct upload, upload_sort_order, DB/API/teacher 전체앨범 순서를 최종 PASS로 고정하고 재조사·수정을 금지했다. R2 병렬 완료도 제보 원인으로 사용하지 않는다.

**How to apply:** 이 사진 순서 제보의 후속 조사에서는 먼저 실제 문제 묶음의 생성경로와 범위를 특정한다. 정상 batch의 metadata만으로 사용자 제보 원인이나 화면 진입점을 확정하지 않는다. 새 반증 또는 사용자 지시 없이 이미 PASS인 구간을 반복 조사하거나 수정하지 않는다.
