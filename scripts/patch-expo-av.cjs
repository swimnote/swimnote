#!/usr/bin/env node
/**
 * patch-expo-av.cjs
 * Runs as EAS postInstallCommand (POST_INSTALL_HOOK).
 *
 * expo-av 16.0.8 ships EXAV.h that imports EXEventEmitter.h.
 * In SDK 55, expo-modules-core 3.x precompiled framework no longer
 * exposes EXEventEmitter.h as a public header — Xcode build fails.
 *
 * This script:
 *   1. Inlines EXEventEmitter @protocol directly in EXAV.h
 *   2. Disables xcframework in EXAV.podspec → forces source build
 */
'use strict';
const fs   = require('fs');
const path = require('path');

const cwd = process.cwd();
console.log('[patch-expo-av] cwd:', cwd);

// ── helpers ────────────────────────────────────────────────────────────────
function patchFile(filePath, searchStr, replaceStr, label) {
  if (!fs.existsSync(filePath)) {
    console.log(`[patch-expo-av] SKIP (not found): ${filePath}`);
    return false;
  }
  const content = fs.readFileSync(filePath, 'utf8');
  if (content.includes(replaceStr.slice(0, 40))) {
    console.log(`[patch-expo-av] ALREADY PATCHED: ${label}`);
    return true;
  }
  if (!content.includes(searchStr)) {
    console.log(`[patch-expo-av] SKIP (pattern not found): ${label}`);
    return false;
  }
  fs.writeFileSync(filePath, content.replace(searchStr, replaceStr), 'utf8');
  console.log(`[patch-expo-av] OK: ${label}`);
  return true;
}

// ── EXAV.h patch ──────────────────────────────────────────────────────────
const EXAV_H_SEARCH = '#import <ExpoModulesCore/EXEventEmitter.h>';
const EXAV_H_REPLACE = [
  '// EXEventEmitter.h inlined: removed from ExpoModulesCore precompiled headers in SDK 55',
  '#ifndef EXEventEmitter_h',
  '#define EXEventEmitter_h',
  '@protocol EXEventEmitter',
  '- (void)startObserving;',
  '- (void)stopObserving;',
  '- (NSArray<NSString *> *)supportedEvents;',
  '@end',
  '#endif',
].join('\n');

// ── EXAV.podspec patch ────────────────────────────────────────────────────
const PODSPEC_SEARCH =
  "if !$ExpoUseSources&.include?(package['name']) && ENV['EXPO_USE_SOURCE'].to_i == 0 && File.exist?(\"#{s.name}.xcframework\") && Gem::Version.new(Pod::VERSION) >= Gem::Version.new('1.10.0')";
const PODSPEC_REPLACE =
  '# SDK 55: xcframework disabled — EXEventEmitter.h missing from precompiled ExpoModulesCore\n  # Force source build so CocoaPods resolves headers correctly\n  if false';

// ── find all expo-av instances ────────────────────────────────────────────
// Standard locations yarn / pnpm can place the package
const candidates = [
  path.join(cwd, 'node_modules', 'expo-av'),
  path.join(cwd, 'artifacts', 'swim-app', 'node_modules', 'expo-av'),
];

// Also crawl .pnpm virtualstore
const pnpmStore = path.join(cwd, 'node_modules', '.pnpm');
if (fs.existsSync(pnpmStore)) {
  for (const entry of fs.readdirSync(pnpmStore)) {
    if (entry.startsWith('expo-av@')) {
      candidates.push(path.join(pnpmStore, entry, 'node_modules', 'expo-av'));
    }
  }
}

let total = 0;
for (const dir of candidates) {
  const h    = path.join(dir, 'ios', 'EXAV', 'EXAV.h');
  const pod  = path.join(dir, 'ios', 'EXAV.podspec');
  if (patchFile(h,   EXAV_H_SEARCH,   EXAV_H_REPLACE,   `EXAV.h   (${dir})`)) total++;
  if (patchFile(pod, PODSPEC_SEARCH,   PODSPEC_REPLACE,  `EXAV.podspec (${dir})`)) total++;
}

console.log(`[patch-expo-av] done — ${total} patch(es) applied.`);
