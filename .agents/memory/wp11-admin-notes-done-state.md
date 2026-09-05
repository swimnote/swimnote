---
name: WP11 Admin Notes MVP Done State
description: WP11 완료 상태 — SHA, 파일 목록, migration 검증 결과, 핵심 결정사항
---

## SHA & Branch
- Branch: release/v2.0.0
- SHA: e2d4ac0f (HEAD)
- HEAD before: f3ffc9d2 (WP10)

## Files Changed (5)
- artifacts/api-server/src/migrations/wp11-admin-member-notes.ts (NEW)
- artifacts/api-server/src/routes/admin.ts (+269 lines — WP11 CRUD routes)
- artifacts/api-server/src/routes/__tests__/wp11-admin-notes.test.ts (NEW, 30TC)
- artifacts/swim-app/app/(admin)/member-detail.tsx (SectionG import + render)
- artifacts/swim-app/components/admin/member/SectionG_AdminNotes.tsx (NEW)

## Key Decisions
- Table: admin_member_notes (no existing equivalent found)
- Soft delete: deleted_at (consistent with students, diary notes convention)
- Content max: 3000 chars (server-side only, DB TEXT unconstrained)
- Pagination: parseLimit default=50 max=100 (reuses lib/pagination.ts)
- Author: always req.user.userId — body fields ignored
- FK author_user_id: TEXT (no REFERENCES, consistent with support_case_notes)
- Routes: GET/POST/PATCH/DELETE /admin/students/:id/notes[/:noteId]
- Audit: direct INSERT to audit_logs, entity_type='admin_member_note'
- UI: SectionG_AdminNotes in member-detail.tsx (between SectionF and SectionH)

## Migration
- Staging (lspmacdbyvpzysnrjsww): PASS (1st run + 2nd run idempotency)
- Production: NOT RUN

**Why:**
- admin_member_notes는 기존 동일 목적 테이블 없음 — 신규 생성 필수
