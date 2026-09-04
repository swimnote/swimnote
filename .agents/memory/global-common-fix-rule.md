---
name: SWIMNOTE GLOBAL COMMON-FIX RULE
description: Normal SWIMNOTE + SWIMNOTE X 공통 수정 원칙 — 모든 작업 시작 전 자동 적용
---

## 핵심 원칙 (10조)

**기본**: 특별히 "X모드 전용 수정"이라고 명시된 경우를 제외하면 모든 수정은 Normal + X 공통으로 처리.

### 1단계 — 먼저 확인할 것
해당 기능이 동일 screen / component / route / API / shared primitive / source of truth를 공유하는지 확인.

### 공통 구조인 경우 (ONE SOURCE FIX + BOTH MODE VERIFICATION)
- source of truth 한 곳만 수정
- 같은 코드를 양쪽에 중복 수정하지 않음
- 수정 후 Normal/X 양쪽에서 회귀검증

### 분기 구현인 경우 (`mode === "x"` / `XModeGuard` / 별도 X component·route)
1. Normal에서 동일 버그 존재 여부 확인
2. X에서 동일 버그 존재 여부 확인
3. 실제 문제가 있는 분기만 수정
4. 불필요하게 양쪽 동시 변경 금지

### X 전용으로 제한할 작업 (이것만 X 범위)
X 전용 AI 기능 / X entitlement / X config / X setup / X Growth / X Steel Blue identity / X 결제·가맹 / X 전용 커리큘럼 / X 전용 권한

### 공통 기능 (아래는 기본적으로 공통 여부 먼저 확인)
회원 / 학생 / 반 / 스케줄 / 출결 / 휴무일 / 보강 / 수동 일지 / 사진·앨범 / 공지 / 알림 / 메시지 / 설정 / 로그인·회원가입 / Modal / Sheet / Input / Keyboard / Navigation / Header / Button / 공통 디자인 / 공통 텍스트

### 중복 구현 금지
공통 문제 해결 시 Normal용 새 component + X용 새 component 각각 생성 금지.
기존 shared component를 수정할 수 있으면 shared source 우선.

## 작업 지시문 자동 적용 문구

X 전용이 아닌 모든 작업에 자동 적용:
> "본 작업은 Normal SWIMNOTE와 SWIMNOTE X 공통 기능으로 간주한다.
> 먼저 양쪽이 동일 source/component/route를 공유하는지 확인한다.
> 공통 구조라면 source of truth 한 곳만 수정하고 Normal/X 양쪽을 검증한다.
> 분기 구현이면 양쪽에서 동일 문제가 존재하는지 확인하고 필요한 범위만 각각 수정한다.
> 불필요한 중복 수정은 금지한다."

## 완료 보고 항목 (공통 수정 시)
1. SHARED SOURCE?
2. NORMAL PATH
3. X PATH
4. MODIFIED SOURCE
5. NORMAL RESULT
6. X RESULT
7. DUPLICATE CHANGE?
8. BUSINESS LOGIC CHANGE?
9. DB/API CHANGE?
10. TEST RESULT

**Why:** Normal/X 분기 때문에 한쪽만 고쳐 다른 쪽에 regression이 반복됐음. 단일 소스 원칙으로 중복 버그와 중복 수정을 동시에 방지.
**How to apply:** 작업 시작 시 §1 확인 → 공통이면 ONE SOURCE → 분기이면 양쪽 스캔 후 필요한 곳만. 완료 보고에 NORMAL RESULT / X RESULT 항상 포함.
