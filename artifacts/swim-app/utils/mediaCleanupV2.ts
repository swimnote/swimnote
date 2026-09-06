/**
 * SWIMNOTE Media Cleanup V2 — utils/mediaCleanupV2.ts
 *
 * 실측 결과 기반 구현 (2026-08-10):
 *   com.hackemist.SDImageCache = 2.38 GB  (expo-image iOS SDWebImage disk cache)
 *   ImagePicker               = 894.4 MB (picker temp copies)
 *
 * 목표:
 *   A. 기존 누적 캐시 1회 정리 (startup, fire-and-forget)
 *   B. 향후 누적은 cachePolicy="memory" 변경으로 차단 (별도 소스 수정)
 *
 * 안전 원칙:
 *   - R2/DB/MediaLibrary/일지/계정 일절 건드리지 않음
 *   - scheduleAudio_* 보호
 *   - 공식 API 우선: Image.clearDiskCache() → expo-image SDWebImage cache
 *   - cacheDirectory 전체 삭제 금지: 확인된 subdirectory만 삭제
 *   - 업로드 진행 중 ImagePicker temp 삭제 금지 (lock + isActive gate)
 *   - 실패 시 completed 미기록 → 다음 실행에서 재시도 가능
 *
 * Flag: @swimnote:media_cleanup_v2
 *   "completed" = 모든 단계 성공
 *   없거나 다른 값 = 다음 실행에서 재시도
 */

import * as FileSystem from "expo-file-system/legacy";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Image } from "expo-image";

const V2_FLAG_KEY = "@swimnote:media_cleanup_v2";
/** V3: 앱 버전마다 1회 실행. 앱 업데이트 후 첫 실행 시 stale cache 일괄 정리. */
/**
 * MEDIA_CLEANUP_REVISION — 앱 버전과 독립된 cleanup 실행 기준.
 * OTA만 받아도 appVersion이 동일하므로 appVersion-only key는 재실행 불가.
 * 이 값을 bump하면 모든 기기에서 cleanup이 정확히 1회 재실행됨.
 * 현재: r1
 */
const MEDIA_CLEANUP_REVISION = "r2"; // r2: 영상 temp 5GB 누적 문제 대응 — 전체 재청소
const V3_FLAG_KEY = `@swimnote:media_cleanup:${MEDIA_CLEANUP_REVISION}`;

// 동시 실행 방지 lock
let _v2Running = false;

export interface CleanupV2Result {
  diskCacheCleared: boolean;
  imagePickerCleared: boolean;
  imagePickerSkipped: boolean; // upload active 때문에 건너뜀
  elapsedMs: number;
  error?: string;
}

/**
 * 대용량 이미지 캐시 정리 — 1회 실행, fire-and-forget 안전.
 *
 * @param isUploadActive UploadQueueContext.isActive 값.
 *   true이면 ImagePicker temp 삭제 건너뜀 (upload 보호).
 */
export async function runMediaCleanupV2(
  isUploadActive: boolean
): Promise<void> {
  try {
    // 1. 이미 완료된 경우 skip
    const flag = await AsyncStorage.getItem(V2_FLAG_KEY);
    if (flag === "completed") return;

    // 2. 동시 실행 방지
    if (_v2Running) return;
    _v2Running = true;

    try {
      const result = await _runCleanup(isUploadActive);
      console.log(
        `[media-cleanup-v2] diskCache=${result.diskCacheCleared} imagePicker=${result.imagePickerCleared} skipped=${result.imagePickerSkipped} ${result.elapsedMs}ms`
      );

      // 3. 모든 단계 성공 시만 completed 기록
      //    ImagePicker skip은 성공으로 간주하지 않음 → 다음 실행에서 재시도
      if (result.diskCacheCleared && (result.imagePickerCleared || !result.imagePickerSkipped === false)) {
        // diskCache 정리 성공 + (ImagePicker 정리 성공 또는 skip이 아님)
        // 실제 조건: diskCacheCleared AND (imagePickerCleared OR skip되지 않고 성공)
        // skip된 경우는 completed 미기록 → 다음 실행에서 ImagePicker 재시도
      }
      if (result.diskCacheCleared && result.imagePickerCleared) {
        await AsyncStorage.setItem(V2_FLAG_KEY, "completed");
      }
      // diskCache만 성공 + ImagePicker skip: 부분 완료, 미기록
      // 다음 앱 실행 시 diskCache는 이미 지워져 있으므로
      // clearDiskCache() 재호출해도 무해 (no-op에 가까움)
    } finally {
      _v2Running = false;
    }
  } catch (e) {
    // cleanup 실패가 앱 부팅에 영향 주면 안 됨
    console.warn("[media-cleanup-v2] error:", e);
    _v2Running = false;
  }
}

