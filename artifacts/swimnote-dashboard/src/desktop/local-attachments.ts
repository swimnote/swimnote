/** Metadata-only local attachment selection. Files are never read, parsed, uploaded or turned into object URLs. */
export const MAX_FILES = 5;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 25 * 1024 * 1024;
export const ALLOWED_EXTENSIONS = ["pdf", "png", "jpg", "jpeg", "webp", "hwp", "hwpx", "docx", "xlsx", "csv", "txt"] as const;
export const ACCEPT_ATTR = ALLOWED_EXTENSIONS.map(e => `.${e}`).join(",");

const MIME_BY_EXT: Record<string, string[]> = {
  pdf: ["application/pdf"], png: ["image/png"], jpg: ["image/jpeg"], jpeg: ["image/jpeg"], webp: ["image/webp"],
  hwp: ["application/x-hwp", "application/haansofthwp", "application/vnd.hancom.hwp"],
  hwpx: ["application/hwp+zip", "application/vnd.hancom.hwpx", "application/x-hwpx", "application/zip"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  csv: ["text/csv", "application/csv", "application/vnd.ms-excel"],
  txt: ["text/plain"],
};

export type LocalAttachment = { id: string; file: File; name: string; type: string; size: number };

export const formatBytes = (n: number) =>
  n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;

const extOf = (name: string) => { const i = name.lastIndexOf("."); return i < 0 ? "" : name.slice(i + 1).toLowerCase(); };
let seq = 0;

export function addLocalFiles(current: LocalAttachment[], incoming: File[]): { next: LocalAttachment[]; errors: string[] } {
  const next = [...current];
  const errors: string[] = [];
  let total = next.reduce((s, a) => s + a.size, 0);
  for (const file of incoming) {
    const ext = extOf(file.name);
    if (!(ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) {
      errors.push(`${file.name}: 지원하지 않는 형식입니다. 실행 파일과 매크로 문서(docm, xlsm 등)는 선택할 수 없습니다.`);
      continue;
    }
    const mimes = MIME_BY_EXT[ext];
    if (file.type && !mimes.includes(file.type) && file.type !== "application/octet-stream") {
      errors.push(`${file.name}: 확장자와 파일 형식이 맞지 않습니다.`);
      continue;
    }
    if (next.some(a => a.name === file.name && a.size === file.size && a.file.lastModified === file.lastModified)) continue;
    if (next.length >= MAX_FILES) { errors.push(`${file.name}: 파일은 최대 ${MAX_FILES}개까지 선택할 수 있습니다.`); continue; }
    if (file.size > MAX_FILE_BYTES) { errors.push(`${file.name}: 파일당 최대 10MiB까지 가능합니다.`); continue; }
    if (total + file.size > MAX_TOTAL_BYTES) { errors.push(`${file.name}: 전체 합계 최대 25MiB를 넘습니다.`); continue; }
    total += file.size;
    next.push({ id: `att-${++seq}`, file, name: file.name, type: file.type || ext.toUpperCase(), size: file.size });
  }
  return { next, errors };
}
