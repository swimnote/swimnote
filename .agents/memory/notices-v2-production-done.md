---
name: 공지사항 V2 Production 배포 완료
description: notices V2 (미리보기 workflow, onShow seen, eligibility 검증) Production 배포 상태
---

## 배포 완료 상태 (2026-09-29)

**source commit:** 3d4e5dfa (+ asset-only efee291e = HEAD)

**DB:** notices.link_label text DEFAULT NULL — Supabase production 적용 완료

**API:** Render swimnote-api LIVE — efee291e — GET /notices/pending + POST /notices/:id/seen 포함

**iOS OTA:**
- Update ID: 01a0e95c-22eb-71e4-b118-c56166940203
- Group ID: cabf504e-edda-4f23-b134-0a70b7d3dec9
- branch: production-v2 / runtimeVersion: 2.2.0

**Android OTA:**
- Update ID: 01a0e95c-a6b5-7db1-a9ce-ccc40f5246af
- Group ID: e5324f18-8b2c-4af5-96c1-07301b111f8a
- branch: production-v2 / runtimeVersion: 2.2.0

## 핵심 변경 내역

- GET /notices/pending: role+pool+starts_at+seen 필터, LIMIT 1
- POST /notices/:id/seen: eligibility 검증 (status/starts_at/ends_at/target_roles/pool)
- NoticePopupCard: 공유 presentation 컴포넌트
- NoticePopup: Modal onShow 기반 seen, seenFiredRef 중복 방지
- (super)/notices: 작성→미리보기→수정→등록 workflow, submittingRef 중복 등록 방지
