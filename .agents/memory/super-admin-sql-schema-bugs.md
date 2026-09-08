---
name: Super Admin Control Center SQL 스키마 불일치 패턴
description: super.ts control-center 라우트에서 발견된 실제 DB 스키마와 코드 불일치 목록. 향후 추가 라우트 작성 시 반드시 참고.
---

## 핵심 교훈

super.ts control-center 라우트는 가상의 컬럼명으로 작성됐었음. 향후 코드 작성 시 반드시 실제 DB 스키마 확인 필수.

## 실제 컬럼명 (수정 완료, 2026-09-09)

| 코드의 잘못된 참조 | 실제 DB 컬럼/테이블 | 비고 |
|---|---|---|
| `class_groups.teacher_id` | `class_groups.teacher_user_id` | 실제 FK 컬럼명 |
| `class_groups.active` | `NOT class_groups.is_deleted` | active 없음, is_deleted로 역전 |
| `class_group_students` (테이블) | 테이블 없음; `students.class_group_id` 직접 | student→class 조인은 students.class_group_id |
| `parent_students.parent_account_id` | `parent_students.parent_id` | FK 컬럼명 |
| `parent_accounts.approved_at` | 없음; `parent_accounts.is_active` (boolean) | 승인 여부는 is_active |
| `parent_accounts.last_login_at` | 없음 | login_at 계열 컬럼 없음 |
| `diary_entries` (테이블) | 없음; `class_diary_student_notes` (student별), `swim_diary` (pool별) | swim_diary에는 student_id 없음 |
| `ai_traces` (테이블) | 없음; `event_logs WHERE category='AI'` | AI 추적은 event_logs에 category로 |
| `pool_levels` (테이블) | 없음 | 레벨명 조회 불가 (제거) |

## audit_logs 제약조건

- `chk_audit_logs_action`: `action IN ('create','update','delete')` — 커스텀 액션명 금지
- `X_FORCE_DISABLE`, `X_FORCE_RESTORE` 등 → `'update'` 사용, before/after_data로 상세 구분

**Why:** super.ts control-center 라우트가 실제 DB 배포 전 설계서 기반으로 작성됐기 때문에 스키마 드리프트 발생.

**How to apply:** super.ts에 새 라우트 추가 시 psql로 실제 컬럼 확인 후 작성.
