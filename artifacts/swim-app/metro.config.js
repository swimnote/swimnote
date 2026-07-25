const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

module.exports = (() => {
  const config = getDefaultConfig(__dirname);
  const { transformer, resolver } = config;

  config.transformer = {
    ...transformer,
    babelTransformerPath: require.resolve("react-native-svg-transformer"),
  };

  // Web stub resolver: replace native-only packages with no-op stubs on web
  const WEB_STUBS = {
    "expo-video-thumbnails": path.join(__dirname, "web-stubs/expo-video-thumbnails.js"),
  };

  config.resolver = {
    ...resolver,
    assetExts: resolver.assetExts.filter((ext) => ext !== "svg"),
    sourceExts: [...resolver.sourceExts, "svg"],
    resolveRequest: (context, moduleName, platform) => {
      if (platform === "web" && WEB_STUBS[moduleName]) {
        return { filePath: WEB_STUBS[moduleName], type: "sourceFile" };
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  };

  return config;
})();
