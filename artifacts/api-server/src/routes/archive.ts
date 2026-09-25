/**
 * archive.ts — 퇴원생 Archive API
 *
 * 운영자(pool_admin, teacher):
 *   GET  /admin/archives           — 지난 회원 목록 (pool 한정)
 *   GET  /admin/archives/:id       — 지난 회원 상세
 *   GET  /admin/archives/:id/diaries — 지난 일지 목록
 *
 * 관리자 전용(pool_admin):
 *   POST   /admin/archive-links    — 수동 연결 (Archive ↔ 현재 학생)
 *   DELETE /admin/archive-links/:id — 연결 해제 (unlinked_at = NOW())
 *
 * 학부모:
 *   GET /parent/students/:id/archive-diaries — 지난 수강 기록 (link 존재 시)
 */

import { Router } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  requireAuth,
  requireRole,
  type AuthRequest,
} from "../middlewares/auth.js";
import { matchArchivePhone } from "../lib/archive-phone-hash.js";
import { randomUUID } from "crypto";

const router = Router();

/** pool_id 조회 helper (admin route와 동일 패턴) */
async function getPoolId(req: AuthRequest): Promise<string | null> {
  const user = req.user!;
  if (user.poolId) return user.poolId;
  if (user.role === "pool_admin" || user.role === "teacher") {
    const rows = (await db.execute(sql`
      SELECT swimming_pool_id FROM users WHERE id = ${user.userId} LIMIT 1
    `)).rows as any[];
    return rows[0]?.swimming_pool_id ?? null;
  }
  return null;
}

// ── GET /admin/archives ────────────────────────────────────────────────────
router.get(
  "/admin/archives",
  requireAuth,
  requireRole("pool_admin", "teacher", "super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const poolId = await getPoolId(req);
      if (!poolId) return res.status(403).json({ error: "수영장 정보가 없습니다." });

      const { search, limit = "50", offset = "0" } = req.query as Record<string, string>;
      const lim  = Math.min(Number(limit)  || 50, 200);
      const off  = Number(offset) || 0;
      const searchPct = search ? `%${search.replace(/%/g, "\\%").replace(/_/g, "\\_")}%` : null;

      const rows = (await db.execute(sql`
        SELECT
          id, original_student_id, student_name, birth_year,
          last_class_name, last_level_order, withdrawn_at,
          withdrawn_by_name, created_at
        FROM withdrawn_member_archives
        WHERE pool_id = ${poolId}
          ${searchPct ? sql`AND student_name ILIKE ${searchPct}` : sql``}
        ORDER BY withdrawn_at DESC
        LIMIT ${lim} OFFSET ${off}
      `)).rows;

      const total = (await db.execute(sql`
        SELECT COUNT(*) AS cnt FROM withdrawn_member_archives
        WHERE pool_id = ${poolId}
          ${searchPct ? sql`AND student_name ILIKE ${searchPct}` : sql``}
      `)).rows[0] as any;

      res.json({ items: rows, total: Number(total.cnt), limit: lim, offset: off });
    } catch (e) {
      console.error("[archive] GET /admin/archives", e);
      res.status(500).json({ error: "서버 오류" });
    }
  }
);

// ── GET /admin/archives/:id ────────────────────────────────────────────────
router.get(
  "/admin/archives/:id",
  requireAuth,
  requireRole("pool_admin", "teacher", "super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const poolId = await getPoolId(req);
      if (!poolId) return res.status(403).json({ error: "수영장 정보가 없습니다." });

      const [archive] = (await db.execute(sql`
        SELECT id, original_student_id, student_name, birth_year,
               last_class_name, last_level_order, withdrawn_at,
               withdrawn_by_id, withdrawn_by_name, created_at,
               parent_phone_hash IS NOT NULL AS has_phone_hash
        FROM withdrawn_member_archives
        WHERE id = ${req.params.id} AND pool_id = ${poolId}
        LIMIT 1
      `)).rows as any[];

      if (!archive) return res.status(404).json({ error: "Archive를 찾을 수 없습니다." });

      // 현재 active link 조회
      const [activeLink] = (await db.execute(sql`
        SELECT wal.id, wal.current_student_id, wal.linked_at,
               s.name AS current_student_name, s.birth_year AS current_birth_year,
               s.parent_phone AS current_parent_phone, s.status AS current_status
        FROM withdrawn_archive_links wal
        JOIN students s ON s.id = wal.current_student_id
        WHERE wal.archive_member_id = ${req.params.id}
          AND wal.unlinked_at IS NULL
        LIMIT 1
      `)).rows as any[];

      let link: any = null;
      if (activeLink) {
        const phoneMatch = matchArchivePhone(
          activeLink.current_parent_phone,
          archive.parent_phone_hash ? "HASHED" : null, // pool_admin만 실제 비교
        );
        link = {
          id: activeLink.id,
          current_student_id: activeLink.current_student_id,
          current_student_name: activeLink.current_student_name,
          current_birth_year: activeLink.current_birth_year,
          current_status: activeLink.current_status,
          linked_at: activeLink.linked_at,
        };
      }

      res.json({ ...archive, active_link: link });
    } catch (e) {
      console.error("[archive] GET /admin/archives/:id", e);
      res.status(500).json({ error: "서버 오류" });
    }
  }
);

