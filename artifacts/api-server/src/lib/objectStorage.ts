import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

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
  type: StorageBucket = "photo"
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { client, bucket } = getClientAndBucket(type);
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }));
    return { ok: true };
  } catch (e: any) {
    console.error(`[R2 upload] 실패 key=${key} bucket=${type}:`, e.message);
    return { ok: false, error: e.message };
  }
}

export async function downloadFromR2(
  key: string,
  type: StorageBucket = "photo"
): Promise<{ ok: boolean; data?: Buffer; error?: string }> {
  try {
    const { client, bucket } = getClientAndBucket(type);
    const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const chunks: Uint8Array[] = [];
    for await (const chunk of res.Body as any) {
      chunks.push(chunk);
    }
    return { ok: true, data: Buffer.concat(chunks) };
  } catch (e: any) {
    console.error(`[R2 download] 실패 key=${key} bucket=${type}:`, e.message);
    return { ok: false, error: e.message };
  }
}

export async function deleteFromR2(key: string, type: StorageBucket = "photo"): Promise<void> {
  try {
    const { client, bucket } = getClientAndBucket(type);
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  } catch (e: any) {
    console.error(`[R2 delete] 실패 key=${key}:`, e.message);
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
