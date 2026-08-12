---
name: WP9 완료 상태
description: Growth Board App UI 구현 완료 상태 기록
---

## WP9 완료 상태

**SHA**: `1a5089df` (branch: `deploy-photo-clone`)

### 기존 x-growth UI 상태 (WP4 placeholder)
- admin/teacher/parent 모두 "기능 준비 중" 화면
- XModeGuard 적용돼 있었음
- parent는 WP9에서 contract 없으므로 그대로 유지

### 구현 내용

**신규/수정 파일 (앱만, 서버 변경 없음)**

| 파일 | 역할 |
|---|---|
| `hooks/useGrowthEvents.ts` | WP8 API 클라이언트 hook (pagination, filter, error/empty 분리) |
| `components/x/GrowthEventCard.tsx` | 이벤트 카드 (status badge, source chip, curriculum_title, confidence) |
| `components/x/GrowthEventDetail.tsx` | 상세 모달 (GET .../events/:eventId, loading/error/success) |
| `app/(admin)/x-growth.tsx` | placeholder → 성장판 화면 (pool_admin) |
| `app/(teacher)/x-growth.tsx` | placeholder → 성장판 화면 (teacher) |

### 핵심 설계 결정

- **error ≠ empty 구분**: loadState="error" → retry UI / loadState="success"+[] → empty UI
- **학생 전환 즉시 초기화**: useEffect dependency [studentId] → 이전 데이터 즉시 제거
- **event_id dedup**: loadMore 시 Set 기반 중복 방지
- **학생 목록**: 기존 `/students` API 재사용 (새 DB 조회 없음)
- **READ ONLY**: 승인/거절/write 없음

### XModeGuard 유지
- admin: `allowedKind="admin" allowedRole="pool_admin"`
- teacher: `allowedKind="admin" allowedRole="teacher"`
- 기존 Lock UI (no_entitlement / not_configured / curriculum_pending / api_error) 그대로 동작

### OTA 배포

| 항목 | 값 |
|---|---|
| Update group ID (production) | `7eea4745-b6c6-4551-a733-8a734f516a90` |
| iOS update ID (production) | `019ff70a-caff-734f-8a4f-2ec8aff56dbc` |
| Update group ID (preview) | `f1bccebb-8f2a-4436-9a38-7cb41ac091b2` |
| iOS update ID (preview) | `019ff70b-07f8-79a5-b78b-c7668406616f` |
| runtimeVersion | `1.6.2` |
| Platform | iOS only |
| Server 재배포 | 없음 |

### TypeScript
- `tsc --noEmit --skipLibCheck` → 오류 없음

**Why:**
- XModeGuard 기존 구현 재사용 → WP5 Gate 동작 보장
- GrowthEvent type은 WP8 response contract와 1:1 매핑
- useGrowthEvents seq 카운터 → 학생 전환 시 stale 응답 자동 무시
