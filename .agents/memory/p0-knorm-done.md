---
name: P0-CS08-KNOWLEDGE-QUERY-NORMALIZATION 완료
description: 한글↔ASCII 공백+조사 변형 정규화로 "스윔노트x에대해서알려줘" → ki_x_mode_intro 매칭 수정
---

## 문제
"스윔노트x에대해서알려줘" → tokenize → 단일 토큰 → score 0 → NO_MATCH → HUMAN_REQUIRED
canonical "스윔노트X에 대해 알려줘" 와 의미 동일하나 deterministic 매칭 실패.

## 원인
- `tokenize()`는 공백 기준 분리 → 공백 없는 한국어+ASCII 혼합 문자열이 단일 토큰
- scoreText()가 raw `.toLowerCase()` 비교 → ASCII 대소문자 정규화만, 공백/조사 정규화 없음
- qLower/tokens 빌드 시 정규화 없음 (support-respond.ts line 272-273)

## 수정 (SHA: accb2fae, branch: deploy-photo-clone)
- `normalizeQuery(q)` 추가 (export):
  1. 한글↔ASCII 경계 공백 삽입 (스윔노트x → 스윔노트 x)
  2. 에대해서/에대해 → 에 대해
  3. 이뭐야/가뭐야 → 가 뭐야
  4. 다중 공백 정리
- `scoreText()`: row.question/title 비교 시 normalizeQuery 적용 (양쪽 정규화)
- `support-respond.ts`: qLower = normalizeQuery(rawMessage), tokens = tokenize(qLower)

## 검증
- KNORM-01~12: 25/25 통과
- 전체 회귀: 83 pre-existing 실패 그대로 (신규 실패 없음)
- TS 오류: 내 파일 0개

## 보안 유지
- role/mode 필터는 SQL eligible rows 단계에서 적용 (unchanged)
- parent에게 admin 화면 노출 없음
- OpenAI 호출 = 0 for deterministic hit

## 배포
- Render: GitHub push deploy-photo-clone → 자동 배포 트리거
- Mobile OTA: NO (server-only fix)

**Why:** 한글 자연어 변형(공백 없음, 조사 변형)은 whitespace 기반 tokenize만으로 커버 불가.
**How to apply:** 새 query variant 추가 시 normalizeQuery에 pattern 추가; 테이블/FAQ 복제 금지.
