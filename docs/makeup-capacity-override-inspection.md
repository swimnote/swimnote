SWIMNOTE 보강 정원초과 허용 — 정밀 검수 보고서

코드 수정 없음. 조사 결과만 제출한다.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. CLASS_FULL 전체 검색
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

── CLASS_FULL ──────────────────────────────

파일                           teachers.ts
함수/Route                     PATCH /teacher/makeups/:id/assign
라인                           906
조건                           if (validation.isFull)
보강 경로인지                  예
일반 회원 경로인지             아니오
수정 필요                      예 — 이 블록만 삭제

전체 레포에서 CLASS_FULL은 이 1곳만 존재. admin assign, complete-direct에는 없음.

── is_full ─────────────────────────────────

파일                           teachers.ts
함수/Route                     GET eligible-occurrences (응답 생성)
라인                           775
조건                           is_full: isFull  (응답 필드 세팅)
보강 경로인지                  예
수정 필요                      아니오 — 정보 제공용, 차단 아님

파일                           teachers.ts
함수/Route                     validateMakeupOccurrence (반환값)
라인                           397, 405
조건                           isFull = capacity > 0 && availableSlots <= 0
보강 경로인지                  예
수정 필요                      아니오 — 계산만 하고 throw 없음

파일                           makeups.tsx
함수/Route                     배정 모달 renderOccRow
라인                           955, 957, 961
조건                           occ.is_full && occ.is_future
보강 경로인지                  예
수정 필요                      예

파일                           makeups.tsx
함수/Route                     배정 모달 뱃지
라인                           967~973
조건                           occ.is_full (뱃지 표시)
보강 경로인지                  예
수정 필요                      아니오 — 경고 표시 유지

파일                           makeups.tsx
함수/Route                     직접 완료 모달 renderDcOccRow onPress
라인                           1152~1158
조건                           if (occ.is_full) → Alert 경고 후 허용
보강 경로인지                  예
수정 필요                      아니오 — 이미 올바른 처리 (경고 → 허용)

파일                           makeups.tsx
함수/Route                     직접 완료 모달 뱃지
라인                           1175~1178
조건                           occ.is_full (뱃지 표시)
보강 경로인지                  예
수정 필요                      아니오 — 경고 표시 유지

파일                           ClassDetailSheet.tsx
함수/Route                     renderOccRow (오늘 스케줄 보강 모달)
라인                           1333, 1335, 1337
조건                           isSaving || (occ.is_full && occ.is_future)
보강 경로인지                  예
수정 필요                      예 — 신규 발견 (초기 설계에 누락됨)

파일                           ClassDetailSheet.tsx
함수/Route                     renderOccRow 뱃지
라인                           1341~1346
조건                           occ.is_full (뱃지 표시)
보강 경로인지                  예
수정 필요                      아니오 — 경고 표시 유지

── is_eligible ─────────────────────────────

파일                           admin.ts
함수/Route                     GET /admin/makeups/eligible-classes
라인                           1791~1792
조건                           is_eligible: capacity ? members < capacity : true
보강 경로인지                  예
수정 필요                      예 — filter 수정 필요

── HAVING ──────────────────────────────────

파일                           teachers.ts
함수/Route                     GET /teacher/makeups/eligible-classes
라인                           660
조건                           GREATEST(0, capacity - members) > 0
보강 경로인지                  예
수정 필요                      예

diary.ts:2058, super.ts:1226, migrations/pool-db-init.ts:1383 등의 HAVING은
모두 보강과 무관한 집계 조건. 수정 불필요.

── capacity / current_count / max_students ──

파일                           class-groups.ts
함수/Route                     POST/PATCH (반 생성/수정)
라인                           64, 131, 190, 209
조건                           capacity 값 저장 CRUD
보강 경로인지                  아니오
일반 회원 경로인지             아니오 (반 속성 관리)
수정 필요                      아니오

파일                           students.ts
함수/Route                     학생 등록/수정
조건                           capacity 관련 코드 없음
수정 필요                      아니오

