# 보강 정원 초과 배정 허용 — 설계서

> 작성일: 2026-08-07  
> 요구사항: 보강 학생은 반 정원이 가득 찼더라도 배정 가능해야 한다.  
> 정원 정보(몇 명 / 정원 몇 명)는 UI에 **표시 가능**. 배정 **차단은 금지**.

---

## 1. 현황 조사 — 정원 제한이 적용되는 모든 위치

### 1-A. 서버사이드

---

#### ① GET /admin/makeups/eligible-classes
- **파일**: `artifacts/api-server/src/routes/admin.ts` line 1768–1796
- **현재 조건**:
  ```js
  is_eligible: r.capacity ? r.current_members < r.capacity : true
  }).filter(r => r.is_eligible);
  ```
- **정원 초과 시 동작**: 반 자체가 응답에서 **제외됨**
- **충돌 여부**: ❌ **충돌** — 정원 찬 반은 관리자 보강 배정 화면에서 선택 불가

---

#### ② GET /teacher/makeups/eligible-classes
- **파일**: `artifacts/api-server/src/routes/teachers.ts` line 634–665
- **현재 조건**:
  ```sql
  HAVING GREATEST(0, cg.capacity - COUNT(...)::int) > 0
  ```
  + `AND (cg.is_one_time = false OR cg.is_one_time IS NULL)` — 일회성 반 제외
- **정원 초과 시 동작**: SQL HAVING 절에서 반 자체 **제외됨**
- **충돌 여부**: ❌ **충돌** — 정원 찬 반은 선생님 보강 배정 화면에서 선택 불가

---

#### ③ GET /teacher/makeups/:makeupId/eligible-occurrences
- **파일**: `artifacts/api-server/src/routes/teachers.ts` line 687–840
- **현재 조건**:
  ```js
  const isFull = capacity > 0 && availableSlots <= 0;
  // 각 occurrence에 is_full: isFull, available_slots: availableSlots 포함하여 반환
  ```
- **정원 초과 시 동작**: occurrence를 **제외하지 않음**. is_full=true, available_slots=0을 클라이언트에 전달
- **충돌 여부**: ⚠️ **간접 충돌** — 서버 자체는 제외 안 하지만 앱이 is_full을 읽어 차단함 (④ 참고)

---

#### ④ validateMakeupOccurrence (공통 검증 함수)
- **파일**: `artifacts/api-server/src/routes/teachers.ts` line 327–410
- **현재 조건**:
  ```js
  const isFull = capacity > 0 && availableSlots <= 0;
  return { ..., isFull, availableSlots, ... };
  ```
- **정원 초과 시 동작**: `isFull` 값을 **계산하여 반환**. 함수 자체는 throw하지 않음
- **충돌 여부**: ⚠️ 값만 반환. 호출자(⑤)가 이 값을 사용해 차단함

---

#### ⑤ PATCH /teacher/makeups/:id/assign  ← **핵심 차단 지점**
- **파일**: `artifacts/api-server/src/routes/teachers.ts` line 843–950
- **현재 조건**:
  ```js
  // 미래 정원 마감은 서버에서 차단
  if (validation.isFull) {
    res.status(400).json({ error: "CLASS_FULL", message: "정원이 마감된 반에는 보강을 배정할 수 없습니다." });
    return;
  }
  ```
- **정원 초과 시 동작**: **HTTP 400 CLASS_FULL 반환** — 배정 자체 거부
- **충돌 여부**: ❌ **충돌** — 보강 정책과 직접 충돌하는 핵심 차단

---

#### ⑥ PATCH /teacher/makeups/:id/complete-direct
- **파일**: `artifacts/api-server/src/routes/teachers.ts` line 1090–1188
- **현재 조건**:
  ```js
  // 오늘·과거 정원 초과는 실제 참여 기록이므로 허용 (isFull 체크 없음)
  ```
- **정원 초과 시 동작**: **허용** — 이미 정원 무시하고 완료 처리 가능
- **충돌 여부**: ✅ **충돌 없음** — 현재 올바른 동작

---

#### ⑦ PATCH /admin/makeups/:id/assign
- **파일**: `artifacts/api-server/src/routes/admin.ts` line 1815–1897
- **현재 조건**: 정원 체크 없음. status=waiting/expired 확인만 함
- **정원 초과 시 동작**: **허용** — 관리자 어드민 assign은 정원 무시
- **충돌 여부**: ✅ **충돌 없음** — 현재 올바른 동작

---

### 1-B. 앱사이드

---

#### ⑧ 앱 — 선생님 보강 반 목록 (assign 모달, eligible-classes)
- **파일**: `artifacts/swim-app/app/(teacher)/makeups.tsx` line 880–914
- **현재 조건**: 반 행 자체는 `disabled` 없음. `잔여 N석` 표시
- **정원 초과 시 동작**: 서버(②)가 이미 정원 찬 반을 제외하므로 **앱 목록에 아예 안 나타남**
- **충돌 여부**: ❌ **간접 충돌** — ②가 수정되면 이 화면에서 정원 찬 반이 표시되고, 별도 차단 없이 선택 가능

