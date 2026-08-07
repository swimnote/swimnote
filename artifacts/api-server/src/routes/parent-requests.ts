/**
 * 학부모 수영장 가입 요청 및 관리자 승인/거절
 * POST /auth/pool-join-request  - 공개: 학부모 가입 요청
 * GET  /pools/public-search     - 공개: 수영장 검색
 * GET  /admin/parent-requests   - 관리자: 요청 목록
 * PATCH /admin/parent-requests/:id - 관리자: 승인/거절 (학생 연결 지원)
 */
import { Router } from "express";
import { db, superAdminDb } from "@workspace/db";
import {
  swimmingPoolsTable, usersTable, parentAccountsTable,
  parentStudentsTable, studentsTable,
} from "@workspace/db/schema";
import { eq, ilike, sql, and, or, isNull, inArray } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";
import { hashPassword } from "../lib/auth.js";
import { buildRequestResultMessage } from "../lib/request-result-message.js";
import { findMakeupResultCandidatesBatch, findMakeupResultCandidate } from "../lib/request-result-candidate.js";
import { PROCESSED_RESULT_TYPES } from "../constants/processed-result-types.js";

const router = Router();

function genId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * PSR 접근 권한 검증 helper
 * 1. id로만 PSR 조회 → 없으면 404 REQUEST_NOT_FOUND
 * 2. tenant 불일치 → 403 TENANT_MISMATCH
 * 3. teacher: 담당·공동담당 반 기준 검증 → 403 REQUEST_ACCESS_DENIED
 * 4. pool_admin / sub_admin: 같은 pool이면 허용
 * 5. super_admin: 전역 허용
 * 반환: { psr, actorPoolId } | null (null = 이미 res에 에러 응답 완료)
 */
async function checkRequestAccess(
  userId: string,
  role: string,
  requestId: string,
  res: any,
): Promise<{ psr: any; actorPoolId: string | null } | null> {
  // 1. tenant 필터 없이 id로만 조회
  const [psr] = (await db.execute(sql`
    SELECT id, parent_id, student_id, swimming_pool_id, request_type,
           status, result_notified_at, processed_result_id, created_at
    FROM parent_student_requests
    WHERE id = ${requestId}
    LIMIT 1
  `)).rows as any[];

  if (!psr) {
    res.status(404).json({ success: false, error_code: "REQUEST_NOT_FOUND", message: "요청을 찾을 수 없습니다." });
    return null;
  }

  // 2. super_admin: 전역 허용
  if (role === "super_admin") return { psr, actorPoolId: null };

  // 3. 수영장 확인
  const [me] = await superAdminDb.select({ swimming_pool_id: usersTable.swimming_pool_id })
    .from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!me?.swimming_pool_id) {
    res.status(403).json({ success: false, message: "소속 수영장 없음" });
    return null;
  }

  // 4. Tenant 검증
  if (psr.swimming_pool_id !== me.swimming_pool_id) {
    res.status(403).json({ success: false, error_code: "TENANT_MISMATCH", message: "다른 수영장의 요청에는 접근할 수 없습니다." });
    return null;
  }

  // 5. pool_admin / sub_admin: 같은 pool이면 허용
  if (["pool_admin", "sub_admin"].includes(role)) {
    return { psr, actorPoolId: me.swimming_pool_id };
  }

  // 6. teacher: 담당 또는 공동담당 검증
  if (role === "teacher") {
    const cgRows = (await db.execute(sql`
      SELECT cg.teacher_user_id, cg.co_teacher_ids
      FROM class_groups cg
      JOIN student_class_history sch ON sch.class_group_id = cg.id
      WHERE sch.student_id = ${psr.student_id}
        AND sch.left_at IS NULL
        AND cg.swimming_pool_id = ${me.swimming_pool_id}
      LIMIT 10
    `)).rows as any[];

    const allowed = cgRows.some((cg: any) => {
      if (cg.teacher_user_id === userId) return true;
      const coIds: string[] = Array.isArray(cg.co_teacher_ids) ? cg.co_teacher_ids : [];
      return coIds.includes(userId);
    });

    if (!allowed) {
      res.status(403).json({ success: false, error_code: "REQUEST_ACCESS_DENIED", message: "이 학생의 담당 교사만 처리할 수 있습니다." });
      return null;
    }
    return { psr, actorPoolId: me.swimming_pool_id };
  }

  res.status(403).json({ success: false, message: "권한이 없습니다." });
  return null;
}

