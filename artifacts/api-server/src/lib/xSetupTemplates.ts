/**
 * xSetupTemplates — WP-X03-T1 공식 DOCX 양식 R2 등록
 *
 * SOURCE OF TRUTH: src/assets/templates/ 의 공식 바이너리 파일
 * 자동 생성 금지: docx 패키지로 새 내용을 만들지 않는다.
 *
 * 템플릿 R2 키: x-setup/templates/{type}_v{version}.docx
 * 버전 변경 시 TEMPLATE_VERSIONS 수정 → 서버 재시작 → 자동 재업로드.
 */
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { uploadToR2, downloadFromR2 } from "./objectStorage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const TEMPLATE_VERSIONS = {
  curriculum: "1.0",
  website:    "1.0",
} as const;

export type TemplateType = keyof typeof TEMPLATE_VERSIONS;

export const TEMPLATE_FILENAMES: Record<TemplateType, string> = {
  curriculum: "SWIMNOTE_X_커리큘럼_작성양식_v1.0.docx",
  website:    "SWIMNOTE_X_홈페이지_제작자료_양식_v1.0.docx",
};

export function getTemplateR2Key(type: TemplateType): string {
  return `x-setup/templates/${type}_v${TEMPLATE_VERSIONS[type]}.docx`;
}

/** 공식 바이너리 파일 경로 (서버 빌드 후 dist/ 에서는 상위 src/assets/ 경로 사용) */
function getAssetPath(type: TemplateType): string {
  // src/lib/ → src/assets/templates/
  const candidates = [
    path.resolve(__dirname, "../assets/templates", TEMPLATE_FILENAMES[type]),
    // dist/ 빌드 후 위치
    path.resolve(__dirname, "../../src/assets/templates", TEMPLATE_FILENAMES[type]),
  ];
  return candidates[0]; // readFile에서 실패하면 candidates[1] fallback
}

// ── 공식 바이너리 읽기 (fallback 포함) ──────────────────────────────────────
async function readOfficialBinary(type: TemplateType): Promise<Buffer> {
  const primary = path.resolve(__dirname, "../assets/templates", TEMPLATE_FILENAMES[type]);
  const fallback = path.resolve(__dirname, "../../src/assets/templates", TEMPLATE_FILENAMES[type]);
  try {
    return await readFile(primary);
  } catch {
    return await readFile(fallback);
  }
}

// ── R2에 공식 템플릿 등록 (이미 존재하면 skip) ───────────────────────────────
async function ensureTemplateInR2(type: TemplateType): Promise<void> {
  const key = getTemplateR2Key(type);
  const version = TEMPLATE_VERSIONS[type];
  const filename = TEMPLATE_FILENAMES[type];

  // 이미 존재하면 skip
  const existing = await downloadFromR2(key, "photo");
  if (existing.ok && existing.data && existing.data.length > 0) {
    console.log(`[x-setup-template] ${type} v${version} R2에 존재 — skip (${existing.data.length} bytes)`);
    return;
  }

  // 공식 바이너리 로드
  let buffer: Buffer;
  try {
    buffer = await readOfficialBinary(type);
  } catch (e: any) {
    console.error(`[x-setup-template] 공식 파일 읽기 실패 (${filename}):`, e.message);
    return;
  }

  const sha256 = createHash("sha256").update(buffer).digest("hex");
  console.log(`[x-setup-template] ${type} v${version} 공식 바이너리 로드 — ${buffer.length} bytes, SHA-256: ${sha256}`);

  // R2 업로드
  const { ok, error } = await uploadToR2(
    key,
    buffer,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "photo",
  );
  if (!ok) {
    console.error(`[x-setup-template] ${type} R2 업로드 실패:`, error);
  } else {
    console.log(`[x-setup-template] ${type} v${version} R2 등록 완료 — key: ${key}`);
  }
}

export async function ensureXSetupTemplates(): Promise<void> {
  await Promise.all([
    ensureTemplateInR2("curriculum"),
    ensureTemplateInR2("website"),
  ]);
}

/** 템플릿 메타데이터 (다운로드 API 응답용) */
export function getTemplateMeta(type: TemplateType) {
  return {
    type,
    version: TEMPLATE_VERSIONS[type],
    file_name: TEMPLATE_FILENAMES[type],
    mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    storage_key: getTemplateR2Key(type),
    updated_at: "2026-08-17",
  };
}
