---
name: P0 Support DB Source-of-Truth Harden 완료
description: support_ticket_replies 없을 때 HTTP 200 반환 → 앱 무응답 P0 수정 완료 상태
---

## 완료 상태
- SHA: 202f9a6e (deploy-photo-clone)
- 1693/1693 tests pass

## 수정된 계약
1. **support-case-service.ts**: DDL catch → console.error; 코멘트 'pool db' 수정
2. **support-respond.ts**: AI INSERT 실패 (결정론+LLM 양 경로) → 500 + AI_MSG_INSERT_FAILED
3. **support-cases.ts**: GET message query 실패 → 500 + MSG_QUERY_FAILED (silent [] 금지)
4. **dbsrc-support-db-audit.test.ts**: DBSRC-01~15, 21 TCs

## DB 아키텍처 확인 (영구 기록)
- `db` = `superAdminDb` alias = SUPABASE_DATABASE_URL (primary app DB)
- `POOL_DATABASE_URL` = getBackupDb() = backup 전용 (앱 로직 사용 금지)
- support 트랜잭션 데이터 전부 Supabase 단일 소스

**Why:** support_ticket_replies 테이블이 Supabase에 없으면 INSERT/SELECT 실패 → HTTP 200 반환 → 앱에서 응답 없음 P0 재발 방지.

## 다음 단계
Render 배포 완료 후 디바이스 재테스트 → WP-CS-08R FULL CLOSE