function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

// ─── 공개: 수영장 이름 검색 ───────────────────────────────────────────
// 정책: 검색어 없음 → [], 이름 전방일치만 허용, phone 반환 금지, 최대 20개
// 주소는 최소 지역 단위로 축약하여 반환 (상세 주소 노출 금지)
function _abbreviateAddr(address: string | null | undefined): string {
  if (!address) return "";
  const parts = address.trim().split(/\s+/);
  if (parts.length === 0) return "";
  const first = parts[0];
  if (first.endsWith("도")) return parts.slice(0, Math.min(3, parts.length)).join(" ");
  if (first.endsWith("시")) return parts.slice(0, Math.min(2, parts.length)).join(" ");
  return parts.slice(0, Math.min(2, parts.length)).join(" ");
}

router.get("/pools/public-search", async (req, res) => {
  const q = (req.query.name as string || "").trim();
  if (!q) { res.json({ success: true, data: [] }); return; }
  try {
    const results = await superAdminDb.select({
      id: swimmingPoolsTable.id,
      name: swimmingPoolsTable.name,
      address: swimmingPoolsTable.address,
    }).from(swimmingPoolsTable)
      .where(and(
        sql`approval_status = 'approved'`,
        ilike(swimmingPoolsTable.name, `${q}%`)
      ))
      .orderBy(
        sql`CASE WHEN LOWER(name) = LOWER(${q}) THEN 0 ELSE 1 END`,
        sql`LENGTH(name)`,
        swimmingPoolsTable.name
      )
      .limit(20);

    const data = results.map(r => ({
      id: r.id,
      name: r.name,
      address: _abbreviateAddr(r.address),
    }));
    res.json({ success: true, data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, data: [] });
  }
});



// ─── 관리자: 학부모 초대코드 생성 ────────────────────────────────────────
router.post("/admin/parent-invites", requireAuth, requireRole("pool_admin", "super_admin", "teacher"),
  async (req: AuthRequest, res) => {
    try {
      const { parent_name, phone, child_name, child_birth_year, notes } = req.body;
      if (!parent_name?.trim() || !phone?.trim()) {
        res.status(400).json({ success: false, message: "이름과 전화번호는 필수입니다." }); return;
      }
      const [me] = await superAdminDb.select({ swimming_pool_id: usersTable.swimming_pool_id })
        .from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
      if (!me?.swimming_pool_id) { res.status(403).json({ success: false, message: "소속 수영장 없음" }); return; }

      const code = generateInviteCode();
      const id = genId("pic");
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7일

      await db.execute(sql`
        INSERT INTO parent_invite_codes (id, swimming_pool_id, parent_name, phone, child_name, child_birth_year, notes, code, expires_at, is_used, created_by, created_at)
        VALUES (${id}, ${me.swimming_pool_id}, ${parent_name.trim()}, ${phone.trim()},
                ${child_name?.trim() || null}, ${child_birth_year || null}, ${notes?.trim() || null},
                ${code}, ${expiresAt.toISOString()}, false, ${req.user!.userId}, now())
      `);

      res.status(201).json({ success: true, data: { id, code, expires_at: expiresAt } });
    } catch (e) {
      console.error(e);
      res.status(500).json({ success: false, message: "서버 오류" });
    }
  }
);


