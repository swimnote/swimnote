/**
 * withInstagramShare.js
 * Android 11+ package visibility: <queries> 블록에 Instagram 추가
 * iOS: LSApplicationQueriesSchemes는 app.json에서 처리
 */
const { withAndroidManifest } = require("@expo/config-plugins");

function withInstagramShare(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults;

    // <queries> 노드가 없으면 생성
    if (!manifest.manifest.queries) {
      manifest.manifest.queries = [];
    }

    const queries = manifest.manifest.queries;

    // queries 배열에 이미 Instagram package가 있는지 확인
    const hasInstagram = queries.some((q) => {
      const pkgs = q.package ?? [];
      return pkgs.some((p) => p.$?.["android:name"] === "com.instagram.android");
    });

    if (!hasInstagram) {
      queries.push({
        package: [
          { $: { "android:name": "com.instagram.android" } },
        ],
      });
    }

    return config;
  });
}

module.exports = withInstagramShare;
