import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { logOperationalError } from "./event-logger.js";
import {
  saveExternalUsage,
  EXTERNAL_USAGE_CATEGORY,
  type ExternalTriggerType,
} from "./external-usage-service.js";

// ── AI01-07: HTTP attempt detection ───────────────────────────────────────────

/**
 * Returns 1 if the AWS SDK error has an HTTP status code, meaning the request
 * was actually transmitted to Cloudflare R2 and a response was received.
 * Returns undefined when HTTP transmission cannot be confirmed
 * (credentials resolution, serialization, or local config failures have no
 * $metadata.httpStatusCode).
 *
 * This prevents false actual_call_count=1 for pre-HTTP SDK failures.
 */
function confirmedHttpCount(err: unknown): 1 | undefined {
  if (
    err != null &&
    typeof err === "object" &&
    "$metadata" in err &&
    (err as any).$metadata?.httpStatusCode != null
  ) {
    return 1;
  }
  return undefined;
}

// ── AI01-07: optional usage context passed by callers ─────────────────────────

/**
 * Optional R2 usage tracking metadata.
 * All fields are optional so existing callsites need no changes.
 * triggerType defaults to undefined — helper records it only when provided,
 * preventing false USER_ACTION labels on background/system paths.
 */
export interface R2UsageMeta {
  poolId?:      string;
  requestId?:   string;
  actorId?:     string | null;
  /** USER_ACTION | SYSTEM_MAINTENANCE. If omitted, defaults to USER_ACTION. */
  triggerType?: ExternalTriggerType;
}

const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID || "53dff4976d55c17ec94ebe6306d0cffc";
const R2_ENDPOINT = `https://${CF_ACCOUNT_ID}.r2.cloudflarestorage.com`;

const photoClient = new S3Client({
  region: "auto",
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.CF_R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.CF_R2_SECRET_ACCESS_KEY!,
  },
});

const videoClient = new S3Client({
  region: "auto",
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.CF_R2_VIDEO_ACCESS_KEY_ID!,
    secretAccessKey: process.env.CF_R2_VIDEO_SECRET_ACCESS_KEY!,
  },
});

const PHOTO_BUCKET = process.env.CF_R2_BUCKET_NAME || "swimnotepicture";
const VIDEO_BUCKET = process.env.CF_R2_VIDEO_BUCKET_NAME || "swimnotevideo";

export type StorageBucket = "photo" | "video";

function getClientAndBucket(type: StorageBucket) {
  return type === "video"
    ? { client: videoClient, bucket: VIDEO_BUCKET }
    : { client: photoClient, bucket: PHOTO_BUCKET };
}

export async function uploadToR2(
  key: string,
  buffer: Buffer,
  contentType: string,
  type: StorageBucket = "photo",
  /** AI01-07: optional usage tracking metadata. Existing callers need not pass this. */
  _usage?: R2UsageMeta,
): Promise<{ ok: boolean; error?: string }> {
  const startMs   = Date.now();
  let   success   = false;
  let   errorType: string | undefined;
  // buffer.length is always known — record bytes
  const bytes     = buffer.length;

  let putErr: unknown;
  try {
    const { client, bucket } = getClientAndBucket(type);
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }));
    success = true;
    return { ok: true };
  } catch (e: any) {
    putErr    = e;
    errorType = e.message?.slice(0, 120);
    console.error(`[R2 upload] 실패 key=${key} bucket=${type}:`, e.message);
    // WP6: MUST DB-observable for R2 PUT failures when pool context available
    if (_usage?.poolId) {
      void logOperationalError({
        pool_id: _usage.poolId,
        feature: "STORAGE",
        level: "ERROR",
        error_code: "R2_PUT_FAILED",
        safe_message: `R2 PUT 실패 bucket=${type}: ${(e?.message ?? "").slice(0, 200)}`,
        entity_type: "file",
        entity_id: _usage?.requestId,
        actor_id: _usage?.actorId ?? undefined,
        metadata: { bucket: type, error_type: errorType },
      });
    }
    return { ok: false, error: e.message };
  } finally {
    // actual_call_count: 1 on success; on failure only if HTTP response confirmed
    const actualCallCount = success ? 1 : confirmedHttpCount(putErr);
    void saveExternalUsage({
      provider:              "cloudflare_r2",
      service:               "r2_put",
      feature:               EXTERNAL_USAGE_CATEGORY.R2,
      trigger_type:          _usage?.triggerType ?? "USER_ACTION",
      pool_id:               _usage?.poolId      ?? "",
      request_id:            _usage?.requestId,
      actor_id:              _usage?.actorId     ?? null,
      logical_request_count: 1,
      actual_call_count:     actualCallCount,
      retry_count:           0,
      success,
      ...(errorType != null ? { error_type: errorType } : {}),
      latency_ms:            Date.now() - startMs,
      estimated_cost_usd:    null,
      cost_source:           "UNKNOWN",
      units:                 { bytes },
    }).catch((err) =>
      console.error("[R2/usage] uploadToR2 recording failed:", (err as Error)?.message)
    );
  }
}

