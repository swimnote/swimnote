---
name: WP7 완료 상태
description: Growth Event Persistence 구현 완료 상태 기록
---

## WP7 완료 상태

**SHA**: `16501ba7` (branch: `deploy-photo-clone`)

### 구현 요약

**서버 변경 (Render.com 배포 필요)**
- `lib/growth-event-service.ts` 신규 — `insertGrowthEvents()` 함수
  - match_token verify → curriculum_item_id 추출 → growth_events INSERT
  - `growth_match_status = 'PENDING_REVIEW'` 명시 (DB default AUTO_ACCEPTED 금지)
  - ON CONFLICT DO NOTHING (idempotency)
  - match_token 만료/오류 → skip + 로그 (diary TX 유지)
  - DB INSERT 오류(non-23505) → throw (TX 롤백)
- `routes/diary.ts` POST /diaries: curriculum_matches 파싱 + resolvePoolMode + TX 내부 insertGrowthEvents
- `routes/diary.ts` DELETE /diaries/:id: TX step4 추가 — growth_events soft-invalidation
- `routes/__tests__/wp7-growth-event.test.ts`: TC-A~J 10개 신규

**앱 변경 (OTA 배포 필요)**
- `DiaryAIService.ts`: `CurriculumMatch` 인터페이스 신규 + `NormalizedDiaryResult` / `DiaryInsertResult`에 `curriculumMatches?` 추가 + normalizeDiaryResponse curriculum_matches 파싱
- `useDiaryAIV2.ts`: `generatedCurriculumMatches` 상태 + handleInsert에서 포함
- `app/(teacher)/diary.tsx`: `aiCurriculumMatches` state + handleSave body에 `curriculum_matches` 포함

### 테스트 결과
- 전체: 234/234 통과 (9개 파일)
- WP7 신규 TC-A~J: 10/10 통과

### 배포 체크리스트
- [ ] Render.com 배포 (서버 변경)
- [ ] OTA 배포 (앱 변경)

### WP8 차단 조건
- Render.com 배포 완료 후 WP8 시작 가능
- WP8 auto-start 금지 (사용자 승인 후 시작)

**Why:**
- growth_match_status DB default AUTO_ACCEPTED 사용 금지 — match-token.ts WP7 주석 참조
- TX 내부에서 insertGrowthEvents 호출 → diary rollback 시 growth_event도 롤백
- 앱 curriculum_matches는 diary save 후 state 클리어 없음 (resetWriteSession에서만)
