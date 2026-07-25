import { Platform } from "react-native";

const MAX_COMPRESS_BYTES = 1.5 * 1024 * 1024; // 1.5 MB 이상일 때만 압축 시도

/**
 * 이미지를 필요시 압축해서 URI를 반환.
 * - 웹 환경: 압축 라이브러리가 없으므로 원본 URI 그대로 반환.
 * - 네이티브 환경: expo-image-manipulator 미설치 시 원본 그대로 반환 (추후 추가 가능).
 * - fileSize가 MAX_COMPRESS_BYTES 미만이면 원본 반환 (불필요한 압축 방지).
 */
export async function compressImageIfNeeded(
  uri: string,
  fileSizeBytes?: number
): Promise<string> {
  // 파일 크기가 기준 미만이면 즉시 원본 반환
  if (fileSizeBytes !== undefined && fileSizeBytes < MAX_COMPRESS_BYTES) {
    return uri;
  }

  // 웹 환경 — canvas 기반 압축은 미구현, 원본 반환
  if (Platform.OS === "web") {
    return uri;
  }

  // 네이티브 환경 — expo-image-manipulator 사용 가능 시 압축
  try {
    // dynamic import so the module is optional
    const Manipulator = await import("expo-image-manipulator").catch(() => null);
    if (!Manipulator) return uri;

    const result = await Manipulator.manipulateAsync(
      uri,
      [{ resize: { width: 1920 } }],
      { compress: 0.8, format: Manipulator.SaveFormat.JPEG }
    );
    return result.uri;
  } catch {
    // 압축 실패 시 원본 그대로 업로드
    return uri;
  }
}