async function _runCleanup(isUploadActive: boolean): Promise<CleanupV2Result> {
  const start = Date.now();
  let diskCacheCleared = false;
  let imagePickerCleared = false;
  let imagePickerSkipped = false;

  // ── Step 1: expo-image disk cache clear (SDWebImage on iOS) ──────────────
  // 공식 API. com.hackemist.SDImageCache (2.38GB) 를 안전하게 제거.
  // 삭제 후 필요한 이미지는 서버/R2 URL에서 자동 재로드.
  try {
    const ok = await Image.clearDiskCache();
    diskCacheCleared = ok;
  } catch (e) {
    console.warn("[media-cleanup-v2] clearDiskCache error:", e);
    diskCacheCleared = false;
  }

  // ── Step 2: ImagePicker temp directory ───────────────────────────────────
  // expo-image-picker는 copyToCacheDirectory=true(기본) 시
  // cacheDirectory/ImagePicker/ 에 temp copy 생성 → 정리 누락으로 894MB 누적.
  //
  // 안전 조건:
  //   - upload 진행 중이 아닐 것 (in-memory queue, isActive gate)
  //   - 디렉터리 존재 확인 후 삭제 (없으면 no-op)
  if (isUploadActive) {
    imagePickerSkipped = true;
    console.log("[media-cleanup-v2] ImagePicker skip: upload active");
  } else {
    const cacheDir = FileSystem.cacheDirectory;
    if (cacheDir) {
      const pickerDir = `${cacheDir}ImagePicker/`;
      try {
        const info = await FileSystem.getInfoAsync(pickerDir);
        if (info.exists && info.isDirectory) {
          await FileSystem.deleteAsync(pickerDir, { idempotent: true });
          imagePickerCleared = true;
        } else {
          // 디렉터리가 없으면 성공으로 처리
          imagePickerCleared = true;
        }
      } catch (e) {
        console.warn("[media-cleanup-v2] ImagePicker dir delete error:", e);
        imagePickerCleared = false;
      }
    }
  }

  return {
    diskCacheCleared,
    imagePickerCleared,
    imagePickerSkipped,
    elapsedMs: Date.now() - start,
  };
}

/**
 * Media Cleanup V3 — 앱 버전 기반 1회 실행.
 *
 * 대상:
 *   - cacheDirectory/ImagePicker/         (ImagePicker temp copies)
 *   - cacheDirectory/ImageManipulator/    (압축 중간 결과물)
 *   - expo-image SDWebImage disk cache    (Image.clearDiskCache)
 *   - documentDirectory legacy patterns  (diary_*.jpg, swim_*.jpg, diary_video_.*)
 *
 * 보호:
 *   - MediaLibrary 원본 (ph://, assets-library://) — 절대 건드리지 않음
 *   - scheduleAudio_* 패턴 파일
 *   - 명명 규칙 외 documentDirectory 파일 (사용자 명시 다운로드 포함)
 *   - upload 진행 중 ImagePicker 디렉터리 삭제 금지 (isUploadActive gate)
 *
 * @param appVersion 로깅 전용 (실행 여부 판단에 사용 안 함)
 * @param isUploadActive UploadQueueContext.isActive
 */
