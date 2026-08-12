---
name: WP12 우리수영장 커리큘럼 검색 설계
description: 학부모 AI 커리큘럼 검색 기능의 확정 설계 및 구현 범위 기록 (DEFERRED_AFTER_SKELETON)
---

## WP12 — 우리수영장 커리큘럼 검색

**상태**: `WP12_PARENT_CURRICULUM_SEARCH = DEFERRED_AFTER_SKELETON`  
상세 구현은 별도 설계 확정 후 재개.

---

## 현재 앱 상태 (Skeleton)

- 버튼: `home.tsx` L1778 — "AI 커리큘럼 검색" 버튼 → `setAiModalType("curriculum")`
- 모달: `AIFeatureModal.tsx` — `curriculum` 타입 → `CurriculumContent()` → 준비중 안내 표시
- 라우트 없음, API 없음, 검색 UI 없음 → 모두 DEFERRED

---

## 확정 기능명

**"우리수영장 커리큘럼 검색"**

---

## 확정 동작 모드

### NORMAL SWIMNOTE

- 해당 수영장이 직접 등록한 커리큘럼/일지 템플릿 기준 검색
- 최소 300개 등록 시 활성화 예정
- 다른 수영장 데이터 사용 금지

### X MODE

- 수영장 자체 300개 등록 불필요
- SWIMNOTE 제공 `ACTIVE x_global` 중앙 커리큘럼을 해당 수영장 교육과정으로 사용

---

## 확정 검색 파이프라인 (향후 구현)

```
학부모 질문
→ 현재 swimming_pool_id 확인
→ 해당 수영장의 기준 커리큘럼 검색
  (NORMAL: pool 자체 등록 커리큘럼 | X MODE: active x_global)
→ SWIMNOTE AI 전문 DB에서 관련 자료 확장검색
→ 근거 선별
→ GPT 문장화
```

---

## 최종 답변 원칙

- 답변 주체 = 실제 수영장 이름 (SWIMNOTE 아님)
- 예: "토이키즈스윔클럽에서는 평영 발차기를 ..."
- `swimming_pool_name`을 최종 Prompt Context에 반드시 포함

---

## 핵심 제한 (구현 시 엄수)

| 제한 | 설명 |
|---|---|
| 기준 준수 | 수영장의 등록 커리큘럼이 교육방식 기준 |
| AI 역할 | 전문지식으로 설명 확장만 — 임의 변경/창작 금지 |
| Fallback 금지 | 일반 GPT 수영지식 fallback 금지 |
| 격리 | 다른 수영장 커리큘럼 혼입 금지 |

---

## DEFERRED 구현 목록 (지금 구현 안 함)

- 검색 API
- 커리큘럼 parser / ranking
- 300개 eligibility 계산
- Knowledge Search 연결
- GPT Prompt Builder
- Parent AI history
- 커리큘럼 데이터 적재
- 실제 검색 결과 UI

---

## 관련 파일 (현재 skeleton)

| 파일 | 역할 |
|---|---|
| `app/(parent)/home.tsx` L1778 | 커리큘럼 검색 버튼 |
| `components/parent/AIFeatureModal.tsx` | 준비중 안내 모달 (`curriculum` 타입) |
