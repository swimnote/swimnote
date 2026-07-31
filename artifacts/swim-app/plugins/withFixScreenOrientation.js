const { withAndroidManifest } = require("@expo/config-plugins");

module.exports = function withFixScreenOrientation(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    const activities = manifest.application?.[0]?.activity ?? [];
    for (const activity of activities) {
      const orientation = activity.$?.["android:screenOrientation"];
      if (orientation) {
        activity.$["android:screenOrientation"] = orientation.toLowerCase();
      }
    }
    return config;
  });
};
