#!/usr/bin/env bash
# ota-export-ios.sh — iOS OTA bundle export (WP-OTA-ENV-FIX)
#
# 반드시 이 스크립트를 통해 OTA export를 실행한다.
# EXPO_PUBLIC_META_APP_ID를 영구적으로 주입하여
# StoryCapturePipeline Instagram 공유 기능이 bake-in되도록 보장.
#
# 사용법:
#   bash scripts/ota-export-ios.sh [출력 디렉토리]
#
# 기본 출력 디렉토리: /tmp/ios-ota-export
#
# OTA 업로드는 이 스크립트에서 하지 않음.
# 업로드는 eas update --skip-bundler --input-dir <출력 디렉토리> 로 별도 실행.

set -e

OUTPUT_DIR="${1:-/tmp/ios-ota-export}"

echo "[OTA-EXPORT-IOS] output: $OUTPUT_DIR"
echo "[OTA-EXPORT-IOS] EXPO_PUBLIC_META_APP_ID=2093655621362240"

EXPO_NO_TELEMETRY=1 \
EXPO_PUBLIC_META_APP_ID=2093655621362240 \
  node_modules/.bin/expo export \
    --platform ios \
    --output-dir "$OUTPUT_DIR"

echo "[OTA-EXPORT-IOS] done → $OUTPUT_DIR"
