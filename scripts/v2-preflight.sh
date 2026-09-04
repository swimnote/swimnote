#!/usr/bin/env bash
# ============================================================
# SWIMNOTE V2 PRE-FLIGHT GUARD
# 반드시 2.0 작업 시작 전 실행. 1.6.3 / production 격리 검증.
# Usage: bash scripts/v2-preflight.sh
# ============================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASS=0
FAIL=0

check() {
  local label="$1"; local result="$2"; local expected="$3"
  if [ "$result" = "$expected" ]; then
    echo -e "  ${GREEN}PASS${NC}  $label"
    PASS=$((PASS+1))
  else
    echo -e "  ${RED}FAIL${NC}  $label"
    echo "        expected : $expected"
    echo "        actual   : $result"
    FAIL=$((FAIL+1))
  fi
}

echo ""
echo "============================================================"
echo " SWIMNOTE V2 PRE-FLIGHT CHECK"
echo "============================================================"
echo ""

CURRENT_BRANCH=$(git branch --show-current 2>/dev/null || echo "DETACHED")

# [1] 현재 branch 확인
echo "[1] Current branch"
if [ "$CURRENT_BRANCH" = "release/v2.0.0" ]; then
  echo -e "  ${GREEN}PASS${NC}  Branch = release/v2.0.0"
  PASS=$((PASS+1))
else
  echo -e "  ${RED}FAIL${NC}  Branch = $CURRENT_BRANCH  (expected: release/v2.0.0)"
  FAIL=$((FAIL+1))
fi
echo ""

# [2] 1.6.3 maintenance branch 미체크아웃 확인
echo "[2] 1.6.3 maintenance branch isolation"
if [ "$CURRENT_BRANCH" = "maintenance/v1.6.3-social-exit" ]; then
  echo -e "  ${RED}FAIL${NC}  Currently on maintenance/v1.6.3-social-exit — STOP IMMEDIATELY"
  FAIL=$((FAIL+1))
else
  echo -e "  ${GREEN}PASS${NC}  Not on 1.6.3 maintenance branch"
  PASS=$((PASS+1))
fi
echo ""

# [3] deploy-photo-clone 미체크아웃 확인
echo "[3] Production branch isolation"
if [ "$CURRENT_BRANCH" = "deploy-photo-clone" ]; then
  echo -e "  ${RED}FAIL${NC}  Currently on deploy-photo-clone — STOP IMMEDIATELY"
  FAIL=$((FAIL+1))
else
  echo -e "  ${GREEN}PASS${NC}  Not on deploy-photo-clone"
  PASS=$((PASS+1))
fi
echo ""

# [4] backup/v1.6.3-final-live 존재 + SHA 확인
echo "[4] 1.6.3 client backup branch integrity"
BACKUP_SHA=$(git rev-parse --verify "origin/backup/v1.6.3-final-live" 2>/dev/null || echo "MISSING")
check "backup/v1.6.3-final-live SHA" "$BACKUP_SHA" "6b7fde18a9ced22d5f8503457cfe3b54e462c935"
echo ""

# [5] v1.6.3-live-freeze tag 확인
echo "[5] 1.6.3 freeze tag integrity"
TAG_SHA=$(git rev-parse --verify "v1.6.3-live-freeze^{}" 2>/dev/null || echo "MISSING")
check "v1.6.3-live-freeze tag SHA" "$TAG_SHA" "6b7fde18a9ced22d5f8503457cfe3b54e462c935"
echo ""

# [6] backup/prod-server-v1.6.3-live 존재 확인
echo "[6] Production server backup branch integrity"
PROD_BACKUP=$(git rev-parse --verify "origin/backup/prod-server-v1.6.3-live" 2>/dev/null || echo "MISSING")
check "backup/prod-server-v1.6.3-live SHA" "$PROD_BACKUP" "e6bb180cf0a21636661927d67440ce1f632b804e"
echo ""

# [7] maintenance branch HEAD 미변경 확인 (6b7fde18 이후 hotfix 커밋 허용, 삭제/리셋 금지)
echo "[7] maintenance/v1.6.3-social-exit branch reachability"
MAINT_CONTAINS=$(git branch -r --contains 6b7fde18 2>/dev/null | grep "maintenance/v1.6.3-social-exit" | wc -l | tr -d ' ')
if [ "$MAINT_CONTAINS" -ge "1" ]; then
  echo -e "  ${GREEN}PASS${NC}  6b7fde18 reachable from maintenance/v1.6.3-social-exit"
  PASS=$((PASS+1))
else
  echo -e "  ${RED}FAIL${NC}  6b7fde18 NOT reachable from maintenance/v1.6.3-social-exit"
  FAIL=$((FAIL+1))
fi
echo ""

# Summary
echo "============================================================"
if [ "$FAIL" -eq 0 ]; then
  echo -e " ${GREEN}ALL $PASS CHECKS PASSED — SAFE TO START V2 WORK${NC}"
else
  echo -e " ${RED}$FAIL CHECKS FAILED — DO NOT START V2 WORK${NC}"
  echo ""
  echo "  Fix all failures before beginning 2.0 development."
fi
echo "============================================================"
echo ""

exit $FAIL
