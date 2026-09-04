# SWIMNOTE X — 최종 실행순서 및 개발 통제 헌법
> 확정일: 2026-08-02 | 이 문서는 PART 1·2·3 전체 완료까지 변경 불가
> 기술 설계 기준: docs/swimnote-x-design-final-v3.3.4.md

---

## 헌법 전제

v3.3.4 기술 설계는 유지한다. 변경된 것은 오직 실행순서(PART 분리)뿐이다.

**임의 변경 금지 항목:**
DB 구조 · 컬럼 · ENUM · Constraint · Index · Global Template 구조 · Advisory Lock ·
Audit 구조 · AI Contract V1.3 · candidate_id · MatchTokenV2 · HMAC 검증 · Growth Event ·
Confidence Config · Evidence 검증 · 학생 비식별화 정책 · Parent AI Reservation ·
Growth Report 버전 추적 · Migration 실패 정책 · Rollback 설계

---

## 헌법 10조

### 1조 — 설계 고정
승인된 전체 설계와 실행순서를 중간에 임의 변경하지 마십시오.

**금지:**
새 기능 임의 추가 / 기존 기능 임의 삭제 / 테이블·컬럼·API·상태값 임의 추가 /
설계에 없는 자동화·fallback·Background Job 추가 / 다음 PART·WP 선행 구현 /
"향후 필요할 것 같다"는 이유로 범위 확장 / Repository 구조를 이유로 승인된 설계를 다른 구조로 대체

더 단순한 구조가 있다고 판단되면 구현하지 말고 설계 단계에서 대안으로만 보고하십시오.

### 2조 — Repository 확인 우선
Repository에서 직접 확인하지 않은 내용을 사실처럼 보고하지 마십시오.

모든 보고는 다음 세 가지 중 하나로 구분하십시오:
- **REPOSITORY_VERIFIED**
- **NOT_FOUND**
- **NEEDS_VERIFICATION**

추정한 내용을 REPOSITORY_VERIFIED로 표시하면 안 됩니다.

### 3조 — WP별 사전 설계 승인
모든 WP는 아래 순서를 지킵니다:

```
Repository 조사
→ 현재 구조 보고
→ 해당 WP 설계 계획 제출
→ 수정 파일·함수·Contract·테스트 제출
→ 사용자 검수
→ 사용자 승인
→ 해당 WP만 구현
→ 구현 결과 제출
→ 실제 코드 재확인
→ 타입체크·테스트
→ 일반모드 회귀검증
→ 사용자 승인
→ 다음 WP
```

설계 계획을 제출한 뒤 사용자 승인 전에는 코드를 수정하지 마십시오.

### 4조 — 구현 후 증거 제출
"완료했습니다"라는 문장만으로 완료 처리하지 않습니다.

구현 후 반드시 제출:
1. 실제 수정 파일 / 2. 실제 수정 함수 / 3. 핵심 코드 위치 / 4. 변경 전·후 동작 /
5. 실행한 명령 / 6. 타입체크 결과 / 7. 테스트 결과 / 8. 일반모드 회귀테스트 결과 /
9. 실패한 테스트 / 10. 미완료 항목 / 11. 실제 로그 또는 응답 / 12. Commit 여부 / 13. 배포 여부

실행하지 않은 테스트를 통과했다고 보고하지 마십시오.

### 5조 — 오류 은폐 금지
**금지:**
```
.catch(() => {})
.catch((error) => { console.error(error); /* 이후 단계 계속 진행 */ })
```
Migration이나 핵심 초기화 단계가 실패하면 즉시 throw하고 이후 단계를 중단하십시오.

### 6조 — 일반모드 보호
일반 SWIMNOTE의 기존 기능을 변경하지 마십시오.

**보호 대상:**
로그인 · 회원관리 · 학생관리 · 반관리 · 선생님 관리 · 학부모 연결 · 출결 · 일정 · 공지 ·
앨범 · 사진·영상 · 보강 · 일지·수업피드 · 음성입력 · 기존 AI 일지 · 기존 템플릿 ·
기존 구독 · 저장공간 · 푸시 · 홈페이지 · 슈퍼어드민 기존 기능 ·
기존 RevenueCat 상품 · 기존 API Contract · 기존 앱 저장 흐름

