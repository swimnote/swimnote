/**
 * directUploadPhotos.ts
 * Implements the R2 direct-upload flow for diary photos.
 *
 * Flow:
 *   1. POST /photos/direct-upload/session  →  { upload_token, expires_at, uploads[] }
 *   2. PUT each file binary to upload_url  (expo-file-system/legacy createUploadTask, BINARY_CONTENT)
 *      – max concurrency 4
 *      – non-2xx PUT status treated as failure
 *   3. POST /photos/direct-upload/finalize (successful subset only)
 *      →  { photos[{ client_id, id, file_url, created_at, … }] }
 *
 * Auth:  Authorization header sent to API server only; NOT forwarded to R2
 *        (pre-signed URLs already carry credentials).
 * Max:   caller enforces ≤ 10 files; this helper accepts any count.
 */

import * as FileSystemLegacy from "expo-file-system/legacy";
import { API_BASE } from "@/context/AuthContext";

export interface DirectUploadFile {
  /** Stable client-side ID (caller-generated) */
  clientId: string;
  /** Local file:// URI of the (possibly compressed) image */
  uri: string;
  fileName: string;
  mimeType: string;
  /** Actual byte size of the (possibly compressed) file */
  fileSize: number;
}

export interface DirectUploadItemResult {
  clientId: string;
  /** Set on success */
  photo?: {
    id: string;
    file_url: string;
    created_at: string;
    uploaded_by_name?: string;
    media_status?: string;
    journal_id?: string;
  };
  /** Set on failure */
  error?: string;
}

export interface DirectUploadOptions {
  token: string;
  albumType: "group" | "private";
  /** Optional – omitted from session body when absent (pool-wide saved album uploads) */
  classId?: string;
  studentId?: string;
  /** Optional – omitted from session body when absent */
  lessonDate?: string;
  caption?: string;
  files: DirectUploadFile[];
  /** Progress 0-100 for a single PUT in flight */
  onItemProgress?: (clientId: string, progress: number) => void;
  /** Called when a single PUT succeeds (before finalize) */
  onItemDone?: (clientId: string) => void;
  /** Called when a single item fails (PUT *or* finalize) */
  onItemError?: (clientId: string, error: string) => void;
}

const MAX_CONCURRENCY = 4;

