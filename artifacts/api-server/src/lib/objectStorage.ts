import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

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
