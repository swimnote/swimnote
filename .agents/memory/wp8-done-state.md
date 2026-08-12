---
name: WP8 완료 상태
description: Growth Event Read API 구현 완료 상태 기록
---

## WP8 완료 상태

**SHA**: `8a9660d9` (branch: `deploy-photo-clone`)

### 구현 요약

**신규/수정 파일 (서버 전용, OTA 없음)**
- `lib/growth-event-service.ts` 수정:
  - `getStudentGrowthEvents(params)` — 학생별 growth_events 목록 조회
    - WHERE swimming_pool_id=poolId + is_invalidated=false 기본 필터
    - status/source/from/to 선택 필터
    - limit/offset pagination (기본 30, max 100)
    - curriculum_items LEFT JOIN (없어도 null 반환)
    - DB 오류 → throw (empty[]로 위장 없음)
  - `getGrowthEventById(params)` — 단건 조회
  - `GrowthEventRow` / `GrowthEventListResult` interface export
- `routes/x-growth.ts` 신규:
  - `GET /x-growth/students/:studentId/events` (목록)
  - `GET /x-growth/students/:studentId/events/:eventId` (단건)
  - requireAuth + requireXMode 미들웨어
  - pool 소속 학생 검증 (students.swimming_pool_id 직접 확인)
- `routes/index.ts` 수정: xGrowthRouter 등록
- `routes/__tests__/wp8-growth-read.test.ts` 신규: TC-A~J + 단건 3건 = 13개

### 테스트 결과
- 전체: 247/247 통과 (10 files)
- WP8 신규: 13/13 통과

### Response Contract
```typescript
// GET /x-growth/students/:studentId/events
{
  events: GrowthEventRow[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

interface GrowthEventRow {
  event_id, student_id, source, status, created_at,
  diary_note_id, curriculum_item_id, curriculum_version_id,
  match_token_id, confidence, is_invalidated,
  curriculum_title  // LEFT JOIN (nullable)
}
```

### Authorization
- requireXMode: pool X mode 확인 (non-X → 403)
- pool 소속 학생 검증: students WHERE id=studentId AND swimming_pool_id=poolId
- service 레이어: WHERE swimming_pool_id=poolId 이중 필터

### 배포 체크리스트
- [x] Render.com 배포 (서버 변경)
- [x] OTA 없음 (앱 변경 없음)

### WP7 PRODUCTION_REAL_WRITE_PENDING 유지
- NO_SAFE_TEST_CONTEXT 상태 유지
- 향후 실제 안전한 첫 데이터 발생 시 row 1건 read-back으로 닫음

**Why:**
- curriculum_items LEFT JOIN → 데이터 없어도 growth_event 조회 정상
- DB 오류를 empty[]로 위장 금지 (TC-I)
- WP9 성장판 앱에서 바로 사용 가능한 response contract
