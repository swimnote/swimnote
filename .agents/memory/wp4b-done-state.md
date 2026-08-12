---
name: WP4B 완료 상태
description: X Mode ACTIVE global_template_set → AI 일지 생성 파이프라인 연결 완료 기록
---

# WP4B 완료 상태

**완료일**: 2026-08-12  
**브랜치**: deploy-photo-clone  
**최종 SHA**: b729cd5a (Render live 확인)

## 구현 파일

| 파일 | 변경 내용 |
|---|---|
| `lib/diary-template-search.ts` | `XTemplateStatus`, `XGlobalTemplateSearchResult`, `getActiveGlobalTemplateSet`, `loadXGlobalTemplates` (COALESCE category), `searchXGlobalTemplates` 추가 |
| `routes/ai-v1.ts` | Phase 2-3: contract 1.3 + poolMode='x' → searchXGlobalTemplates 분기; buildMeta에 x_template_status/x_active_set_id 추가 |
| `routes/__tests__/ai-v1-integration.test.ts` | mockSearchXGlobalTemplates + TC-WP4B-A~I + TC-WP4B-X1~X3 추가 (35/35 통과) |
| `migrations/pool-db-x-init.ts` | M-E 1차 검증: x_global+NULL swimming_pool_id 허용하도록 수정 |

## 핵심 설계 결정

**category→level_name 매핑**: x_global 템플릿은 level_id 없음(NULL). `loadXGlobalTemplates`에서 `COALESCE(dtl.level_name, dt.category) AS level_name`을 사용해 category 값(자유형/배영 등)을 기존 LEVEL_NAME_STROKE_SIGNALS 엔진에 재활용.

**Why**: x_global 템플릿 없이는 strokeMatch=0 고정 → 최대 score=1.0 < USAGE_MIN_SCORE(1.40) → 항상 NO_MATCH. category를 level_name 대체값으로 쓰면 기존 scoring engine 무수정으로 재활용 가능.

**No global fallback**: X mode에서 x_global 검색 실패 시(NOT_CONFIGURED/NO_MATCH/DATA_INTEGRITY_ERROR) → INPUT_ONLY로 처리. 일반 scope='global' 템플릿으로 절대 fallback 하지 않음.

## 런타임 검증 결과 (로컬 서버 + Production DB)

| 케이스 | 입력 | x_template_status | generation_mode | 검증 |
|---|---|---|---|---|
| B | ACTIVE=0 | NOT_CONFIGURED | INPUT_ONLY | ✅ |
| C/D | X + 자유형 발차기 | FOUND | TEMPLATE_ASSISTED | ✅ |
| E | X + 배영 | NO_MATCH | INPUT_ONLY | ✅ |
| A | Non-X pool | [ABSENT] | TEMPLATE_ASSISTED | ✅ |

## 부수 수정

M-E 1차 검증 쿼리가 x_global 템플릿(scope NOT IN ('global','teacher') 조건에서 위반으로 판정)을 잘못 차단 → 서버 기동 불가. x_global+NULL swimming_pool_id를 정상으로 허용하도록 수정.

## WP5 대기 조건

WP4B_X_GLOBAL_TEMPLATE_SEARCH_VERIFIED ✅ 상태. WP5는 별도 승인 후 시작.

## 최종 승인 (2026-08-12)

**WP4B_X_GLOBAL_TEMPLATE_SEARCH_VERIFIED ✅**  
**WP4_COMPLETE ✅**  
**WP4_CLOSED ✅**

기능 기준 SHA: b729cd5ae7bd1a675f82d019ad9e3fc21af60998 (origin = Render Live)  
Production Runtime 전 케이스 확인 완료.  
WP5는 별도 명시적 승인 후 시작.
