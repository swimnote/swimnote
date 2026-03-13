import { Client } from "@replit/object-storage";

let _client: Client | null = null;

export function getStorageClient(): Client {
  if (!_client) _client = new Client();
  return _client;
}

export async function uploadFile(buffer: Buffer, key: string, mimeType: string): Promise<string> {
  const client = getStorageClient();
  await client.uploadFromBuffer(buffer, key, { contentType: mimeType });
  return key;
}

export async function getPublicUrl(key: string): Promise<string> {
  const client = getStorageClient();
  const { ok, value } = await client.downloadAsBytes(key);
  if (!ok) throw new Error(`File not found: ${key}`);
  return key;
}

export function buildServeUrl(baseUrl: string, key: string): string {
  return `${baseUrl}/api/uploads/${encodeURIComponent(key)}`;
}
