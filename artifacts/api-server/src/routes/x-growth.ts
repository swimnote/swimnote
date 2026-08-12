/**
 * x-growth.ts — WP8
 *
 * X Mode Growth Event READ API.
 *
 * 엔드포인트:
 *   GET /x-growth/students/:studentId/events
 *   GET /x-growth/students/:studentId/events/:eventId
 *
 * 보안 원칙:
 *   1. requireAuth   — 로그인 필수
 *   2. requireXMode  — pool X mode 확인 (non-X → 403)
 *   3. pool 소속 학생 검증 — 다른 pool 학생 조회 불가
 *   4. service 레이어에서 swimming_pool_id 이중 필터
 *
 * READ ONLY. Write/승인/DELETE 없음.
 */
import { Router, type Request, type Response } from "express";
import { sql } from "drizzle-orm";
import { superAdminDb } from "@workspace/db";
import { requireAuth, requireXMode, type AuthRequest } from "../middlewares/auth.js";
import {
  getStudentGrowthEvents,
  getGrowthEventById,
} from "../lib/growth-event-service.js";

const router = Router();

// ── 공통 helper ───────────────────────────────────────────────────────────────

/** 호출자(teacher/pool_admin) 의 pool ID를 JWT poolId → DB 순으로 조회 */
async function getRequesterPoolId(req: AuthRequest): Promise<string | null> {
  const user = req.user!;
  // JWT에 poolId가 있으면 우선 사용 (admin.ts 패턴)
  if (user.poolId) return user.poolId;
  const r = await superAdminDb.execute(
    sql`SELECT swimming_pool_id FROM users WHERE id = ${user.id}`,
  );
  return (r.rows as any[])[0]?.swimming_pool_id ?? null;
}

/** poolId 내에서 studentId 소속 검증. 없으면 null. */
async function verifyStudentInPool(
  studentId: string,
  poolId: string,
): Promise<boolean> {
  const r = await superAdminDb.execute(sql`
    SELECT id FROM students
    WHERE id = ${studentId} AND swimming_pool_id = ${poolId}
    LIMIT 1
  `);
  return (r.rows as any[]).length > 0;
}

// ── 파라미터 파싱 helpers ─────────────────────────────────────────────────────

const VALID_STATUSES = new Set([
  "PENDING_REVIEW",
  "TEACHER_ACCEPTED",
  "TEACHER_REJECTED",
  "AUTO_ACCEPTED",
  "DISCARDED",
]);

const VALID_SOURCES = new Set([
  "teacher_ai",
  "teacher_manual",
  "parent_ai",
  "video_ai",
]);

const MAX_LIMIT   = 100;
const DEFAULT_LIM = 30;

function parseLimit(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LIM;
  return Math.min(n, MAX_LIMIT);
}

function parseOffset(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

// ── GET /x-growth/students/:studentId/events ─────────────────────────────────

router.get(
  "/x-growth/students/:studentId/events",
  requireAuth as any,
  requireXMode as any,
  async (req: Request, res: Response) => {
    const authReq = req as AuthRequest;
    // Express v5: req.params 값이 string | string[] 가능 → 명시적 변환
    const studentId = String(req.params.studentId);

    // query string 단일 값 추출 helper
    const qs = (key: string): string | undefined => {
      const v = req.query[key];
      return typeof v === "string" ? v : Array.isArray(v) ? String(v[0]) : undefined;
    };

    try {
      // 1. 호출자 pool 확인
      const poolId = await getRequesterPoolId(authReq);
      if (!poolId) {
        return res.status(403).json({ error: "pool_not_found" });
      }

      // 2. 학생 소속 검증
      const belongs = await verifyStudentInPool(studentId, poolId);
      if (!belongs) {
        return res.status(403).json({ error: "student_not_in_pool" });
      }

      // 3. 쿼리 파라미터 파싱
      const limit  = parseLimit(qs("limit"));
      const offset = parseOffset(qs("offset"));

      const rawStatus = qs("status");
      const status    = rawStatus && VALID_STATUSES.has(rawStatus) ? rawStatus : undefined;

      const rawSource = qs("source");
      const source    = rawSource && VALID_SOURCES.has(rawSource) ? rawSource : undefined;

      const from = qs("from") || undefined;
      const to   = qs("to")   || undefined;

      // 4. 조회
      const result = await getStudentGrowthEvents({
        db: superAdminDb,
        poolId,
        studentId,
        limit,
        offset,
        status,
        source,
        from,
        to,
      });

      return res.json({
        events:   result.events,
        total:    result.total,
        limit,
        offset,
        has_more: offset + result.events.length < result.total,
      });
    } catch (err: any) {
      console.error(`[x-growth] LIST_ERROR student=${studentId}`, err?.message ?? err);
      return res.status(500).json({ error: "internal_server_error" });
    }
  },
);

// ── GET /x-growth/students/:studentId/events/:eventId ────────────────────────

router.get(
  "/x-growth/students/:studentId/events/:eventId",
  requireAuth as any,
  requireXMode as any,
  async (req: Request, res: Response) => {
    const authReq   = req as AuthRequest;
    const studentId = String(req.params.studentId);
    const eventId   = String(req.params.eventId);

    try {
      // 1. 호출자 pool 확인
      const poolId = await getRequesterPoolId(authReq);
      if (!poolId) {
        return res.status(403).json({ error: "pool_not_found" });
      }

      // 2. 학생 소속 검증
      const belongs = await verifyStudentInPool(studentId, poolId);
      if (!belongs) {
        return res.status(403).json({ error: "student_not_in_pool" });
      }

      // 3. 단건 조회
      const event = await getGrowthEventById({
        db: superAdminDb,
        poolId,
        studentId,
        eventId,
      });

      if (!event) {
        return res.status(404).json({ error: "event_not_found" });
      }

      return res.json({ event });
    } catch (err: any) {
      console.error(`[x-growth] DETAIL_ERROR student=${studentId} event=${eventId}`, err?.message ?? err);
      return res.status(500).json({ error: "internal_server_error" });
    }
  },
);

export default router;