파일                           admin.ts
함수/Route                     PATCH /class-groups/:id/capacity (정원 수정)
라인                           2519~2532
조건                           capacity 값 수정 CRUD
보강 경로인지                  아니오
수정 필요                      아니오

결론: 일반 학생 등록/반이동/반배정 경로에는 capacity 초과 체크가 없다.
이번 변경과 무관하게 일반 경로에 capacity gate가 존재하지 않는다.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
2. teachers.ts HAVING 원문
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

원문 (660행):

        HAVING GREATEST(0, cg.capacity - COUNT(s.id) FILTER (WHERE s.status IN ('active', 'pending_parent_link', 'unregistered') AND s.deleted_at IS NULL)) > 0

분석:

포함된 aggregate 조건 수: 1개
내용: GREATEST(0, capacity - member_count) > 0
      = 정원 여유가 1명 이상일 때만 포함

다른 aggregate 조건: 없음
정원 비교 외 HAVING 조건: 없음

판정:

HAVING 절 전체에 정원 비교 조건만 있음.
전체 삭제 가능.

삭제 후 GROUP BY ~ ORDER BY 연결:

        GROUP BY cg.id, cg.name, cg.schedule_days, cg.schedule_time, cg.capacity, cg.teacher_user_id, cg.co_teacher_ids, u.name
        ORDER BY is_mine DESC, cg.schedule_days, cg.schedule_time

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
3. CLASS_FULL 블록 전체 원문
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

── validateMakeupOccurrence 안에 있는가? ────

없다.

validateMakeupOccurrence (327~410행):
- 단계 9 (387~397행)에서 isFull을 계산한다.
- throw 없이 return 값에 포함시킨다.
- assign과 complete-direct가 공유하는 함수지만,
  함수 자체는 isFull을 차단에 사용하지 않는다.

── assign 경로의 CLASS_FULL 블록 (원문) ─────

파일: teachers.ts 904~907행

      // 미래 정원 마감은 서버에서 차단
      if (validation.isFull) {
        res.status(400).json({ error: "CLASS_FULL", message: "정원이 마감된 반에는 보강을 배정할 수 없습니다." }); return;
      }

이 블록은 validateMakeupOccurrence 호출 이후, ASSIGN_REQUIRES_FUTURE_DATE 체크 이후에 위치한다.

── complete-direct에 CLASS_FULL 체크가 있는가? ─

없다.

complete-direct (1090행~) 처리 순서:
1. status 확인 (INVALID_ASSIGNED_DATE, MAKEUP_EXPIRED_CONFIRM_REQUIRED)
2. validateMakeupOccurrence 호출 → isFull 반환값 있음
3. isFull 값을 차단에 사용하지 않음
4. status='completed' UPDATE 진행

── isFull 계산과 실제 차단 위치 구분 ──────────

계산 위치 (3곳):
  teachers.ts:397   validateMakeupOccurrence 함수 내부
  teachers.ts:740   eligible-occurrences 핸들러 내부
  teachers.ts:650   eligible-classes SQL (GREATEST(...) AS available_slots)

차단 위치 (1곳):
  teachers.ts:904~906   assign 핸들러에서 validation.isFull 체크 → 400

── 보강 assign/complete-direct 정책 현황 ──────

assign      → 현재 isFull이면 400 차단 → 제거 필요
complete-direct → 현재 isFull 체단 없음 → 이미 올바름

유지해야 하는 검증 (validateMakeupOccurrence 내부):
  1. 날짜 형식 YYYY-MM-DD              INVALID_ASSIGNED_DATE
  2. 실존 날짜                         INVALID_ASSIGNED_DATE
  3. 날짜 범위 -14 ~ +28               MAKEUP_DATE_OUT_OF_RANGE
  4. 반 존재 + 풀 일치 + 삭제 여부      CLASS_NOT_FOUND
  5. 수업 요일 일치                     CLASS_NOT_SCHEDULED_ON_DATE
  6. 풀 휴일                           POOL_HOLIDAY
  7. 정원 계산 (isFull 반환)           → 차단 없이 정보만 반환

assign 핸들러에서 유지해야 하는 검증:
  - MAKEUP_EXPIRED_CONFIRM_REQUIRED   (status=expired + allow_expired 없을 때)
  - ASSIGN_REQUIRES_FUTURE_DATE       (오늘/과거 날짜에 assign 시도)

