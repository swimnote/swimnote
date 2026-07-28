# E1 Contract 설계도 — Teacher Diary Request/Response 확장

> **목적**: GPT 검토 후 구현 진행을 위한 설계 사전 합의 문서  
> **범위**: `useDiaryAI.ts` Request 확장 + Response 필드명 표준화 + 로그 마스킹  
> **변경 금지**: Diary Save, State Machine, UI, DB, 커리큘럼, UX 흐름

---

## 1. 현재 상태 (변경 전 베이스라인)

### 1-A. 현재 Request Body

```json
{
  "schema_version": "1.0",
  "feature": "teacher_diary",
  "locale": "ko-KR",
  "input": {
    "text": "오늘 자유형 호흡을 연습했습니다."
  },
  "context": {
    "class_id":     "class_group_id값",
    "pool_id":      "swimming_pool_id값",
    "lesson_date":  "2026-07-29",
    "student_refs": ["student_xxx", "student_yyy"]
  }
}
```

**현재 문제**:
- `student_refs` 배열에 ID만 있음. AI Engine이 이름 정보 없이 Name Matcher 처리 불가.
- `organization_ref`, `lesson_ref` 없음 (이번 E1에서도 추가하지 않음).

---

### 1-B. 현재 Response 처리 (dual-field 이미 구현됨)

```typescript
// useDiaryAI.ts L481–483
const sid      = s.student_ref ?? s.student_id ?? '';
const feedback = (s.feedback   ?? s.content    ?? '').trim();
```

AI Engine이 `student_ref/feedback` 또는 `student_id/content` 중 어느 것을 보내도 수신 가능.  
단, **표준 필드명이 명시적으로 문서화되어 있지 않아** AI Engine이 무엇을 기준으로 구현해야 하는지 모호함.

---

### 1-C. 현재 로그 (마스킹 없음)

```typescript
// useDiaryAI.ts L398
console.log('[GENERATE-REQ] student_refs:', (options.students ?? []).map(s => `${s.id}(${s.name})`).join(', '));
```

실명이 그대로 로그에 출력됨.

---

## 2. E1에서 변경할 내용 요약

| 항목 | 변경 전 | 변경 후 |
|---|---|---|
| Request `context.students` | 없음 | `[{ref, name}]` 배열 추가 |
| Request `context.student_refs` | 유지 | 병행 유지 (하위 호환) |
| Request `context.organization_ref` | 없음 | **추가 안 함** |
| Request `context.lesson_ref` | 없음 | **추가 안 함** |
| Response 표준 필드명 | 미문서화 | `student_ref` + `content` 확정 |
| Response 호환 필드명 | dual 처리 | `student_id` + `feedback` 임시 유지 |
| 로그 학생 이름 | 실명 노출 | 마스킹 처리 |
| Diary Save | — | **변경 금지** |
| State Machine | — | **변경 금지** |
| 커리큘럼 UX | — | **변경 금지** |

---

## 3. E1 Request Contract (변경 후)

### 3-A. 전체 구조

```json
{
  "schema_version": "1.0",
  "feature": "teacher_diary",
  "locale": "ko-KR",
  "input": {
    "text": "STT 원문 또는 텍스트 입력 (trim만 적용, 의미 변환 없음)"
  },
  "context": {
    "pool_id":      "swimming_pool_id",
    "class_id":     "class_group_id",
    "lesson_date":  "YYYY-MM-DD",

    "student_refs": ["student_xxx", "student_yyy"],

    "students": [
      { "ref": "student_xxx", "name": "서태웅" },
      { "ref": "student_yyy", "name": "이정우" }
    ]
  }
}
```

### 3-B. 각 필드 명세

| 필드 | 타입 | 필수 | 생성 책임 | 설명 |
|---|---|:---:|---|---|
| `schema_version` | `string` | ✅ | 앱 | 현재 `"1.0"` 고정 |
| `feature` | `string` | ✅ | 앱 | 현재 `"teacher_diary"` 고정 |
| `locale` | `string` | ✅ | 앱 | `"ko-KR"` 고정 |
| `input.text` | `string` | ✅ | 앱 | STT 원문 또는 텍스트. `.trim()` 만 적용 |
| `context.pool_id` | `string` | ✅ | 앱 | `adminUser.swimming_pool_id` |
| `context.class_id` | `string` | ✅ | 앱 | `selectedGroup.id` (class_group_id) |
| `context.lesson_date` | `string` | ✅ | 앱 | `"YYYY-MM-DD"` 형식 |
| `context.student_refs` | `string[]` | ✅ | 앱 | 기존 하위 호환 유지. ID 배열 |
| `context.students` | `{ref,name}[]` | ✅ | 앱 | **E1 신규**. 이름 포함 학생 배열 |
| `context.students[].ref` | `string` | ✅ | 앱 | `student.id` |
| `context.students[].name` | `string` | ✅ | 앱 | `student.name` (전체 이름, 가공 없음) |