// ── GET /admin/archives/:id/diaries ────────────────────────────────────────
router.get(
  "/admin/archives/:id/diaries",
  requireAuth,
  requireRole("pool_admin", "teacher", "super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const poolId = await getPoolId(req);
      if (!poolId) return res.status(403).json({ error: "수영장 정보가 없습니다." });

      // pool guard
      const [archive] = (await db.execute(sql`
        SELECT id FROM withdrawn_member_archives
        WHERE id = ${req.params.id} AND pool_id = ${poolId} LIMIT 1
      `)).rows;
      if (!archive) return res.status(404).json({ error: "Archive를 찾을 수 없습니다." });

      const rows = (await db.execute(sql`
        SELECT id, original_diary_id, lesson_date, former_class_name,
               former_teacher_name, common_content, student_note,
               is_makeup_diary, source_type, original_created_at, archived_at
        FROM withdrawn_diary_archives
        WHERE archive_member_id = ${req.params.id}
        ORDER BY lesson_date DESC, original_created_at DESC
      `)).rows;

      res.json(rows);
    } catch (e) {
      console.error("[archive] GET /admin/archives/:id/diaries", e);
      res.status(500).json({ error: "서버 오류" });
    }
  }
);

// ── POST /admin/archive-links ──────────────────────────────────────────────
router.post(
  "/admin/archive-links",
  requireAuth,
  requireRole("pool_admin", "super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const poolId = await getPoolId(req);
      if (!poolId) return res.status(403).json({ error: "수영장 정보가 없습니다." });

      const { archive_member_id, current_student_id } = req.body as {
        archive_member_id: string;
        current_student_id: string;
      };
      if (!archive_member_id || !current_student_id)
        return res.status(400).json({ error: "archive_member_id, current_student_id 필수" });

      // Archive pool guard
      const [archive] = (await db.execute(sql`
        SELECT id, student_name, birth_year, parent_phone_hash
        FROM withdrawn_member_archives
        WHERE id = ${archive_member_id} AND pool_id = ${poolId}
        LIMIT 1
      `)).rows as any[];
      if (!archive) return res.status(404).json({ error: "Archive를 찾을 수 없습니다." });

      // 현재 학생 pool guard + 상태 확인
      const [student] = (await db.execute(sql`
        SELECT id, name, birth_year, status, parent_phone
        FROM students
        WHERE id = ${current_student_id} AND swimming_pool_id = ${poolId}
        LIMIT 1
      `)).rows as any[];
      if (!student) return res.status(404).json({ error: "현재 회원을 찾을 수 없습니다." });
      if (["withdrawn", "deleted", "archived"].includes(student.status)) {
        return res.status(400).json({ error: "퇴원/삭제/아카이브 상태 회원에는 연결할 수 없습니다." });
      }

      // active link 중복 방지
      const [existing] = (await db.execute(sql`
        SELECT id FROM withdrawn_archive_links
        WHERE archive_member_id = ${archive_member_id} AND unlinked_at IS NULL
        LIMIT 1
      `)).rows;
      if (existing) return res.status(409).json({ error: "이미 연결된 Archive입니다. 먼저 해제하십시오." });

      // phone match 계산 (pool_admin에게 boolean만 반환)
      const phoneMatch = matchArchivePhone(student.parent_phone, archive.parent_phone_hash);

      const linkId = randomUUID();
      await db.execute(sql`
        INSERT INTO withdrawn_archive_links (id, archive_member_id, current_student_id, linked_by, linked_at)
        VALUES (${linkId}, ${archive_member_id}, ${current_student_id}, ${req.user!.userId}, NOW())
      `);

      res.json({
        id: linkId,
        archive_member_id,
        current_student_id,
        archive_name: archive.student_name,
        archive_birth_year: archive.birth_year,
        current_name: student.name,
        current_birth_year: student.birth_year,
        phone_match: phoneMatch,   // true | false | null
      });
    } catch (e: any) {
      if (e?.code === "23505") {
        return res.status(409).json({ error: "이미 연결된 Archive입니다." });
      }
      console.error("[archive] POST /admin/archive-links", e);
      res.status(500).json({ error: "서버 오류" });
    }
  }
);

