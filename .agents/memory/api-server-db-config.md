---
name: API 서버 DB 구성
description: Render.com과 swimnote.kr이 동일한 외부 DB를 사용한다는 확인 및 executeSql과의 차이
---

# API 서버 DB 구성

## 핵심 사실
- **Render.com API 서버**와 **swimnote.kr (Replit 배포)**는 같은 외부 PostgreSQL DB를 사용한다 (tsx 스크립트로 실제 학부모 계정 조회 확인)
- **`executeSql` (Replit code_execution)** 은 Replit 관리 PostgreSQL에 연결 → 앱 서버가 쓰는 실제 운영 DB와 **다름**
- 실제 운영 데이터 조회/수정은 `tsx` 스크립트로 `@workspace/db` 를 import해서 실행해야 함

## 읽기 전용 검증 시 안전 주의
개발 API 워크플로의 시작 로그에도 DB 초기화·스키마 보완·backfill 동작이 나타난다. 운영 DB 쓰기가 금지된 작업에서는 테스트가 로컬 mock만 사용하더라도 **워크플로 재시작을 읽기 전용 작업으로 간주하면 안 된다.**

**Why:** 개발 API가 운영 DB와 연결될 수 있으므로 서버 시작 자체가 데이터를 변경할 가능성이 있다.

**How to apply:** Production DB write 금지 요청 시 워크플로를 시작/재시작하기 전에 대상 DB와 startup side effect를 확인한다. 확인되지 않으면 로컬 무DB 단위 테스트만 실행하고 workflow 재시작을 생략한다. 이미 시작했다면 운영 무변경을 추정하거나 단정하지 않는다.

## API URL 전환 이력
- 앱은 `EXPO_PUBLIC_API_URL`로 API 서버 주소 결정
- Render.com (swimnote-api.onrender.com): 구버전 코드 배포 문제 있었음
- swimnote.kr: 최신 코드, 같은 DB, 2026-07-19 이후 앱이 사용 중

## DB 직접 수정 방법
```bash
cd artifacts/api-server
node_modules/.bin/tsx <스크립트.ts>
```
스크립트 내에서 `import { db } from "@workspace/db"` 로 실제 운영 DB 사용 가능.

**Why:** executeSql로 학부모 계정 검색 시 아무것도 안 나왔으나 tsx 스크립트로는 실제 데이터 발견. 두 DB 분리 확인.
