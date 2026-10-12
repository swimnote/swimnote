---
name: 임시 PostgreSQL 검증
description: 외부 테스트 DB를 사용할 수 없을 때 운영 DB를 대체로 쓰지 않고 실제 SQL 경쟁을 검증하는 경계
---

실제 PostgreSQL claim/lease 경쟁을 검증할 때 외부 테스트 DB가 연결되지 않으면, 운영 DB로 테스트를 우회하지 않는다. 격리된 임시 로컬 DB와 테스트 전용 데이터만 사용한다.

**Why:** 운영 데이터는 claim 경쟁이나 fixture 정리의 대상이 될 수 없다. 이 환경에서는 일회성 shell에서 daemon을 시작해도 이후 호출 사이에 프로세스가 종료될 수 있어, 연결 실패를 SQL 결함으로 오인하기 쉽다.

**How to apply:** 임시 PostgreSQL은 명시적 background shell task로 실행하고 테스트 동안 유지한다. 테스트 URL은 localhost와 테스트 전용 DB 이름을 확인한 뒤 허용한다. 검증 후 background task를 종료한다. 임시 fixture 검증과 운영 migration/배포 검증 결과는 구분하여 보고한다.

## Fixture 스키마와 정상 경로를 먼저 검증

SQL fixture는 ORM 선언만으로 만들지 않는다. 실제 경로의 raw SQL과 실패·중복 요청 분기가 사용하는 스키마까지 포함한다. 정상 가입이 fixture에서 성공하지 않았다면 실패 시 알림이 없다는 테스트 결과를 제품 검증 근거로 삼지 않는다.

**Why:** ORM 선언에 없는 운영 컬럼과 중복 요청 분기의 조회 컬럼이 fixture에서 빠져 정상 요청도 실패한 사례가 있었다. 이런 fixture 오류는 알림 미발송 테스트를 거짓으로 통과시키거나 실제 중복 발송 문제를 가린다.

**How to apply:** 실제 호출 경로의 SQL과 읽기 전용 운영 스키마를 대조하고 정상·중복 요청 경로가 의도대로 실행되는지 먼저 확인한다. 그 후 실패 주입·알림 재처리를 검증하며, fixture 설정 오류와 제품 코드의 실패를 구분해 보고한다.