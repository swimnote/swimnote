/**
 * withPatchExpoAv.js
 *
 * Expo Config Plugin — runs during `expo prebuild` (iOS),
 * after Podfile generation but before `pod install`.
 *
 * expo-av 16.0.8 EXAV.h imports EXEventEmitter.h, which is absent
 * from the ExpoModulesCore SDK 55 precompiled framework headers.
 * This plugin:
 *   1. Inlines the EXEventEmitter @protocol directly in EXAV.h
 *   2. Forces source-build by disabling xcframework in EXAV.podspec
 */
const { withDangerousMod } = require('@expo/config-plugins');
const fs   = require('fs');
const path = require('path');

const EXAV_H_SEARCH = '#import <ExpoModulesCore/EXEventEmitter.h>';
const EXAV_H_REPLACE = [
  '// EXEventEmitter.h inlined: not in ExpoModulesCore SDK 55 precompiled headers',
  '#ifndef EXEventEmitter_h',
  '#define EXEventEmitter_h',
  '@protocol EXEventEmitter',
  '- (void)startObserving;',
  '- (void)stopObserving;',
  '- (NSArray<NSString *> *)supportedEvents;',
  '@end',
  '#endif',
].join('\n');

const PODSPEC_SEARCH =
  "if !$ExpoUseSources&.include?(package['name']) && ENV['EXPO_USE_SOURCE'].to_i == 0 && File.exist?(\"#{s.name}.xcframework\") && Gem::Version.new(Pod::VERSION) >= Gem::Version.new('1.10.0')";
const PODSPEC_REPLACE =
  '# SDK 55: xcframework disabled — EXEventEmitter.h absent from precompiled ExpoModulesCore\n  # Force source build so CocoaPods resolves headers via dependency graph\n  if false';

function patchFile(filePath, search, replace, label) {
  if (!fs.existsSync(filePath)) {
    console.log(`[withPatchExpoAv] SKIP (not found): ${label}`);
    return false;
  }
  const content = fs.readFileSync(filePath, 'utf8');
  // Already patched?
  if (!content.includes(search)) {
    console.log(`[withPatchExpoAv] already patched or pattern absent: ${label}`);
    return false;
  }
  fs.writeFileSync(filePath, content.replace(search, replace), 'utf8');
  console.log(`[withPatchExpoAv] ✅ patched: ${label}`);
  return true;
}

/** @type {import('@expo/config-plugins').ConfigPlugin} */
module.exports = function withPatchExpoAv(config) {
  return withDangerousMod(config, [
    'ios',
    async (config) => {
      const root = config.modRequest.projectRoot;

      // Candidates: direct node_modules (yarn / pnpm hoisted)
      const candidateDirs = [
        path.join(root, 'node_modules', 'expo-av'),
      ];

      // pnpm virtualstore (if present)
      const pnpmStore = path.join(root, 'node_modules', '.pnpm');
      if (fs.existsSync(pnpmStore)) {
        for (const entry of fs.readdirSync(pnpmStore)) {
          if (entry.startsWith('expo-av@')) {
            candidateDirs.push(
              path.join(pnpmStore, entry, 'node_modules', 'expo-av'),
            );
          }
        }
      }

      let patched = 0;
      for (const dir of candidateDirs) {
        if (!fs.existsSync(dir)) continue;
        const h   = path.join(dir, 'ios', 'EXAV', 'EXAV.h');
        const pod = path.join(dir, 'ios', 'EXAV.podspec');
        if (patchFile(h,   EXAV_H_SEARCH,   EXAV_H_REPLACE,   `EXAV.h (${path.relative(root, dir)})`))   patched++;
        if (patchFile(pod, PODSPEC_SEARCH,   PODSPEC_REPLACE,  `EXAV.podspec (${path.relative(root, dir)})`)) patched++;
      }

      console.log(`[withPatchExpoAv] done — ${patched} file(s) patched.`);
      return config;
    },
  ]);
};
