---
name: PHASE 4 curriculum-hub 완료 상태
description: AI 커리큘럼 허브 구현 완료 상태, PRE-CHECK 결과, 배포 정보
---

# PHASE 4 완료 상태

## SHA
- commit: `c1c74fc8`
- branch: `deploy-photo-clone`
- OTA: iOS production `01a04309` / update group `7c280629`
- Render: dep-da825itg1s2s73fpemo0 / live 11:48:00 UTC

## PRE-CHECK C1~C8 (블로커 없음)
- C1: curriculum_versions (swimming_pool_id, version_name, is_active) ✅
- C2: curriculum_items (curriculum_version_id FK, is_active) ✅
- C3: student_curriculum_assignments (student_id, curriculum_version_id, is_active, swimming_pool_id) ✅
- C4: growth_events (student_id, curriculum_item_id, created_at, is_invalidated) ✅
- C5: event_logs (category='AI', metadata->>'feature'='parent_curriculum_search', pool_id) ✅
- C6: global_template_sets (status='ACTIVE', version_name) ✅
- C7: diary_templates (global_template_set_id, scope='x_global') ✅
- C8: 현재 재원 = student_class_history.left_at IS NULL ✅

## 구현 파일
- admin.ts: GET /curriculum/summary + GET /curriculum/students
- curriculum-hub.tsx: 전체 구현

## 시스템 분리
- A. 교육 커리큘럼 (curriculum_versions→items→assignments→growth_events)
- B. X Global AI 일지 템플릿 (global_template_sets→diary_templates scope=x_global)
- 두 시스템 합산/JOIN 없음 — 별도 object로 분리

## migration
- 없음 — 기존 테이블 조회 전용

## Route path 규칙 (PHASE 3 버그 학습 반영)
- adminRouter는 index.ts에서 `/admin` prefix로 마운트됨
- admin.ts 내부 route는 `/curriculum/*` (NOT `/admin/curriculum/*`)
- production: `/api/admin/curriculum/summary`, `/api/admin/curriculum/students` ✅

**Why:** PHASE 3에서 이중 prefix 버그 발생. admin.ts 내부 route path에 /admin 중복 금지.