### 3-C. 확정 원칙

```
1. students[].name 은 DB에서 가져온 전체 이름 그대로 전달
   - 성/이름 분리 금지
   - given_name 생성 금지
   - 조사/호칭 제거 금지
   → 성 제거, 이름만 추출, 동명이인 처리는 AI Engine Name Matcher 담당

2. organization_ref 추가 안 함
   - pool_id 가 수영장(= 조직) 식별자
   - AI Engine이 pool_id 를 organization_ref 로 수용하면 충분

3. lesson_ref 추가 안 함
   - class_id + lesson_date 조합이 수업 식별자
   - 독립적인 lesson_id 개념이 앱 DB에 없음

4. student_refs 병행 유지
   - AI Engine이 students[] 를 우선 사용
   - student_refs 는 하위 호환용으로 동일 ID 목록 유지
   - 장기 통합 여부는 별도 검토
```

---

## 4. E1 Response Contract (표준 확정)

### 4-A. 표준 Response 구조

```json
{
  "request_id":     "req_xxx",
  "schema_version": "1.0",
  "feature":        "teacher_diary",
  "status":         "ok",
  "result": {
    "common": "오늘 수업에서는 자유형 호흡 연결 동작을 중심으로 진행했습니다.",
    "students": [
      {
        "student_ref": "student_xxx",
        "content":     "호흡 시작 타이밍을 연습했습니다."
      },
      {
        "student_ref": "student_yyy",
        "content":     "킥 동작이 안정적으로 유지되었습니다."
      }
    ]
  },
  "usage": {
    "input_tokens":  120,
    "output_tokens": 80,
    "total_tokens":  200
  }
}
```

### 4-B. Response 필드 명세

| 필드 | 타입 | 표준 | 호환 (임시 유지) | 설명 |
|---|---|---|---|---|
| `result.common` | `string` | `common` | — | 공통 일지 텍스트 |
| `result.students[].student_ref` | `string` | **`student_ref`** | `student_id` | 학생 식별자 |
| `result.students[].content` | `string` | **`content`** | `feedback` | 학생별 일지 텍스트 |

### 4-C. 필드명 표준화 근거

| 구분 | 필드명 | 선택 이유 |
|---|---|---|
| 표준 (AI Engine이 사용해야 할 이름) | `student_ref` | Request의 `students[].ref` 와 일관성 |
| 표준 (AI Engine이 사용해야 할 이름) | `content` | 일지 "내용"의 의미적 명확성 |
| 호환 유지 (임시) | `student_id` | 기존 AI Engine 구현 호환 |
| 호환 유지 (임시) | `feedback` | 기존 AI Engine 구현 호환 |

앱 코드(L481–483)는 dual-field 처리가 이미 구현되어 있으므로 Response Contract 전환 시 앱 수정 불필요.

### 4-D. 앱의 student_ref 매칭 규칙

```
1. student_ref (또는 student_id) 가 context.student_refs 에 없는 경우 → 건너뜀
2. content (또는 feedback) 가 빈 문자열인 경우 → 건너뜀
3. 동일한 student_ref 가 중복으로 오는 경우 → content 를 공백으로 결합
4. 매칭된 학생의 name 은 앱 내 students[] 에서 조회 (Response에 name 불필요)
```

---

## 5. 로그 마스킹 규칙

### 5-A. 변경 전 (현재)

```typescript
// L398
console.log('[GENERATE-REQ] student_refs:', 
  (options.students ?? []).map(s => `${s.id}(${s.name})`).join(', '));
```
→ 실명 `서태웅`, `이정우` 가 로그에 그대로 출력됨

### 5-B. 변경 후

```typescript
// 마스킹 함수
function maskName(name: string): string {
  if (!name || name.length === 0) return '***';
  if (name.length === 1) return '*';
  return name[0] + '*'.repeat(name.length - 1);
}

// 적용
console.log('[GENERATE-REQ] students:', 
  (options.students ?? []).map(s => `${s.id}(${maskName(s.name)})`).join(', '));
```

→ `student_xxx(서**)`, `student_yyy(이**)` 형태로 출력

### 5-C. 마스킹 규칙 정의

