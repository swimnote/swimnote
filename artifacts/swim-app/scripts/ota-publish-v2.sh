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

# ── 1. resolved Expo config에서 version / runtimeVersion 추출 ─
# npx expo config --json 으로 실제 resolved 값 확인
echo "🔍 Resolving Expo config..."
RESOLVED_JSON=$(npx expo config --json 2>/dev/null)

ACTUAL_VERSION=$(echo "$RESOLVED_JSON" | node -e "let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>console.log(JSON.parse(d).version))" 2>/dev/null || \
  node -e "console.log(require('./app.json').expo.version)")

# runtimeVersion: policy=appVersion → resolves to version string
RUNTIME_FIELD=$(echo "$RESOLVED_JSON" | node -e "let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{const r=JSON.parse(d).runtimeVersion; console.log(typeof r==='object'? r.policy : r)})" 2>/dev/null || \
  node -e "const r=require('./app.json').expo.runtimeVersion; console.log(typeof r==='object'? r.policy : r)")

if [[ "$RUNTIME_FIELD" == "appVersion" ]]; then
  ACTUAL_RUNTIME="$ACTUAL_VERSION"
else
  ACTUAL_RUNTIME="$RUNTIME_FIELD"
fi

# ── 2. Guard checks ──────────────────────────────────────────
FAIL=0

if [[ "$ACTUAL_VERSION" != "$REQUIRED_VERSION" ]]; then
  echo "❌ GUARD FAIL: resolved version = $ACTUAL_VERSION (required: $REQUIRED_VERSION)"
  FAIL=1
fi

if [[ "$ACTUAL_RUNTIME" != "$REQUIRED_RUNTIME" ]]; then
  echo "❌ GUARD FAIL: resolved runtimeVersion = $ACTUAL_RUNTIME (required: $REQUIRED_RUNTIME)"
  FAIL=1
fi

if [[ "$FAIL" -ne 0 ]]; then
  echo ""
  echo "🚫 2.0.0 OTA 배포 중단. app.json version을 $REQUIRED_VERSION 으로 변경 후 재시도."
  exit 1
fi

# ── 3. Guard 통과 요약 출력 ──────────────────────────────────
echo ""
echo "✅ OTA PUBLISH GUARD — 2.0.0 PASSED"
echo "   resolved version        : $ACTUAL_VERSION"
echo "   resolved runtimeVersion : $ACTUAL_RUNTIME"
echo "   target channel          : $REQUIRED_CHANNEL"
echo "   target branch           : $REQUIRED_BRANCH"
echo "   platform                : $PLATFORM"
echo "   message                 : $MSG"
echo ""

# ── 4. 실제 OTA 배포 ─────────────────────────────────────────
npx eas-cli update \
  --branch "$REQUIRED_BRANCH" \
  --message "$MSG" \
  --platform "$PLATFORM" \
  --environment production \
  --non-interactive

echo ""
echo "✅ 2.0.0 OTA 배포 완료 — channel: $REQUIRED_CHANNEL, branch: $REQUIRED_BRANCH"
