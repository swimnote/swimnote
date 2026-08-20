---
name: RT2 완료 상태
description: RT2 SupportRetriever — concept lexicon + ILIKE + JS ranking 구현 완료 상태
---

# RT2 SupportRetriever 완료

- **SHA**: 09789cd1
- **branch**: deploy-photo-clone
- **pushed**: YES

## 신규 파일
- `lib/runtime/support-lexicon.ts` — 11-concept product lexicon + tokenizeKorean + stripJosa + detectConcepts
- `lib/retrievers/support-retriever.ts` — L1-L5 canonical KI retrieval (L0 utterance exact 보존)
- `lib/retrievers/__tests__/support-retriever.test.ts` — 26 TC

## 수정 파일
- `lib/support-resolver.ts` — tryCanonicalRetriever() + import retrieveCanonicalKI (runChain에 L0 다음 삽입)

## 핵심 계약
- concept keyword 매칭 시 score +50 (title/category/feature) / +45 (question) → MEDIUM confidence(≥50) 보장
- MIN_SCORE_THRESHOLD = 25 (utterance miss KI도 낮은 overlap시 포함)
- active KI only (status='active' SQL 필터)
- pool-scope SQL 필터 (global OR pool match)
- 전체 active KI 무조건 로드 금지 (ILIKE 후보 LIMIT 80)
- 동점 처리: confidence 낮춤 → GROUNDED_AI 허용 (null 금지)
- cross-pool 필터: SQL 레벨 보장

## 테스트 결과
- RT2: 26/26 통과
- RT1 regression: 37/37 통과
- TS 오류 0 (RT2 파일 기준)

## 배포 상태
- DB migration: NONE
- Render deploy: PENDING (별도 지시 필요)
- OTA: NONE

**Why:** RT2 이후 다음 단계: RT3(CurriculumRetriever), RT4(DiaryRetriever)