export async function runMediaCleanupV3(
  appVersion: string,
  isUploadActive: boolean
): Promise<void> {
  try {
    const flagKey = V3_FLAG_KEY;
    const flag = await AsyncStorage.getItem(flagKey);
    if (flag === "completed") return;
    if (_v2Running) return; // V2와 동시 실행 방지

    _v2Running = true;
    try {
      const cacheDir = FileSystem.cacheDirectory;
      const docDir = FileSystem.documentDirectory;

      // Step 1: expo-image SDWebImage disk cache
      try { await Image.clearDiskCache(); } catch (_) {}

      // Step 2: ImagePicker temp directory
      if (!isUploadActive && cacheDir) {
        const pickerDir = `${cacheDir}ImagePicker/`;
        try {
          const info = await FileSystem.getInfoAsync(pickerDir);
          if (info.exists) await FileSystem.deleteAsync(pickerDir, { idempotent: true });
        } catch (_) {}
      }

      // Step 3: ImageManipulator temp directory
      if (cacheDir) {
        const manipDir = `${cacheDir}ImageManipulator/`;
        try {
          const info = await FileSystem.getInfoAsync(manipDir);
          if (info.exists) await FileSystem.deleteAsync(manipDir, { idempotent: true });
        } catch (_) {}
      }

      // Step 4: legacy documentDirectory patterns (앱이 직접 생성한 파일만)
      if (docDir) {
        const SAFE_PATTERNS = [
          /^diary_\w+\.jpg$/,
          /^diary_all_\w+\.jpg$/,
          /^swim_\w+\.jpg$/,
          /^diary_video_\w+\.(mp4|mov|m4v|webm|avi|mkv)$/,
        ];
        try {
          const files = await FileSystem.readDirectoryAsync(docDir);
          for (const f of files) {
            if (SAFE_PATTERNS.some(re => re.test(f))) {
              await FileSystem.deleteAsync(`${docDir}${f}`, { idempotent: true }).catch(() => {});
            }
          }
        } catch (_) {}
      }

      await AsyncStorage.setItem(flagKey, "completed");
      console.log(`[media-cleanup-v3] done for version=${appVersion} uploadActive=${isUploadActive}`);
    } finally {
      _v2Running = false;
    }
  } catch (e) {
    console.warn("[media-cleanup-v3] error:", e);
    _v2Running = false;
  }
}

/**
 * 업로드 완료 후 app-local temp 파일 삭제.
 * ImageManipulator / ImagePicker temp copy 대상.
 *
 * 변경 이력:
 *  - r1: cacheDir path prefix 비교만 사용 →
 *    iOS /private/var vs /var symlink 불일치로 영상 temp 미삭제 (5GB 누적 버그)
 *  - r2: ph:// / assets-library:// 만 제외하고 file:// URI 전체 삭제 허용
 *
 * 원본 MediaLibrary(ph://, assets-library://) 파일은 절대 건드리지 않음.
 *
 * @param uri 업로드에 사용된 로컬 URI
 */
export async function deleteTempFileAfterUpload(uri: string): Promise<void> {
  try {
    if (!uri) return;
    // ph:// / assets-library:// = iOS MediaLibrary 원본 — 절대 삭제 금지
    if (uri.startsWith("ph://") || uri.startsWith("assets-library://")) return;
    // file:// URI만 삭제 시도 — cacheDirectory, tmpDirectory, ImagePicker 경로 모두 포함
    // (iOS의 /private/var ↔ /var symlink 불일치로 인한 startsWith 오판을 회피)
    if (!uri.startsWith("file://")) return;
    const info = await FileSystem.getInfoAsync(uri);
    if (info.exists && !info.isDirectory) {
      await FileSystem.deleteAsync(uri, { idempotent: true });
    }
  } catch {
    // 삭제 실패는 조용히 무시 (cleanup은 best-effort)
  }
}
