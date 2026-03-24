/**
 * 미등록회원 관리 라우트
 * 관리자: 일괄 업로드, 목록 조회, 학부모 초대
 * 선생님: 목록 조회, 반배정 (→ 정상회원 전환)
 */
import { Router } from "express";
import { db, superAdminDb , superAdminDb } from "@workspace/db";
import {
  studentsTable, classGroupsTable, usersTable,
} from "@workspace/db/schema";
import { eq, and, sql, inArray } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";

const router = Router();

function err(res: any, status: number, message: string) {
  return res.status(status).json({ success: false, message });
}

async function getPoolId(userId: string): Promise<string | null> {
  const [user] = await superAdminDb.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  return user?.swimming_pool_id || null;
}

function normalizePhone(p: string): string {
  return p.replace(/\D/g, "");
}

function validatePhone(p: string): boolean {
  const digits = normalizePhone(p);
  return digits.length >= 10 && digits.length <= 11;
}

// ── GET /admin/unregistered ─────────────────────────────────────
router.get("/admin/unregistered", requireAuth, requireRole(["admin", "platform_admin"]), async (req: AuthRequest, res) => {
  try {
    const poolId = await getPoolId(req.user!.id);
    if (!poolId) return err(res, 403, "수영장 정보 없음");

    const rows = await db
      .select()
      .from(studentsTable)
      .where(
        and(
          eq(studentsTable.swimming_pool_id, poolId),
          eq(studentsTable.status, "unregistered"),
        )
      )
      .orderBy(sql`${studentsTable.created_at} DESC`);

    return res.json(rows);
  } catch (e) {
    return err(res, 500, "서버 오류");
  }
});

// ── POST /admin/unregistered/bulk ───────────────────────────────
// body: { students: [{ name: string, parent_phone: string }] }
router.post("/admin/unregistered/bulk", requireAuth, requireRole(["admin", "platform_admin"]), async (req: AuthRequest, res) => {
  try {
    const poolId = await getPoolId(req.user!.id);
    if (!poolId) return err(res, 403, "수영장 정보 없음");

    const { students } = req.body as { students: { name: string; parent_phone: string }[] };
    if (!Array.isArray(students) || students.length === 0) {
      return err(res, 400, "업로드할 데이터가 없습니다");
    }

    // 기존 미등록회원 목록 조회 (중복 체크용)
    const existing = await db
      .select({ name: studentsTable.name, parent_phone: studentsTable.parent_phone })
      .from(studentsTable)
      .where(
        and(
          eq(studentsTable.swimming_pool_id, poolId),
          eq(studentsTable.status, "unregistered"),
        )
      );

    const existingSet = new Set(existing.map(e => `${e.name}__${normalizePhone(e.parent_phone || "")}`));

    const results: { name: string; parent_phone: string; result: "ok" | "duplicate" | "error"; reason?: string }[] = [];
    const toInsert: { name: string; parent_phone: string }[] = [];
    const seenInFile = new Set<string>();

    for (const row of students) {
      const name = (row.name || "").trim();
      const phone = (row.parent_phone || "").trim();

      if (!name) {
        results.push({ name, parent_phone: phone, result: "error", reason: "학생 이름 필수" });
        continue;
      }
      if (!phone) {
        results.push({ name, parent_phone: phone, result: "error", reason: "학부모 전화번호 필수" });
        continue;
      }
      if (!validatePhone(phone)) {
        results.push({ name, parent_phone: phone, result: "error", reason: "전화번호 형식 오류" });
        continue;
      }

      const normalPhone = normalizePhone(phone);
      const key = `${name}__${normalPhone}`;

      if (seenInFile.has(key)) {
        results.push({ name, parent_phone: phone, result: "duplicate", reason: "파일 내 중복" });
        continue;
      }
      if (existingSet.has(key)) {
        results.push({ name, parent_phone: phone, result: "duplicate", reason: "이미 등록된 미등록회원" });
        continue;
      }

      seenInFile.add(key);
      results.push({ name, parent_phone: normalPhone, result: "ok" });
      toInsert.push({ name, parent_phone: normalPhone });
    }

    // 정상 항목만 DB 삽입
    let inserted = 0;
    for (const item of toInsert) {
      await db.insert(studentsTable).values({
        id: crypto.randomUUID(),
        swimming_pool_id: poolId,
        name: item.name,
        parent_phone: item.parent_phone,
        status: "unregistered",
        registration_path: "bulk_upload",
        invite_status: "none",
      });
      inserted++;
    }

    return res.json({ results, inserted, total: students.length });
  } catch (e) {
    console.error(e);
    return err(res, 500, "서버 오류");
  }
});