제거 대상:
  - validation.isFull → 400 CLASS_FULL  블록 1개만

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
4. admin is_eligible 의미 해체
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

원문 (admin.ts 1788~1792행):

      const eligible = rows.map(r => ({
        ...r,
        available_slots: r.capacity ? Math.max(0, r.capacity - r.current_members) : 999,
        is_eligible: r.capacity ? r.current_members < r.capacity : true,
      })).filter(r => r.is_eligible);

is_eligible 계산식 분해:

  r.capacity가 null 또는 0이면
    → is_eligible = true  (정원 미설정 반 → 항상 배정 가능)

  r.capacity가 있으면
    → is_eligible = r.current_members < r.capacity
                  = 현재 인원이 정원 미만이면 true

포함된 조건:

조건                           의미                              유지/제거
r.capacity null/0 → true       정원 미설정 반은 항상 가능          유지 (로직 무관)
members < capacity             정원 여유 있으면 true               제거 대상

다른 eligibility 조건 (is_active, is_visible 등): 없음
is_eligible의 계산 조건은 정원 비교 하나뿐이다.

수정 방안:

.filter(r => r.is_eligible)  →  삭제

is_eligible 계산 자체(1791행)는 유지한다.
정보 제공용 필드로 response에 포함시킨다.
filter만 제거하면 정원 찬 반도 응답에 포함된다.

판정: filter 전체 삭제 가능. is_eligible 계산은 유지.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
5. makeups.tsx UI 검수
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

── 배정 모달 (assign 경로) ─────────────────

원문 (955~961행):

                    <Pressable
                      key={occ.occurrence_date}
                      style={[s.classRow, (occ.is_full && occ.is_future) && { opacity: 0.4 }]}
                      onPress={() => {
                        if (occ.is_full && occ.is_future) return;
                        setSelectedDate(occ.occurrence_date);
                        setSelectedOccurrence(occ);
                      }}
                      disabled={occ.is_full && occ.is_future}

disabled 조건:    occ.is_full && occ.is_future
조건 개수:        2개 (AND 조합)
다른 disabled 조건: 없음 (is_eligible 조건 없음)

각 조건의 의미:
  occ.is_full     → 정원 찬 반 → 제거 대상
  occ.is_future   → 미래 날짜 (assign은 미래만 허용) → 유지 불필요
                    ※ assign 자체가 미래 전용이므로 UI에서 과거를 disabled할 필요 없음
                      (assign 모달에는 미래 회차만 표시됨)

결론: disabled 조건 전체 제거 가능.
     onPress guard 전체 제거 가능.
     opacity: 0.4 조건부 스타일 전체 제거 가능.

── 직접 완료 모달 (complete-direct 경로) ───

