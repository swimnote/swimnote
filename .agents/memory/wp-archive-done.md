---
name: WP-A~H 퇴원생 Archive 완료
description: 퇴원생 Archive 기능 전체 구현 완료 상태 및 정책 요약
---

## 완료 상태

- DB migration: 3 tables (withdrawn_member_archives, withdrawn_diary_archives, withdrawn_archive_links) — Production Supabase 적용 완료
- API: archive.ts — 7개 엔드포인트 (GET/POST/DELETE /admin/archives*, /parent/archive-diaries)
- ARCHIVE_PHONE_HASH_SECRET: Replit Secret 설정 완료 (전용 96자 hex)
- archive-phone-hash.ts: HMAC-SHA256, raw phone 절대 저장 금지
- Render 배포: dep-dar9sp2d0e5s73c1ha9g (commit f689bc6f→8ddff1ff)
- iOS OTA: 01a0d95c / production-v2 / commit 8ddff1ff

## 핵심 정책 (영구 불변)

- Archive diary set = education_started_at 미적용, 반 history 전체, 결석 제외, 보강 포함
- Parent current feed / GR: education_started_at 기존 정책 유지 (변경 금지)
- Archive table은 auto-link/bulk-import/GR/curriculum flow에서 절대 조회 금지
- 재가입 시 자동 연결 금지 — pool_admin 수동 연결만
- Archive INSERT 실패 → throw → rollback → withdraw 취소
- force-delete 경로: Archive 범위 밖
- 기존 퇴원생 backfill 금지

**Why:** 퇴원생 데이터 단방향 snapshot + 개인정보 보호 (phone hash only)
**How to apply:** withdraw-student-service.ts의 [ARCHIVE] 블록이 canonical; 이 블록 변경 시 반드시 위 정책과 대조