일반모드에서 X 기능을 제외할 때는 비노출 / Route 차단 / API Guard / 권한 차단 / 잠금만 사용.
실제 코드 삭제는 PART 3 승인 후에만 검토.

### 7조 — 운영 변경 통제
**별도 승인 전 금지:**
Migration 실행 · Production DB 변경 · Commit · Push · OTA · Render 배포 ·
서버 재시작 · RevenueCat 상품 생성 · 샘플 데이터 생성 · 토이키즈 X모드 전환

코드를 작성하도록 승인받았더라도 배포까지 승인받은 것은 아닙니다.

### 8조 — 범위 외 작업 금지
현재 승인된 WP 외의 작업을 하지 마십시오.

예: WP1 진행 중 WP2 함수 생성 금지 / PART 1 진행 중 Parent AI 테이블 생성 금지 /
성장판 구현 중 성장리포트 평가항목 생성 금지 / Migration 작업 중 샘플 데이터 삽입 금지

### 9조 — 사용자 승인 없는 자동 결정 금지
**승인 필수:**
상태값 변경 · 데이터 삭제 정책 · 자동 승인 기준 · 자동 폐기 기준 ·
결제 정책 · 리포트 평가항목 · Confidence threshold 변경 · 일반모드 기능 삭제 ·
토이키즈 전환 · Production 배포

### 10조 — 문서와 코드 불일치 처리
v3.3.4와 실제 Repository가 다르면 임의로 맞추지 마십시오.

다음 형식으로 보고:
```
설계 문서:
실제 Repository:
불일치:
영향:
선택지 A:
선택지 B:
권장안:
```
사용자 승인 후에만 처리합니다.

---

## X모드 판정 기준

```
xmode_entitlement = true AND xmode_config_status = READY  →  X모드
xmode_entitlement = false                                 →  일반모드 또는 X 접근 차단
xmode_entitlement = true AND xmode_config_status != READY →  X 준비중
```

앱이 로컬 상태나 버튼으로 X모드를 임의 활성화하면 안 됩니다.

---

## 전체 실행순서

### PART 1 — SWIMNOTE X모드 구현

| WP | 이름 | 핵심 내용 |
|----|------|----------|
| WP0 | 일반모드 기준선 고정 | Repository 조사 (코드 수정 금지) |
| WP1 | PART 1 최소 DB Migration | swimming_pools xmode 컬럼, global_template_sets, curriculum 테이블, audit, growth_events |
| WP2 | X모드 상태·권한 Backend | resolvePoolMode, requireXMode, getXModeCapabilities |
| WP3 | 앱 전역 Mode Context | 로그인 후 mode 조회, Pool Context, 전환 시 캐시 처리 |
| WP4 | X 외형·메뉴·화면 분기 | X 로고·색상·메뉴, 화면 분기, 학부모 출시예정 모달 |
| WP5 | 일반/X 1차 격리검증 | POOL_A=일반, POOL_B=X 샘플. 통과 조건: 일반모드 변화 0 |
| WP6 | 커리큘럼 의뢰 Backend | 의뢰·상태·첨부파일·슈퍼어드민 검토·Audit |
| WP7 | 슈퍼어드민 X 관리 화면 | X 수영장 목록, entitlement, 커리큘럼 의뢰 |
| WP8 | 수영장 관리자 X 설정 화면 | X 상태, 커리큘럼 의뢰, READY 전환 |
| WP9 | 커리큘럼 버전·학생별 배정 | 버전 생성, 학생 배정, 이전 버전 보존 |
| WP10 | Global Template Set 관리 | DRAFT→ACTIVE, Advisory Lock, Audit |
| WP11 | X 글로벌 일지 템플릿 50개 | scope=x_global, ACTIVE 세트, 일반모드 노출 금지 |
| WP12 | AI 일지 검색 분기 | 일반모드 기존 유지, X모드 자체+x_global 보완 |
| WP13 | Curriculum Candidate + AI V1.3 | candidate_id, MatchTokenV2, HMAC, Evidence |
| WP14 | 최종 일지 저장 → Growth Event | Match Token 검증, Growth Event 생성, 멱등성 |
| WP15 | 교사 매칭 확인 UI | PENDING_REVIEW 승인/거절, 성장판 포함/제외 |
| WP16 | 수영 성장판 Backend | 완료항목/배정항목×100, 2회 이상 조건 |
| WP17 | X 학부모 성장판 화면 | 진도·완료·진행중·다음목표 (리포트·결제 금지) |
| WP18 | 샘플 X 전체 E2E | 전체 흐름 검증 |
| WP19 | 일반모드 최종 회귀검증 | 통과 조건: 일반모드 기능 변화 0 |
| WP20 | 토이키즈스윔클럽 X모드 전환 | WP18·19 통과 후, 백업·샘플 검증 선행 |

