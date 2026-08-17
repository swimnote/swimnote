---
name: WP-CS-05R 완료 상태
description: Support Knowledge + FAQ Foundation — 서버 엔드포인트, 마이그레이션, Super Admin UI, 테스트 완료 상태
---

## 완료 내용

- SHA: 2808cdfc (deploy-photo-clone)
- 전체 TC: 1600/1600 통과 (cs-05r 48TC 포함)
- Render 배포 트리거: 2808cdfc

## 파일 목록

| 파일 | 역할 |
|------|------|
| `artifacts/api-server/src/migrations/pool-db-cs-05r.ts` | ALTER TABLE 확장 + 18개 seed (pending) |
| `artifacts/api-server/src/routes/knowledge-search.ts` | 8 엔드포인트 (search/detail/list/create/approve/deactivate/archive/x04-import) |
| `artifacts/api-server/src/routes/__tests__/cs-05r.test.ts` | 48TC (CS05R-01~24) |
| `artifacts/swimnote-web/src/pages/super/SuperKnowledge.tsx` | Knowledge DB Admin UI |
| `artifacts/swimnote-web/src/pages/super/SuperSupport.tsx` | Knowledge + FAQ 탭 연결 |

## 주요 구조 결정

- `support_knowledge_items` 테이블 확장: question, answer, frontend_screen_id, source_type, source_ref, revision, affected_roles(TEXT[]), affected_modes(TEXT[])
- status 값: pending/active/inactive/archived/deprecated (inactive, archived 신규 추가)
- X04 import → 항상 pending, scope=pool, source_type='X_SETUP'
- 감사 로그: audit_logs 테이블 (KNOWLEDGE_ACTIVATED/DEACTIVATED/ARCHIVED/CREATED/UPDATED)
- analytics: event_logs (FAQ_HIT/KNOWLEDGE_HIT/NO_KNOWLEDGE_MATCH)
- 검색 scoring: exact_faq_question(90) → exact_title(85) → ... → token_match(30-55)

## 테스트 mock 결정 (중요)

- `drizzle-orm`을 vi.mock으로 교체해야 sql 태그드 템플릿이 __text/__values 구조 반환
- `@workspace/db`는 superAdminDb.execute만 mock
- INSERT audit_logs params 순서: [id, itemId, action, actorId, poolId, jsonStr] (literal string 'support_knowledge', 'super_admin', NOW() 제외)

## 다음 미배포 (Production DB 적용 필요)

pool-db-cs-05r.ts 마이그레이션은 서버 시작 시 자동 실행됨 (Render 재배포로 자동 적용 예정)
