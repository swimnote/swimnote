---
name: 임시 PostgreSQL 검증
description: 외부 테스트 DB를 사용할 수 없을 때 운영 DB를 대체로 쓰지 않고 실제 SQL 경쟁을 검증하는 경계
---

실제 PostgreSQL claim/lease 경쟁을 검증할 때 외부 테스트 DB가 연결되지 않으면, 운영 DB로 테스트를 우회하지 않는다. 격리된 임시 로컬 DB와 테스트 전용 데이터만 사용한다.

**Why:** 운영 데이터는 claim 경쟁이나 fixture 정리의 대상이 될 수 없다. 이 환경에서는 일회성 shell에서 daemon을 시작해도 이후 호출 사이에 프로세스가 종료될 수 있어, 연결 실패를 SQL 결함으로 오인하기 쉽다.

**How to apply:** 임시 PostgreSQL은 명시적 background shell task로 실행하고 테스트 동안 유지한다. 테스트 URL은 localhost와 테스트 전용 DB 이름을 확인한 뒤 허용한다. 검증 후 background task를 종료한다. 임시 fixture 검증과 운영 migration/배포 검증 결과는 구분하여 보고한다.