SWIMNOTE 보강 정원 초과 허용 — 설계도

현재 아키텍처 감사 완료.
REQ-4 충돌 위치 4곳 확정.

이번 단계는
코드 수정 → Push → Render 배포 → 서버 검증 → OTA 순으로 진행한다.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
목표 (REQ-4)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

정원이 초과된 반에도 보강 배정이 가능해야 한다.

현재: 정원 찬 반 → 목록에서 제외 또는 400 차단
목표: 정원 찬 반 → 경고 표시 후 선택·배정 허용

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 1. 코드 수정 대상 (4곳)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

① teachers.ts — eligible-classes HAVING 제거

파일: artifacts/api-server/src/routes/teachers.ts
위치: 660행

Before:
        HAVING GREATEST(0, cg.capacity - COUNT(s.id) FILTER (...)) > 0
        ORDER BY is_mine DESC, cg.schedule_days, cg.schedule_time

After:
        ORDER BY is_mine DESC, cg.schedule_days, cg.schedule_time

설명:
HAVING 절을 제거한다.
정원이 찬 반도 목록에 포함된다.
available_slots=0인 반도 반환된다.

─────────────────────────────

② teachers.ts — assign CLASS_FULL 차단 제거

파일: artifacts/api-server/src/routes/teachers.ts
위치: 904~907행

Before:
      // 미래 정원 마감은 서버에서 차단
      if (validation.isFull) {
        res.status(400).json({ error: "CLASS_FULL", message: "정원이 마감된 반에는 보강을 배정할 수 없습니다." }); return;
      }

After:
      (해당 블록 전체 삭제)

설명:
isFull 체크 블록을 완전히 제거한다.
정원 초과 여부는 validation 객체에 정보로 존재하지만 차단에 쓰지 않는다.
assign 이후 isFull 정보를 response에 포함하지 않아도 된다.

─────────────────────────────

③ admin.ts — eligible-classes filter 제거

파일: artifacts/api-server/src/routes/admin.ts
위치: 1792행

Before:
      }).filter(r => r.is_eligible);

After:
      });

설명:
.filter(r => r.is_eligible) 를 제거한다.
is_eligible 계산 자체(1788~1791행)는 유지한다.
정원 찬 반도 응답에 포함된다.
관리자 화면에서 정원 찬 반을 선택 가능해진다.

─────────────────────────────

④ teacher/makeups.tsx — UI disabled 제거

파일: artifacts/swim-app/app/(teacher)/makeups.tsx
위치: 955~961행

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

설명:
- opacity: 0.4 조건부 스타일 제거
- onPress 내부 occ.is_full && occ.is_future return 가드 제거
- disabled prop 제거
- is_full 뱃지("정원마감"/"정원초과") 표시는 유지 (967~973행 변경 없음)
- 경고는 보여주되 선택을 막지 않는다

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 2. 변경 불가 항목
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

다음은 수정하지 않는다.

- validateMakeupOccurrence 함수 — isFull 계산 유지 (정보 제공)
- eligible-occurrences 응답 구조 — is_full, available_slots 유지
- complete-direct — 이미 isFull 체크 없음
- admin assign — 이미 isFull 체크 없음
- teacher complete — 이미 isFull 체크 없음
- is_full 뱃지 UI (967~973행) — 경고 표시 유지
- 날짜 범위 로직 — ASSIGN_REQUIRES_FUTURE_DATE 유지
- MAKEUP_EXPIRED_CONFIRM_REQUIRED — 유지
- DB schema — 변경 없음
- Auth / JWT / 로그인 / 일지 / AI 일지 — 변경 없음

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 3. 변경 파일 목록
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- artifacts/api-server/src/routes/teachers.ts
- artifacts/api-server/src/routes/admin.ts
- artifacts/swim-app/app/(teacher)/makeups.tsx

총 3개 파일

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 4. 서버 검증 케이스 (배포 후)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

서버 배포 완료 후 아래를 확인한다.
운영 데이터는 변경하지 않는다.

① eligible-classes — 정원 찬 반 포함 여부

GET /teacher/makeups/eligible-classes?all=true

→ available_slots=0 인 반이 응답에 포함되어야 함

② eligible-classes — admin

GET /admin/makeups/eligible-classes

→ is_eligible=false 인 반도 응답에 포함되어야 함

③ assign — 정원 찬 반에 배정

PATCH /teacher/makeups/{id}/assign
body: { class_group_id: "정원찬반ID", assigned_date: "오늘+1일" }

→ 200 (CLASS_FULL 400이 나오면 실패)

④ 기존 날짜 범위 검증 — 회귀

PATCH /teacher/makeups/{id}/assign
body: { assigned_date: "오늘+29일" }

→ 400 MAKEUP_DATE_OUT_OF_RANGE

⑤ 기존 미래 전용 검증 — 회귀

PATCH /teacher/makeups/{id}/assign
body: { assigned_date: "오늘" }

→ 400 ASSIGN_REQUIRES_FUTURE_DATE

⑥ 기존 만료 검증 — 회귀

expired 상태 보강에 allow_expired 없이 assign

→ 409 MAKEUP_EXPIRED_CONFIRM_REQUIRED

HTTP 코드와 error code만 제출한다.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 5. 앱 검증 케이스 (OTA 후 실기기)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

내가 실기기에서 직접 확인한다.

- 보강 배정 모달 → 정원 찬 반이 목록에 표시되는지
- 정원 찬 반 선택 후 회차 목록에서 정원마감 뱃지가 표시되는지
- 정원마감 뱃지 있는 회차를 선택 가능한지 (차단 없어야 함)
- 배정 버튼 누르면 성공하는지
- 기존 날짜 범위 (-14일 ~ +28일) 동작 이상 없는지
- 로그인 / 일지 / AI 기능 영향 없는지

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 6. 배포 제출 항목
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Branch
2. Local HEAD (commit SHA)
3. Origin HEAD
4. git status --short
5. Render Deploy ID
6. Render Started At
7. Render Finished At
8. Render Status = Live
9. GET /api/health — HTTP Status / version / timestamp
10. 서버 검증 결과 (케이스 ①~⑥)
11. OTA Update Group ID
12. runtimeVersion
13. updateId
14. bundle SHA-256
15. 변경 파일 목록
16. DB 변경 여부 = 없음
17. Auth/JWT/로그인/일지 변경 여부 = 없음

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
주의사항
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- DB 변경 금지
- 추가 Commit 금지 (4곳 수정 1 commit)
- JWT / Auth 수정 금지
- 로그인 수정 금지
- 일지 / AI 일지 수정 금지
- OTA는 Render 배포 완료 후에만 진행

배포 완료 후 중단.
실기기 검증은 내가 직접 한다.
