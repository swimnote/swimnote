# DATABASE_RECOVERY_GUIDE.md — DB 복구 가이드

---

## 1. DB 현황

| 항목 | 내용 |
|------|------|
| DBMS | PostgreSQL |
| 호스팅 | Supabase (ap-south-1, 서울) |
| ORM | Drizzle ORM |
| 스키마 관리 | `db:push` (마이그레이션 파일 없음) |
| 스키마 위치 | `packages/db/src/` |

### DB 구성

| DB | 환경변수 | 용도 |
|----|----------|------|
| 메인 DB | `SUPABASE_DATABASE_URL` | users, swimming_pools, teacher_invites, phone_verifications, push 알림 설정 등 |
| 풀별 DB | `POOL_DATABASE_URL` | parent_accounts, schedules, diary, attendance 등 |
| 보호 백업 DB | `SUPER_PROTECT_DATABASE_URL` | 자동 백업 (선택) |

---

## 2. 스키마 복구 방법

### 전제조건
- Supabase에서 새 프로젝트 생성
- DB 연결 URL 취득

### 스키마 적용 절차

```bash
# 1. DB 환경변수 설정
export SUPABASE_DATABASE_URL="postgresql://postgres:[PW]@db.[ID].supabase.co:5432/postgres"
export POOL_DATABASE_URL="postgresql://postgres:[PW]@db.[ID].supabase.co:5432/postgres"

# 2. DB 스키마 push (Drizzle)
pnpm --filter @workspace/db run db:push

# 또는 API 서버 실행 시 자동 init (초기화 코드 내장)
pnpm --filter @workspace/api-server run dev
# 서버 시작 시 [super-db-init], [pool-db-init] 로그 확인
```

### 자동 초기화 항목
API 서버 시작 시 다음 테이블/컬럼이 자동으로 생성/보완됨:
- `swimming_pools` (수영정보 컬럼 보완)
- `backup_logs`, `restore_logs`
- `phone_verifications`
- `payment_logs`, `revenue_logs`
- `parent_content_reads`

---

## 3. 주요 테이블 구조 요약

### 메인 DB (`SUPABASE_DATABASE_URL`)
```
users                  — 관리자, 선생님, 슈퍼어드민 계정
swimming_pools         — 수영장 정보 (승인 상태, 플랜 등)
teacher_invites        — 선생님 초대 코드
phone_verifications    — SMS 인증 코드
pool_push_settings     — 수영장별 푸시 알림 설정
payment_logs           — 결제 기록
revenue_logs           — 매출 기록
backup_logs            — DB 백업 기록
restore_logs           — DB 복원 기록
```

### 풀별 DB (`POOL_DATABASE_URL`)
```
parent_accounts        — 학부모 계정 (login_id, phone, pin_hash 등)
students               — 학생 정보
schedules              — 수업 일정
attendance             — 출결 기록
diary_entries          — 일지
announcements          — 공지사항
swimming_levels        — 수영 레벨
```

---

## 4. Supabase 백업/복원 절차

### 수동 백업 (Supabase 콘솔)
1. Supabase 프로젝트 → Settings → Database
2. "Backups" 탭 → Point-in-Time Recovery 또는 수동 다운로드

### pg_dump 사용
```bash
pg_dump "postgresql://postgres:[PW]@db.[ID].supabase.co:5432/postgres" \
  -Fc -f swimnote_backup_$(date +%Y%m%d).dump

# 복원
pg_restore -d "postgresql://postgres:[PW]@[NEW_DB]/postgres" \
  swimnote_backup_YYYYMMDD.dump
```

### 프로젝트 내 자동 백업
API 서버의 `backup-batch` 기능이 매일 03:00 자동 증분 백업 실행 (`SUPER_PROTECT_DATABASE_URL` 설정 시)

---

## 5. 새 환경에서 DB 복구 순서

```
1. Supabase에서 새 프로젝트 생성 (ap-south-1 권장 — 지연 최소화)
2. DATABASE_URL 취득
3. 환경변수에 설정
4. pnpm --filter @workspace/api-server run dev 실행
5. 서버 시작 로그에서 [super-db-init], [pool-db-init] 완료 확인
6. curl http://localhost:8080/api/healthz → 200 확인
7. 운영 데이터 복원 (pg_restore 사용)
```
