# SWIMNOTE Makeup Production Baseline — 2026-08-08

이 문서는 현재 Production에서 실기기 검증 완료된  
보강 시스템의 복구 기준선이다.

---

## 1. Baseline Git SHA

```
baee4222f51f6c25c295a110d1988efced28ebdd
```

Branch: `deploy-photo-clone`  
Tag: `swimnote-makeup-production-stable-2026-08-08`

**포함 커밋 (ancestry 검증 완료):**

| SHA | 내용 |
|---|---|
| `5c5c11a5` | feat(REQ-5): teacher makeup visibility — current class membership filter |
| `4b9656e5` | fix: 날짜 다시 선택 시 selectedOccurrence도 함께 초기화 |
| `baee4222` | fix: 배정 확정 onPress 래핑 — GestureResponderEvent 오염 제거 |

---

## 2. Production Tag

```
swimnote-makeup-production-stable-2026-08-08
```

태그 생성 명령:
```bash
git tag -a swimnote-makeup-production-stable-2026-08-08 \
  -m "SWIMNOTE Makeup Production Stable Baseline
- teacher visibility by current active class
- expired makeup preserved
- KST -14/+28 date range
- future assign / today-past complete-direct
- full-class makeup override allowed
- date reselect fixed
- assign confirm GestureResponderEvent regression fixed
- verified on real device"

git push origin swimnote-makeup-production-stable-2026-08-08
```

---

## 3. 실기기 정상 확인 기능

| 기능 | 상태 |
|---|---|
| 선생님별 보강 대상 분리 | ✅ 정상 |
| 기간 지난 보강(expired) 표시 | ✅ 정상 |
| 보강 가능 날짜 표시 | ✅ 정상 |
| 날짜 재선택 | ✅ 정상 |
| 보강 배정 확정 | ✅ 정상 |
| 정원 5/5 반에도 보강 추가 가능 | ✅ 정상 |
| 보강으로 6명 이상이 되어도 배정 가능 | ✅ 정상 |

---

## 4. Teacher Visibility 규칙 (REQ-5)

**Source of Truth:** `student_class_history.left_at IS NULL`  
현재 재적 중인 학생의 class를 기준으로 담당 teacher를 결정한다.

```sql
-- teacher 조회 조건
WHERE sch.left_at IS NULL
  AND (
    cg.teacher_user_id = '${userId}'
    OR cg.co_teacher_ids @> to_jsonb('${userId}'::text)
  )
-- handoff 예외
OR ms.handed_to_teacher_id = '${userId}'
```

**규칙:**
- `original_teacher_id`는 visibility 기준으로 사용 금지
- 현재 active class(`left_at IS NULL`)의 `teacher_user_id` 또는 `co_teacher_ids`가 기준
- `handed_to_teacher_id = 나` 인 경우 인계받은 보강도 표시

---

## 5. Admin Visibility 규칙

Pool Admin / Admin 역할은 pool 전체 보강 조회.  
`swimming_pool_id = poolId` 조건만 적용, teacher 필터 없음.

---

## 6. Expired 규칙

- `status = 'waiting'` + `status = 'expired'` 모두 조회
- `is_expired` 필드로 UI에서 구분 표시
- `MAKEUP_EXPIRED_CONFIRM_REQUIRED` 코드로 confirm 없는 expired 처리 차단

---

## 7. 날짜 -14/+28 규칙

**KST 오늘 기준:**
- `rangeStart = 오늘 - 14일`
- `rangeEnd   = 오늘 + 28일`

범위 벗어나면 `MAKEUP_DATE_OUT_OF_RANGE` (HTTP 400).

**관련 파일:** `artifacts/api-server/src/lib/makeup-date-range.ts`

---

## 8. assign / complete-direct 분기

| 조건 | 엔드포인트 | 비고 |
|---|---|---|
| `assigned_date > 오늘` (미래) | `PATCH /teacher/makeups/:id/assign` | 출결 기록 예약 |
| `assigned_date <= 오늘` (오늘·과거) | `PATCH /teacher/makeups/:id/complete-direct` | 즉시 완료 처리 |

오늘 날짜를 assign에 전달하면 `ASSIGN_REQUIRES_FUTURE_DATE` (400).

---

## 9. FULL CLASS 보강 초과 허용

**절대 원칙:**  
일반 class capacity가 5명이어도 보강은 정원을 초과해서 추가 가능.

```
capacity = 5, current_members = 5
makeup +1 → 총 6명 허용 ✅
```

**금지 패턴:**
- `CLASS_FULL`로 보강 assign 차단
- `eligible-classes`에서 FULL 반 제거
- FULL 반 UI `disabled` 처리
- FULL 반 `onPress` guard

