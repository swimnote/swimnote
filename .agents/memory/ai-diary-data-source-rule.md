---
name: AI 일지 데이터 소스 영구 원칙
description: 일지 생성 AI = diary_templates 단독. curriculum = 게이지·레벨 전용. 2026-09-11 확정 불변.
---

## 원칙 (변경 불가, 2026-09-11 확정)

**일지 생성 AI는 diary_templates(AI 엔진 DB)만 사용한다.**
**curriculum_items는 학부모 게이지·학생 레벨 추적 전용이며 일지 생성에 관여하지 않는다.**

### 역할 분리

| 데이터 소스 | 용도 |
|---|---|
| `diary_templates` | 일지 생성 AI 참고 예문 (모든 수영장 공통) |
| `curriculum_items` | 학부모 게이지 진도 추적 + 학생 레벨 산정 전용 |

### 검색 전략 (ai-v1.ts Normal mode)

| 조건 | 동작 |
|---|---|
| Normal mode (curriculum 유무 무관) | `searchTemplates(poolId, meaning)` 단독 사용 |
| X mode | `searchXGlobalTemplates(meaning)` — 별도 경로 유지 |

- `hasCurriculumBasedDiary` 분기 없음 — curriculum 존재 여부는 일지 생성에 영향 없음
- 엔진 DB 콘텐츠 추가 시 전국 모든 수영장에 즉시 반영

### 파라미터 (2026-09-11 기준)
- `TOP_K_USAGE = 3` — 프롬프트에 예문 최대 3개
- `USAGE_MIN_SCORE = 1.0` — 영법 매칭만 있어도 통과
- `CANDIDATE_MIN_CONCEPT_OVERLAP = 0.30` — 후보 필터
- common 일지 길이: 150~450자

**Why:** curriculum 노드는 동작명(9글자) + 분류코드만 있어 AI 예문으로 활용 불가. diary_templates는 완성된 서술 문장이라 품질 차이가 크다. 전 수영장이 동일 엔진 DB를 공유해야 스윔노트 의존도가 높아지는 사업 방향에도 부합.

**How to apply:**
- ai-v1.ts Normal mode 분기 수정 시 `searchTemplates` 단독 유지 필수
- curriculum 관련 검색(searchCurriculumForDiary 등)을 일지 생성 경로에 추가하는 것 금지
- 파일 상단 ╔══╗ 박스 주석에 원칙 명시됨