// ── DELETE /admin/archive-links/:id ───────────────────────────────────────
router.delete(
  "/admin/archive-links/:id",
  requireAuth,
  requireRole("pool_admin", "super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const poolId = await getPoolId(req);
      if (!poolId) return res.status(403).json({ error: "수영장 정보가 없습니다." });

      // pool guard — link → archive → pool_id
      const [link] = (await db.execute(sql`
        SELECT wal.id FROM withdrawn_archive_links wal
        JOIN withdrawn_member_archives wma ON wma.id = wal.archive_member_id
        WHERE wal.id = ${req.params.id} AND wma.pool_id = ${poolId}
          AND wal.unlinked_at IS NULL
        LIMIT 1
      `)).rows;
      if (!link) return res.status(404).json({ error: "활성 연결을 찾을 수 없습니다." });

      await db.execute(sql`
        UPDATE withdrawn_archive_links SET unlinked_at = NOW()
        WHERE id = ${req.params.id}
      `);

      res.json({ success: true });
    } catch (e) {
      console.error("[archive] DELETE /admin/archive-links/:id", e);
      res.status(500).json({ error: "서버 오류" });
    }
  }
);

// ── GET /parent/students/:id/archive-diaries ──────────────────────────────
// 조건: 현재 parent가 current_student_id에 대해 approved parent_students 권한 보유
//       + active withdrawn_archive_links 존재
router.get(
  "/parent/students/:id/archive-diaries",
  requireAuth,
  async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      // parent_account role 확인
      if (user.role !== "parent_account") {
        return res.status(403).json({ error: "학부모 전용 API입니다." });
      }

      const studentId = req.params.id;

      // parent_students approved 확인 (parent.ts 패턴과 동일)
      const [link] = (await db.execute(sql`
        SELECT id FROM parent_students
        WHERE parent_id = ${user.userId} AND student_id = ${studentId}
          AND status = 'approved'
        LIMIT 1
      `)).rows;
      if (!link) return res.status(403).json({ error: "접근 권한이 없습니다." });

      // active archive links 조회
      const linkRows = (await db.execute(sql`
        SELECT wal.id AS link_id, wal.archive_member_id, wal.linked_at,
               wma.student_name, wma.withdrawn_at, wma.last_class_name
        FROM withdrawn_archive_links wal
        JOIN withdrawn_member_archives wma ON wma.id = wal.archive_member_id
        WHERE wal.current_student_id = ${studentId}
          AND wal.unlinked_at IS NULL
        ORDER BY wma.withdrawn_at DESC
      `)).rows as any[];

      if (!linkRows.length) {
        return res.json([]);
      }

      // 각 archive별 diary 조회
      const result = await Promise.all(linkRows.map(async (lnk) => {
        const diaries = (await db.execute(sql`
          SELECT id, lesson_date, former_class_name, former_teacher_name,
                 common_content, student_note, is_makeup_diary, original_created_at
          FROM withdrawn_diary_archives
          WHERE archive_member_id = ${lnk.archive_member_id}
          ORDER BY lesson_date DESC, original_created_at DESC
        `)).rows;

        return {
          link_id: lnk.link_id,
          archive_member_id: lnk.archive_member_id,
          student_name: lnk.student_name,
          withdrawn_at: lnk.withdrawn_at,
          last_class_name: lnk.last_class_name,
          linked_at: lnk.linked_at,
          diaries,
        };
      }));

      res.json(result);
    } catch (e) {
      console.error("[archive] GET /parent/students/:id/archive-diaries", e);
      res.status(500).json({ error: "서버 오류" });
    }
  }
);

// ── GET /admin/archive-link-candidates ────────────────────────────────────
// 연결 전 후보 확인: Archive 1건 + 현재 회원 1건의 비교 정보
router.get(
  "/admin/archive-link-candidates",
  requireAuth,
  requireRole("pool_admin", "super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const poolId = await getPoolId(req);
      if (!poolId) return res.status(403).json({ error: "수영장 정보가 없습니다." });

      const { archive_id, student_id } = req.query as Record<string, string>;
      if (!archive_id || !student_id)
        return res.status(400).json({ error: "archive_id, student_id 필수" });

      const [archive] = (await db.execute(sql`
        SELECT id, student_name, birth_year, parent_phone_hash, withdrawn_at
        FROM withdrawn_member_archives
        WHERE id = ${archive_id} AND pool_id = ${poolId} LIMIT 1
      `)).rows as any[];
      if (!archive) return res.status(404).json({ error: "Archive 없음" });

      const [student] = (await db.execute(sql`
        SELECT id, name, birth_year, status, parent_phone
        FROM students WHERE id = ${student_id} AND swimming_pool_id = ${poolId} LIMIT 1
      `)).rows as any[];
      if (!student) return res.status(404).json({ error: "회원 없음" });

      const phoneMatch = matchArchivePhone(student.parent_phone, archive.parent_phone_hash);

      res.json({
        archive: {
          id: archive.id,
          student_name: archive.student_name,
          birth_year: archive.birth_year,
          withdrawn_at: archive.withdrawn_at,
        },
        current: {
          id: student.id,
          name: student.name,
          birth_year: student.birth_year,
          status: student.status,
        },
        phone_match: phoneMatch,  // true | false | null
      });
    } catch (e) {
      console.error("[archive] GET /admin/archive-link-candidates", e);
      res.status(500).json({ error: "서버 오류" });
    }
  }
);

export default router;