// ─── 관리자: 학부모 초대코드 목록 ─────────────────────────────────────────
router.get("/admin/parent-invites", requireAuth, requireRole("pool_admin", "super_admin", "teacher"),
  async (req: AuthRequest, res) => {
    try {
      const [me] = await superAdminDb.select({ swimming_pool_id: usersTable.swimming_pool_id })
        .from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
      if (!me?.swimming_pool_id) { res.status(403).json({ success: false, message: "소속 수영장 없음" }); return; }

      const rows = await db.execute(sql`
        SELECT * FROM parent_invite_codes
        WHERE swimming_pool_id = ${me.swimming_pool_id}
        ORDER BY created_at DESC LIMIT 50
      `);
      res.json({ success: true, data: rows.rows });
    } catch (e) {
      console.error(e);
      res.status(500).json({ success: false, message: "서버 오류" });
    }
  }
);

// ─── 관리자/선생님: 학생별 학부모 수업 요청 조회 ─────────────────────────
// GET /parent-requests?student_id=xxx
router.get("/parent-requests", requireAuth, requireRole("pool_admin", "sub_admin", "teacher", "super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const { student_id } = req.query;
      const [me] = await superAdminDb.select({ swimming_pool_id: usersTable.swimming_pool_id })
        .from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
      if (!me?.swimming_pool_id) { res.status(403).json({ success: false, message: "소속 수영장 없음" }); return; }

      let q = `SELECT * FROM parent_student_requests WHERE swimming_pool_id = '${me.swimming_pool_id}'`;
      if (student_id) q += ` AND student_id = '${student_id}'`;
      q += ` ORDER BY created_at DESC LIMIT 100`;

      const result = await db.execute(sql.raw(q));
      res.json(result.rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: "서버 오류" });
    }
  }
);

// ─── 학부모: 수업 요청 생성 ──────────────────────────────────────────────
// POST /parent/requests
router.post("/parent/requests", requireAuth,
  async (req: AuthRequest, res) => {
    try {
      if (req.user?.role !== "parent_account") {
        res.status(403).json({ success: false, message: "학부모만 이용 가능합니다." }); return;
      }
      const { student_id, request_type, request_date, content } = req.body;
      const VALID_TYPES = ["absence", "makeup", "postpone", "withdrawal", "counseling", "inquiry"];
      if (!student_id || !request_type) {
        res.status(400).json({ success: false, message: "student_id와 request_type은 필수입니다." }); return;
      }
      if (!VALID_TYPES.includes(request_type)) {
        res.status(400).json({ success: false, message: "유효하지 않은 요청 유형입니다." }); return;
      }

      const paResult = await db.execute(sql`
        SELECT pa.swimming_pool_id, ps.student_id
        FROM parent_accounts pa
        JOIN parent_students ps ON ps.parent_id = pa.id AND ps.student_id = ${student_id} AND ps.status = 'approved'
        WHERE pa.id = ${req.user!.userId}
        LIMIT 1
      `);
      const pa = paResult.rows[0] as any;
      if (!pa) { res.status(403).json({ success: false, message: "해당 학생에 대한 권한이 없습니다." }); return; }

      const poolId = pa.swimming_pool_id;

      // 학생 담당 선생님 조회
      const teacherRow = await db.execute(sql`
        SELECT cg.teacher_user_id, u.name AS teacher_name, s.name AS student_name, pa2.name AS parent_name
        FROM students s
        LEFT JOIN class_groups cg ON cg.id = s.class_group_id AND cg.is_deleted = false
        LEFT JOIN users u ON u.id = cg.teacher_user_id
        JOIN parent_accounts pa2 ON pa2.id = ${req.user!.userId}
        WHERE s.id = ${student_id}
        LIMIT 1
      `);
      const teacherInfo = teacherRow.rows[0] as any;
      const teacherUserId = teacherInfo?.teacher_user_id || null;
      const studentName = teacherInfo?.student_name || "학생";
      const parentName = teacherInfo?.parent_name || "학부모";

      const TYPE_LABELS: Record<string, string> = {
        absence: "결석 신청", makeup: "보강 요청", postpone: "연기 신청",
        withdrawal: "퇴원 신청", counseling: "상담 요청", inquiry: "문의",
      };
      const typeLabel = TYPE_LABELS[request_type] || request_type;

      const result = await db.execute(sql`
        INSERT INTO parent_student_requests (swimming_pool_id, student_id, parent_id, teacher_user_id, request_type, request_date, content)
        VALUES (${poolId}, ${student_id}, ${req.user!.userId}, ${teacherUserId}, ${request_type}, ${request_date || null}, ${content || null})
        RETURNING *
      `);
      const newReq = result.rows[0] as any;

      // 담당 선생님에게 푸시 알림 + 메시지함(notice 채널) 삽입
      if (teacherUserId) {
        try {
          const { sendPushToUser } = await import("../lib/push-service.js");
          const pushContent = content?.trim()
            ? `${studentName} · ${content.trim().slice(0, 60)}`
            : `${studentName}`;
          await sendPushToUser(
            teacherUserId, false, "parent_request",
            `${parentName}님의 ${typeLabel}`,
            pushContent,
            { type: "parent_request", poolId, requestId: newReq.id },
            `preq_${poolId}`
          );
        } catch (pushErr) {
          console.error("[parent-requests push error]", pushErr);
        }
      }

      res.status(201).json({ success: true, data: newReq });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: "서버 오류" });
    }
  }
);