export async function downloadFromR2(
  key: string,
  type: StorageBucket = "photo",
  /** AI01-07: optional usage tracking metadata. Existing callers need not pass this. */
  _usage?: R2UsageMeta,
): Promise<{ ok: boolean; data?: Buffer; error?: string }> {
  const startMs  = Date.now();
  let   success  = false;
  let   errorType: string | undefined;
  let   bytes: number | undefined;

  let getErr: unknown;
  try {
    const { client, bucket } = getClientAndBucket(type);
    const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const chunks: Uint8Array[] = [];
    for await (const chunk of res.Body as any) {
      chunks.push(chunk);
    }
    const data = Buffer.concat(chunks);
    bytes      = data.length; // known after full read
    success    = true;
    return { ok: true, data };
  } catch (e: any) {
    getErr    = e;
    errorType = e.message?.slice(0, 120);
    console.error(`[R2 download] 실패 key=${key} bucket=${type}:`, e.message);
    return { ok: false, error: e.message };
  } finally {
    const actualCallCount = success ? 1 : confirmedHttpCount(getErr);
    void saveExternalUsage({
      provider:              "cloudflare_r2",
      service:               "r2_get",
      feature:               EXTERNAL_USAGE_CATEGORY.R2,
      trigger_type:          _usage?.triggerType ?? "USER_ACTION",
      pool_id:               _usage?.poolId      ?? "",
      request_id:            _usage?.requestId,
      actor_id:              _usage?.actorId     ?? null,
      logical_request_count: 1,
      actual_call_count:     actualCallCount,
      retry_count:           0,
      success,
      ...(errorType != null ? { error_type: errorType } : {}),
      latency_ms:            Date.now() - startMs,
      estimated_cost_usd:    null,
      cost_source:           "UNKNOWN",
      ...(bytes != null ? { units: { bytes } } : {}),
    }).catch((err) =>
      console.error("[R2/usage] downloadFromR2 recording failed:", (err as Error)?.message)
    );
  }
}

export async function deleteFromR2(
  key: string,
  type: StorageBucket = "photo",
  /** AI01-07: optional usage tracking metadata. Existing callers need not pass this. */
  _usage?: R2UsageMeta,
): Promise<void> {
  const startMs  = Date.now();
  let   success  = false;
  let   errorType: string | undefined;
  let   delErr: unknown;

  try {
    const { client, bucket } = getClientAndBucket(type);
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    success = true;
  } catch (e: any) {
    delErr    = e;
    errorType = e.message?.slice(0, 120);
    console.error(`[R2 delete] 실패 key=${key}:`, e.message);
    // original behavior: swallow error, return void
  } finally {
    const actualCallCount = success ? 1 : confirmedHttpCount(delErr);
    void saveExternalUsage({
      provider:              "cloudflare_r2",
      service:               "r2_delete",
      feature:               EXTERNAL_USAGE_CATEGORY.R2,
      trigger_type:          _usage?.triggerType ?? "USER_ACTION",
      pool_id:               _usage?.poolId      ?? "",
      request_id:            _usage?.requestId,
      actor_id:              _usage?.actorId     ?? null,
      logical_request_count: 1,
      actual_call_count:     actualCallCount,
      retry_count:           0,
      success,
      ...(errorType != null ? { error_type: errorType } : {}),
      latency_ms:            Date.now() - startMs,
      estimated_cost_usd:    null,
      cost_source:           "UNKNOWN",
    }).catch((err) =>
      console.error("[R2/usage] deleteFromR2 recording failed:", (err as Error)?.message)
    );
  }
}

export async function uploadFile(buffer: Buffer, key: string, mimeType: string): Promise<string> {
  await uploadToR2(key, buffer, mimeType, "photo");
  return key;
}

/**
 * Generate a presigned PUT URL for direct client-side upload to R2.
 * Expires in `expiresIn` seconds (default 300 = 5 minutes).
 * Only photo bucket is supported for direct upload.
 */
export async function getPresignedPutUrl(
  key: string,
  contentType: string,
  contentLength: number,
  expiresIn: number = 300,
): Promise<{ ok: boolean; url?: string; error?: string }> {
  try {
    const url = await getSignedUrl(
      photoClient as any,
      new PutObjectCommand({
        Bucket: PHOTO_BUCKET,
        Key: key,
        ContentType: contentType,
        ContentLength: contentLength,
      }) as any,
      { expiresIn },
    );
    return { ok: true, url };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

/**
 * HEAD an object in R2 — returns size and content-type without downloading the body.
 * Returns null if the object does not exist (404).
 */
export async function headObject(
  key: string,
  type: StorageBucket = "photo",
): Promise<{ contentLength: number; contentType: string } | null> {
  try {
    const { client, bucket } = getClientAndBucket(type);
    const result = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return {
      contentLength: result.ContentLength ?? 0,
      contentType: result.ContentType ?? "",
    };
  } catch (e: any) {
    // 404 / NoSuchKey → object does not exist
    if (e.$metadata?.httpStatusCode === 404 || e.name === "NotFound" || e.name === "NoSuchKey") {
      return null;
    }
    throw e;
  }
}

export async function getPresignedUrl(
  key: string,
  type: StorageBucket = "photo",
  expiresIn: number = 3600,
): Promise<{ ok: boolean; url?: string; error?: string }> {
  try {
    const { client, bucket } = getClientAndBucket(type);
    const url = await getSignedUrl(
      client as any,
      new GetObjectCommand({ Bucket: bucket, Key: key }) as any,
      { expiresIn },
    );
    return { ok: true, url };
  } catch (e: any) {
    console.error(`[R2 presign] 실패 key=${key} bucket=${type}:`, e.message);
    return { ok: false, error: e.message };
  }
}
