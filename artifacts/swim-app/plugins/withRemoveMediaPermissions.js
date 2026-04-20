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
    if (Array.isArray(manifest["uses-permission"])) {
      manifest["uses-permission"] = manifest["uses-permission"].filter((perm) => {
        const name = perm.$?.["android:name"] || "";
        return !PERMISSIONS_TO_REMOVE.includes(name);
      });
    }
    if (Array.isArray(manifest["uses-permission-sdk-23"])) {
      manifest["uses-permission-sdk-23"] = manifest["uses-permission-sdk-23"].filter((perm) => {
        const name = perm.$?.["android:name"] || "";
        return !PERMISSIONS_TO_REMOVE.includes(name);
      });
    }
    return config;
  });
};
