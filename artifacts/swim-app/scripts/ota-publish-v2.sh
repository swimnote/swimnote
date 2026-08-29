#!/usr/bin/env bash
# ============================================================
# OTA Publish Guard — 2.0.0 전용
# 반드시 이 스크립트로만 2.0.0 OTA를 배포한다.
#
# 사용법:
#   bash scripts/ota-publish-v2.sh "커밋 메시지" [ios|android|all]
#
# 예:
#   bash scripts/ota-publish-v2.sh "feat: new onboarding UI" ios
# ============================================================
set -euo pipefail

REQUIRED_VERSION="2.0.0"
REQUIRED_RUNTIME="2.0.0"
REQUIRED_CHANNEL="production-v2"
REQUIRED_BRANCH="release-2.0.0"

MSG="${1:-}"
PLATFORM="${2:-ios}"

if [[ -z "$MSG" ]]; then
  echo "❌ GUARD FAIL: 커밋 메시지가 없습니다."
  echo "   사용법: bash scripts/ota-publish-v2.sh \"메시지\" [ios|android|all]"
  exit 1
fi

# ── 1. app.json version 확인 ─────────────────────────────────
ACTUAL_VERSION=$(node -e "console.log(require('./app.json').expo.version)")
if [[ "$ACTUAL_VERSION" != "$REQUIRED_VERSION" ]]; then
  echo "❌ GUARD FAIL: app.json version = $ACTUAL_VERSION (expected $REQUIRED_VERSION)"
  echo "   2.0.0 build 전에 app.json version을 $REQUIRED_VERSION 으로 올리세요."
  exit 1
fi

# ── 2. runtimeVersion 정책 확인 ──────────────────────────────
RUNTIME_POLICY=$(node -e "const r=require('./app.json').expo.runtimeVersion; console.log(typeof r === 'object' ? r.policy : r)")
if [[ "$RUNTIME_POLICY" == "appVersion" ]]; then
  ACTUAL_RUNTIME="$ACTUAL_VERSION"
else
  ACTUAL_RUNTIME="$RUNTIME_POLICY"
fi
if [[ "$ACTUAL_RUNTIME" != "$REQUIRED_RUNTIME" ]]; then
  echo "❌ GUARD FAIL: runtimeVersion = $ACTUAL_RUNTIME (expected $REQUIRED_RUNTIME)"
  exit 1
fi

# ── 3. Guard 통과 요약 출력 ──────────────────────────────────
echo ""
echo "✅ OTA PUBLISH GUARD — 2.0.0"
echo "   version        : $ACTUAL_VERSION"
echo "   runtimeVersion : $ACTUAL_RUNTIME"
echo "   channel        : $REQUIRED_CHANNEL"
echo "   branch         : $REQUIRED_BRANCH"
echo "   platform       : $PLATFORM"
echo "   message        : $MSG"
echo ""

# ── 4. 실제 OTA 배포 ─────────────────────────────────────────
if [[ "$PLATFORM" == "all" ]]; then
  npx eas-cli update \
    --branch "$REQUIRED_BRANCH" \
    --message "$MSG" \
    --platform all \
    --environment production \
    --non-interactive
else
  npx eas-cli update \
    --branch "$REQUIRED_BRANCH" \
    --message "$MSG" \
    --platform "$PLATFORM" \
    --environment production \
    --non-interactive
fi

echo ""
echo "✅ 2.0.0 OTA 배포 완료 — channel: $REQUIRED_CHANNEL, branch: $REQUIRED_BRANCH"
