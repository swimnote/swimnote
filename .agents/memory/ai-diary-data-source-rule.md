---
name: AI 일지 데이터 소스 영구 원칙
description: 일지 생성 AI는 curriculum_items + diary_templates 항상 병합 사용. 2026-09-11 확정 불변 원칙.
---

## 원칙 (변경 불가)

**일지 생성 AI는 가용한 모든 데이터 소스를 병합해 최대 품질을 추구한다.**

### 검색 전략

| 조건 | 동작 |
|---|---|
| Normal mode (curriculum 있음) | `searchCurriculumForDiary` + `searchTemplates` 병렬 실행 후 병합 |
| Normal mode (curriculum 없음) | `searchTemplates`만 사용 |
| X mode | `searchXGlobalTemplates`만 사용 (별도 경로, 이 원칙 비적용) |

### 병합 규칙
- curriculum 결과 먼저, diary_templates 결과로 보충
- 중복 ID 제거 후 append

### 이유
- `curriculum_items`는 **학부모 게이지(진도 추적)** 목적과 일지 AI를 겸용
- curriculum이 존재해도 diary_templates 검색을 skip하면 AI 엔진에 추가된 풍성한 예문이 전혀 활용되지 않음
- 수영 커리큘럼 내용은 범용적이라 diary_templates(전국 공통) 보충이 항상 유효

**Why:** curriculum 존재 여부로 diary_templates를 skip하는 구조였으나, 이는 AI 엔진에 쌓인 컨텐츠를 낭비함. 두 소스를 항상 병합해야 품질 최대화 가능.

**How to apply:** ai-v1.ts Normal mode 분기 수정 시 curriculum+templates 병합 구조 유지 필수. 파일 최상단 ★ 영구 불변 원칙 주석 참고.

### 적용 파일
- `artifacts/api-server/src/routes/ai-v1.ts` — Normal mode 검색 분기 (hasCurriculum 블록)
- 파일 상단 ╔══╗ 박스 주석에 원칙 명시됨
