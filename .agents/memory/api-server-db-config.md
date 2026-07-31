---
name: API 서버 DB 구성
description: Render.com과 swimnote.kr이 동일한 외부 DB를 사용한다는 확인 및 executeSql과의 차이
---

# API 서버 DB 구성

## 핵심 사실
- **Render.com API 서버**와 **swimnote.kr (Replit 배포)**는 같은 외부 PostgreSQL DB를 사용한다 (tsx 스크립트로 실제 학부모 계정 조회 확인)
- **`executeSql` (Replit code_execution)** 은 Replit 관리 PostgreSQL에 연결 → 앱 서버가 쓰는 실제 운영 DB와 **다름**
- 실제 운영 데이터 조회/수정은 `tsx` 스크립트로 `@workspace/db` 를 import해서 실행해야 함

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