**허용 패턴:**
- `is_full`, `available_slots`, `current_members` 정보 제공
- "정원마감/정원초과" 뱃지 표시 (정보 목적)

---

## 10. 날짜 다시 선택 State 규칙

날짜 재선택 버튼(`onPress`) 핸들러는 반드시 두 state를 동시에 초기화:

```tsx
onPress={() => { setSelectedDate(null); setSelectedOccurrence(null); }}
```

`setSelectedDate(null)`만 단독으로 초기화하면 `selectedOccurrence`가 오염되어  
이전 날짜 선택이 남아 있는 버그 발생.

---

## 11. onPress={() => doAssign()} 고정 이유

**원인:**  
`Pressable`의 `onPress` prop에 `doAssign`을 직접 전달하면,  
`doAssign(GestureResponderEvent)`로 호출되어 `allowExpired` 파라미터에  
이벤트 객체가 전달됨 → `JSON.stringify` 오류 또는 `allow_expired: [object Object]` 오염.

**올바른 코드:**
```tsx
onPress={() => doAssign()}          // ✅ GestureResponderEvent 격리
```

**금지 코드:**
```tsx
onPress={doAssign}                  // ❌ 이벤트 객체 오염
```

**예외:**  
expired Alert 내부의 `doAssign(true)` 명시 호출은 화살표 함수 내이므로 정상.

---

## 12. 회귀 테스트 목록

| 파일 | 커버 CASE |
|---|---|
| `makeup-production-baseline-gate.test.ts` | CASE 1~7 (teacher visibility), S1~S5 (앱 정적 gate) |
| `makeup-capacity-gate.test.ts` | D1~D3 (assign 5/5·6/5), E1~E3 (eligible-classes), F1~F3 (complete-direct), G1~G11 (차단 규칙), H1~H8 (정적 코드) |
| `makeup-regression-gate.test.ts` | W1~W4 (waiting list), O1~O6 (eligible-occurrences), Date1~Date5 (날짜 정책) |
| `makeup-date-range.test.ts` | A1~A6 (lib 단위), B1~B5 (admin route), C1~C4 (teacher route) |

**실행:**
```bash
cd artifacts/api-server
pnpm test
```

---

## 13. 절대 되돌리면 안 되는 코드/정책

### teachers.ts (API 서버)
- `left_at IS NULL` 기반 teacher visibility 필터
- `co_teacher_ids` 포함 조건
- `handed_to_teacher_id` 예외
- `status IN ('waiting', 'expired')` waiting list 조회
- `validateMakeupDateRange` — KST -14/+28
- `ASSIGN_REQUIRES_FUTURE_DATE` — 오늘 이전 assign 차단
- `MAKEUP_EXPIRED_CONFIRM_REQUIRED` — expired confirm 없음 차단
- CLASS_FULL 차단 로직 없음 (보강은 정원 초과 허용)

### makeups.tsx (클라이언트)
- `onPress={() => doAssign()}` — GestureResponderEvent 래핑
- `setSelectedDate(null); setSelectedOccurrence(null);` — 날짜 재선택 두 state 동시 초기화
- FULL 반 `disabled` / `if ... return` 차단 없음

---

## 14. 향후 보강 수정 시 필수 Regression Gate

다음 파일이 diff에 포함되면 아래 테스트를 반드시 실행해야 한다:

```
artifacts/api-server/src/routes/teachers.ts
artifacts/api-server/src/routes/admin.ts
artifacts/swim-app/app/(teacher)/makeups.tsx
artifacts/swim-app/components/teacher/my-schedule/ClassDetailSheet.tsx
artifacts/api-server/src/lib/makeup-date-range.ts
```

**Regression Gate 실행:**
```bash
cd artifacts/api-server
npx vitest run \
  src/routes/__tests__/makeup-production-baseline-gate.test.ts \
  src/routes/__tests__/makeup-capacity-gate.test.ts \
  src/routes/__tests__/makeup-regression-gate.test.ts \
  src/routes/__tests__/makeup-date-range.test.ts
```

**"리팩터링", "코드 정리", "중복 제거"를 이유로 보강 정책을 변경하는 것을 금지한다.**  
과거 makeups.tsx / teachers.ts를 통째로 복원하는 행위 금지.

---

## 15. 복구 기준 SHA

향후 보강 회귀 발생 시:

```
현재 Production Baseline SHA: baee4222f51f6c25c295a110d1988efced28ebdd
→ regression tests 실행
→ 필요한 최소 diff 적용
```

과거 commit을 통째로 rollback하지 않는다.
