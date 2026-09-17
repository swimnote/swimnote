---
name: platform-banners POST 버그 패턴
description: POST /super/banners 500 오류의 세 가지 원인과 최종 수정
---

## 세 가지 버그 (모두 POST 500 유발)

**1. req.user!.id → undefined**
- JWT payload에 `userId` 필드가 있고 `id`가 없음
- `req.user = { ...payload }` 이므로 `req.user.id`는 항상 undefined
- SQL 파라미터가 빈 값(`, ,`)으로 생성 → 쿼리 실패
- **수정**: `req.user!.id` → `req.user!.userId`

**2. execute(sql) not iterable**
- `const [row] = await superAdminDb.execute(sql\`...\`)`
- drizzle `execute()` 반환값은 단일 QueryResult 객체 (배열 아님)
- 배열 destructuring 시 `(intermediate value) is not iterable` 오류
- **수정**: `.insert(table).values({...}).returning()` ORM 방식으로 교체

**3. target_pool_id 컬럼 없음**
- platform_banners 테이블에 `target_pool_id` 컬럼이 스키마·DB에 모두 없음
- raw SQL INSERT에 포함하면 DB 오류
- **수정**: INSERT 컬럼 목록에서 제거

## display_url https 생성
- Render는 TLS를 load balancer에서 terminate → 내부 req.protocol = 'http'
- `req.get("x-forwarded-proto") || req.protocol` 로 수정해야 https URL 생성
- GET /platform/banners, GET /super/banners 모두 동일하게 적용

**Why**: Render 환경 특성. 앱의 Image 컴포넌트는 HTTP 301 redirect를 자동 추적하지 않으므로 https 필수.

## SHA
- f920a4c9 (POST ORM 교체 + req.user.userId)
- 3668b513 (GET /super/banners display_url + debug 코드 제거)
- Render live 확인 완료
