---
name: Diary Template → Curriculum Materialization
description: diary_templates(scope=global, is_active=true)를 curriculum_items로 자동 sync하는 시스템 구조 및 핵심 결정사항
---

# Diary Template → Curriculum Materialization

## 결정된 설계

**Source of Truth:** diary_templates (scope='global', is_active=true)  
**Target:** curriculum_items (via diary-templates-v1 curriculum_version)  
**분리:** DOCX 기반 x-curriculum-v1과 별개 버전명으로 충돌 없음

**Why:** DOCX ingestion dependency 제거; 실제 교사 일지 화면과 동일한 데이터 소스 사용

## 핵심 컬럼 매핑
- curriculum_items.title = diary_template_levels.level_name (JOIN via level_id)
- curriculum_items.description = diary_templates.template_text
- curriculum_items.source_template_id = diary_templates.id (NEW 컬럼, super-db-init.ts에 ADD IF NOT EXISTS)

## migration
- `ALTER TABLE curriculum_items ADD COLUMN IF NOT EXISTS source_template_id text`
- `UNIQUE INDEX (swimming_pool_id, source_template_id) WHERE source_template_id IS NOT NULL`
- super-db-init.ts 끝 부분에 추가됨 (자동 startup 실행)

## DB 연결
- @workspace/db: `db`와 `superAdminDb`는 동일 연결(SUPABASE_DATABASE_URL) — 단일 Supabase DB
- diary_templates도 superAdminDb로 접근 가능

## Sync 트리거 (diary.ts)
- POST /diary-templates (scope=global만)
- PATCH /diary-templates/:id (isAdmin)
- DELETE /diary-templates/:id (admin + wasGlobal 확인 후)
- restore-default, clear-all
- 패턴: fireSyncInBackground(poolId) — fire-and-forget, .catch() 로그

## Pre-deploy corrections (2026-08-20, SHA 9e8ef38d)

### 수정 사항
1. **fireSyncInBackground 제거** — 모든 sync 호출 await으로 전환; 실패 → API 500 전파
2. **startup migration 제거** — super-db-init.ts에서 source_template_id DDL 제거
   → `artifacts/api-server/src/migrations/diary-template-sync-migration.ts` 독립 파일로 분리
3. **ON CONFLICT semantics 검증**:
   - curriculum_versions: `uniq_curriculum_versions_name (swimming_pool_id, version_name)` 존재 → ON CONFLICT 안전
   - curriculum_items: `WHERE source_template_id IS NOT NULL` 정확히 일치 필요
4. **uniq_curriculum_versions_one_active 처리**:
   - `ensureDiaryTemplateVersion`이 경쟁 active version을 먼저 deactivate 후 diary-templates-v1 활성화
5. **16TC**: TC-SYNC-14(throw 검증), TC-SYNC-15(deactivate competing), TC-SYNC-16(ON CONFLICT version_name)

### 현재 상태
- 16TC 전체 통과, TS clean
- Production DB write NO, Render deploy NO
- Toykids (pool_1780849364252_l9k44rbk3): backfill 별도 승인 후 진행
- 독립 migration 실행 순서: (1) diary-template-sync-migration.ts 실행, (2) Render 배포, (3) backfill

## How to apply
- 신규 X pool: restore-default 또는 template INSERT 시 자동 sync
- 수동 재sync: syncDiaryTemplatesToCurriculumItems(poolId) 직접 호출
- eligibility: active items >= 300 → eligible=true (기존 정책 유지)
