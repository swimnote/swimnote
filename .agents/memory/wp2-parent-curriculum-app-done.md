---
name: WP2 Parent Curriculum Search APP Server 완료 상태
description: APP Server API + Scope Builder + ENGINE Client 구현 완료 기록 및 핵심 설계 결정
---

## WP2 완료 상태

**SHA**: 732d79d2  
**TC**: 21 신규 + 1012 전체 통과  
**Render/OTA**: 미배포

---

## 확정된 설계 결정

### 300-count canonical rule
- 계산 대상: active `curriculum_versions`의 `is_active=true` `curriculum_items` 수
- 임계값: 300 미만 → `CURRICULUM_SEARCH_NOT_ELIGIBLE`
- 상수: `NORMAL_MIN_CURRICULUM_ITEMS = 300` in `parent-curriculum-scope-builder.ts`

### curriculum_items → ENGINE 필드 매핑
- NORMAL: `title→title`, `description→content`, `sort_order→order`, level 없음(생략)
- X: `category→title`, `template_text→content`, `level_name→level(nullable)`, `sort_order→order`
- `level` 필드: optional(`level?: string | null`) — ENGINE WP1.1에서 확정

### ENGINE 인증 패턴 (growth-report-engine-client.ts와 동일)
- Env: `PARENT_CURRICULUM_ENGINE_URL`, `PARENT_CURRICULUM_ENGINE_SECRET`, `PARENT_CURRICULUM_ENGINE_TIMEOUT_MS`
- Auth: `Authorization: Bearer <secret>`
- Default timeout: 60_000ms

---

## 신규 파일
- `lib/parent-curriculum-engine-client.ts` — ENGINE HTTP client
- `lib/parent-curriculum-scope-builder.ts` — NORMAL/X scope + student progress builder
- `routes/parent-curriculum.ts` — POST /parent/students/:studentId/curriculum-search
- `routes/__tests__/parent-curriculum.test.ts` — 21 TC (A~U)

## BLOCKED 확인 후 구현된 것
- getActiveGlobalTemplateSet() 재사용 (diary-template-search.ts)
- resolvePoolMode() 재사용 (xmode.ts)
- parent_students.swimming_pool_id로 pool 확인 (별도 students 조회 불필요)

## 다음 단계
- WP3: Parent APP UI (curriculum-search 화면)
- ENGINE WP1+WP1.1 Production deploy 필요 (현재 미배포)
- APP Production deploy 필요 (현재 미배포)