---

#### ⑨ 앱 — 선생님 보강 회차 선택 (assign 모달, 미래 회차)  ← **핵심 차단 지점**
- **파일**: `artifacts/swim-app/app/(teacher)/makeups.tsx` line 951–976
- **현재 조건**:
  ```jsx
  style={[s.classRow, (occ.is_full && occ.is_future) && { opacity: 0.4 }]}
  onPress={() => {
    if (occ.is_full && occ.is_future) return;  // 차단
    ...
  }}
  disabled={occ.is_full && occ.is_future}      // 버튼 비활성
  ```
  배지: `is_full && is_future` → "정원마감" 빨간 배지
- **정원 초과 시 동작**:
  - 미래 + is_full → **선택 불가** (비활성화)
  - 오늘/과거 + is_full → 선택 가능 (배지만 표시)
- **충돌 여부**: ❌ **충돌** — 미래 보강 날짜 선택 자체 차단

---

#### ⑩ 앱 — 선생님 직접 완료 모달 회차 선택 (과거·오늘)
- **파일**: `artifacts/swim-app/app/(teacher)/makeups.tsx` line 1149–1182
- **현재 조건**:
  ```jsx
  if (occ.is_full) {
    Alert.alert("정원 초과", "정원을 초과한 반입니다.\n실제로 보강 수업에 참여한 경우에만 처리해 주세요.",
      [{ text: "취소" }, { text: "그래도 처리", onPress: onConfirm }]
    );
    return;
  }
  ```
  배지: `is_full` → "정원초과" 노란 배지
- **정원 초과 시 동작**: **Alert 경고 후 허용** — 사용자가 "그래도 처리" 선택하면 진행
- **충돌 여부**: ✅ **충돌 없음** — 정원 정보 표시하면서 배정 허용. 이 패턴을 그대로 유지

---

#### ⑪ 앱 — 관리자 보강 반 선택 (eligible-classes)
- **파일**: `artifacts/swim-app/app/(admin)/makeups.tsx` line 259–267
- **현재 조건**: `정원 여유: {item.available_slots === 999 ? "제한없음" : item.available_slots}명` 표시
- **정원 초과 시 동작**: 서버(①)가 이미 제외하므로 앱에 정원 찬 반이 **표시 안 됨**
- **충돌 여부**: ❌ **간접 충돌** — ①이 수정되면 정원 찬 반도 목록에 나타남 (앱 자체 차단 없음)

---

## 2. 충돌 위치 요약

| 번호 | 위치 | 파일 | 충돌 여부 | 충돌 내용 |
|------|------|------|-----------|-----------|
| ① | GET /admin/makeups/eligible-classes | admin.ts:1792 | ❌ **충돌** | `.filter(r => r.is_eligible)` — 정원 찬 반 제외 |
| ② | GET /teacher/makeups/eligible-classes | teachers.ts:660 | ❌ **충돌** | `HAVING ... > 0` — SQL에서 정원 찬 반 제외 |
| ③ | GET eligible-occurrences | teachers.ts:740 | ⚠️ 간접 | is_full 플래그 계산·전달. 차단은 앱(⑨)에서 |
| ④ | validateMakeupOccurrence | teachers.ts:397 | ⚠️ 간접 | isFull 반환. 차단은 assign(⑤)에서 |
| ⑤ | PATCH /teacher/makeups/:id/assign | teachers.ts:905 | ❌ **충돌** | `if (validation.isFull) → 400 CLASS_FULL` |
| ⑥ | PATCH /teacher/makeups/:id/complete-direct | teachers.ts:1154 | ✅ 정상 | isFull 체크 없음, 허용 |
| ⑦ | PATCH /admin/makeups/:id/assign | admin.ts:1851 | ✅ 정상 | 정원 체크 없음, 허용 |
| ⑧ | 앱 — 선생님 반 목록 | makeups.tsx(teacher):880 | ❌ 간접 | ②가 차단하므로 앱에 표시 안 됨 |
| ⑨ | 앱 — 선생님 미래 회차 선택 | makeups.tsx(teacher):955,957,961 | ❌ **충돌** | is_full && is_future → disabled, onPress 무시 |
| ⑩ | 앱 — 선생님 직접 완료 회차 | makeups.tsx(teacher):1152 | ✅ 정상 | Alert 경고 후 허용 |
| ⑪ | 앱 — 관리자 반 목록 | makeups.tsx(admin):267 | ❌ 간접 | ①이 차단하므로 앱에 표시 안 됨 |

---

## 3. 수정 목표 (재설계 기준)

### 정책

> 보강 학생은 정원이 가득 찬 반에도 배정 가능.  
> 정원 정보(현재 N명 / 정원 M명, 잔여 K석)는 UI에 **표시 가능**.  
> 정원 초과 이유만으로 배정 차단 **금지**.

