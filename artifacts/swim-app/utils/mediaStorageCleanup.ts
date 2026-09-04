/**
 * SWIMNOTE Legacy Media Cleanup — utils/mediaStorageCleanup.ts
 *
 * 역할: 앱 documentDirectory에 누적된 SWIMNOTE legacy media를 일괄 삭제.
 *
 * 삭제 대상 (MediaLibrary 저장 후 cleanup 누락된 temp copy):
 *   diary_{id}.jpg
 *   diary_all_{id}.jpg
 *   diary_video_{id}.{ext}
 *   swim_{id}.jpg
 *   swim_video_{id}.{ext}
 *
 * 절대 삭제하지 않는 것:
 *   scheduleAudio_*          — 선생님 수업 음성녹음 (영구 사용자 파일)
 *   위 패턴 외 모든 파일     — 보수적 허용 목록 방식
 *
 * 실행 정책:
 *   - AsyncStorage flag(@swimnote:media_cleanup_v1)로 1회 실행
 *   - Partial failure 시 completed 미기록 → 다음 실행 때 재시도
 *   - UI thread 차단 없이 async 처리
 *   - 앱 부팅을 막지 않음 (전체 try-catch)
 */

import * as FileSystem from "expo-file-system/legacy";
import AsyncStorage from "@react-native-async-storage/async-storage";

const CLEANUP_FLAG_KEY = "@swimnote:media_cleanup_v1";
const BATCH_SIZE = 20;

/**
 * 허용된 legacy SWIMNOTE media 파일 패턴만 true 반환.
 * 단순 startsWith가 아닌 엄격한 정규식 매처 사용.
 *
 * ID 형식: UUID (hex + hyphens) 또는 숫자형 문자열
 * Extension: mp4, mov, m4v, webm, avi, mkv (영상), jpg (사진)
 */
export function isLegacySwimnoteMediaFile(name: string): boolean {
  // diary_{id}.jpg
  if (/^diary_[a-zA-Z0-9\-]+\.jpg$/.test(name)) return true;
  // diary_all_{id}.jpg
  if (/^diary_all_[a-zA-Z0-9\-]+\.jpg$/.test(name)) return true;
  // diary_video_{id}.{video-ext}
  if (/^diary_video_[a-zA-Z0-9\-]+\.(mp4|mov|m4v|webm|avi|mkv)$/.test(name)) return true;
  // swim_{id}.jpg
  if (/^swim_[a-zA-Z0-9\-]+\.jpg$/.test(name)) return true;
  // swim_video_{id}.{video-ext}
  if (/^swim_video_[a-zA-Z0-9\-]+\.(mp4|mov|m4v|webm|avi|mkv)$/.test(name)) return true;
  return false;
}

export interface CleanupResult {
  scanned: number;
  matched: number;
  deleted: number;
  failed: number;
}

/** BATCH_SIZE 단위 순차 삭제 (메모리 폭증 방지) */
async function deleteBatch(
  paths: string[]
): Promise<{ deleted: number; failed: number }> {
  let deleted = 0;
  let failed = 0;
  for (const path of paths) {
    try {
      await FileSystem.deleteAsync(path, { idempotent: true });
      deleted++;
    } catch {
      failed++;
    }
  }
  return { deleted, failed };
}

/**
 * 앱 documentDirectory의 legacy SWIMNOTE media를 일괄 정리.
 *
 * - UI를 막지 않도록 호출부에서 await 없이 .catch(() => {}) 처리 가능
 * - 내부 예외가 앱 부팅에 영향을 주지 않음
 */
export async function runLegacyMediaCleanup(): Promise<void> {
  try {
    // 1. 완료 flag 확인 — completed면 즉시 종료
    const flag = await AsyncStorage.getItem(CLEANUP_FLAG_KEY);
    if (flag === "completed") return;

    // 2. documentDirectory 목록 읽기
    const docDir = FileSystem.documentDirectory;
    if (!docDir) return;

    let entries: string[] = [];
    try {
      entries = await FileSystem.readDirectoryAsync(docDir);
    } catch {
      return; // 읽기 실패 시 조용히 종료
    }

    // 3. 허용 패턴에 맞는 파일만 선택 (파일명만 검사, 내용 읽지 않음)
    const targets = entries.filter(isLegacySwimnoteMediaFile);
    const result: CleanupResult = {
      scanned: entries.length,
      matched: targets.length,
      deleted: 0,
      failed: 0,
    };

    if (targets.length === 0) {
      // 대상 없음 → 완료
      await AsyncStorage.setItem(CLEANUP_FLAG_KEY, "completed");
      return;
    }

    // 4. BATCH_SIZE(20) 단위 순차 삭제
    for (let i = 0; i < targets.length; i += BATCH_SIZE) {
      const batch = targets
        .slice(i, i + BATCH_SIZE)
        .map((name) => `${docDir}${name}`);
      const { deleted, failed } = await deleteBatch(batch);
      result.deleted += deleted;
      result.failed += failed;
    }

    // 5. 최소 로그 (개인정보·파일명 전체 미출력)
    console.log(
      `[media-cleanup-v1] scanned=${result.scanned} matched=${result.matched} deleted=${result.deleted} failed=${result.failed}`
    );

    // 6. 전체 성공 시만 completed 기록
    //    partial failure: 미기록 → 다음 앱 실행 때 실패 대상 재시도
    if (result.failed === 0) {
      await AsyncStorage.setItem(CLEANUP_FLAG_KEY, "completed");
    }
  } catch {
    // cleanup 실패가 앱 부팅을 막으면 안 됨 — 전체 swallow
  }
}
