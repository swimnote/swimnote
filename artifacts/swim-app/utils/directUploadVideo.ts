/**
 * directUploadVideo.ts
 * R2 presigned direct-upload flow for videos.
 *
 * Flow:
 *   1. POST /videos/direct-upload/session  → { upload_token, upload_url, thumbnail_upload_url? }
 *   2. PUT video binary to upload_url  (expo-file-system/legacy createUploadTask, BINARY_CONTENT)
 *   3. (optional) PUT thumbnail binary to thumbnail_upload_url
 *   4. POST /videos/direct-upload/finalize → { video: { id, file_url, … } }
 */

import * as FileSystemLegacy from "expo-file-system/legacy";
import * as VideoThumbnails from "expo-video-thumbnails";
import { API_BASE } from "@/context/AuthContext";

export interface DirectUploadVideoOptions {
  token: string;
  albumType: "group" | "private";
  classId?: string;
  studentId?: string;
  caption?: string;
  /** Local file URI of the video */
  uri: string;
  /** Original file name */
  fileName?: string;
  /** MIME type (e.g. video/mp4, video/quicktime) */
  mimeType?: string;
  /** File size in bytes */
  fileSize?: number;
  onProgress?: (pct: number) => void;
}

export interface DirectUploadVideoResult {
  video?: {
    id: string;
    file_url: string;
    created_at: string;
    album_type: string;
    class_id?: string;
    student_id?: string;
    thumbnail_key?: string;
  };
  error?: string;
}

export async function directUploadVideo(
  opts: DirectUploadVideoOptions
): Promise<DirectUploadVideoResult> {
  const {
    token, albumType, classId, studentId, caption, uri, fileName, mimeType, fileSize, onProgress,
  } = opts;

  const resolvedMime = mimeType || "video/mp4";
  const resolvedName = fileName || "video.mp4";

  // Resolve actual file size if not provided
  let resolvedSize = fileSize ?? 0;
  if (!resolvedSize) {
    try {
      const info = await FileSystemLegacy.getInfoAsync(uri);
      if (info.exists) resolvedSize = (info as any).size ?? 0;
    } catch {/* keep 0 */}
  }

  // ── Step 1: session ──────────────────────────────────────────────────
  const sessionBody: Record<string, unknown> = {
    album_type: albumType,
    file_name: resolvedName,
    file_type: resolvedMime,
    file_size: resolvedSize,
  };
  if (classId)   sessionBody.class_id   = classId;
  if (studentId) sessionBody.student_id = studentId;
  if (caption)   sessionBody.caption    = caption;

  let sessionData: {
    upload_token: string;
    upload_url: string;
    thumbnail_upload_url?: string;
    object_key: string;
    thumbnail_object_key?: string;
  };

  try {
    const sessionRes = await fetch(`${API_BASE}/videos/direct-upload/session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(sessionBody),
    });
    if (!sessionRes.ok) {
      const errBody = await sessionRes.json().catch(() => ({})) as any;
      return { error: errBody?.error || `세션 생성 실패 (${sessionRes.status})` };
    }
    sessionData = await sessionRes.json();
  } catch (e: any) {
    return { error: String(e?.message || "세션 오류") };
  }

  onProgress?.(5);

  // ── Step 2: PUT video directly to R2 ────────────────────────────────
  try {
    const task = FileSystemLegacy.createUploadTask(
      sessionData.upload_url,
      uri,
      {
        httpMethod: "PUT",
        uploadType: FileSystemLegacy.FileSystemUploadType.BINARY_CONTENT,
        headers: { "Content-Type": resolvedMime },
        sessionType: FileSystemLegacy.FileSystemSessionType.BACKGROUND,
      },
      (progressData) => {
        const { totalBytesSent, totalBytesExpectedToSend } = progressData;
        if (totalBytesExpectedToSend > 0) {
          // 5–90% range for video upload
          const pct = 5 + Math.round((totalBytesSent / totalBytesExpectedToSend) * 85);
          onProgress?.(pct);
        }
      }
    );

    const result = await task.uploadAsync();
    if (!result) return { error: "업로드 취소됨" };
    if (result.status < 200 || result.status >= 300) {
      return { error: `PUT 실패 (${result.status})` };
    }
  } catch (e: any) {
    return { error: String(e?.message || "영상 업로드 실패") };
  }

  onProgress?.(90);

  // ── Step 3: PUT thumbnail (optional, best-effort) ────────────────────
  let thumbnailObjectKey: string | undefined;
  if (sessionData.thumbnail_upload_url && sessionData.thumbnail_object_key) {
    try {
      const thumb = await VideoThumbnails.getThumbnailAsync(uri, { time: 1000 });
      const thumbTask = FileSystemLegacy.createUploadTask(
        sessionData.thumbnail_upload_url,
        thumb.uri,
        {
          httpMethod: "PUT",
          uploadType: FileSystemLegacy.FileSystemUploadType.BINARY_CONTENT,
          headers: { "Content-Type": "image/jpeg" },
          sessionType: FileSystemLegacy.FileSystemSessionType.FOREGROUND,
        },
      );
      const thumbResult = await thumbTask.uploadAsync();
      if (thumbResult && thumbResult.status >= 200 && thumbResult.status < 300) {
        thumbnailObjectKey = sessionData.thumbnail_object_key;
      }
    } catch {/* thumbnail failure is non-fatal */}
  }

  onProgress?.(95);

  // ── Step 4: finalize ─────────────────────────────────────────────────
  try {
    const finalizeRes = await fetch(`${API_BASE}/videos/direct-upload/finalize`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        upload_token: sessionData.upload_token,
        object_key: sessionData.object_key,
        thumbnail_object_key: thumbnailObjectKey,
      }),
    });

    if (!finalizeRes.ok) {
      const errBody = await finalizeRes.json().catch(() => ({})) as any;
      return { error: errBody?.error || `완료 처리 실패 (${finalizeRes.status})` };
    }

    const finalizeData = await finalizeRes.json() as { video: DirectUploadVideoResult["video"] };
    onProgress?.(100);
    return { video: finalizeData.video };
  } catch (e: any) {
    return { error: String(e?.message || "완료 처리 오류") };
  }
}
