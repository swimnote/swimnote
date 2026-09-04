/**
 * SWIMNOTE Storage Diagnostic — utils/storageDiagnostic.ts
 *
 * 역할: 실기기에서 documentDirectory / cacheDirectory 실제 사용량을 측정.
 *       삭제는 절대 하지 않음 — 측정 전용 (read-only).
 *
 * 개인정보 보호:
 *   - 파일명 / URL / 학생이름 출력 금지
 *   - size / count 숫자만 반환
 */

import * as FileSystem from "expo-file-system/legacy";
import AsyncStorage from "@react-native-async-storage/async-storage";

// ── 타입 ──────────────────────────────────────────────────────────────────────

export interface DirScanResult {
  files: number;
  directories: number;
  bytes: number;
}

export interface DocumentDiagnostic extends DirScanResult {
  /** diary_{id}.jpg / diary_all_{id}.jpg / diary_video_{id}.* */
  legacyDiaryBytes: number;
  legacyDiaryFiles: number;
  /** swim_{id}.jpg / swim_video_{id}.* (swimnote_* 제외) */
  legacySwimBytes: number;
  legacySwimFiles: number;
  /** swimnote_YYYYMMDD_... — home.tsx download, v1 matcher에서 누락된 패턴 */
  legacySwimnoteBytes: number;
  legacySwimnoteFiles: number;
  /** scheduleAudio_* — 음성녹음, 영구 보관 */
  scheduleAudioBytes: number;
  scheduleAudioFiles: number;
  /** 위 패턴 외 기타 */
  otherBytes: number;
  otherFiles: number;
}

export interface CacheSubdir {
  /** 라이브러리 디렉터리명 (개인정보 없음) */
  name: string;
  files: number;
  bytes: number;
}

export interface CacheDiagnostic extends DirScanResult {
  /** top-level 하위 디렉터리별 집계 (용량 내림차순) */
  subdirs: CacheSubdir[];
}

export interface StorageDiagnosticResult {
  document: DocumentDiagnostic;
  cache: CacheDiagnostic;
  /** @swimnote:media_cleanup_v1 AsyncStorage 값 (null = 없음) */
  cleanupV1Flag: string | null;
  /** 측정 소요 시간 ms */
  elapsedMs: number;
}

// ── 패턴 분류 ─────────────────────────────────────────────────────────────────

type DocCategory = "diary" | "swim" | "swimnote" | "audio" | "other";

function classifyDocFile(name: string): DocCategory {
  if (/^diary_/.test(name)) return "diary";
  if (/^swimnote_/.test(name)) return "swimnote";   // swim_ 보다 먼저 체크
  if (/^swim_/.test(name)) return "swim";
  if (/^scheduleAudio_/.test(name)) return "audio";
  return "other";
}

// ── 재귀 스캔 ─────────────────────────────────────────────────────────────────

async function recursiveScan(dir: string): Promise<DirScanResult> {
  let files = 0, directories = 0, bytes = 0;
  let entries: string[] = [];
  try {
    entries = await FileSystem.readDirectoryAsync(dir);
  } catch {
    return { files, directories, bytes };
  }

  for (const name of entries) {
    const fullPath = dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
    try {
      const info = await FileSystem.getInfoAsync(fullPath, { size: true } as any);
      if (!info.exists) continue;
      if (info.isDirectory) {
        directories++;
        const sub = await recursiveScan(fullPath + "/");
        files += sub.files;
        directories += sub.directories;
        bytes += sub.bytes;
      } else {
        files++;
        bytes += (info as any).size ?? 0;
      }
    } catch { /* 개별 항목 오류 무시 */ }
  }
  return { files, directories, bytes };
}

// ── Documents 스캔 ────────────────────────────────────────────────────────────

async function scanDocumentDir(): Promise<DocumentDiagnostic> {
  const zero: DocumentDiagnostic = {
    files: 0, directories: 0, bytes: 0,
    legacyDiaryBytes: 0, legacyDiaryFiles: 0,
    legacySwimBytes: 0, legacySwimFiles: 0,
    legacySwimnoteBytes: 0, legacySwimnoteFiles: 0,
    scheduleAudioBytes: 0, scheduleAudioFiles: 0,
    otherBytes: 0, otherFiles: 0,
  };
  const docDir = FileSystem.documentDirectory;
  if (!docDir) return zero;

  let entries: string[] = [];
  try { entries = await FileSystem.readDirectoryAsync(docDir); } catch { return zero; }

  const r = { ...zero };
  for (const name of entries) {
    const fullPath = `${docDir}${name}`;
    try {
      const info = await FileSystem.getInfoAsync(fullPath, { size: true } as any);
      if (!info.exists) continue;

      if (info.isDirectory) {
        // Documents 하위 디렉터리 재귀 → other로 분류
        r.directories++;
        const sub = await recursiveScan(fullPath + "/");
        r.files += sub.files;
        r.bytes += sub.bytes;
        r.otherFiles += sub.files;
        r.otherBytes += sub.bytes;
      } else {
        const sz: number = (info as any).size ?? 0;
        r.files++;
        r.bytes += sz;
        const cat = classifyDocFile(name);
        if (cat === "diary")     { r.legacyDiaryFiles++;    r.legacyDiaryBytes    += sz; }
        else if (cat === "swim") { r.legacySwimFiles++;     r.legacySwimBytes     += sz; }
        else if (cat === "swimnote") { r.legacySwimnoteFiles++; r.legacySwimnoteBytes += sz; }
        else if (cat === "audio")    { r.scheduleAudioFiles++;  r.scheduleAudioBytes  += sz; }
        else                         { r.otherFiles++;          r.otherBytes          += sz; }
      }
    } catch { /* 개별 항목 오류 무시 */ }
  }
  return r;
}