// ─── 학부모: 내 수업 요청 목록 조회 ─────────────────────────────────────
// GET /parent/requests?student_id=xxx
router.get("/parent/requests", requireAuth,
  async (req: AuthRequest, res) => {
    try {
      if (req.user?.role !== "parent_account") {
        res.status(403).json({ success: false, message: "학부모만 이용 가능합니다." }); return;
      }
      const { student_id } = req.query;
      let q = `SELECT psr.*, s.name AS student_name FROM parent_student_requests psr LEFT JOIN students s ON s.id = psr.student_id WHERE psr.parent_id = '${req.user!.userId}'`;
      if (student_id) q += ` AND psr.student_id = '${String(student_id).replace(/'/g, "''")}'`;
      q += ` ORDER BY psr.created_at DESC LIMIT 50`;

      const result = await db.execute(sql.raw(q));
      res.json({ success: true, data: result.rows });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: "서버 오류" });
    }
  }
);

// ─── 선생님: 내게 온 학부모 요청 목록 ───────────────────────────────────
// GET /teacher/parent-requests
router.get("/teacher/parent-requests", requireAuth, requireRole("teacher", "pool_admin", "super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const { userId } = req.user!;
      const [me] = await superAdminDb.select({ swimming_pool_id: usersTable.swimming_pool_id })
        .from(usersTable).where(eq(usersTable.id, userId)).limit(1);
      if (!me?.swimming_pool_id) { res.status(403).json({ success: false, message: "소속 수영장 없음" }); return; }

      // is_read_by_teacher 컬럼 없으면 자동 추가
      await db.execute(sql`
        ALTER TABLE parent_student_requests
        ADD COLUMN IF NOT EXISTS is_read_by_teacher BOOLEAN DEFAULT false
      `).catch(() => {});

      const rows = await db.execute(sql`
        SELECT
          psr.*,
          COALESCE(psr.is_read_by_teacher, false) AS is_read_by_teacher,
          s.name AS student_name,
          pa.name AS parent_name
        FROM parent_student_requests psr
        LEFT JOIN students s ON s.id = psr.student_id
        LEFT JOIN parent_accounts pa ON pa.id = psr.parent_id
        WHERE psr.swimming_pool_id = ${me.swimming_pool_id}
          AND psr.teacher_user_id = ${userId}
        ORDER BY psr.created_at DESC
        LIMIT 100
      `);

      const data = rows.rows as any[];

      // 보강 완료 후보 배치 탐지 (N+1 방지)
      const pendingMakeups = data.filter(
        r => r.request_type === "makeup" && r.status === "pending" && !r.processed_result_id
      ).map(r => ({ id: r.id, student_id: r.student_id, created_at: r.created_at }));

      let candidateMap: Map<string, any> = new Map();
      let candidateQueryError = false;
      try {
        candidateMap = await findMakeupResultCandidatesBatch({
          poolId: me.swimming_pool_id,
          pendingMakeupRequests: pendingMakeups,
        });
      } catch (e) {
        candidateQueryError = true;
        console.error(`[teacher/parent-requests candidate] poolId=${me.swimming_pool_id} userId=${userId}`, e);
      }

      const enriched = data.map(r => ({
        ...r,
        work_result_candidate: candidateQueryError ? null : (candidateMap.get(r.id) ?? null),
      }));

      // Contract: 배열 직접 반환 (하위 호환 유지)
      res.json(enriched);
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: "서버 오류" });
    }
  }
);

