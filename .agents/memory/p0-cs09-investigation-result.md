---
name: P0-CS09 Messages GET Investigation
description: GET /support/cases/:id/messages "empty array" defect — investigation result was NO DEFECT
---

# P0-CS09 Investigation Result: NO DEFECT

## Summary
WP-CS09 종료 검증 스크립트가 존재하지 않는 경로를 호출해 false positive 결함을 보고.

## Actual Endpoint
- **올바른 경로**: `GET /support/cases/:id` → `{ case, ticket, messages: [...], master_state, ... }`
- **잘못된 경로**: `GET /support/cases/:id/messages` → 404 (등록된 GET 라우트 없음)
- POST는 있음: `POST /support/cases/:id/messages` (메시지 추가용)

## Architecture Confirmed
- `db = superAdminDb` (동일 alias in lib/db/src/index.ts line 78)
- 모든 support_ticket_replies read/write = SUPABASE_DATABASE_URL
- POOL_DATABASE_URL = backup 전용, getBackupDb()만 허용

## Client Parsing (SupportChatScreen.tsx)
- Line 181: `apiRequest(token, '/support/cases/${caseId}')` ✅
- Line 190: `messages: data.messages ?? []` ✅

## Production Verification (sc_1787041523891_nz4say)
- HTTP 200, messages count = 4
- Roles: user / ai_deterministic / user / ai_low_confidence ✅
- All rows: case_id=caseId, ticket_id=NULL (AI-only case, ticket_id on support_cases also NULL)

**Why:** 검증 스크립트가 `/messages` suffix를 잘못 붙임 → 404 JSON에서 .messages=undefined → [] 해석
**How to apply:** 향후 검증 스크립트 작성 시 올바른 endpoint `GET /support/cases/:id` 사용할 것
