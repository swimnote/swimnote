/**
 * x-setup.test.ts — WP-X03 X Setup API 테스트
 *
 * 테스트 범위:
 *   - DOCX MIME/ext 검증
 *   - Photo 최대 10장 enforcement
 *   - 버전 이력 (재업로드 시 이전 is_current=false)
 *   - Cross-pool isolation
 *   - 역할 기반 접근 제어 (pool_admin only for uploads)
 *   - Super admin 조회/승인/수정요청
 *   - Status 전환
 *   - Template download
 *   - Submit flow
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import express from "express";

// ── Mock 세팅 ─────────────────────────────────────────────────────────────────
const mockPoolId = "pool_test_xsetup_001";
const mockUserId = "user_pool_admin_001";
const mockSuperAdminId = "user_super_admin_001";

// DB mock
vi.mock("@workspace/db", () => ({
  superAdminDb: {
    execute: vi.fn(),
  },
  db: {
    execute: vi.fn(),
  },
}));

// objectStorage mock
vi.mock("../../lib/objectStorage.js", () => ({
  uploadToR2: vi.fn().mockResolvedValue({ ok: true, error: null }),
  downloadFromR2: vi.fn().mockResolvedValue({ ok: true, data: Buffer.alloc(0) }),
  getPresignedUrl: vi.fn().mockResolvedValue({ ok: true, url: "https://r2.example.com/test?sig=xxx", error: null }),
}));

// xSetupTemplates mock
vi.mock("../../lib/xSetupTemplates.js", () => ({
  TEMPLATE_VERSIONS: { curriculum: "1.0", website: "1.0" },
  TEMPLATE_FILENAMES: {
    curriculum: "SWIMNOTE_X_커리큘럼_작성양식_v1.0.docx",
    website:    "SWIMNOTE_X_홈페이지_제작자료_양식_v1.0.docx",
  },
  getTemplateR2Key: (type: string) => `x-setup/templates/${type}_v1.0.docx`,
  ensureXSetupTemplates: vi.fn().mockResolvedValue(undefined),
  getTemplateMeta: (type: string) => ({
    type,
    version: "1.0",
    file_name: type === "curriculum" ? "SWIMNOTE_X_커리큘럼_작성양식_v1.0.docx" : "SWIMNOTE_X_홈페이지_제작자료_양식_v1.0.docx",
    mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    storage_key: `x-setup/templates/${type}_v1.0.docx`,
    updated_at: "2026-08-17",
  }),
}));

// migrations mock
vi.mock("../../migrations/pool-db-x-setup.js", () => ({
  runXSetupMigration: vi.fn().mockResolvedValue(undefined),
}));

// auth mock
vi.mock("../../middlewares/auth.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    const auth = req.headers["authorization"];
    if (auth === `Bearer pool_admin_token`) {
      req.user = { userId: mockUserId, role: "pool_admin" };
    } else if (auth === `Bearer super_admin_token`) {
      req.user = { userId: mockSuperAdminId, role: "super_admin" };
    } else if (auth === `Bearer teacher_token`) {
      req.user = { userId: "user_teacher_001", role: "teacher" };
    } else if (auth === `Bearer other_pool_token`) {
      req.user = { userId: "user_other_pool_001", role: "pool_admin" };
    }
    next();
  },
  requireRole: (...roles: string[]) => (req: any, res: any, next: any) => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: "권한 없음" });
      return;
    }
    next();
  },
}));

import { superAdminDb } from "@workspace/db";
import { uploadToR2, getPresignedUrl } from "../../lib/objectStorage.js";

// ── DB 응답 설정 헬퍼 ─────────────────────────────────────────────────────────
function mockPoolAdmin(poolId = mockPoolId) {
  (superAdminDb.execute as any).mockImplementation((query: any) => {
    const q = query?.queryChunks?.map((c: any) => c?.value ?? c).join("") ?? "";
    // getPoolId → users 테이블
    if (q.includes("FROM users") && q.includes("swimming_pool_id")) {
      return { rows: [{ swimming_pool_id: poolId }] };
    }
    // ensureSubmission INSERT ... ON CONFLICT
    if (q.includes("INSERT INTO x_setup_submissions")) {
      return { rows: [] };
    }
    // submission SELECT
    if (q.includes("FROM x_setup_submissions")) {
      return { rows: [{ pool_id: poolId, setup_status: "NOT_STARTED", curriculum_status: "NOT_SUBMITTED", website_status: "NOT_SUBMITTED", logo_status: "NOT_SUBMITTED", photos_status: "NOT_SUBMITTED", submitted_at: null }] };
    }
    // files SELECT
    if (q.includes("FROM x_setup_files") && q.includes("is_current")) {
      return { rows: [] };
    }
    // revision SELECT
    if (q.includes("FROM x_setup_revision_requests") && q.includes("status = 'PENDING'")) {
      return { rows: [] };
    }
    // nextVersion (MAX submission_version)
    if (q.includes("MAX(submission_version)")) {
      return { rows: [{ v: 0 }] };
    }
    // photo count
    if (q.includes("COUNT(*)") && q.includes("photo")) {
      return { rows: [{ cnt: 0 }] };
    }
    // UPDATE x_setup_files SET is_current = false
    if (q.includes("UPDATE x_setup_files")) {
      return { rows: [] };
    }
    // INSERT INTO x_setup_files
    if (q.includes("INSERT INTO x_setup_files")) {
      return { rows: [] };
    }
    // UPDATE x_setup_submissions
    if (q.includes("UPDATE x_setup_submissions")) {
      return { rows: [] };
    }
    // swimming_pools
    if (q.includes("FROM swimming_pools")) {
      return { rows: [{ id: poolId, name: "테스트 수영장" }] };
    }
    return { rows: [] };
  });
}

function mockPhotoCount(count: number) {
  (superAdminDb.execute as any).mockImplementation((query: any) => {
    const q = query?.queryChunks?.map((c: any) => c?.value ?? c).join("") ?? "";
    if (q.includes("FROM users")) return { rows: [{ swimming_pool_id: mockPoolId }] };
    if (q.includes("INSERT INTO x_setup_submissions")) return { rows: [] };
    if (q.includes("FROM x_setup_submissions")) return { rows: [{ pool_id: mockPoolId, setup_status: "IN_PROGRESS", curriculum_status: "NOT_SUBMITTED", website_status: "NOT_SUBMITTED", logo_status: "NOT_SUBMITTED", photos_status: "SUBMITTED" }] };
    if (q.includes("COUNT(*)") && q.includes("photo")) return { rows: [{ cnt: count }] };
    if (q.includes("UPDATE x_setup_submissions")) return { rows: [] };
    if (q.includes("UPDATE x_setup_files")) return { rows: [] };
    if (q.includes("INSERT INTO x_setup_files")) return { rows: [] };
    if (q.includes("MAX(submission_version)")) return { rows: [{ v: count }] };
    return { rows: [] };
  });
}

// ── 앱 세팅 ──────────────────────────────────────────────────────────────────
let app: express.Application;
let xSetupRouter: any;

beforeAll(async () => {
  const mod = await import("../x-setup.js");
  xSetupRouter = mod.default;
  app = express();
  app.use(express.json());
  app.use("/", xSetupRouter);
});

// DOCX 양식 생성 헬퍼
function makeDocxBuffer(): Buffer {
  // PK zip magic bytes — DOCX is a zip file
  const pkMagic = Buffer.from([0x50, 0x4B, 0x03, 0x04]);
  return Buffer.concat([pkMagic, Buffer.alloc(100, 0)]);
}

// ── 테스트 ────────────────────────────────────────────────────────────────────

describe("GET /x-setup/status", () => {
  it("TC-XS-01: pool_admin 정상 조회", async () => {
    mockPoolAdmin();
    const res = await request(app)
      .get("/x-setup/status")
      .set("Authorization", "Bearer pool_admin_token");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("submission");
    expect(res.body).toHaveProperty("files");
    expect(res.body).toHaveProperty("pending_revisions");
    expect(res.body).toHaveProperty("template_versions");
  });

  it("TC-XS-02: teacher 역할 접근 거부 (403)", async () => {
    const res = await request(app)
      .get("/x-setup/status")
      .set("Authorization", "Bearer teacher_token");
    expect(res.status).toBe(403);
  });

  it("TC-XS-03: 미인증 접근 거부 (403)", async () => {
    const res = await request(app).get("/x-setup/status");
    expect(res.status).toBe(403);
  });
});

describe("GET /x-setup/templates/:type/download", () => {
  it("TC-XS-04: curriculum 템플릿 다운로드 URL 반환", async () => {
    mockPoolAdmin();
    const res = await request(app)
      .get("/x-setup/templates/curriculum/download")
      .set("Authorization", "Bearer pool_admin_token");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("url");
    expect(res.body).toHaveProperty("version");
    expect(res.body.url).toContain("r2.example.com");
  });

  it("TC-XS-05: website 템플릿 다운로드 URL 반환", async () => {
    mockPoolAdmin();
    const res = await request(app)
      .get("/x-setup/templates/website/download")
      .set("Authorization", "Bearer pool_admin_token");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("url");
  });

  it("TC-XS-06: 잘못된 type 요청 거부 (400)", async () => {
    mockPoolAdmin();
    const res = await request(app)
      .get("/x-setup/templates/invalid/download")
      .set("Authorization", "Bearer pool_admin_token");
    expect(res.status).toBe(400);
  });
});

describe("POST /x-setup/upload/curriculum — DOCX 검증", () => {
  it("TC-XS-07: DOCX 업로드 성공", async () => {
    mockPoolAdmin();
    const res = await request(app)
      .post("/x-setup/upload/curriculum")
      .set("Authorization", "Bearer pool_admin_token")
      .attach("file", makeDocxBuffer(), { filename: "curriculum.docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("ok", true);
    expect(res.body).toHaveProperty("file_id");
    expect(res.body).toHaveProperty("version");
  });

  it("TC-XS-08: DOC 파일 거부 (422 INVALID_DOCX)", async () => {
    mockPoolAdmin();
    const res = await request(app)
      .post("/x-setup/upload/curriculum")
      .set("Authorization", "Bearer pool_admin_token")
      .attach("file", Buffer.from("D0CF11E0"), { filename: "curriculum.doc", contentType: "application/msword" });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("INVALID_DOCX");
  });

  it("TC-XS-09: DOCM 파일 거부 (422 INVALID_DOCX)", async () => {
    mockPoolAdmin();
    const res = await request(app)
      .post("/x-setup/upload/curriculum")
      .set("Authorization", "Bearer pool_admin_token")
      .attach("file", Buffer.from("PK\x03\x04"), { filename: "curriculum.docm", contentType: "application/vnd.ms-word.document.macroEnabled.12" });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("INVALID_DOCX");
  });

  it("TC-XS-10: 파일 없이 요청 시 400", async () => {
    mockPoolAdmin();
    const res = await request(app)
      .post("/x-setup/upload/curriculum")
      .set("Authorization", "Bearer pool_admin_token");
    expect(res.status).toBe(400);
  });

  it("TC-XS-11: teacher 역할 업로드 거부 (403)", async () => {
    const res = await request(app)
      .post("/x-setup/upload/curriculum")
      .set("Authorization", "Bearer teacher_token")
      .attach("file", makeDocxBuffer(), { filename: "curriculum.docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    expect(res.status).toBe(403);
  });
});

describe("POST /x-setup/upload/website — DOCX 검증", () => {
  it("TC-XS-12: website DOCX 업로드 성공", async () => {
    mockPoolAdmin();
    const res = await request(app)
      .post("/x-setup/upload/website")
      .set("Authorization", "Bearer pool_admin_token")
      .attach("file", makeDocxBuffer(), { filename: "website.docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("TC-XS-13: website .doc 거부 (422)", async () => {
    mockPoolAdmin();
    const res = await request(app)
      .post("/x-setup/upload/website")
      .set("Authorization", "Bearer pool_admin_token")
      .attach("file", Buffer.from("test"), { filename: "website.doc", contentType: "application/msword" });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("INVALID_DOCX");
  });
});

describe("POST /x-setup/upload/logo — 이미지 검증", () => {
  it("TC-XS-14: PNG 로고 업로드 성공", async () => {
    mockPoolAdmin();
    const pngMagic = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, ...Array(100).fill(0)]);
    const res = await request(app)
      .post("/x-setup/upload/logo")
      .set("Authorization", "Bearer pool_admin_token")
      .attach("file", pngMagic, { filename: "logo.png", contentType: "image/png" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("TC-XS-15: SVG 로고 거부 (422 INVALID_LOGO)", async () => {
    mockPoolAdmin();
    const res = await request(app)
      .post("/x-setup/upload/logo")
      .set("Authorization", "Bearer pool_admin_token")
      .attach("file", Buffer.from("<svg/>"), { filename: "logo.svg", contentType: "image/svg+xml" });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("INVALID_LOGO");
  });

  it("TC-XS-16: JPEG 로고 업로드 성공", async () => {
    mockPoolAdmin();
    const jpgMagic = Buffer.from([0xFF, 0xD8, 0xFF, ...Array(100).fill(0)]);
    const res = await request(app)
      .post("/x-setup/upload/logo")
      .set("Authorization", "Bearer pool_admin_token")
      .attach("file", jpgMagic, { filename: "logo.jpg", contentType: "image/jpeg" });
    expect(res.status).toBe(200);
  });

  it("TC-XS-17: GIF 로고 거부 (422 INVALID_LOGO)", async () => {
    mockPoolAdmin();
    const res = await request(app)
      .post("/x-setup/upload/logo")
      .set("Authorization", "Bearer pool_admin_token")
      .attach("file", Buffer.from("GIF89a"), { filename: "logo.gif", contentType: "image/gif" });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("INVALID_LOGO");
  });
});

describe("POST /x-setup/upload/photo — 사진 한도 enforcement", () => {
  it("TC-XS-18: 첫 번째 사진 업로드 성공 (현재 0장)", async () => {
    mockPhotoCount(0);
    const jpgMagic = Buffer.from([0xFF, 0xD8, 0xFF, ...Array(100).fill(0)]);
    const res = await request(app)
      .post("/x-setup/upload/photo")
      .set("Authorization", "Bearer pool_admin_token")
      .attach("file", jpgMagic, { filename: "photo1.jpg", contentType: "image/jpeg" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.total_count).toBe(1);
  });

  it("TC-XS-19: 10장 초과 시 거부 (422 PHOTO_LIMIT_EXCEEDED)", async () => {
    mockPhotoCount(10);
    const jpgMagic = Buffer.from([0xFF, 0xD8, 0xFF, ...Array(100).fill(0)]);
    const res = await request(app)
      .post("/x-setup/upload/photo")
      .set("Authorization", "Bearer pool_admin_token")
      .attach("file", jpgMagic, { filename: "photo11.jpg", contentType: "image/jpeg" });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("PHOTO_LIMIT_EXCEEDED");
  });

  it("TC-XS-20: 9장일 때 추가 허용 (max 10)", async () => {
    mockPhotoCount(9);
    const jpgMagic = Buffer.from([0xFF, 0xD8, 0xFF, ...Array(100).fill(0)]);
    const res = await request(app)
      .post("/x-setup/upload/photo")
      .set("Authorization", "Bearer pool_admin_token")
      .attach("file", jpgMagic, { filename: "photo10.jpg", contentType: "image/jpeg" });
    expect(res.status).toBe(200);
    expect(res.body.total_count).toBe(10);
  });

  it("TC-XS-21: 사진 PNG 업로드 성공", async () => {
    mockPhotoCount(2);
    const pngMagic = Buffer.from([0x89, 0x50, 0x4E, 0x47, ...Array(100).fill(0)]);
    const res = await request(app)
      .post("/x-setup/upload/photo")
      .set("Authorization", "Bearer pool_admin_token")
      .attach("file", pngMagic, { filename: "photo.png", contentType: "image/png" });
    expect(res.status).toBe(200);
  });

  it("TC-XS-22: 사진 GIF 거부 (422 INVALID_PHOTO)", async () => {
    mockPhotoCount(2);
    const res = await request(app)
      .post("/x-setup/upload/photo")
      .set("Authorization", "Bearer pool_admin_token")
      .attach("file", Buffer.from("GIF89a"), { filename: "photo.gif", contentType: "image/gif" });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("INVALID_PHOTO");
  });
});

describe("DELETE /x-setup/photos/:fileId", () => {
  it("TC-XS-23: 사진 soft-delete 성공", async () => {
    (superAdminDb.execute as any).mockImplementation((query: any) => {
      const q = query?.queryChunks?.map((c: any) => c?.value ?? c).join("") ?? "";
      if (q.includes("FROM users")) return { rows: [{ swimming_pool_id: mockPoolId }] };
      if (q.includes("FROM x_setup_files") && q.includes("LIMIT 1")) return { rows: [{ id: "xsf_001", file_type: "photo", pool_id: mockPoolId }] };
      if (q.includes("UPDATE x_setup_files") && q.includes("deleted_at")) return { rows: [] };
      if (q.includes("COUNT(*)")) return { rows: [{ cnt: 1 }] };
      if (q.includes("UPDATE x_setup_submissions")) return { rows: [] };
      return { rows: [] };
    });
    const res = await request(app)
      .delete("/x-setup/photos/xsf_001")
      .set("Authorization", "Bearer pool_admin_token");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("TC-XS-24: 다른 pool의 사진 삭제 거부 (404)", async () => {
    (superAdminDb.execute as any).mockImplementation((query: any) => {
      const q = query?.queryChunks?.map((c: any) => c?.value ?? c).join("") ?? "";
      if (q.includes("FROM users")) return { rows: [{ swimming_pool_id: "other_pool" }] };
      // cross-pool: file not found for this pool
      if (q.includes("FROM x_setup_files")) return { rows: [] };
      return { rows: [] };
    });
    const res = await request(app)
      .delete("/x-setup/photos/xsf_999")
      .set("Authorization", "Bearer pool_admin_token");
    expect(res.status).toBe(404);
  });

  it("TC-XS-25: DOCX 파일 삭제 시도 거부 (422)", async () => {
    (superAdminDb.execute as any).mockImplementation((query: any) => {
      const q = query?.queryChunks?.map((c: any) => c?.value ?? c).join("") ?? "";
      if (q.includes("FROM users")) return { rows: [{ swimming_pool_id: mockPoolId }] };
      if (q.includes("FROM x_setup_files")) return { rows: [{ id: "xsf_doc", file_type: "curriculum", pool_id: mockPoolId }] };
      return { rows: [] };
    });
    const res = await request(app)
      .delete("/x-setup/photos/xsf_doc")
      .set("Authorization", "Bearer pool_admin_token");
    expect(res.status).toBe(422);
  });
});

describe("POST /x-setup/submit", () => {
  it("TC-XS-26: 제출 성공", async () => {
    (superAdminDb.execute as any).mockImplementation((query: any) => {
      const q = query?.queryChunks?.map((c: any) => c?.value ?? c).join("") ?? "";
      if (q.includes("FROM users")) return { rows: [{ swimming_pool_id: mockPoolId }] };
      if (q.includes("INSERT INTO x_setup_submissions")) return { rows: [] };
      if (q.includes("UPDATE x_setup_submissions")) return { rows: [] };
      if (q.includes("FROM x_setup_submissions")) return { rows: [{ pool_id: mockPoolId, setup_status: "SUBMITTED", curriculum_status: "SUBMITTED" }] };
      return { rows: [] };
    });
    const res = await request(app)
      .post("/x-setup/submit")
      .set("Authorization", "Bearer pool_admin_token")
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe("Super Admin Routes", () => {
  function mockSuperAdminPool() {
    (superAdminDb.execute as any).mockImplementation((query: any) => {
      const q = query?.queryChunks?.map((c: any) => c?.value ?? c).join("") ?? "";
      if (q.includes("FROM swimming_pools")) return { rows: [{ id: mockPoolId, name: "테스트 수영장", x_paid_entitlement: true }] };
      if (q.includes("FROM x_setup_submissions")) return { rows: [{ pool_id: mockPoolId, setup_status: "SUBMITTED", curriculum_status: "SUBMITTED" }] };
      if (q.includes("FROM x_setup_files")) return { rows: [{ id: "xsf_001", file_type: "curriculum", original_filename: "curriculum.docx", pool_id: mockPoolId, r2_key: "x-setup/pool001/curriculum/v1.docx", mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", submission_version: 1, is_current: true }] };
      if (q.includes("FROM x_setup_revision_requests")) return { rows: [] };
      if (q.includes("UPDATE x_setup_submissions")) return { rows: [] };
      return { rows: [] };
    });
  }

  it("TC-XS-27: super_admin 풀 X Setup 조회", async () => {
    mockSuperAdminPool();
    const res = await request(app)
      .get(`/super/x-setup/${mockPoolId}`)
      .set("Authorization", "Bearer super_admin_token");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("pool");
    expect(res.body).toHaveProperty("submission");
    expect(res.body).toHaveProperty("files");
    expect(res.body).toHaveProperty("revisions");
  });

  it("TC-XS-28: pool_admin이 super 엔드포인트 접근 시 403", async () => {
    const res = await request(app)
      .get(`/super/x-setup/${mockPoolId}`)
      .set("Authorization", "Bearer pool_admin_token");
    expect(res.status).toBe(403);
  });

  it("TC-XS-29: super_admin 파일 다운로드 URL 요청", async () => {
    (superAdminDb.execute as any).mockImplementation((query: any) => {
      const q = query?.queryChunks?.map((c: any) => c?.value ?? c).join("") ?? "";
      if (q.includes("FROM x_setup_files")) return { rows: [{ id: "xsf_001", r2_key: "x-setup/pool001/curriculum/v1.docx", original_filename: "curriculum.docx", mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", pool_id: mockPoolId }] };
      return { rows: [] };
    });
    const res = await request(app)
      .get(`/super/x-setup/${mockPoolId}/files/xsf_001/download`)
      .set("Authorization", "Bearer super_admin_token");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("url");
    expect(res.body).toHaveProperty("filename");
  });

  it("TC-XS-30: super_admin 수정 요청 — curriculum", async () => {
    mockSuperAdminPool();
    const res = await request(app)
      .post(`/super/x-setup/${mockPoolId}/revisions`)
      .set("Authorization", "Bearer super_admin_token")
      .send({ section: "curriculum", message: "레벨 설명이 너무 짧습니다. 보완해 주세요." });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body).toHaveProperty("revision_id");
  });

  it("TC-XS-31: super_admin 수정 요청 — section 누락 시 400", async () => {
    const res = await request(app)
      .post(`/super/x-setup/${mockPoolId}/revisions`)
      .set("Authorization", "Bearer super_admin_token")
      .send({ message: "메시지만" });
    expect(res.status).toBe(400);
  });

  it("TC-XS-32: super_admin 수정 요청 — 잘못된 section 거부 (400)", async () => {
    const res = await request(app)
      .post(`/super/x-setup/${mockPoolId}/revisions`)
      .set("Authorization", "Bearer super_admin_token")
      .send({ section: "invalid_section", message: "테스트" });
    expect(res.status).toBe(400);
  });

  it("TC-XS-33: super_admin curriculum 섹션 승인", async () => {
    mockSuperAdminPool();
    const res = await request(app)
      .patch(`/super/x-setup/${mockPoolId}/sections/curriculum/approve`)
      .set("Authorization", "Bearer super_admin_token");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.section).toBe("curriculum");
    expect(res.body.new_status).toBe("APPROVED");
  });

  it("TC-XS-34: super_admin 잘못된 section 승인 거부 (400)", async () => {
    const res = await request(app)
      .patch(`/super/x-setup/${mockPoolId}/sections/invalid/approve`)
      .set("Authorization", "Bearer super_admin_token");
    expect(res.status).toBe(400);
  });

  it("TC-XS-35: 존재하지 않는 pool 조회 시 404", async () => {
    (superAdminDb.execute as any).mockImplementation((query: any) => {
      const q = query?.queryChunks?.map((c: any) => c?.value ?? c).join("") ?? "";
      if (q.includes("FROM swimming_pools")) return { rows: [] };
      return { rows: [] };
    });
    const res = await request(app)
      .get("/super/x-setup/nonexistent_pool_id")
      .set("Authorization", "Bearer super_admin_token");
    expect(res.status).toBe(404);
  });
});

describe("DOCX 버전 이력 및 R2 업로드 검증", () => {
  it("TC-XS-36: DOCX 재업로드 시 uploadToR2 호출 확인", async () => {
    mockPoolAdmin();
    vi.clearAllMocks();
    (superAdminDb.execute as any).mockImplementation((query: any) => {
      const q = query?.queryChunks?.map((c: any) => c?.value ?? c).join("") ?? "";
      if (q.includes("FROM users")) return { rows: [{ swimming_pool_id: mockPoolId }] };
      if (q.includes("INSERT INTO x_setup_submissions")) return { rows: [] };
      if (q.includes("MAX(submission_version)")) return { rows: [{ v: 2 }] }; // 이미 2버전 있음
      if (q.includes("UPDATE x_setup_files") && q.includes("is_current = false")) return { rows: [] };
      if (q.includes("INSERT INTO x_setup_files")) return { rows: [] };
      if (q.includes("UPDATE x_setup_submissions")) return { rows: [] };
      return { rows: [] };
    });
    (uploadToR2 as any).mockResolvedValue({ ok: true, error: null });

    const res = await request(app)
      .post("/x-setup/upload/curriculum")
      .set("Authorization", "Bearer pool_admin_token")
      .attach("file", makeDocxBuffer(), { filename: "curriculum_v3.docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });

    expect(res.status).toBe(200);
    expect(res.body.version).toBe(3); // 2+1
    expect(uploadToR2).toHaveBeenCalledTimes(1);
    const callArgs = (uploadToR2 as any).mock.calls[0];
    expect(callArgs[0]).toContain(`x-setup/${mockPoolId}/curriculum/v3`);
  });

  it("TC-XS-37: R2 업로드 실패 시 503 반환", async () => {
    (superAdminDb.execute as any).mockImplementation((query: any) => {
      const q = query?.queryChunks?.map((c: any) => c?.value ?? c).join("") ?? "";
      if (q.includes("FROM users")) return { rows: [{ swimming_pool_id: mockPoolId }] };
      if (q.includes("INSERT INTO x_setup_submissions")) return { rows: [] };
      if (q.includes("MAX(submission_version)")) return { rows: [{ v: 0 }] };
      return { rows: [] };
    });
    (uploadToR2 as any).mockResolvedValue({ ok: false, error: "R2 bucket unavailable" });

    const res = await request(app)
      .post("/x-setup/upload/curriculum")
      .set("Authorization", "Bearer pool_admin_token")
      .attach("file", makeDocxBuffer(), { filename: "curriculum.docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });

    expect(res.status).toBe(503);
  });
});
