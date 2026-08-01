---
name: AI Engine Template Pipeline 구조
description: /api/v1/teacher-diary/generate 파이프라인 설계 결정 — Template 소스, Scoring, grounding_validation 분리, 배포 흐름
---

## 핵심 결정

### AI Engine 위치
- `https://swimnote-api.onrender.com` = Render.com 운영 서버 (main 아님, deploy-photo-clone 추적)
- 경로 `/api/v1/teacher-diary/generate` = `artifacts/api-server/src/routes/ai-v1.ts`

### Parser 책임 분리
- **App은 raw text만 전송** — 의미 추출 금지
- Parser: `diary-parser.ts` (AI Engine 전담)
- 이유: 규칙 발전 시 앱 업데이트 불필요

### Template DB 소스
- `diary_templates` 테이블 — **신규 DB 생성 금지**
- 1,050개 global 템플릿
- **실제 ID 형식**: `dt_1784310622286_59h5wlvby` (타임스탬프+랜덤)

### Template Search 단일 경로
- `artifacts/api-server/src/lib/diary-template-search.ts` — **유일한 검색 모듈**
- `DiaryTemplateModule`, `DiaryTemplateRepository` — **존재하지 않음** (사용자가 언급했으나 미구현)

### V2 Normalized Scoring (commit f264bba 이후)

```
strokeMatch (0|1):      level_name 영법 신호 매칭 (중복 합산 금지 — break after first match)
focusMatch (0|1):       level_name 기술 신호 매칭 (중복 합산 금지)
conceptOverlap (0~1.0): input allKeywords 중 template_text에 포함된 비율 (level_name 제외)
observationMatch (0|1): input issues 중 template_text 매칭 여부
score = strokeMatch + focusMatch + conceptOverlap + observationMatch (max 3.0)
```

**이전 버그 (V1 score=10+)**: LEVEL_NAME_STROKE_SIGNALS 9개 항목이 각자 +3 중복 합산 가능
→ "자유형" 입력: 자유형/풀·글라이드/글라이드/스트림라인 계열 신호 4개 × +3 = +12, text +1 = 10+

**임계값 상수**:
- `CANDIDATE_MIN_CONCEPT_OVERLAP = 0.30` (text 기반 후보 필터)
- `USAGE_MIN_SCORE = 1.40` (영법 단독=1.0 미달 → INPUT_ONLY, 단 conceptOverlap≥1.0이면 2.0으로 TEMPLATE_ASSISTED)
- `TOP_K_USAGE = 1` (최대 1개 사용)

**실측 "자유형" 점수** (commit f264bba):
- strokeMatch=1, focusMatch=0, conceptOverlap=1.0(text에 '자유형' 포함), observationMatch=0 → score=2.0
- TEMPLATE_ASSISTED (score=2.0 ≥ 1.40), template_ids 1개

### grounding_validation 분리 (commit f264bba 이후)

**parser_confidence**: `diary-parser.ts`가 입력 해석 신뢰도 (0.2~0.95, allKeywords 수 기반)

**grounding_validation**: `diary-grounding.ts`가 GPT 출력 실제 분석 (parser_confidence 미사용)
```json
{
  "status": "PASS|WARNING|FAIL",
  "score": 1.0|0.7|0.3,
  "unsupported_claim_count": 0,
  "student_to_common_leak_count": 0,
  "invented_student_evaluation_count": 0,
  "invented_next_plan_count": 0,
  "invented_technique_count": 0
}
```
- PASS: unsupported=0 (score=1.0)
- WARNING: unsupported=1~2 (score=0.7)
- FAIL: unsupported≥3 (score=0.3)

**주의**: grounding.score=0.7 == parser_confidence=0.7인 경우가 발생할 수 있음 (수치 우연의 일치) — 별개 계산임

### meta 필드 (commit f264bba 이후)
- `pipeline_mode: "template_v1"`
- `generation_mode`: "TEMPLATE_ASSISTED" | "INPUT_ONLY"
- `parser_confidence`: 0.2~0.95 (입력 해석 신뢰도)
- `top_score`: 0~3.0 (최대 3.0, 이전 버그로 10+ 가능했음)
- `top_breakdown`: {strokeMatch, focusMatch, conceptOverlap, observationMatch} (상위 템플릿 점수 구성)
- `template_candidate_count`: conceptOverlap≥0.30 통과 후보 수
- `template_used_count`: score≥1.40 통과 사용 수 (최대 1)
- `template_candidate_ids`: 후보 DB ID 목록
- `template_ids`: 사용된 DB ID 목록 (최대 1개, INPUT_ONLY이면 [])
- `grounding_validation`: GPT 출력 실제 검증 결과

### SCRIPT_VERIFIED 테스트 결과 (commit f264bba, Render live)
| 테스트 | generation_mode | top_score | top_breakdown | grounding |
|---|---|---|---|---|
| A "자유형" | TEMPLATE_ASSISTED | 2.0 | stroke=1,focus=0,overlap=1,obs=0 | WARNING(eval=1) |
| B "태웅 발차기 무릎 굽힘" | TEMPLATE_ASSISTED | 2.6 | stroke=1,focus=0,overlap=0.6,obs=1 | FAIL(eval=3) |
| C "자유형 발차기" | TEMPLATE_ASSISTED | 2.0 | stroke=1,focus=0,overlap=1,obs=0 | WARNING(eval=1,tech=1) |

**Test B focusMatch=0**: 최상위 템플릿의 level_name에 '킥' 신호 없음 — 정상 동작 (conceptOverlap+observationMatch로 선택)
**grounding FAIL/WARNING**: GPT가 여전히 '발전', '향상' 등 평가 표현을 생성 — 프롬프트 준수 미흡, 검출은 정확

### 앱 클라이언트 설정
- **기본 모드: grounded** (하드코딩, 환경변수 미설정 시에도 grounded)
- **GROUNDED_BASE**: `https://swimnote-api.onrender.com` (하드코딩 fallback)

### Render.com 배포 흐름
- 서비스 ID: `srv-d7bn4gogjchc73dp1ci0`, 브랜치: `deploy-photo-clone`
- **현재 live**: commit `f264bba` (V2 scoring + grounding_validation 분리)
- **JWT 필수**: payload에 `tv: 1` 없으면 `token_version_mismatch` 401
- **테스트 user**: `user_1775118427405_ey2qbn6is` (integration-test.ts의 pool_admin) — `pool_1775118427405_xs80lcdmo`

**Why**: 
- V1 scoring은 LEVEL_NAME_STROKE_SIGNALS 중복 합산으로 영법 단독 입력에서도 score=10이 나와 template 과잉 적용.
- grounding_validation을 parser_confidence로 대체하면 GPT 출력 품질이 아닌 입력 복잡도를 측정하게 됨 — 실제 출력 검증과 무관.
- TOP_K_USAGE=1: 복수 template 동시 적용 시 내용 혼합(hallucination) 위험.