async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  limit: number
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let idx = 0;

  async function worker() {
    while (idx < tasks.length) {
      const i = idx++;
      results[i] = await tasks[i]();
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function directUploadPhotos(opts: DirectUploadOptions): Promise<DirectUploadItemResult[]> {
  const {
    token, albumType, classId, studentId, lessonDate, caption, files,
    onItemProgress, onItemDone, onItemError,
  } = opts;

  if (files.length === 0) return [];

  // ── Step 1: request upload session ──────────────────────────────────
  // Build body, omitting optional fields when absent
  const sessionBody: Record<string, unknown> = {
    album_type: albumType,
    files: files.map(f => ({
      client_id: f.clientId,
      file_name: f.fileName,
      file_type: f.mimeType,
      file_size: f.fileSize,
    })),
  };
  if (classId)    sessionBody.class_id    = classId;
  if (studentId)  sessionBody.student_id  = studentId;
  if (lessonDate) sessionBody.lesson_date = lessonDate;
  if (caption)    sessionBody.caption     = caption;

  type SessionData = {
    upload_token: string;
    expires_at: string;
    uploads: Array<{
      client_id: string;
      object_key: string;
      upload_url: string;
      headers: Record<string, string>;
    }>;
  };

  let sessionData: SessionData;

  try {
    const sessionRes = await fetch(`${API_BASE}/photos/direct-upload/session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(sessionBody),
    });
    if (!sessionRes.ok) {
      const errBody = await sessionRes.json().catch(() => ({})) as any;
      throw new Error(errBody?.error || `세션 생성 실패 (${sessionRes.status})`);
    }
    sessionData = await sessionRes.json();
  } catch (e: any) {
    // Session creation failed → every item fails
    const errMsg = String(e?.message || "세션 오류");
    files.forEach(f => onItemError?.(f.clientId, errMsg));
    return files.map(f => ({ clientId: f.clientId, error: errMsg }));
  }

  // Build a clientId → upload-slot lookup
  const uploadMap = new Map(sessionData.uploads.map(u => [u.client_id, u]));

  // ── Step 2: PUT each file ────────────────────────────────────────────
  const perItemResults: DirectUploadItemResult[] = new Array(files.length);

  const tasks = files.map((file, fileIndex) => async () => {
    const slot = uploadMap.get(file.clientId);
    if (!slot) {
      const errMsg = "업로드 슬롯 없음";
      onItemError?.(file.clientId, errMsg);
      perItemResults[fileIndex] = { clientId: file.clientId, error: errMsg };
      return;
    }

    try {
      // Use expo-file-system/legacy createUploadTask: BINARY_CONTENT + PUT
      // Do NOT include Authorization in headers – R2 pre-signed URLs are self-authorising
      const task = FileSystemLegacy.createUploadTask(
        slot.upload_url,
        file.uri,
        {
          httpMethod: "PUT",
          uploadType: FileSystemLegacy.FileSystemUploadType.BINARY_CONTENT,
          headers: slot.headers ?? {},
          sessionType: FileSystemLegacy.FileSystemSessionType.FOREGROUND,
        },
        (progressData) => {
          const { totalBytesSent, totalBytesExpectedToSend } = progressData;
          if (totalBytesExpectedToSend > 0) {
            const pct = Math.round((totalBytesSent / totalBytesExpectedToSend) * 100);
            onItemProgress?.(file.clientId, pct);
          }
        }
      );

      const result = await task.uploadAsync();

      if (!result) throw new Error("업로드 취소됨");

      // Non-2xx → failure
      if (result.status < 200 || result.status >= 300) {
        throw new Error(`PUT 실패 (${result.status})`);
      }

      onItemProgress?.(file.clientId, 100);
      onItemDone?.(file.clientId);
      perItemResults[fileIndex] = { clientId: file.clientId };
    } catch (e: any) {
      const errMsg = String(e?.message || "업로드 실패");
      onItemError?.(file.clientId, errMsg);
      perItemResults[fileIndex] = { clientId: file.clientId, error: errMsg };
    }
  });

  await runWithConcurrency(tasks, MAX_CONCURRENCY);

  // ── Step 3: finalize the successful subset ───────────────────────────
  const succeededItems = perItemResults.filter(r => !r.error);
  if (succeededItems.length === 0) {
    return perItemResults;
  }

  const completed = succeededItems.map(r => {
    const slot = uploadMap.get(r.clientId)!;
    return { client_id: r.clientId, object_key: slot.object_key };
  });

  try {
    const finalizeRes = await fetch(`${API_BASE}/photos/direct-upload/finalize`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        upload_token: sessionData.upload_token,
        completed,
      }),
    });

    if (!finalizeRes.ok) {
      const errBody = await finalizeRes.json().catch(() => ({})) as any;
      throw new Error(errBody?.error || `완료 처리 실패 (${finalizeRes.status})`);
    }

    const finalizeData = await finalizeRes.json() as {
      photos: Array<{
        client_id?: string;
        id: string;
        file_url: string;
        created_at: string;
        uploaded_by_name?: string;
        media_status?: string;
        journal_id?: string;
      }>;
    };

    // Primary: map by photo.client_id returned by the server
    // Fallback: positional index in completed[] (same ordering)
    const photosByClientId = new Map<string, typeof finalizeData.photos[0]>();
    (finalizeData.photos ?? []).forEach((photo, i) => {
      const cid = photo.client_id ?? completed[i]?.client_id;
      if (cid) photosByClientId.set(cid, photo);
    });

    // Merge finalized photo data into results; call onItemError for finalize misses
    return perItemResults.map(r => {
      if (r.error) return r;
      const photo = photosByClientId.get(r.clientId);
      if (!photo) {
        const errMsg = "파이널라이즈 응답 없음";
        onItemError?.(r.clientId, errMsg);
        return { ...r, error: errMsg };
      }
      return { ...r, photo };
    });
  } catch (e: any) {
    // Finalize error → mark all previously succeeded items as failed
    const errMsg = String(e?.message || "완료 처리 오류");
    return perItemResults.map(r => {
      if (r.error) return r;
      onItemError?.(r.clientId, errMsg);
      return { ...r, error: errMsg };
    });
  }
}
