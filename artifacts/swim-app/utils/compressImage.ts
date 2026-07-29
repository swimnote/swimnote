import * as ImageManipulator from "expo-image-manipulator";

const MAX_BYTES = 3 * 1024 * 1024;
const MAX_DIM = 1920;

/**
 * 사진 용량이 3MB 초과인 경우 자동 압축.
 * 동영상은 그대로 반환.
 * @param uri       이미지 로컬 URI
 * @param fileSize  expo-image-picker asset.fileSize (바이트, 없으면 undefined)
 */
export async function compressImageIfNeeded(
  uri: string,
  fileSize?: number
): Promise<string> {
  if (fileSize !== undefined && fileSize < MAX_BYTES) return uri;
  try {
    const result = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: MAX_DIM } }],
      { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG }
    );
    return result.uri;
  } catch {
    return uri;
  }
}