| 이름 길이 | 규칙 | 예시 |
|---|---|---|
| 0자 | `***` | — |
| 1자 | `*` | `김` → `*` |
| 2자 | 첫 글자 + `*` | `태웅` → `태*` |
| 3자 이상 | 첫 글자 + `**` 반복 | `서태웅` → `서**` |

### 5-D. 마스킹 적용 범위

| 로그 위치 | 마스킹 적용 | 비고 |
|---|:---:|---|
| `[GENERATE-REQ] student_refs:` | ✅ | L398 수정 |
| `[GENERATE-STUDENT-RAW]` | 해당 없음 | ID만 출력 |
| `[GENERATE-STUDENT]` | 해당 없음 | ID만 출력 |
| `[INSERT-RESULT]` | 해당 없음 | 이름 미출력 |
| `[GENERATE-2] context` | ✅ | students 수(count)만 출력 유지 |

---

## 6. 변경 파일 범위

### 6-A. 변경하는 파일: 1개

```
artifacts/swim-app/components/ai/features/diary/useDiaryAI.ts
```

**변경 위치**

| 위치 | 현재 코드 | 변경 후 |
|---|---|---|
| L379–392 `requestBody` | `student_refs` 만 있음 | `students: [{ref, name}]` 추가 |
| L398 로그 | 실명 출력 | `maskName()` 적용 |

**변경량**: 약 10줄 추가/수정

### 6-B. 변경하지 않는 파일

| 파일 | 이유 |
|---|---|
| `AIStateMachine.ts` | State 전환 영향 없음 |
| `DiaryWriteView.tsx` | dual-field 매핑 이미 완료 |
| `diary.tsx` | Diary Save 변경 금지 |
| `diary/types.ts` | `StudentContext` 인터페이스 변경 없음 |
| API Server 라우트 (`diary.ts` 등) | 저장 구조 변경 금지 |
| DB 스키마 | 변경 없음 |

---

## 7. AI Engine 측 필요 사항 (앱에서 요청)

앱은 위 Contract를 준수하여 전송합니다.  
AI Engine이 확인/구현해야 할 내용:

```
1. Request.context.students[{ref, name}] 수신 처리
   - ref = student 식별자 (Request의 student_refs 와 동일 ID)
   - name = 전체 이름 (성 분리/given_name 처리는 AI Engine Name Matcher에서)

2. pool_id 를 organization 식별자로 수용
   - organization_ref 필드 없음. pool_id 로 처리.

3. class_id + lesson_date 를 수업 식별자로 수용
   - lesson_ref 필드 없음.

4. Response 표준 필드명 확정
   - students[].student_ref (표준) — student_id 는 임시 호환만
   - students[].content (표준)    — feedback 은 임시 호환만

5. student_refs 와 students[] 중 어느 쪽을 우선 사용할지 확인 필요
   - 앱은 두 필드를 동일한 학생 목록으로 동시에 전송
   - AI Engine이 students[] 를 우선 사용하고 student_refs 를 fallback으로 처리 권장
```

---

## 8. 검증 방법 (구현 후)

```
1. 앱 로그 확인
   [GENERATE-REQ] body: { ... context.students: [{ref, name}] ... }
   → students 배열에 ref + name 포함 여부

2. 학생 이름 마스킹 확인
   [GENERATE-REQ] students: student_xxx(서**), student_yyy(이**)
   → 실명 미노출

3. Diary Save 영향 없음 확인
   handleSave() → POST /diaries body 변경 없음
   → class_group_id, lesson_date, common_content, student_notes 동일

4. 기존 하위 호환 확인
   AI Engine이 student_id/feedback 반환 시에도 정상 매칭
   → dual-field 코드(L481–483) 동작 확인
```

---

## 9. 단계 경계 (이번 E1에서 다루지 않는 것)

```
- 커리큘럼 데이터 전송      → E3 (DB 설계 후)
- 템플릿 전송              → E4 (Template Search 방안 확정 후)
- Knowledge 전송           → E4 (Knowledge DB 구축 후)
- 커리큘럼 확인·수정 UX    → E6 (E3 완료 후)
- lesson_ref               → 추가 안 함 (class_id + lesson_date 대체)
- organization_ref         → 추가 안 함 (pool_id 대체)
- student_refs 제거        → E2 안정화 후 별도 결정
- feedback/student_id 제거 → AI Engine 표준 전환 완료 후 별도 결정
```

---

*작성일: 2026-07-28*  
*검토 대상: AI Engine Repository*  
*구현 대상: 앱 Repository `useDiaryAI.ts` (GPT 검토 후 진행)*