원문 (1149~1167행):

                  function renderDcOccRow(occ: MakeupOccurrence) {
                    const onConfirm = () => doDirectComplete(occ);
                    const onPress = () => {
                      if (occ.is_full) {
                        Alert.alert(
                          "정원 초과",
                          "정원을 초과한 반입니다.\n실제로 보강 수업에 참여한 경우에만 처리해 주세요.",
                          [{ text: "취소", style: "cancel" }, { text: "그래도 처리", onPress: onConfirm }],
                        );
                        return;
                      }
                      onConfirm();
                    };
                    ...
                    disabled={directCompleting}

disabled 조건: directCompleting만 (처리 중 중복 클릭 방지)
is_full 처리:  Alert 경고 후 허용 (이미 올바른 처리)

판정: 수정 불필요. 이미 REQ-4에 부합한다.

── is_full 뱃지 (양쪽 모달 공통) ───────────

배정 모달 뱃지 (967~973행):
  occ.is_full 시 "정원마감" 또는 "정원초과" 텍스트 표시
  → 유지. 경고 표시는 UX 요구사항.

직접 완료 뱃지 (1175~1178행):
  occ.is_full 시 "정원초과" 표시
  → 유지.

── ClassDetailSheet.tsx UI (신규 발견) ──────

파일: ClassDetailSheet.tsx (오늘 스케줄에서 보강 처리하는 별도 컴포넌트)
라인: 1333~1337

원문:
                          disabled={isSaving || (occ.is_full && occ.is_future)}
                        >
                          <LucideIcon name="calendar" size={16} color={occ.is_full && occ.is_future ? C.textMuted : "#4F46E5"} />
                          <View style={{ flex: 1 }}>
                            <Text style={[cds.moveClassName, (occ.is_full && occ.is_future) && { color: C.textMuted }]}>

이 컴포넌트가 호출하는 API:
  미래 날짜 선택 → PATCH /teacher/makeups/:id/assign
  오늘/과거 날짜 → PATCH /teacher/makeups/:id/complete-direct

disabled 조건: isSaving || (occ.is_full && occ.is_future)
  isSaving       → 저장 중 중복 방지 → 유지
  occ.is_full && occ.is_future → 정원 체크 → 제거

뱃지 (1341~1346행): 유지

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
6. 보강 전용 예외 보장
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

── 신규 회원 반배정 ─────────────────────────

경로: students.ts (학생 등록/반배정)
capacity 관련 코드: 없음
결론: 이미 정원 제한 없음. 이번 변경과 무관.

── 일반 학생 반이동 ─────────────────────────

경로: class-groups.ts PATCH (반 수정)
capacity 관련 코드:
  - capacity 값 저장 CRUD만 존재
  - 이동 시 정원 초과 체크 없음
결론: 이미 정원 제한 없음. 이번 변경과 무관.

── 정규 학생 추가 ───────────────────────────

경로: admin.ts (학생 관리 API)
capacity 관련 코드:
  - PATCH /class-groups/:id/capacity = 정원 값 자체를 수정하는 API
  - 학생 추가 시 capacity 초과 체크 코드 없음
결론: 이미 정원 제한 없음. 이번 변경과 무관.

── 이번 변경으로 풀리는 것 ─────────────────

변경 후 정원 초과 허용되는 경로:
  - GET /teacher/makeups/eligible-classes  (반 목록에 정원 찬 반 포함)
  - PATCH /teacher/makeups/:id/assign      (CLASS_FULL 차단 제거)
  - GET /admin/makeups/eligible-classes    (반 목록에 정원 찬 반 포함)
  - makeups.tsx UI                         (선택 가능)
  - ClassDetailSheet.tsx UI               (선택 가능)

변경과 무관하게 정원 제한이 없는 경로 (현재도 없음):
  - 신규 회원 등록
  - 학생 반이동
  - 정규 학생 추가
  - PATCH /admin/makeups/:id/assign        (현재도 isFull 체크 없음)
  - PATCH /teacher/makeups/:id/complete-direct  (현재도 isFull 체크 없음)

변경 후에도 정원 제한이 유지되는 경로:
  해당 없음. 원래부터 보강 assign 1곳에만 capacity gate가 있었다.

판정: 일반 등록/이동 경로는 이번 변경 전부터 capacity gate가 없다.
      이번 변경은 보강 assign 경로의 차단 1곳만 제거한다.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
7. 날짜 수정 생존 확인
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

새벽에 완료한 날짜 정책 로직 현재 상태:

항목                                  파일                   라인     상태
validateMakeupDateRange 호출         teachers.ts            351      생존
getMakeupDateRange 호출              teachers.ts            747      생존
MAKEUP_DATE_OUT_OF_RANGE             makeup-date-range.ts   82       생존
ASSIGN_REQUIRES_FUTURE_DATE          teachers.ts            897~901  생존
MAKEUP_EXPIRED_CONFIRM_REQUIRED      teachers.ts            873~878  생존 (assign)
MAKEUP_EXPIRED_CONFIRM_REQUIRED      teachers.ts            1123~128 생존 (complete-direct)
선보강 허용 (absenceDate 제한 없음)  teachers.ts            347~348  생존 (주석 확인)
결석 당일 허용                       teachers.ts            406~408  생존
미래 → assign, 오늘/과거 → complete-direct  makeups.tsx  467~492  생존

이번 정원 수정 diff가 위 로직을 건드리는가?

건드리지 않는다.

이유:
- HAVING 삭제는 eligible-classes SQL에만 영향. 날짜 로직과 무관.
- CLASS_FULL 블록 삭제는 assign 핸들러 904~906행. ASSIGN_REQUIRES_FUTURE_DATE(897~901)와 MAKEUP_EXPIRED_CONFIRM_REQUIRED(873~878)는 이 블록보다 앞에 있어 영향 없음.
- admin.ts filter 삭제는 eligible-classes 응답에만 영향. 날짜 로직과 무관.
- UI disabled 제거는 클라이언트에만 영향. 서버 날짜 검증과 무관.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
8. 최종 수정안
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

초기 설계에서 누락된 파일 1개 추가.
총 수정 대상: 3개 파일, 5개 위치.

──────────────────────────────────────────
수정 ① teachers.ts:660
──────────────────────────────────────────

파일: artifacts/api-server/src/routes/teachers.ts
Route: GET /teacher/makeups/eligible-classes

Before:
        GROUP BY cg.id, cg.name, cg.schedule_days, cg.schedule_time, cg.capacity, cg.teacher_user_id, cg.co_teacher_ids, u.name
        HAVING GREATEST(0, cg.capacity - COUNT(s.id) FILTER (WHERE s.status IN ('active', 'pending_parent_link', 'unregistered') AND s.deleted_at IS NULL)) > 0
        ORDER BY is_mine DESC, cg.schedule_days, cg.schedule_time

After:
        GROUP BY cg.id, cg.name, cg.schedule_days, cg.schedule_time, cg.capacity, cg.teacher_user_id, cg.co_teacher_ids, u.name
        ORDER BY is_mine DESC, cg.schedule_days, cg.schedule_time

제거되는 정원 조건: HAVING GREATEST(...) > 0  (1개만, 전부)
유지되는 eligibility 조건: 없음 (이 쿼리에 정원 외 eligibility 없음)
일반 회원 경로 영향: 없음 (보강 전용 API)

──────────────────────────────────────────
수정 ② teachers.ts:904~907
──────────────────────────────────────────

파일: artifacts/api-server/src/routes/teachers.ts
Route: PATCH /teacher/makeups/:id/assign

Before:
      // 미래 정원 마감은 서버에서 차단
      if (validation.isFull) {
        res.status(400).json({ error: "CLASS_FULL", message: "정원이 마감된 반에는 보강을 배정할 수 없습니다." }); return;
      }

After:
      (4줄 전체 삭제)

제거되는 정원 조건: if (validation.isFull) → 400 CLASS_FULL
유지되는 검증:
  - MAKEUP_EXPIRED_CONFIRM_REQUIRED  (873~878, 이 블록보다 앞)
  - validateMakeupOccurrence 내부 검증 전체 (날짜/반/요일/휴일)
  - ASSIGN_REQUIRES_FUTURE_DATE      (897~901, 이 블록보다 앞)
일반 회원 경로 영향: 없음 (보강 assign 전용 핸들러)

──────────────────────────────────────────
수정 ③ admin.ts:1792
──────────────────────────────────────────

파일: artifacts/api-server/src/routes/admin.ts
Route: GET /admin/makeups/eligible-classes

Before:
      const eligible = rows.map(r => ({
        ...r,
        available_slots: r.capacity ? Math.max(0, r.capacity - r.current_members) : 999,
        is_eligible: r.capacity ? r.current_members < r.capacity : true,
      })).filter(r => r.is_eligible);
      res.json(eligible);

After:
      const eligible = rows.map(r => ({
        ...r,
        available_slots: r.capacity ? Math.max(0, r.capacity - r.current_members) : 999,
        is_eligible: r.capacity ? r.current_members < r.capacity : true,
      }));
      res.json(eligible);

제거되는 정원 조건: .filter(r => r.is_eligible)
유지되는 eligibility 조건: is_eligible 계산식 유지 (정보 제공용 필드)
일반 회원 경로 영향: 없음 (보강용 eligible-classes 전용 API)

──────────────────────────────────────────
수정 ④ makeups.tsx:955~961
──────────────────────────────────────────

파일: artifacts/swim-app/app/(teacher)/makeups.tsx
위치: 배정 모달 renderOccRow

Before:
                    <Pressable
                      key={occ.occurrence_date}
                      style={[s.classRow, (occ.is_full && occ.is_future) && { opacity: 0.4 }]}
                      onPress={() => {
                        if (occ.is_full && occ.is_future) return;
                        setSelectedDate(occ.occurrence_date);
                        setSelectedOccurrence(occ);
                      }}
                      disabled={occ.is_full && occ.is_future}

After:
                    <Pressable
                      key={occ.occurrence_date}
                      style={[s.classRow]}
                      onPress={() => {
                        setSelectedDate(occ.occurrence_date);
                        setSelectedOccurrence(occ);
                      }}

제거되는 정원 조건: occ.is_full && occ.is_future (3곳)
유지되는 조건: 없음 (다른 disabled 조건 없음)
is_full 뱃지 (967~973): 변경 없음, 유지
일반 회원 경로 영향: 없음 (보강 배정 모달 전용)

──────────────────────────────────────────
수정 ⑤ ClassDetailSheet.tsx:1333~1337  (신규 발견)
──────────────────────────────────────────

파일: artifacts/swim-app/components/teacher/my-schedule/ClassDetailSheet.tsx
위치: renderOccRow (오늘 스케줄에서 보강 처리)

Before:
                          disabled={isSaving || (occ.is_full && occ.is_future)}
                        >
                          <LucideIcon name="calendar" size={16} color={occ.is_full && occ.is_future ? C.textMuted : "#4F46E5"} />
                          <View style={{ flex: 1 }}>
                            <Text style={[cds.moveClassName, (occ.is_full && occ.is_future) && { color: C.textMuted }]}>

After:
                          disabled={isSaving}
                        >
                          <LucideIcon name="calendar" size={16} color="#4F46E5" />
                          <View style={{ flex: 1 }}>
                            <Text style={[cds.moveClassName]}>

제거되는 정원 조건: (occ.is_full && occ.is_future) — 3곳
유지되는 조건: isSaving (처리 중 중복 클릭 방지, 정원과 무관)
is_full 뱃지 (1341~1346): 변경 없음, 유지
일반 회원 경로 영향: 없음 (보강 전용 모달)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
종합 요약
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. 정확한 수정 파일                 3개
2. 정확한 함수/Route               5곳
3. 변경 전 코드                     위 각 수정 ①~⑤ Before 참조
4. 변경 후 코드                     위 각 수정 ①~⑤ After 참조
5. 정원 조건 중 제거되는 부분       HAVING, CLASS_FULL 블록, .filter(), UI disabled (occ.is_full 관련만)
6. 유지되는 eligibility 조건        is_eligible 계산식 유지, isSaving 유지, 날짜/반/요일/휴일 검증 전부 유지
7. 일반 회원 정원 제한 무변경 증거  students.ts capacity 코드 없음, class-groups.ts CRUD만, admin.ts enrollment capacity gate 없음
8. teacher/admin 동작 일치          teacher assign → CLASS_FULL 제거, admin assign → 원래부터 없음
9. UI 경고 뱃지 유지                is_full 뱃지 3곳 유지 (makeups.tsx 2곳, ClassDetailSheet.tsx 1곳)
10. 날짜 로직 무변경                validateMakeupDateRange, getMakeupDateRange, ASSIGN_REQUIRES_FUTURE_DATE, MAKEUP_EXPIRED_CONFIRM_REQUIRED 전부 생존
11. Auth/JWT/Login 무변경           변경 파일에 해당 없음
12. DB schema 무변경               DB 변경 없음
13. 테스트 계획                     서버 검증 6케이스 (eligible-classes 정원찬반 포함, assign 200, 날짜범위 회귀, 미래전용 회귀, 만료 회귀)
14. Rollback                       git revert 1커밋으로 5곳 원복 가능
15. 구현 승인 가능 여부             검수 완료. 승인 후 구현 진행 가능.

코드 수정·Commit·Push·Render·OTA 없음.
설계서 제출 후 중단.
