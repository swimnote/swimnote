---
name: PHASE 3 diary-hub 완료 상태
description: AI 일지피드 허브 구현 완료 상태, PRE-CHECK 결과, 배포 정보
---

# PHASE 3 완료 상태

## SHA
- commit: `cdf85657`
- branch: `deploy-photo-clone`
- OTA: iOS production `01a042dd` / update group `84cd660f`

## PRE-CHECK 결과 (확정)
- C1: class_diaries는 작성 시에만 생성 (B형) → 미작성 KPI 불가
- C2: ai_status 컬럼 없음 → AI KPI/필터 전면 제외 (MISSING)
- C3: GET /diaries/:id pool_admin 이미 허용; diary.tsx viewOnly=true 최소 수정
- C4: diary_reactions(reaction_type IN like/thanks) + diary_messages(diary_comment)
- C5: photo_assets_meta(journal_id, media_status=attached) ✅ FULL

## 구현 파일
- admin.ts: GET /admin/diaries/summary (requireXMode + pool isolation)
- diary-hub.tsx: 전체 구현 (KPI 2개, DATE INDEX, 검색, 필터, FlatList)
- DiaryEditView.tsx: viewOnly prop 추가 (저장 버튼 조건부 숨김)
- diary.tsx: viewOnly param 추가 (제목 "일지 보기")

## KPI (실제 데이터만)
- 오늘 일지 = class_diaries COUNT for date
- 학생 노트 = class_diary_student_notes COUNT for date

## MISSING
- AI 생성 KPI: ai_status 컬럼 없음 → 이번 PHASE 제외
- 미작성 KPI: common_content NOT NULL + 작성 시 생성 → 계산 불가

## Route path 버그 (수정 완료)
- admin.ts route를 `"/admin/diaries/summary"`로 등록 → index.ts가 `router.use("/admin", adminRouter)` 마운트이므로 이중 prefix 발생
- 올바른 path: `"/diaries/summary"` (admin.ts 내부)
- 수정 SHA: `69bf7c1d`

## Render 배포 상태
- `69bf7c1d` live (2026-08-27 11:26:40 UTC)
- dep-da81rqbbc2fs73chpt8g — LIVE ✅
- T27 PASS: `GET /api/admin/diaries/summary` → 401 JSON

**Why:** admin.ts는 index.ts에서 `/admin` prefix로 마운트됨. admin.ts 내부 route path에 `/admin` 중복 금지.
