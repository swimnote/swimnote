/**
 * 파일명 생성 규칙: {수영장영문명}_{YYYYMMDD}_{HHMMSS}_{rand4}.{ext}
 * 예: toykidsswimclub_20260314_154530_a3f8.jpg
 */
export function sanitizePoolName(name: string): string {
  return (name || "pool").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 24) || "pool";
}

export function genFilename(poolSlug: string, ext: string): string {
  const now = new Date();
  const YYYY = now.getFullYear().toString();
  const MM = String(now.getMonth() + 1).padStart(2, "0");
  const DD = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  const rand = Math.random().toString(36).substr(2, 4);
  const cleanExt = (ext || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
  return `${poolSlug}_${YYYY}${MM}${DD}_${hh}${mm}${ss}_${rand}.${cleanExt}`;
}

/** storage key에서 표준 파일명 추출 */
export function filenameFromKey(key: string): string {
  return key.split("/").pop() || "photo.jpg";
}
