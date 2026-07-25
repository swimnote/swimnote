const { withAndroidManifest, withInfoPlist } = require("@expo/config-plugins");

/**
 * Expo config plugin: removes unnecessary media/photo library permissions
 * from iOS Info.plist and Android Manifest.
 */
const withRemoveMediaPermissions = (config) => {
  // iOS: remove photo library permission keys that aren't needed
  config = withInfoPlist(config, (cfg) => {
    const keysToRemove = [
      "NSPhotoLibraryUsageDescription",
      "NSPhotoLibraryAddUsageDescription",
    ];
    keysToRemove.forEach((key) => {
      delete cfg.modResults[key];
    });
    return cfg;
  });

  // Android: remove READ_MEDIA_* permissions if not needed
  config = withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    if (manifest["uses-permission"]) {
      const toRemove = [
        "android.permission.READ_MEDIA_IMAGES",
        "android.permission.READ_MEDIA_VIDEO",
        "android.permission.READ_MEDIA_AUDIO",
        "android.permission.READ_EXTERNAL_STORAGE",
        "android.permission.WRITE_EXTERNAL_STORAGE",
      ];
      manifest["uses-permission"] = manifest["uses-permission"].filter(
        (perm) => !toRemove.includes(perm.$?.["android:name"])
      );
    }
    return cfg;
  });

  return config;
};

module.exports = withRemoveMediaPermissions;