// ── Cache 스캔 ────────────────────────────────────────────────────────────────

async function scanCacheDir(): Promise<CacheDiagnostic> {
  const zero: CacheDiagnostic = { files: 0, directories: 0, bytes: 0, subdirs: [] };
  const cacheDir = FileSystem.cacheDirectory;
  if (!cacheDir) return zero;

  let entries: string[] = [];
  try { entries = await FileSystem.readDirectoryAsync(cacheDir); } catch { return zero; }

  const r = { ...zero, subdirs: [] as CacheSubdir[] };
  for (const name of entries) {
    const fullPath = `${cacheDir}${name}`;
    try {
      const info = await FileSystem.getInfoAsync(fullPath, { size: true } as any);
      if (!info.exists) continue;
      if (info.isDirectory) {
        r.directories++;
        const sub = await recursiveScan(fullPath + "/");
        r.files += sub.files;
        r.bytes += sub.bytes;
        r.subdirs.push({ name, files: sub.files, bytes: sub.bytes });
      } else {
        r.files++;
        r.bytes += (info as any).size ?? 0;
      }
    } catch { /* 개별 항목 오류 무시 */ }
  }
  // 용량 내림차순
  r.subdirs.sort((a, b) => b.bytes - a.bytes);
  return r;
}

// ── 메인 ──────────────────────────────────────────────────────────────────────

/**
 * Storage 전체 진단. 삭제 없음 — 측정 전용.
 */
export async function runStorageDiagnostic(): Promise<StorageDiagnosticResult> {
  const start = Date.now();
  const cleanupV1Flag = await AsyncStorage.getItem("@swimnote:media_cleanup_v1").catch(() => null);
  const [document, cache] = await Promise.all([scanDocumentDir(), scanCacheDir()]);
  return { document, cache, cleanupV1Flag, elapsedMs: Date.now() - start };
}

// ── Alert 포맷 헬퍼 ───────────────────────────────────────────────────────────

function fmtB(b: number): string {
  if (b >= 1_073_741_824) return `${(b / 1_073_741_824).toFixed(2)} GB`;
  if (b >= 1_048_576)     return `${(b / 1_048_576).toFixed(1)} MB`;
  if (b >= 1_024)         return `${(b / 1_024).toFixed(0)} KB`;
  return `${b} B`;
}

/**
 * 진단 결과를 Alert용 문자열로 변환.
 * 파일명 / URL / 개인정보 포함하지 않음.
 */
export function formatDiagnosticAlert(r: StorageDiagnosticResult): { title: string; message: string } {
  const d = r.document;
  const c = r.cache;

  const docLines = [
    `📁 Documents  ${fmtB(d.bytes)} / ${d.files}개`,
    `  diary:     ${fmtB(d.legacyDiaryBytes)} (${d.legacyDiaryFiles}개)`,
    `  swim:      ${fmtB(d.legacySwimBytes)} (${d.legacySwimFiles}개)`,
    `  swimnote:  ${fmtB(d.legacySwimnoteBytes)} (${d.legacySwimnoteFiles}개)  ← v1 누락`,
    `  audio:     ${fmtB(d.scheduleAudioBytes)} (${d.scheduleAudioFiles}개)`,
    `  기타:      ${fmtB(d.otherBytes)} (${d.otherFiles}개)`,
  ];

  const topSubdirs = c.subdirs.slice(0, 6).map(
    s => `  ${s.name}: ${fmtB(s.bytes)} (${s.files}개)`
  );
  const cacheLines = [
    `🗂 Cache  ${fmtB(c.bytes)} / ${c.files}개`,
    ...topSubdirs,
    ...(c.subdirs.length > 6 ? [`  (+ ${c.subdirs.length - 6}개 디렉터리)`] : []),
  ];

  return {
    title: "SWIMNOTE Storage Diagnostic",
    message: [
      ...docLines,
      "",
      ...cacheLines,
      "",
      `🏳 cleanup v1: ${r.cleanupV1Flag ?? "(없음)"}`,
      `⏱ ${(r.elapsedMs / 1000).toFixed(1)}s`,
    ].join("\n"),
  };
}
