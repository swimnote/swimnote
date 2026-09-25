---
name: 회원 엑셀 일괄등록 1,000명 안정화
description: bulk import 정책 복원 + APP/WEB canonical API 통합 + ALL-OR-NOTHING 완료 상태
---

## 완료 상태 (2026-09-25)

**Git SHA:** 4699183a  
**Render LIVE 대상:** dep-dar744p42hec73d8betg (update_in_progress → live 예정)  
**APP OTA:** iOS production-v2 01a0d8b0 (runtimeVersion 2.2.0)

## 최종 정책

- 필수 2개: 이름 + 보호자 연락처
- BLOCKING: 이름 없음 / 연락처 없음·불량 / 1001명 초과
- WARNING (등록 허용): 반 이름 미발견(미배정 등록), 중복 의심
- ALL-OR-NOTHING: blocking error 0건일 때만 전체 등록

## 엔드포인트

- `POST /admin/members/bulk/validate` — 검증 (N+1 없음, 1 query class + 1 query existing)
- `POST /admin/members/bulk/commit` — 등록 (250-chunk INSERT, 단일 tx, 학부모 사전조회)
- 응답: `{ total, valid, blocking_error_count, warning_count, errors[], warnings[], rows[] }`
- `/students/batch` 삭제 금지 (구버전 호환)

## APP step flow

pick → preview → validating → validated → committing → done

**Why:** 기존 /students/batch + partial success 방식 → 정책 불일치. canonical API로 통합.

**How to apply:** APP에서 API 변경 시 handleValidate/handleCommit 패턴 유지; parseRows에 `_row` 포함 필수.
