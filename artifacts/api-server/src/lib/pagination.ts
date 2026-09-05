/**
 * WP8 Pagination Helpers
 *
 * Cursor format: base64url(JSON { created_at, id })
 * - Opaque to client
 * - No sensitive info
 * - No encryption needed
 */

export interface CursorPayload {
  created_at: string;
  id: string;
}

export function encodeCursor(created_at: string | Date, id: string): string {
  const payload: CursorPayload = {
    created_at: typeof created_at === "string" ? created_at : created_at.toISOString(),
    id,
  };
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

export function decodeCursor(cursor: string): CursorPayload | null {
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const obj = JSON.parse(raw);
    if (typeof obj.created_at !== "string" || typeof obj.id !== "string") return null;
    // Validate ISO date
    if (isNaN(Date.parse(obj.created_at))) return null;
    return { created_at: obj.created_at, id: obj.id };
  } catch {
    return null;
  }
}

/**
 * Parse limit from query param.
 * Returns a safe bounded integer.
 */
export function parseLimit(
  val: unknown,
  defaultVal = 50,
  maxVal = 100,
): number {
  const n = parseInt(String(val ?? ""), 10);
  if (!n || n <= 0 || isNaN(n)) return defaultVal;
  return Math.min(n, maxVal);
}