// ── POST /admin/unregistered/invite ─────────────────────────────
// body: { ids: string[] }
router.post("/admin/unregistered/invite", requireAuth, requireRole(["admin", "platform_admin"]), async (req: AuthRequest, res) => {
  try {
    const poolId = await getPoolId(req.user!.id);
    if (!poolId) return err(res, 403, "수영장 정보 없음");

    const { ids } = req.body as { ids: string[] };
    if (!Array.isArray(ids) || ids.length === 0) {
      return err(res, 400, "선택된 항목 없음");
    }

    await db
      .update(studentsTable)
      .set({ invite_status: "invited" })
      .where(
        and(
          eq(studentsTable.swimming_pool_id, poolId),
          inArray(studentsTable.id, ids),
        )
      );

    return res.json({ success: true, count: ids.length });
  } catch (e) {
    return err(res, 500, "서버 오류");
  }
});

// ── DELETE /admin/unregistered/:id ──────────────────────────────
router.delete("/admin/unregistered/:id", requireAuth, requireRole(["admin", "platform_admin"]), async (req: AuthRequest, res) => {
  try {
    const poolId = await getPoolId(req.user!.id);
    if (!poolId) return err(res, 403, "수영장 정보 없음");

    await db
      .delete(studentsTable)
      .where(
        and(
          eq(studentsTable.id, req.params.id),
          eq(studentsTable.swimming_pool_id, poolId),
          eq(studentsTable.status, "unregistered"),
        )
      );

    return res.json({ success: true });
  } catch (e) {
    return err(res, 500, "서버 오류");
  }
});

// ── GET /teacher/unregistered ─────────────────────────────────
router.get("/teacher/unregistered", requireAuth, requireRole(["teacher", "admin", "platform_admin"]), async (req: AuthRequest, res) => {
  try {
    const poolId = await getPoolId(req.user!.id);
    if (!poolId) return err(res, 403, "수영장 정보 없음");

    const rows = await db
      .select()
      .from(studentsTable)
      .where(
        and(
          eq(studentsTable.swimming_pool_id, poolId),
          eq(studentsTable.status, "unregistered"),
        )
      )
      .orderBy(sql`${studentsTable.created_at} DESC`);

    return res.json(rows);
  } catch (e) {
    return err(res, 500, "서버 오류");
  }
});

// ── POST /teacher/unregistered/:id/assign ────────────────────────
// body: { class_group_id: string }
// 미등록회원 → 정상회원, 반 배정
router.post("/teacher/unregistered/:id/assign", requireAuth, requireRole(["teacher", "admin", "platform_admin"]), async (req: AuthRequest, res) => {
  try {
    const poolId = await getPoolId(req.user!.id);
    if (!poolId) return err(res, 403, "수영장 정보 없음");

    const { class_group_id } = req.body as { class_group_id: string };
    if (!class_group_id) return err(res, 400, "반 ID 필요");

    // 학생 조회
    const [student] = await db
      .select()
      .from(studentsTable)
      .where(
        and(
          eq(studentsTable.id, req.params.id),
          eq(studentsTable.swimming_pool_id, poolId),
        )
      )
      .limit(1);

    if (!student) return err(res, 404, "학생 없음");

    // 반 조회
    const [classGroup] = await db
      .select()
      .from(classGroupsTable)
      .where(eq(classGroupsTable.id, class_group_id))
      .limit(1);

    if (!classGroup) return err(res, 404, "반 없음");

    // 기존 assigned_class_ids에 추가
    const existingIds: string[] = Array.isArray(student.assigned_class_ids)
      ? student.assigned_class_ids
      : [];
    const newIds = existingIds.includes(class_group_id)
      ? existingIds
      : [...existingIds, class_group_id];

    // 정상회원으로 전환
    await db
      .update(studentsTable)
      .set({
        status: "active",
        assigned_class_ids: newIds,
        class_group_id: class_group_id,
        last_class_group_name: classGroup.name,
        updated_at: new Date(),
      })
      .where(eq(studentsTable.id, req.params.id));

    return res.json({ success: true, message: "정상회원으로 전환 완료" });
  } catch (e) {
    console.error(e);
    return err(res, 500, "서버 오류");
  }
});

export default router;
