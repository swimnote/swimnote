/**
 * r2.ts — Cloudflare R2 S3-compatible client
 *
 * ┌─ 사진 버킷 (swimnotepicture) ─────────────────────────────────────────┐
 * │  CF_ACCOUNT_ID           : Cloudflare 계정 ID                        │
 * │  CF_R2_BUCKET_NAME       : 버킷 이름                                  │
 * │  CF_R2_ACCESS_KEY_ID     : R2 액세스 키                               │
 * │  CF_R2_SECRET_ACCESS_KEY : R2 시크릿 키                               │
 * └───────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ 영상 버킷 (swimnotevideo) — 과금 구조 분리 ──────────────────────────┐
 * │  CF_ACCOUNT_ID                 : 동일 Cloudflare 계정 ID              │
 * │  CF_R2_VIDEO_BUCKET_NAME       : 영상 버킷 이름                       │
 * │  CF_R2_VIDEO_ACCESS_KEY_ID     : 영상 전용 R2 액세스 키               │
 * │  CF_R2_VIDEO_SECRET_ACCESS_KEY : 영상 전용 R2 시크릿 키               │
 * └───────────────────────────────────────────────────────────────────────┘
 */
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import { Readable } from "stream";

// ─── 사진 전용 S3 클라이언트 ──────────────────────────────────────────────
let _photoClient: S3Client | null = null;

export function getPhotoClient(): S3Client {
  if (!_photoClient) {
    const accountId = process.env.CF_ACCOUNT_ID;
    if (!accountId) throw new Error("CF_ACCOUNT_ID 환경변수가 설정되지 않았습니다.");
    _photoClient = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.CF_R2_ACCESS_KEY_ID || "",
        secretAccessKey: process.env.CF_R2_SECRET_ACCESS_KEY || "",
      },
    });
  }
  return _photoClient;
}

// ─── 영상 전용 S3 클라이언트 (별도 과금 추적용) ───────────────────────────
let _videoClient: S3Client | null = null;

export function getVideoClient(): S3Client {
  if (!_videoClient) {
    const accountId = process.env.CF_ACCOUNT_ID;
    if (!accountId) throw new Error("CF_ACCOUNT_ID 환경변수가 설정되지 않았습니다.");
    _videoClient = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.CF_R2_VIDEO_ACCESS_KEY_ID || "",
        secretAccessKey: process.env.CF_R2_VIDEO_SECRET_ACCESS_KEY || "",
      },
    });
  }
  return _videoClient;
}

// ─── 버킷 이름 ────────────────────────────────────────────────────────────

export function getPhotoBucket(): string {
  return process.env.CF_R2_BUCKET_NAME || "swimnotepicture";
}

export function getVideoBucket(): string {
  return process.env.CF_R2_VIDEO_BUCKET_NAME || "swimnotevideo";
}

/** @deprecated getPhotoBucket()를 사용하세요 */
export const getBucket = getPhotoBucket;
/** @deprecated getPhotoClient()를 사용하세요 */
export const getR2Client = getPhotoClient;

// ─── 내부 범용 헬퍼 ──────────────────────────────────────────────────────────

async function _upload(
  client: S3Client,
  bucket: string,
  key: string,
  body: Buffer,
  contentType: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    await client.send(
      new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType })
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

async function _download(
  client: S3Client,
  bucket: string,
  key: string
): Promise<{ ok: boolean; buffer?: Buffer; error?: string }> {
  try {
    const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
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

async function _delete(client: S3Client, bucket: string, key: string): Promise<void> {
  try {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  } catch { /* 없는 파일 삭제 시 에러 무시 */ }
}

async function _deleteMany(client: S3Client, bucket: string, keys: string[]): Promise<void> {
  if (!keys.length) return;
  try {
    await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: keys.map((Key) => ({ Key })) },
      })
    );
  } catch { /* 에러 무시 */ }
}

// ─── 사진 버킷 API ────────────────────────────────────────────────────────────

/** 사진 버킷에 파일 업로드 */
export async function r2Upload(
  key: string,
  body: Buffer,
  contentType: string
): Promise<{ ok: boolean; error?: string }> {
  return _upload(getPhotoClient(), getPhotoBucket(), key, body, contentType);
}

/** 사진 버킷에서 파일 다운로드 */
export async function r2Download(
  key: string
): Promise<{ ok: boolean; buffer?: Buffer; error?: string }> {
  return _download(getPhotoClient(), getPhotoBucket(), key);
}

/** 사진 버킷 파일 단건 삭제 */
export async function r2Delete(key: string): Promise<void> {
  return _delete(getPhotoClient(), getPhotoBucket(), key);
}

/** 사진 버킷 파일 다건 삭제 */
export async function r2DeleteMany(keys: string[]): Promise<void> {
  return _deleteMany(getPhotoClient(), getPhotoBucket(), keys);
}

// ─── 영상 버킷 API (swimnotevideo, 별도 과금 키) ─────────────────────────────

/** 영상 버킷에 파일 업로드 */
export async function r2VideoUpload(
  key: string,
  body: Buffer,
  contentType: string
): Promise<{ ok: boolean; error?: string }> {
  return _upload(getVideoClient(), getVideoBucket(), key, body, contentType);
}

/** 영상 버킷에서 파일 다운로드 */
export async function r2VideoDownload(
  key: string
): Promise<{ ok: boolean; buffer?: Buffer; error?: string }> {
  return _download(getVideoClient(), getVideoBucket(), key);
}

/** 영상 버킷 파일 단건 삭제 */
export async function r2VideoDelete(key: string): Promise<void> {
  return _delete(getVideoClient(), getVideoBucket(), key);
}

/** 영상 버킷 파일 다건 삭제 */
export async function r2VideoDeleteMany(keys: string[]): Promise<void> {
  return _deleteMany(getVideoClient(), getVideoBucket(), keys);
}
