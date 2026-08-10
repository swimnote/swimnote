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
 * 업로드 완료 후 cacheDirectory에 있는 temp 파일 삭제.
 * ImageManipulator / ImagePicker temp copy 대상.
 * 원본 MediaLibrary(ph://, assets-library://) 파일은 건드리지 않음.
 *
 * @param uri 업로드에 사용된 로컬 URI
 */
export async function deleteTempFileAfterUpload(uri: string): Promise<void> {
  try {
    const cacheDir = FileSystem.cacheDirectory;
    if (!cacheDir) return;
    // cacheDirectory 내 파일만 삭제 (file:///.../Caches/... 확인)
    if (!uri.startsWith(cacheDir) && !uri.includes("/Caches/")) return;
    const info = await FileSystem.getInfoAsync(uri);
    if (info.exists && !info.isDirectory) {
      await FileSystem.deleteAsync(uri, { idempotent: true });
    }
  } catch {
    // 삭제 실패는 조용히 무시 (cleanup은 best-effort)
  }
}
