#!/usr/bin/env bash
# ota-export-android.sh — Android OTA bundle export (WP-OTA-ENV-FIX)
#
# 반드시 이 스크립트를 통해 OTA export를 실행한다.
# EXPO_PUBLIC_META_APP_ID를 영구적으로 주입하여
# StoryCapturePipeline Instagram 공유 기능이 bake-in되도록 보장.
#
# 사용법:
#   bash scripts/ota-export-android.sh [출력 디렉토리]
#
# 기본 출력 디렉토리: /tmp/android-ota-export
#
# OTA 업로드는 이 스크립트에서 하지 않음.
# 업로드는 eas update --skip-bundler --input-dir <출력 디렉토리> 로 별도 실행.

set -e

OUTPUT_DIR="${1:-/tmp/android-ota-export}"

echo "[OTA-EXPORT-ANDROID] output: $OUTPUT_DIR"
echo "[OTA-EXPORT-ANDROID] EXPO_PUBLIC_META_APP_ID=2093655621362240"

EXPO_NO_TELEMETRY=1 \
EXPO_PUBLIC_META_APP_ID=2093655621362240 \
  node_modules/.bin/expo export \
    --platform android \
    --output-dir "$OUTPUT_DIR"

echo "[OTA-EXPORT-ANDROID] done → $OUTPUT_DIR"
