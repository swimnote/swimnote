---
name: WP11 완료 상태
description: WP11 Background Worker (job_queue + reservation expiry) + 격리 fix 완료
---

## WP11 — Background Worker ✅ CLOSED

### SHA / Deploy 현황

| 서비스 | SHA | Deploy ID | 상태 |
|---|---|---|---|
| API (swimnote-api) | `09b7126a` | `dep-d9uc11ujsl0c73845o2g` | live ✅ |
| Worker (swimnote-worker) | `09b7126a` | `dep-d9ucbc942hec73f1v1d0` | live ✅ |

- Branch: `deploy-photo-clone`
- Worker Render SVC ID: `srv-d9uc5hnlk1mc73efmnu0`
- API Render SVC ID: `srv-d7bn4gogjchc73dp1ci0`

### 구현 파일

| 파일 | 내용 |
|---|---|
| `jobs/queue-worker.ts` (신규) | `runRetryQueue()` + `runMakeupExpiry()` + `startQueueWorker()` |
| `index.ts` (수정) | WORKER_MODE=true 블록에만 `startQueueWorker()` 등록; API mode 제거 |
| `routes/__tests__/wp11-queue-worker.test.ts` | 17 TC (WORKER_MODE 격리 4개 포함) |

### 설계 결정

- **job_queue = event_retry_queue**: processRetryQueue() 5분 주기
- **reservation = makeup_sessions**: expire_at 기준 1시간 주기, LIMIT 50 서브쿼리 IN
- **Pending 48h**: 이번 WP11에서 제외
- **API mode 격리**: startQueueWorker() API mode 완전 제거 → API는 HTTP/API 역할만
- **Worker mode**: WORKER_MODE=true 환경변수로 스케줄러 전용 실행
- **acquireLock**: scheduler_locks 테이블 기반, DB init에서 자동 생성됨

### Render Background Worker 빌드 문제 & 해결

- `npm install -g pnpm@10` → background_worker 환경에서 global install 실패
- 해결: `npx pnpm@10 install --no-frozen-lockfile && npx pnpm@10 --filter @workspace/api-server run build`
- plan: standard 필요 (starter 동일하게 실패)
- Worker buildCommand는 API service와 달리 `npx` 방식 사용 ← 재발 방지

### Runtime 검증 (2026-08-12)

```
API 재시작 후 로그 검사:
  [queue-worker] 시작 로그 없음 ✅ (격리 확인)
  [deactivation-cleanup], [readonly-trigger], [standby-sync], [video-expiry] 정상

Worker events:
  deploy_ended: dep-d9ucbc942hec73f1v1d0 succeeded ✅
  server_available 확인 ✅

/api/health → ok ✅
/api/healthz → {"status":"ok"} ✅
```

**테스트**: WP11 17/17 + 전체 322/322

**WP12 auto-start 금지** — 명시적 승인 후에만 시작.
