---
name: AI Engine Template Pipeline 구조
description: /api/v1/teacher-diary/generate 파이프라인 설계 결정 — Template 소스, 파싱 책임, 검색 기준
---

## 핵심 결정

### AI Engine 위치
- `https://6f233dc5-...-1oorqtggrk5cm.pike.replit.dev` = **이 프로젝트의 api-server** Replit dev domain
- 경로 `/api/v1/teacher-diary/generate` = `artifacts/api-server/src/routes/ai-v1.ts`에 신규 구현
- 기존 `/api/ai/diary/generate` (legacy) 별도 유지

### Parser 책임 분리 (Single Source of Truth)
- **App은 raw text만 전송** — 의미 추출 금지
- Parser는 AI Engine(api-server) 전담: `diary-parser.ts`
- 이유: 규칙 발전 시 앱 업데이트 불필요, Template Search와 동일 파서 보장

### Template DB 소스
- `diary_templates` 테이블 (동일 DB) — **신규 DB 생성 금지**
- 1,050개 global 템플릿 (수영장당 ~350개, 10개 레벨)
- `diary_template_levels.level_name`에 영법 포함: "흰색: 자유형", "평영킥", "접영스트로크" 등

### Template Search 알고리즘
- **후보 기준 (relaxed)**: score ≥ 1 (1개 이상 매칭)
- **최종 사용 (strict)**: top 5 by ranking
- Scoring: level_name 영법 일치 +3, 기술 일치 +2, template_text 키워드 일치 +1
- 키워드 없는 입력(confidence=0.2): 전체 템플릿 후보, top 5 fallback 반환

### meta 필드 (응답에 포함)
- `pipeline_mode: "template_v1"`
- `parser_confidence`: 0.2 ~ 0.95
- `template_candidate_count`: 후보 수
- `template_used_count`: 실제 사용 수
- `top_score`: 최고 점수

**Why:** App이 Parser를 갖지 않아야 AI Engine 단독으로 알고리즘 개선 가능. Template 후보는 넓게, 최종 선택은 엄격하게.
