---
name: 성장리포트 APP↔ENGINE 계약 검증
description: 별도 저장소 간 성장리포트 요청 계약을 대조할 때 놓치기 쉬운 비호환 및 안전성 조건
---

성장리포트 계약 판정은 APP 타입만으로 하지 않는다. 별도 GitLab AI ENGINE의 현재 수신 타입·검증·실행 코드를 읽기 전용으로 함께 대조한다. ENGINE의 실제 배포 버전도 확인하기 전에는 저장소 코드가 운영 중인 코드라고 단정하지 않는다.

**Why:** APP의 일부 분석 보조 데이터는 snapshot 안에 실리지만 ENGINE은 요청의 최상위 필드에서 읽어 기본값으로 대체할 수 있다. APP가 월 경계로 쿼리하더라도 전송된 analysis_from은 비어 있을 수 있고, ENGINE의 cutoff 검사가 경계와 정확히 같은 시각을 허용할 수 있다. DB registry의 오류 시 비영속 fallback과 완료 기록 실패 후 성공 응답도 코드상 가능하다. 각 저장소 단독 테스트만으로는 발견하기 어렵다.

**How to apply:** 월간 자동발급 준비 판정 전에 최종 wire JSON과 ENGINE의 실제 소비 위치, KST 반개구간, 영속 idempotency, 양쪽 타임아웃을 교차 검증한다. 비호환·fail-open이 해소되고 합성 데이터로 통합 검증되기 전에는 계약/대량처리를 PASS 처리하지 않는다. 별도 ENGINE 저장소에 직접 커밋하면 자동 배포될 수 있으므로 작업 승인 범위를 먼저 확인한다.

## Recovery 응답의 혼합 상태

조회 응답의 유효 상태가 UNKNOWN이고 provider 상태도 UNKNOWN이면, 내부 registry 상태가 FAILED여도 확정 실패나 안전한 재시도로 해석하지 않는다.

**Why:** 운영 조회 응답에서 UNKNOWN과 registry FAILED가 함께 반환되고 분석 재시도는 명시적으로 금지되는 계약을 확인했다. registry 상태만 읽으면 provider 결과 불확실성을 무시한 중복 분석으로 이어질 수 있다.

**How to apply:** recovery 결과 분류는 조회 계약의 유효 상태와 provider 상태를 함께 기준으로 삼는다. 불확실성 해제·결과 저장은 해당 identity의 검증된 완료 결과가 있을 때만 수행한다. ENGINE 코드 대조는 사용자가 승인한 범위에서만 한다.