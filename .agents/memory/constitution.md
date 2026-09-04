---
name: SWIMNOTE X 개발 통제 헌법
description: PART 1·2·3 전체 완료까지 변경 불가한 개발 통제 원칙. 모든 작업 전 반드시 확인.
---

# SWIMNOTE X 개발 통제 헌법

**파일 위치:** `docs/swimnote-x-constitution.md`
**복사 패널:** `docs/constitution-copier.html`
**기술 설계:** `docs/swimnote-x-design-final-v3.3.4.md`

## 헌법 10조 요약

| 조항 | 핵심 규칙 |
|------|----------|
| 1조 | 승인 없이 설계 변경·기능 추가·다음 WP 선행 구현 금지 |
| 2조 | REPOSITORY_VERIFIED / NOT_FOUND / NEEDS_VERIFICATION 으로만 보고 |
| 3조 | 설계서 제출 → 사용자 승인 → 구현 순서 필수 |
| 4조 | 수정 파일·타입체크·테스트·회귀 결과 모두 제출 |
| 5조 | `.catch(() => {})` 후 계속 진행 금지, 실패 즉시 throw |
| 6조 | 기존 일반모드 기능(로그인·출결·일지·AI 등) 변경 금지 |
| 7조 | Migration·Commit·Push·OTA·배포·서버 재시작은 별도 승인 후 |
| 8조 | 현재 WP 외 선행 구현 금지 |
| 9조 | 상태값·삭제정책·결제·threshold 등은 사용자 승인 필수 |
| 10조 | 불일치 발견 시 임의로 맞추지 말고 형식대로 보고 |

## 현재 상태

- **현재 단계:** WP0 Repository 조사 + WP1 설계서 제출 대기
- **현재 금지:** 코드 수정 / Migration 생성·실행 / DB 변경 / Commit / Push / 배포

## X모드 판정 기준

```
xmode_entitlement = true AND xmode_config_status = READY → X모드
xmode_entitlement = false                               → 일반모드
xmode_entitlement = true AND xmode_config_status != READY → X 준비중
```

## WP1 포함/제외

**포함:** swimming_pools xmode 5컬럼 · global_template_sets · diary_templates x_global ·
curriculum_versions·items·assignments·requests·request_files ·
audit_entity_versions · next_audit_version() · audit_logs ·
growth_events · growth_match_status_enum

**제외 (PART 2):** parent_ai_daily_usage · parent_ai_usage_reservations · growth_reports · PPT

## WP 전체 순서

### PART 1
WP0(기준선) → WP1(Migration) → WP2(Backend 권한) → WP3(Mode Context) →
WP4(외형 분기) → WP5(격리검증) → WP6(커리큘럼 의뢰) → WP7(슈퍼어드민) →
WP8(관리자 설정) → WP9(커리큘럼 배정) → WP10(Global Template) →
WP11(템플릿 50개) → WP12(AI 검색 분기) → WP13(AI Contract V1.3) →
WP14(Growth Event) → WP15(교사 UI) → WP16(성장판 Backend) →
WP17(학부모 화면) → WP18(E2E) → WP19(회귀검증) → WP20(토이키즈 전환)

### PART 2 (PART 1 완료 후)
WP21~WP28: Parent AI · 성장리포트 · 학부모 결제

### PART 3 (PART 1·2 완료 후)
WP29~WP33: 일반모드 정리 · Dead Code 제거 · 최종 검증

**Why:** 검증 범위 제어 + 일반모드 격리 보장 + 장애 원인 추적 가능성 확보
**How to apply:** 작업 시작 전 이 파일과 constitution.md 반드시 확인
