#!/bin/bash
set -e

# 의존성 설치
pnpm install --frozen-lockfile

# ⚠️  DB 스키마 변경(drizzle-kit push)은 자동 실행하지 않음.
# drizzle-kit push는 파괴적 변경(테이블/컬럼 삭제) 감지 시 대화형 확인을 요구하므로
# stdin이 닫힌 post-merge 환경에서 항상 실패함.
# 스키마 변경이 필요한 경우 직접 실행: pnpm --filter db push-force
