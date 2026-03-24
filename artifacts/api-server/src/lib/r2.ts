/**
 * r2.ts — Cloudflare R2 S3-compatible client
 * 환경변수: CF_ACCOUNT_ID, CF_R2_BUCKET_NAME, CF_R2_ACCESS_KEY_ID, CF_R2_SECRET_ACCESS_KEY
 */
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import { Readable } from "stream";

let _client: S3Client | null = null;

export function getR2Client(): S3Client {
  if (!_client) {
    const accountId = process.env.CF_ACCOUNT_ID;
    if (!accountId) throw new Error("CF_ACCOUNT_ID 환경변수가 설정되지 않았습니다.");
    _client = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.CF_R2_ACCESS_KEY_ID || "",
        secretAccessKey: process.env.CF_R2_SECRET_ACCESS_KEY || "",
      },
    });
  }
  return _client;
}

export function getBucket(): string {
  return process.env.CF_R2_BUCKET_NAME || "swimnotepicture";
}

/** R2에 파일 업로드 */
export async function r2Upload(
  key: string,
  body: Buffer,
  contentType: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    await getR2Client().send(
      new PutObjectCommand({
        Bucket: getBucket(),
        Key: key,
        Body: body,
        ContentType: contentType,
      })
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/** R2에서 파일 다운로드 (Buffer 반환) */
export async function r2Download(
  key: string
): Promise<{ ok: boolean; buffer?: Buffer; error?: string }> {
  try {
    const res = await getR2Client().send(
      new GetObjectCommand({ Bucket: getBucket(), Key: key })
    );
    const stream = res.Body as Readable;
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return { ok: true, buffer: Buffer.concat(chunks) };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/** R2에서 파일 단건 삭제 */
export async function r2Delete(key: string): Promise<void> {
  try {
    await getR2Client().send(
      new DeleteObjectCommand({ Bucket: getBucket(), Key: key })
    );
  } catch {
    // 없는 파일 삭제 시 에러 무시
  }
}

/** R2에서 파일 다건 삭제 (최대 1000개) */
export async function r2DeleteMany(keys: string[]): Promise<void> {
  if (!keys.length) return;
  try {
    await getR2Client().send(
      new DeleteObjectsCommand({
        Bucket: getBucket(),
        Delete: { Objects: keys.map((Key) => ({ Key })) },
      })
    );
  } catch {
    // 에러 무시
  }
}