// ─── 선생님: 요청 읽음 처리 ──────────────────────────────────────────────
// PATCH /teacher/parent-requests/:id/read
router.patch("/teacher/parent-requests/:id/read", requireAuth, requireRole("teacher", "pool_admin", "super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const { userId } = req.user!;
      const [me] = await superAdminDb.select({ swimming_pool_id: usersTable.swimming_pool_id })
        .from(usersTable).where(eq(usersTable.id, userId)).limit(1);
      if (!me?.swimming_pool_id) { res.status(403).json({ success: false, message: "소속 수영장 없음" }); return; }

      await db.execute(sql`
        UPDATE parent_student_requests
        SET is_read_by_teacher = true,
            updated_at = NOW()
        WHERE id = ${req.params.id}
          AND swimming_pool_id = ${me.swimming_pool_id}
          AND teacher_user_id = ${userId}
      `);
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: "서버 오류" });
    }
  }
);

// ─── 관리자: 학부모 수업 요청 처리 (pending→done/rejected) ────────────────
// PATCH /parent-requests/:id
router.patch("/parent-requests/:id", requireAuth, requireRole("pool_admin", "sub_admin", "teacher", "super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const { status, admin_note } = req.body;
      if (!["done", "rejected", "pending"].includes(status)) {
        res.status(400).json({ success: false, message: "status는 done, rejected, pending 중 하나여야 합니다." }); return;
      }
      const [me] = await superAdminDb.select({ swimming_pool_id: usersTable.swimming_pool_id })
        .from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
      if (!me?.swimming_pool_id) { res.status(403).json({ success: false, message: "소속 수영장 없음" }); return; }

      // 요청 정보 조회 (알림 발송용)
      const [reqRow] = await db.execute(sql`
        SELECT parent_id, request_type, student_id FROM parent_student_requests
        WHERE id = ${req.params.id} AND swimming_pool_id = ${me.swimming_pool_id}
        LIMIT 1
      `).then(r => r.rows as any[]);

      // 컬럼 보장 (GET보다 PATCH가 먼저 호출될 경우 대비)
      await db.execute(sql`
        ALTER TABLE parent_student_requests
        ADD COLUMN IF NOT EXISTS is_read_by_teacher BOOLEAN DEFAULT false
      `).catch(() => {});

      // 상태 변경 시 읽음 처리도 함께
      await db.execute(sql`
        UPDATE parent_student_requests
        SET status = ${status},
            is_read_by_teacher = true,
            updated_at = NOW()
        WHERE id = ${req.params.id} AND swimming_pool_id = ${me.swimming_pool_id}
      `);

      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: "서버 오류" });
    }
  }
);

