---
name: WP-X03 완료 상태
description: X Setup 자료 제출/슈퍼어드민 검토 기능 구현 완료 상태
---

## 결과

- SHA: 1636fbd1
- 브랜치: deploy-photo-clone
- TC: 1153 → 1190 (+37)
- Render: dep-da1175c9v7es73ac46n0 (build_in_progress → 완료 후 auto DB migration)
- iOS OTA production: 01a00c25-8633-76b5-a49a-88cc25e3f9b3 (iOS 01a00c25)
- iOS OTA preview: 1450138c
- Android OTA production: 1a562770 (Android 01a00c2a)
- Android OTA preview: ba341952

## 포함 내용

- DB: x_setup_submissions, x_setup_files, x_setup_revision_requests (3 tables, IF NOT EXISTS, startup auto-migration)
- Server: x-setup.ts (pool_admin + super_admin 라우트 전체)
  - GET /x-setup/status, /templates/:type/download
  - POST /x-setup/upload/{curriculum,website,logo,photo}
  - DELETE /x-setup/photos/:fileId
  - POST /x-setup/submit
  - GET /super/x-setup/:poolId, /files/:fileId/download
  - POST /super/x-setup/:poolId/revisions
  - PATCH /super/x-setup/:poolId/sections/:section/approve
- xSetupTemplates.ts: DOCX 양식 자동 생성 + R2 업로드 (idempotent)
- App: x-setup.tsx 완전 재작성 (3-section 업로드 UI)
- Web: PoolAdmin.tsx XSetupTab 컴포넌트 + "x-setup" 탭 (super_admin 전용)

## 주요 결정

- DOCX: docx@8.5.0 패키지 사용, curriculum + website 양식 2종
- 파일 버전: is_current=false(이전) + is_current=true(신규), 삭제 절대 금지
- 사진 최대 10장, MIME whitelist 서버 검증
- pool_id: 항상 userId→DB 조회, 요청 body에서 수신 금지
- 섹션 승인: curriculum+website 둘 다 APPROVED → overall APPROVED

## 미배포 현황

- Render 배포 진행 중 (dep-da1175c9v7es73ac46n0) → 완료 시 startup DB migration 자동 실행
- 수동 DB migration 불필요