### PART 2 — 학부모 AI·성장리포트·결제 (PART 1 완료 전 시작 금지)

WP21 Parent AI 설계 확정 / WP22 Parent AI Backend (PART 2 Migration) /
WP23 Parent AI 앱 화면 / WP24 성장리포트 실제 설계 확정 (임의 설계 금지) /
WP25 리포트 데이터 추출·분석 / WP26 리포트 화면·PPT / WP27 학부모 결제 / WP28 PART 2 E2E

### PART 3 — 일반모드 기능 정리 (PART 1·2 완료 전 시작 금지)

WP29 일반모드 기능 분류 / WP30 UI 노출 정리 / WP31 Backend 접근 차단 /
WP32 Dead Code 제거 (별도 승인 후) / WP33 전체 최종 회귀검증

### WP1 포함/제외 목록

**포함:** swimming_pools xmode 5컬럼 · global_template_sets · diary_templates x_global 확장 ·
curriculum_versions · curriculum_items · student_curriculum_assignments · curriculum_requests ·
curriculum_request_files · audit_entity_versions · next_audit_version() · audit_logs · growth_events · growth_match_status_enum

**제외 (PART 2에서 실행):** parent_ai_daily_usage · parent_ai_usage_reservations · growth_reports ·
report_files · deep_report_orders · Parent AI 대화 구조 · PPT 구조

---

## §7 — 매 WP 사전 설계서 형식 (제출 후 승인 전 구현 금지)

```
1. WP 목표
2. 포함 범위
3. 제외 범위
4. Repository 실제 조사 결과
5. 현재 호출 흐름
6. 변경 후 호출 흐름
7. 수정 파일
8. 수정 함수
9. 신규 파일
10. DB 변경
11. API Contract 변경
12. 앱 영향
13. 일반모드 영향
14. 인증·권한 영향
15. 캐시 영향
16. 개인정보 영향
17. Migration 순서
18. 실패 즉시 중단 구조
19. 멱등성
20. Rollback
21. 테스트 목록
22. 일반모드 회귀테스트
23. 위험요소
24. NEEDS_VERIFICATION
25. 더 단순한 대안
26. 구현 후 제출할 증거
```

---

## §8 — 매 WP 구현 후 증거 형식

```
1. 실제 수정 파일 목록
2. 실제 수정 함수 목록
3. 핵심 코드 위치
4. 설계와 구현 대조표
5. 계획과 달라진 부분
6. 변경 이유
7. 실행한 명령
8. 타입체크 원문
9. 테스트 원문
10. 실패 테스트
11. API 요청·응답 마스킹본
12. DB 검증 쿼리와 결과
13. 일반모드 회귀 결과
14. X모드 테스트 결과
15. Commit hash 또는 미Commit 상태
16. Push 여부
17. Migration 실행 여부
18. 배포 여부
19. 미완료 사항
20. 다음 WP 진입 가능 여부
```
실제 실행 결과가 없으면 미실행이라고 표시하십시오.

---

## §11 — 헌법 최초 확인 응답 형식

```
1. v3.3.4 기술 설계를 유지한다는 확인
2. 실행순서만 PART 1·2·3으로 재배치됐다는 확인
3. 중간 설계 변경·기능 추가를 하지 않겠다는 확인
4. 모든 WP 전 Repository 조사와 설계서를 제출하겠다는 확인
5. 모든 WP 후 실제 코드·테스트 증거를 제출하겠다는 확인
6. 현재는 WP0 조사와 WP1 설계만 하겠다는 확인
7. 코드 수정·Migration 실행·Commit·Push·배포를 하지 않겠다는 확인
```

---

*확정: 2026-08-02 | 상태: PART 1 WP0 진입 대기*