// ─── 선생님: 요청 처리 결과 알리기 ─────────────────────────────────────────
// POST /parent-requests/:id/notify-result
// 조건: status IN ('done','rejected') AND result_notified_at IS NULL
router.post("/parent-requests/:id/notify-result", requireAuth, requireRole("teacher", "pool_admin", "sub_admin", "super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const { userId, role } = req.user!;

      // tenant·담당교사 권한 통합 검증
      const access = await checkRequestAccess(userId, role, req.params.id, res);
      if (!access) return;
      const { psr } = access;

      // 상태 검증
      if (!["done", "rejected"].includes(psr.status)) {
        res.status(400).json({ success: false, code: "INVALID_STATUS", message: "done 또는 rejected 상태의 요청만 알릴 수 있습니다." }); return;
      }
      if (psr.result_notified_at) {
        res.status(409).json({ success: false, code: "ALREADY_NOTIFIED", message: "이미 결과 알림을 보냈습니다." }); return;
      }

      // 알림 문구 생성
      const msg = buildRequestResultMessage({
        requestType: psr.request_type,
        status:      psr.status,
        adminNote:   req.body?.admin_note ?? null,
        requestId:   psr.id,
      });

      const notifId = `notif_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

      // 트랜잭션: notifications INSERT + parent_student_requests UPDATE
      await db.execute(sql`BEGIN`);
      try {
        await db.execute(sql`
          INSERT INTO notifications (id, user_id, type, title, body, ref_id, ref_type, deep_link, is_read, created_at)
          VALUES (
            ${notifId},
            ${psr.parent_id},
            'parent_request_result',
            ${msg.title},
            ${msg.body},
            ${msg.refId},
            ${msg.refType},
            ${msg.deepLink},
            false,
            NOW()
          )
        `);

        const updateResult = await db.execute(sql`
          UPDATE parent_student_requests
          SET result_notified_at     = NOW(),
              result_notified_by     = ${userId},
              result_notification_id = ${notifId},
              updated_at             = NOW()
          WHERE id = ${psr.id}
            AND result_notified_at IS NULL
          RETURNING id
        `);

        if ((updateResult.rows?.length ?? 0) === 0) {
          await db.execute(sql`ROLLBACK`);
          res.status(409).json({ success: false, code: "ALREADY_NOTIFIED", message: "이미 결과 알림을 보냈습니다." }); return;
        }

        await db.execute(sql`COMMIT`);
      } catch (txErr) {
        await db.execute(sql`ROLLBACK`).catch(() => {});
        throw txErr;
      }

      // 비동기 Push — fire-and-forget (전달 여부 확정 불가)
      if (psr.parent_id) {
        (async () => {
          try {
            const { sendPushToUser } = await import("../lib/push-service.js");
            await sendPushToUser(
              psr.parent_id, true, "parent_request_result",
              msg.title, msg.body,
              { requestId: psr.id, deepLink: msg.deepLink },
              `req_result_${psr.id}`
            );
          } catch (pushErr) { console.error("[notify-result push]", pushErr); }
        })();
      }

      // push_delivered 사용 금지 (fire-and-forget이므로 전달 여부 미확정)
      res.json({ success: true, notification_id: notifId, push_queued: true });
    } catch (err) {
      console.error("[notify-result]", err);
      res.status(500).json({ success: false, message: "서버 오류" });
    }
  }
);

// ─── 선생님: 보강 세션 연결 ──────────────────────────────────────────────────
// POST /parent-requests/:id/link-result
// body: { result_type: "makeup_assignment", result_id: string }
// 성공 시: pending → done, processed_result_type/id/by/at 저장
router.post("/parent-requests/:id/link-result", requireAuth, requireRole("teacher", "pool_admin", "sub_admin", "super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const { userId, role } = req.user!;
      const { result_type, result_id } = req.body ?? {};

      if (!result_type) {
        res.status(400).json({ success: false, message: "result_type은 필수입니다." }); return;
      }
      if (result_type !== PROCESSED_RESULT_TYPES.MAKEUP_ASSIGNMENT) {
        res.status(400).json({ success: false, code: "INVALID_RESULT_TYPE", message: `지원하지 않는 result_type입니다. 허용값: ${PROCESSED_RESULT_TYPES.MAKEUP_ASSIGNMENT}` }); return;
      }
      if (!result_id) {
        res.status(400).json({ success: false, message: "result_id는 필수입니다." }); return;
      }

      // 1. tenant·담당교사 권한 통합 검증
      const access = await checkRequestAccess(userId, role, req.params.id, res);
      if (!access) return;
      const { psr, actorPoolId } = access;

      // 2. 요청 유형 검증
      if (psr.request_type !== "makeup") {
        res.status(400).json({ success: false, code: "WRONG_REQUEST_TYPE", message: "보강 요청에만 세션을 연결할 수 있습니다." }); return;
      }

      // 3. 요청 상태 검증 (pending만 허용 — link-result는 pending → done 전환)
      if (psr.status !== "pending") {
        res.status(400).json({ success: false, code: "INVALID_STATUS", message: "대기 중인 요청에만 세션을 연결할 수 있습니다." }); return;
      }

      // 4. 이미 연결 여부
      if (psr.processed_result_id) {
        res.status(409).json({ success: false, code: "ALREADY_LINKED", message: "이미 연결된 세션이 있습니다." }); return;
      }

      // 5. 세션 조회
      const [session] = (await db.execute(sql`
        SELECT id, swimming_pool_id, student_id, status, created_at, assigned_date,
               assigned_class_group_id, assigned_class_group_name, assigned_teacher_name
        FROM makeup_sessions
        WHERE id = ${result_id}
        LIMIT 1
      `)).rows as any[];
      if (!session) { res.status(404).json({ success: false, message: "보강 세션을 찾을 수 없습니다." }); return; }

      // 6. 세션 수영장 확인 (super_admin은 psr.swimming_pool_id 기준)
      const poolId = actorPoolId ?? psr.swimming_pool_id;
      if (session.swimming_pool_id !== poolId) {
        res.status(403).json({ success: false, message: "이 세션에 접근할 권한이 없습니다." }); return;
      }

      // 7. 세션 학생 확인
      if (session.student_id !== psr.student_id) {
        res.status(400).json({ success: false, code: "STUDENT_MISMATCH", message: "세션의 학생이 요청의 학생과 다릅니다." }); return;
      }

      // 8. 세션 상태 확인
      if (session.status !== "assigned") {
        res.status(400).json({ success: false, code: "SESSION_NOT_ASSIGNED", message: "배정 완료 상태의 세션만 연결할 수 있습니다." }); return;
      }

      // 9. 세션 날짜 순서 확인
      const psrCreated  = new Date(psr.created_at).getTime();
      const sessCreated = new Date(session.created_at).getTime();
      if (sessCreated < psrCreated) {
        res.status(400).json({ success: false, code: "SESSION_BEFORE_REQUEST", message: "세션이 요청보다 이전에 생성됐습니다." }); return;
      }

      // 10. UPDATE: pending → done + processed_result 연결 + Partial Unique 위반 → 409
      let updateRows = 0;
      try {
        const updateResult = await db.execute(sql`
          UPDATE parent_student_requests
          SET status                = 'done',
              processed_result_type = ${PROCESSED_RESULT_TYPES.MAKEUP_ASSIGNMENT},
              processed_result_id   = ${result_id},
              processed_by          = ${userId},
              processed_at          = NOW(),
              updated_at            = NOW()
          WHERE id = ${psr.id}
            AND status = 'pending'
            AND processed_result_id IS NULL
          RETURNING id
        `);
        updateRows = updateResult.rows?.length ?? 0;
      } catch (updateErr: any) {
        const msg = String(updateErr?.message ?? "");
        if (msg.includes("uq_psr_processed_result") || msg.includes("unique")) {
          res.status(409).json({ success: false, code: "ALREADY_LINKED", message: "이 세션은 이미 다른 요청에 연결됐습니다." }); return;
        }
        throw updateErr;
      }

      // 11. 0행 → 상태 충돌
      if (updateRows === 0) {
        res.status(409).json({ success: false, code: "STATUS_CONFLICT", message: "요청 상태가 변경되어 처리할 수 없습니다. 목록을 새로고침하세요." }); return;
      }

      res.json({
        success: true,
        linked: {
          sessionId:      result_id,
          assignedDate:   session.assigned_date             ?? null,
          classGroupName: session.assigned_class_group_name ?? null,
          teacherName:    session.assigned_teacher_name     ?? null,
        },
      });
    } catch (err) {
      console.error("[link-result]", err);
      res.status(500).json({ success: false, message: "서버 오류" });
    }
  }
);

// ─── 관리자: 학부모 V2 연결 대기 목록 ─────────────────────────────────────
// GET /admin/parent-v2-pending?status=pending
router.get("/admin/parent-v2-pending", requireAuth, requireRole("pool_admin", "sub_admin", "super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const [me] = await superAdminDb.select({ swimming_pool_id: usersTable.swimming_pool_id })
        .from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
      if (!me?.swimming_pool_id) { res.status(403).json({ success: false, message: "소속 수영장 없음" }); return; }

      const { getParentV2PendingByPool } = await import("../lib/auto-link-v2.js");
      const statusFilter = (req.query.status as string) || "pending";
      const rows = await getParentV2PendingByPool(me.swimming_pool_id, statusFilter);

      res.json({ success: true, data: rows });
    } catch (e) {
      console.error("[admin/parent-v2-pending GET]", e);
      res.status(500).json({ success: false, message: "서버 오류" });
    }
  }
);

// ─── 관리자: 학부모 V2 연결 승인/거절 ─────────────────────────────────────
// PATCH /admin/parent-v2-pending/:id  { action: "approve" | "reject", reason?: string }
router.patch("/admin/parent-v2-pending/:id", requireAuth, requireRole("pool_admin", "sub_admin", "super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const [me] = await superAdminDb.select({ swimming_pool_id: usersTable.swimming_pool_id })
        .from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
      if (!me?.swimming_pool_id) { res.status(403).json({ success: false, message: "소속 수영장 없음" }); return; }

      const { action, reason } = req.body;
      if (!["approve", "reject"].includes(action)) {
        res.status(400).json({ success: false, message: "action은 approve 또는 reject여야 합니다." }); return;
      }

      const { approveParentV2Pending, rejectParentV2Pending } = await import("../lib/auto-link-v2.js");
      let result: { success: boolean; message: string };

      if (action === "approve") {
        result = await approveParentV2Pending(req.params.id, me.swimming_pool_id);
      } else {
        result = await rejectParentV2Pending(req.params.id, me.swimming_pool_id, reason);
      }

      if (!result.success) {
        res.status(400).json({ success: false, message: result.message }); return;
      }

      // 학부모에게 결과 알림
      try {
        const { db: dbClient } = await import("@workspace/db");
        const { sql: sqlTag } = await import("drizzle-orm");
        const [pending] = (await dbClient.execute(sqlTag`
          SELECT parent_id, child_name_raw FROM parent_v2_pending WHERE id = ${req.params.id} LIMIT 1
        `)).rows as any[];

        if (pending?.parent_id) {
          const { sendPushToUser } = await import("../lib/push-service.js");
          if (action === "approve") {
            await sendPushToUser(pending.parent_id, true, "parent_link_approved",
              "자녀 연결 완료!", `${pending.child_name_raw}과(와) 연결되었습니다.`,
              { screen: "home" }, `link_approved_${req.params.id}`);
          } else {
            await sendPushToUser(pending.parent_id, true, "parent_link_rejected",
              "자녀 연결 요청 거절",
              reason ? `거절 사유: ${reason}` : "수영장 관리자에게 문의해주세요.",
              { screen: "home" }, `link_rejected_${req.params.id}`);
          }
        }
      } catch {}

      res.json({ success: true, message: result.message });
    } catch (e) {
      console.error("[admin/parent-v2-pending PATCH]", e);
      res.status(500).json({ success: false, message: "서버 오류" });
    }
  }
);

export default router;
