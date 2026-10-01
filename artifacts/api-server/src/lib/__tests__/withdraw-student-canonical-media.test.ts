import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { withdrawStudent } from "../withdraw-student-service.js";

const mocks = vi.hoisted(() => ({
  deleteObject: vi.fn(),
}));

vi.mock("@replit/object-storage", () => ({
  Client: class {
    delete(key: string) {
      return mocks.deleteObject(key);
    }
  },
}));
vi.mock("../../utils/historyUtils.js", () => ({
  kstTodayStr: () => "2025-05-01",
  closeAllActiveClassHistory: vi.fn(),
}));
vi.mock("../archive-phone-hash.js", () => ({
  hashArchivePhone: vi.fn(() => null),
}));

function sqlText(query: any): string {
  const chunks: unknown[] = query?.queryChunks ?? [];
  return chunks
    .filter((chunk): chunk is { value: string[] } =>
      chunk != null && typeof chunk === "object" && Array.isArray((chunk as any).value))
    .flatMap((chunk) => chunk.value)
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function sqlValues(query: any): unknown[] {
  return new PgDialect().sqlToQuery(query).params;
}

describe("withdrawStudent canonical media and parent cleanup", () => {
  beforeEach(() => {
    mocks.deleteObject.mockReset().mockResolvedValue(undefined);
  });

  it("uses real media columns, resolves only local legacy upload URLs, and unlinks only the target student", async () => {
    const executed: Array<{ text: string; values: unknown[]; phase: "read" | "transaction" }> = [];
    const mediaRows = {
      student_photos: [
        { id: "legacy-photo-local", file_url: "/uploads/students/photo-a.jpg" },
        { id: "legacy-photo-external", file_url: "https://cdn.example/uploads/external.jpg" },
        { id: "legacy-photo-key", file_url: "raw/object/key.jpg" },
      ],
      student_videos: [
        { id: "legacy-video-local", file_url: "http://localhost:8080/api/uploads/students/video-b.mp4" },
        { id: "legacy-video-external", file_url: "https://video.example/media/external.mp4" },
      ],
      photo_assets_meta: [{ id: "asset-photo", object_key: "photo-assets/target.jpg" }],
      video_assets_meta: [{ id: "asset-video", object_key: "video-assets/target.mp4" }],
    };
    const parentLinks = [
      { student_id: "student-target", parent_id: "parent-shared" },
      { student_id: "student-sibling", parent_id: "parent-shared" },
      { student_id: "student-unrelated", parent_id: "parent-other" },
    ];
    const parentAccounts = [{ id: "parent-shared" }, { id: "parent-other" }];
    const originalParentAccounts = structuredClone(parentAccounts);
    const rowsFor = (text: string) => {
      if (text.includes("select id, name, status, swimming_pool_id")) {
        return [{
          id: "student-target",
          name: "Student",
          status: "active",
          swimming_pool_id: "pool-target",
          class_group_id: null,
        }];
      }
      if (text.includes("from student_photos")) return mediaRows.student_photos;
      if (text.includes("from student_videos")) return mediaRows.student_videos;
      if (text.includes("from photo_assets_meta")) return mediaRows.photo_assets_meta;
      if (text.includes("from video_assets_meta")) return mediaRows.video_assets_meta;
      return [];
    };
    const execute = async (query: any, phase: "read" | "transaction") => {
      const text = sqlText(query);
      const values = sqlValues(query);
      executed.push({ text, values, phase });

      if (phase === "read") return { rows: rowsFor(text), rowCount: 0 };
      if (text.includes("delete from swim_diary")) {
        throw new Error('column "student_id" does not exist in shared swim_diary');
      }
      if (text.includes("select id from students")) return { rows: [{ id: "student-target" }], rowCount: 1 };
      if (text.includes("from students s")) {
        return { rows: [{ name: "Student", birth_year: null, parent_phone: null, class_name: null }], rowCount: 1 };
      }
      if (text.includes("select distinct class_group_id")) return { rows: [], rowCount: 0 };
      if (text.includes("delete from parent_students")) {
        const targetStudentId = values.find(value => value === "student-target");
        const beforeCount = parentLinks.length;
        for (let index = parentLinks.length - 1; index >= 0; index--) {
          if (parentLinks[index].student_id === targetStudentId) parentLinks.splice(index, 1);
        }
        return { rows: [], rowCount: beforeCount - parentLinks.length };
      }
      return { rows: [], rowCount: text.startsWith("delete from ") ? 1 : 0 };
    };
    const db = {
      execute: (query: any) => execute(query, "read"),
      transaction: (callback: (tx: any) => Promise<void>) =>
        callback({ execute: (query: any) => execute(query, "transaction") }),
    };

    const result = await withdrawStudent(db, "student-target", "pool-target", {
      userId: "admin-target",
      role: "pool_admin",
    });

    const mediaSelects = executed.filter(({ phase, text }) =>
      phase === "read" && text.startsWith("select id,") &&
      (text.includes("from student_photos") || text.includes("from student_videos") ||
        text.includes("from photo_assets_meta") || text.includes("from video_assets_meta")));
    expect(mediaSelects).toHaveLength(4);
    expect(mediaSelects.find(({ text }) => text.includes("from student_photos"))?.text)
      .toContain("select id, file_url from student_photos");
    expect(mediaSelects.find(({ text }) => text.includes("from student_videos"))?.text)
      .toContain("select id, file_url from student_videos");
    expect(mediaSelects.find(({ text }) => text.includes("from photo_assets_meta"))?.text)
      .toContain("select id, object_key from photo_assets_meta");
    expect(mediaSelects.find(({ text }) => text.includes("from video_assets_meta"))?.text)
      .toContain("select id, object_key from video_assets_meta");
    expect(mediaSelects.every(({ text }) => !text.includes("storage_key"))).toBe(true);
    expect(executed.some(({ text }) => text.includes("delete from swim_diary"))).toBe(false);
    expect(executed.some(({ phase, text }) =>
      phase === "transaction" && text.includes("delete from growth_events"))).toBe(true);

    expect(mocks.deleteObject.mock.calls.map(([key]) => key).sort()).toEqual([
      "photo-assets/target.jpg",
      "students/photo-a.jpg",
      "students/video-b.mp4",
      "video-assets/target.mp4",
    ]);
    expect(result.r2DeletedCount).toBe(4);

    const parentDelete = executed.find(({ phase, text }) =>
      phase === "transaction" && text.includes("delete from parent_students"));
    expect(parentDelete?.values).toContain("student-target");
    expect(parentLinks).toEqual([
      { student_id: "student-sibling", parent_id: "parent-shared" },
      { student_id: "student-unrelated", parent_id: "parent-other" },
    ]);
    expect(parentAccounts).toEqual(originalParentAccounts);
    expect(executed.some(({ text }) => text.includes("delete from parent_accounts"))).toBe(false);
  });
});