### A. 표시 가능 (유지·허용)
- `available_slots`, `is_full` 필드를 클라이언트에 전달 → **유지**
- UI에 "정원마감", "정원초과", "잔여 N석" 배지 → **표시 유지**
- 직접완료 모달의 "정원 초과" Alert 경고 → **유지** (⑩ 현재 올바름)

### B. 제거해야 할 차단 (수정 대상)

| 번호 | 위치 | 현재 동작 | 목표 동작 |
|------|------|-----------|-----------|
| ① | admin.ts:1792 | `.filter(r => r.is_eligible)` 제외 | 제거: `is_eligible` 계산은 유지하되 filter 제거 |
| ② | teachers.ts:660 | `HAVING ... > 0` SQL 제외 | 제거: HAVING 절 삭제. `available_slots`는 SELECT에서 계산·반환 유지 |
| ⑤ | teachers.ts:905 | `if (validation.isFull) → 400` | 제거: isFull 체크 삭제. 미래 날짜여도 배정 허용 |
| ⑨ | makeups.tsx(teacher):955,957,961 | `is_full && is_future` → disabled | 변경: disabled 제거. 배지 표시만 유지. Alert 경고 방식으로 전환(⑩ 패턴 적용) |

### C. 변경 불필요 (현재 올바름)
- ③ eligible-occurrences: is_full 플래그 전달 유지 (표시 목적)
- ④ validateMakeupOccurrence: isFull 반환 유지 (값은 필요, 차단 로직 제거가 목표)
- ⑥ complete-direct: 이미 정원 무시 허용
- ⑦ admin assign: 이미 정원 무시 허용
- ⑩ 앱 직접완료 Alert: 이미 올바른 패턴

---

## 4. 수정 상세 계획

### [서버] admin.ts — eligible-classes filter 제거

```diff
- }).filter(r => r.is_eligible);
+ }); // is_eligible 필드는 반환하되 filter 제거
```

`is_eligible`은 클라이언트 표시용으로 남길 수도 있고, 제거해도 무방.

---

### [서버] teachers.ts — eligible-classes HAVING 제거

```diff
- HAVING GREATEST(0, cg.capacity - COUNT(s.id) FILTER (...)) > 0
```
삭제. `available_slots` 계산은 SELECT에 유지.

---

### [서버] teachers.ts — assign isFull 차단 제거

```diff
- // 미래 정원 마감은 서버에서 차단
- if (validation.isFull) {
-   res.status(400).json({ error: "CLASS_FULL", message: "정원이 마감된 반에는 보강을 배정할 수 없습니다." });
-   return;
- }
```
삭제.

---

### [앱] teacher/makeups.tsx — 미래 회차 is_full 차단 제거 + Alert 전환

**현재** (❌ 차단):
```jsx
style={[s.classRow, (occ.is_full && occ.is_future) && { opacity: 0.4 }]}
onPress={() => {
  if (occ.is_full && occ.is_future) return;
  setSelectedDate(occ.occurrence_date);
  setSelectedOccurrence(occ);
}}
disabled={occ.is_full && occ.is_future}
```

**목표** (✅ Alert 경고 후 허용):
```jsx
style={[s.classRow]}   // opacity 제거
onPress={() => {
  if (occ.is_full && occ.is_future) {
    Alert.alert(
      "정원 마감",
      "현재 정원이 마감된 반입니다.\n보강 학생은 정원 초과 상태에서도 배정 가능합니다.",
      [{ text: "취소", style: "cancel" }, { text: "배정 진행", onPress: () => { setSelectedDate(occ.occurrence_date); setSelectedOccurrence(occ); } }]
    );
    return;
  }
  setSelectedDate(occ.occurrence_date);
  setSelectedOccurrence(occ);
}}
disabled={false}   // 비활성화 제거
// 배지 "정원마감" 표시는 유지
```

---

## 5. 수정 범위 최종 정리

| # | 파일 | 위치 | 수정 내용 |
|---|------|------|-----------|
| 1 | `artifacts/api-server/src/routes/admin.ts` | line ~1792 | `.filter(r => r.is_eligible)` 삭제 |
| 2 | `artifacts/api-server/src/routes/teachers.ts` | line ~660 | `HAVING GREATEST(...) > 0` 삭제 |
| 3 | `artifacts/api-server/src/routes/teachers.ts` | line ~905–907 | `if (validation.isFull)` 블록 삭제 |
| 4 | `artifacts/swim-app/app/(teacher)/makeups.tsx` | line ~955–961 | `is_full && is_future` disabled/opacity/return 제거. Alert 경고로 전환 |

**총 4개 지점, 3개 파일** 수정.

---

## 6. 서버 배포 계획

> 실제 앱은 swimnote.kr (Render.com) 연결.  
> 서버 수정 → GitHub push → Render.com 자동 배포 → 앱 즉시 반영.  
> 앱 코드(⑨) 수정 → OTA 배포 필요.

1. 서버 3개 지점 수정 (admin.ts, teachers.ts)
2. GitHub push → Render.com 배포 확인
3. 앱 1개 지점 수정 (teacher/makeups.tsx)
4. OTA 배포 (iOS production + preview 채널)
