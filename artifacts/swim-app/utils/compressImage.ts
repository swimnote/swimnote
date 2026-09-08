import * as ImageManipulator from "expo-image-manipulator";
import * as FileSystemLegacy from "expo-file-system/legacy";
import { Image } from "react-native";

const MAX_LONG_EDGE = 1920;
const COMPRESS_QUALITY = 0.75;
/** Recompress if file is larger than this, even without resize */
const SIZE_THRESHOLD = 2 * 1024 * 1024; // 2 MB
/** Parallel compression concurrency (memory-safe for low-end Android) */
const COMPRESS_CONCURRENCY = 2;

// HEIC/HEIF MIME types → must be normalized to JPEG for upload compatibility
const HEIC_MIMES = new Set([
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);

function isHeicByUri(uri: string): boolean {
  const lower = uri.toLowerCase().split("?")[0];
  return lower.endsWith(".heic") || lower.endsWith(".heif");
}

/** Returns true when the file needs JPEG normalization. */
function needsNormalize(uri: string, mimeType?: string): boolean {
  if (mimeType && HEIC_MIMES.has(mimeType.toLowerCase())) return true;
  return isHeicByUri(uri);
}

/**
 * Gets image dimensions without running full ImageManipulator pipeline.
 * Falls back to { width: 0, height: 0 } on failure.
 */
async function getImageDimensions(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    Image.getSize(
      uri,
      (width, height) => resolve({ width, height }),
      () => resolve({ width: 0, height: 0 })
    );
  });
}

/**
 * Smart compress/normalize a single photo.
 *
 * Policy:
 *   - Long edge > 1920 px → resize down (never upscale)
 *   - HEIC/HEIF → normalize to JPEG
 *   - fileSize > 2 MB → recompress at Q0.75
 *   - Otherwise → return original URI unchanged
 *
 * Orientation is preserved by expo-image-manipulator.
 *
 * @param uri       Local file:// URI
 * @param fileSize  Known byte size (optional)
 * @param mimeType  Known MIME type (optional; improves HEIC detection)
 */
export async function compressImageIfNeeded(
  uri: string,
  fileSize?: number,
  mimeType?: string
): Promise<string> {
  try {
    const heic = needsNormalize(uri, mimeType);
    const bigFile = fileSize !== undefined && fileSize > SIZE_THRESHOLD;

    // Fast-path: small, not HEIC. Still need to check dimensions.
    if (!heic && !bigFile && fileSize !== undefined && fileSize < 512 * 1024) {
      // Very small file — skip even dimension check; almost certainly fine.
      return uri;
    }

    const { width, height } = await getImageDimensions(uri);
    const longEdge = Math.max(width, height);
    const needsResize = longEdge > MAX_LONG_EDGE && longEdge > 0;

    // Nothing to do
    if (!heic && !bigFile && !needsResize) return uri;

    const actions: ImageManipulator.Action[] = [];
    if (needsResize) {
      const scale = MAX_LONG_EDGE / longEdge;
      actions.push({
        resize: {
          width: Math.round(width * scale),
          height: Math.round(height * scale),
        },
      });
    }

    const result = await ImageManipulator.manipulateAsync(uri, actions, {
      compress: COMPRESS_QUALITY,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    return result.uri;
  } catch {
    return uri;
  }
}

// ── Full-asset compression (returns uri + metadata) ───────────────────────

export interface CompressedPhoto {
  uri: string;
  mimeType: string;
  fileSize: number;
  fileName: string;
}

/**
 * Compress a picker asset and return the compressed URI + derived metadata.
 * Reads the actual byte size from the filesystem after compression.
 */
export async function compressPhotoAsset(asset: {
  uri: string;
  fileSize?: number;
  mimeType?: string;
  fileName?: string;
}): Promise<CompressedPhoto> {
  const compressedUri = await compressImageIfNeeded(
    asset.uri,
    asset.fileSize ?? undefined,
    asset.mimeType ?? undefined
  );
  const wasCompressed = compressedUri !== asset.uri;
  const mimeType = wasCompressed ? "image/jpeg" : (asset.mimeType ?? "image/jpeg");
  const fileName = wasCompressed ? "photo.jpg" : (asset.fileName ?? "photo.jpg");

  let fileSize = asset.fileSize ?? 0;
  try {
    const info = await FileSystemLegacy.getInfoAsync(compressedUri);
    if (info.exists) fileSize = (info as any).size ?? fileSize;
  } catch {
    // keep original size estimate
  }

  return { uri: compressedUri, mimeType, fileSize, fileName };
}

// ── Parallel compression ──────────────────────────────────────────────────

export interface CompressedPhotoWithAsset<A> extends CompressedPhoto {
  asset: A;
}

/**
 * Compress multiple photo assets in parallel with a concurrency cap.
 * Default concurrency = 2 (safe for low-end Android with large photos).
 */
export async function compressPhotosParallel<
  A extends { uri: string; fileSize?: number; mimeType?: string; fileName?: string }
>(
  assets: A[],
  concurrency = COMPRESS_CONCURRENCY
): Promise<CompressedPhotoWithAsset<A>[]> {
  const results: CompressedPhotoWithAsset<A>[] = new Array(assets.length);
  let idx = 0;

  async function worker() {
    while (idx < assets.length) {
      const i = idx++;
      const asset = assets[i];
      const compressed = await compressPhotoAsset(asset);
      results[i] = { ...compressed, asset };
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, assets.length) }, worker)
  );
  return results;
}
