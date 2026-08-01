---
name: AI Engine Template Pipeline 구조
description: /api/v1/teacher-diary/generate 파이프라인 설계 결정 — Template 소스, 파싱 책임, 검색 기준, 품질 수정 이력
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
- **실제 ID 형식**: `dt_1781933096795_dddbavxvu` (타임스탬프+랜덤스트링)
- **`tpl_0~tpl_4`는 mock/placeholder였음** — commit `04bce0ea`에서 실제 DB ID로 교체

### Template Search 알고리즘
- **후보 기준 (relaxed)**: score ≥ 1 (1개 이상 매칭)
- **최종 사용 (strict)**: top 5 by ranking
- Scoring: level_name 영법 일치 +3, 기술 일치 +2, template_text 키워드 일치 +1
- 키워드 없는 입력(confidence=0.2): 전체 템플릿 후보, top 5 fallback 반환

### generation_mode 임계값 (commit `04bce0ea` 이후)
- **`TEMPLATE_USE_MIN_SCORE = 4`**: topScore ≥ 4 이어야 TEMPLATE_ASSISTED
- topScore < 4이면 INPUT_ONLY로 판정하고 템플릿을 프롬프트에 포함하지 않음
- `searchTemplates` 결과의 `candidateIds` 필드로 후보 DB ID 목록 반환

### grounding_validation 임계값 (commit `04bce0ea` 이후)
- `PASS`: parser_confidence ≥ 0.7
- `WARNING`: 0.4 ≤ confidence < 0.7
- `FAIL`: confidence < 0.4
- **이전**: 항상 `{ status: 'PASS', score: ... }` 하드코딩 → 폐기

### meta 필드 (응답에 포함)
- `pipeline_mode: "template_v1"`
- `generation_mode`: "TEMPLATE_ASSISTED" | "INPUT_ONLY"
- `parser_confidence`: 0.2 ~ 0.95
- `template_candidate_count`: 후보 수
- `template_used_count`: 실제 사용 수 (INPUT_ONLY이면 0)
- `top_score`: 최고 점수
- `grounding_validation`: `{ status, score, pass_threshold, warning_threshold }`
- `template_candidate_ids`: 후보 DB ID 목록 (실제 DB ID)
- `template_ids`: 프롬프트에 사용된 DB ID 목록 (실제 DB ID, INPUT_ONLY이면 [])
- `knowledge_ids`: []

### 시스템 프롬프트 품질 규칙 (commit `04bce0ea` 이후)
- **메모에 없는 내용 생성 금지**: 발차기/호흡/자세/태도/향상/다음 계획 (명시된 경우에만)
- **특정 학생 관찰 → common 포함 금지**
- **Template는 문체 참고 전용** (내용 복사 금지)
- **학생 이름+관찰이 메모에 없으면 students=[]**

### 앱 클라이언트 설정 (TeacherDiaryAIClient.ts)
- **기본 모드: grounded** (하드코딩, EXPO_PUBLIC_SWIMNOTE_AI_MODE 미설정 시도 grounded)
- **GROUNDED_BASE**: `https://swimnote-api.onrender.com` (하드코딩 fallback)
- 토큰 없으면 요청 전 `AUTH_TOKEN_MISSING` 조기 반환 (NETWORK 오류 위장 방지)

### Render.com 배포 커밋 (운영 서버)
- **현재 live**: `04bce0ea` (품질 수정: template_ids 실제 DB ID, grounding_validation 임계값, generation_mode 임계값, system prompt 강화)
- 서비스 ID: `srv-d7bn4gogjchc73dp1ci0`, 브랜치: `deploy-photo-clone`
- **토큰 검증 필수**: JWT payload에 `tv: TOKEN_VERSION(=1)` 필드 없으면 `token_version_mismatch` 401

### SCRIPT_VERIFIED 테스트 결과 (commit `04bce0ea`)
- **A** ("자유형"): generation_mode=TEMPLATE_ASSISTED top_score=10 grounding=WARNING(0.50) — 발차기/호흡/자세 미생성 ✅
- **B** ("배영 발차기 태웅 다리 통증"): generation_mode=TEMPLATE_ASSISTED top_score=10 grounding=PASS(0.70) — 태웅 common 미포함 ✅
- **C** ("자유형 발차기 태웅 무릎 굽힘"): generation_mode=TEMPLATE_ASSISTED top_score=10 grounding=PASS(0.95) — student→common leak 없음 ✅

**Why:** App이 Parser를 갖지 않아야 AI Engine 단독으로 알고리즘 개선 가능. Template 후보는 넓게, 최종 선택은 엄격하게. grounded 하드코딩은 환경변수 미설정 시 legacy로 폴백하는 버그를 방지하기 위함. template_ids mock은 운영 추적을 불가능하게 하므로 반드시 실제 DB ID 사용.
