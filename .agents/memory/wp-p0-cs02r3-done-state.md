---
name: P0-CS02R-3 완료 상태
description: support-cases message INSERT sql.raw() 파라미터 버그 수정 — 실기기 "서버 오류" 원인
---

## 증상
POST /support/cases/:id/messages → 500 → 앱 "서버 오류" (catch block)

## ROOT CAUSE
sql.raw(template, paramsArray) — drizzle-orm sql.raw()는 두 번째 인자를 무시.
PostgreSQL이 $1..$8 미바인딩으로 42P02 (there is no parameter $1) 반환.

배포 로그 증거:
  2026-08-17 08:22:01 ERROR
  cause: error: there is no parameter $1, code: 42P02
  query: INSERT INTO support_ticket_replies (...) VALUES ($1, $2, ...) params: []

## 수정
artifacts/api-server/src/routes/support-cases.ts line 249
  BEFORE: sql.raw(template, [msgId, caseId, ...])
  AFTER:  sql`INSERT ... VALUES (${msgId}, ${caseId}, ..., ${sql.raw(`'${imgsLit}'::text[]`)})`

**Why:** drizzle sql.raw()는 raw string only — parameterized query는 반드시 sql`` template literal 사용.
**How to apply:** execute() 인자가 sql.raw(str, params) 패턴이면 무조건 sql`` template으로 교체.

## 확인된 추가 사실
- swimnote.kr = `node dist/index.mjs` (dist 기반, args 로그 확인)
- POST /support/cases (case INSERT) = sql`` template → 정상 동작
- [cs-01r] schema migration = 성공 (08:16:33 / 08:17:00 로그 확인)
  - ticket_id nullable: YES
  - case_id, message_type 컬럼: EXISTS
- Render live commit = bc3f0105 (Aug 16) — CS-01R/02R 이전 → Render 404 확인됨
  (mobile은 swimnote.kr 사용, Render 직접 사용 안 함)
- SUPABASE_DATABASE_URL 로컬 직접 접속 불가 (password auth failed — pooler 접속만 가능)

## 배포
SHA: 2367862d
Tests: 45/45 cs-02r, 1440/1440 full
Render: auto-deploy 2367862d
swimnote.kr: REPLIT PUBLISH 필요 (dist force-add + push 완료)
iOS OTA: 01a00eb5 (error UX — 이전 세션)
