---
name: Pool-First 2.0.0 Account Architecture 완료
description: SWIMNOTE 2.0.0 Pool-First 계정 독립 구조 활성화 전체 구현 상태
---

## 완료 항목

**SHA**: 761fdfbb → release/v2.0.0  
**OTA iOS**: 01a04e47 (update group 01c4054c-61ea-495f-bc3f-cd591ff972ed)  
**채널**: production-v2 / branch: release-2.0.0  
**Render**: release/v2.0.0 push로 자동 배포 트리거됨

## 핵심 변경

1. **parent-login.tsx**: 수영장 선택(debounce pool search) → 자격증명 순서. pool_id 필수 전달.
2. **SessionContext.parentLogin()**: `poolId?: string` 3번째 인자 추가, 서버에 pool_id 전달.
3. **auth.ts /find-identifier-by-phone**: parent 계정 응답에 `pool_id` 포함 (reset-password 스코핑용).
4. **forgot-password.tsx**: resetPassword()에 pool_id 포함, 이후 자동로그인도 pool_id 전달.
5. **pool-db-init.ts**: UNIQUE INDEX `idx_parent_accounts_pool_phone` (swimming_pool_id, normalized phone) — duplicate check 후 안전하게 추가.

## 서버 기존 구현 확인

- `/parent-login`: pool_id scoping 이미 구현됨 ✅
- `/reset-password`: pool_id scoping 이미 구현됨 ✅
- Growth Report parent auth: parent_students ownership chain으로 이미 pool-scoped ✅

## DB 감사 결과

SUPABASE_DATABASE_URL 직접 연결 실패(인증 오류). 마이그레이션에 duplicate safety check 내장:
- same-pool phone duplicate 있으면 UNIQUE INDEX 생성 SKIP + 경고 로그
- 서버 기동 계속

## 테스트

- Pool-First 33/33 PASS
- TS: 내 변경으로 인한 새 오류 0개

**Why**: 동일 전화번호가 여러 pool에 존재할 수 있으므로 로그인/재설정 시 pool scope 필수
