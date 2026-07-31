const { withAndroidManifest } = require("@expo/config-plugins");

const PERMISSIONS_TO_REMOVE = [
  "android.permission.READ_MEDIA_IMAGES",
  "android.permission.READ_MEDIA_VIDEO",
  "android.permission.READ_MEDIA_AUDIO",
  "android.permission.READ_EXTERNAL_STORAGE",
  "android.permission.WRITE_EXTERNAL_STORAGE",
  "android.permission.ACCESS_MEDIA_LOCATION",
];

module.exports = function withRemoveMediaPermissions(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;

    // xmlns:tools 없으면 추가 (tools:node="remove" 사용에 필요)
    if (!manifest.$["xmlns:tools"]) {
      manifest.$["xmlns:tools"] = "http://schemas.android.com/tools";
    }

    // 기존 선언 제거
    for (const key of ["uses-permission", "uses-permission-sdk-23"]) {
      if (Array.isArray(manifest[key])) {
        manifest[key] = manifest[key].filter((perm) => {
          const name = perm.$?.["android:name"] || "";
          return !PERMISSIONS_TO_REMOVE.includes(name);
        });
      }
    }

    // tools:node="remove" 마커 추가
    // → Gradle manifest merger가 AAR 라이브러리에서 이 권한을 주입하더라도 최종 APK/AAB에서 제거됨
    if (!Array.isArray(manifest["uses-permission"])) {
      manifest["uses-permission"] = [];
    }
    for (const perm of PERMISSIONS_TO_REMOVE) {
      manifest["uses-permission"].push({
        $: {
          "android:name": perm,
          "tools:node": "remove",
        },
      });
    }

    return config;
  });
};
