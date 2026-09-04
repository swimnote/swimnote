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

const router = Router();

function genId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

// ─── parent_request_messages 테이블 자동 생성 ─────────────────────────────
let _messagesTableReady = false;
async function ensureMessagesTable() {
  if (_messagesTableReady) return;
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS parent_request_messages (
      id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()::text),
      request_id TEXT NOT NULL,
      swimming_pool_id TEXT NOT NULL,
      sender_type TEXT NOT NULL,
      sender_id TEXT,
      message_type TEXT NOT NULL DEFAULT 'message',
      content TEXT NOT NULL,
      is_read_by_teacher BOOLEAN DEFAULT false,
      is_read_by_parent BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(() => {});
  _messagesTableReady = true;
}

const REQUEST_TYPE_NAMES: Record<string, string> = {
  absence: "결석 신청", makeup: "보강 요청", postpone: "연기 신청",
  withdrawal: "퇴원 신청", counseling: "상담 요청", inquiry: "문의",
};

async function insertSystemMessage(requestId: string, poolId: string, content: string) {
  await ensureMessagesTable();
  const id = `prm_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  await db.execute(sql`
    INSERT INTO parent_request_messages
    (id, request_id, swimming_pool_id, sender_type, sender_id, message_type, content, is_read_by_teacher, is_read_by_parent)
    VALUES (${id}, ${requestId}, ${poolId}, 'system', NULL, 'system', ${content}, true, true)
  `).catch(() => {});
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

      await ensureMessagesTable();
      const rows = await db.execute(sql`
        SELECT
          psr.*,
          COALESCE(psr.is_read_by_teacher, false) AS is_read_by_teacher,
          s.name AS student_name,
          pa.name AS parent_name,
          COALESCE((
            SELECT COUNT(*) FROM parent_request_messages prm
            WHERE prm.request_id = psr.id
              AND prm.sender_type = 'parent'
              AND prm.is_read_by_teacher = false
          ), 0) AS new_message_count
        FROM parent_student_requests psr
        LEFT JOIN students s ON s.id = psr.student_id
        LEFT JOIN parent_accounts pa ON pa.id = psr.parent_id
        LEFT JOIN class_groups cg
          ON cg.id = s.class_group_id
         AND cg.is_deleted = false
        WHERE psr.swimming_pool_id = ${me.swimming_pool_id}
          AND (
            psr.teacher_user_id = ${userId}
            OR cg.teacher_user_id = ${userId}
            OR cg.co_teacher_ids @> to_jsonb(${userId}::text)
          )
          AND s.status NOT IN ('withdrawn', 'deleted', 'archived')
          AND s.deleted_at IS NULL
        ORDER BY psr.created_at DESC
        LIMIT 100
      `);
      res.json({ success: true, data: rows.rows });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: "서버 오류" });
    }
  }
);

// ─── 선생님: 요청 읽음 처리 ──────────────────────────────────────────────
// PATCH /teacher/parent-requests/:id/read
// 최초 unread→read 전환 시에만 학부모 확인 알림 발송 (중복 알림 방지)
router.patch("/teacher/parent-requests/:id/read", requireAuth, requireRole("teacher", "pool_admin", "super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const { userId } = req.user!;
      const [me] = await superAdminDb.select({ swimming_pool_id: usersTable.swimming_pool_id })
        .from(usersTable).where(eq(usersTable.id, userId)).limit(1);
      if (!me?.swimming_pool_id) { res.status(403).json({ success: false, message: "소속 수영장 없음" }); return; }

      // 현재 row 조회 (is_read_by_teacher, request_type, parent_id)
      const [reqRow] = await db.execute(sql`
        SELECT is_read_by_teacher, request_type, parent_id
        FROM parent_student_requests
        WHERE id = ${req.params.id}
          AND swimming_pool_id = ${me.swimming_pool_id}
        LIMIT 1
      `).then(r => r.rows as any[]);

      if (reqRow && !reqRow.is_read_by_teacher) {
        // 최초 읽음 전환: UPDATE + 확인 알림 발송 + system message
        await db.execute(sql`
          UPDATE parent_student_requests
          SET is_read_by_teacher = true,
              updated_at = NOW()
          WHERE id = ${req.params.id}
            AND swimming_pool_id = ${me.swimming_pool_id}
        `);

        // 대화 스레드에 시스템 메시지 기록
        const typeNameForSys = REQUEST_TYPE_NAMES[reqRow.request_type] || "요청";
        await insertSystemMessage(req.params.id, me.swimming_pool_id, `선생님이 ${typeNameForSys}을 확인했습니다.`);

        if (reqRow.parent_id) {
          const ACK_LABELS: Record<string, { title: string; body: string }> = {
            absence:    { title: "결석 신청을 확인했습니다",  body: "선생님이 결석 신청을 확인했습니다." },
            postpone:   { title: "연기 신청을 확인했습니다",  body: "선생님이 연기 신청을 확인했습니다." },
            makeup:     { title: "보강 요청을 확인했습니다",  body: "선생님이 보강 요청을 확인했습니다." },
            withdrawal: { title: "퇴원 신청을 확인했습니다",  body: "선생님이 퇴원 신청을 확인했습니다." },
            counseling: { title: "상담 요청을 확인했습니다",  body: "선생님이 상담 요청을 확인했습니다." },
            inquiry:    { title: "문의를 확인했습니다",       body: "선생님이 문의 내용을 확인했습니다." },
          };
          const ack = ACK_LABELS[reqRow.request_type] ?? { title: "요청을 확인했습니다", body: "선생님이 요청을 확인했습니다." };

          // Notification DB 저장 (ref_id 기준 중복 방지 — read transition은 1회만 발생하므로 시간 기반 불필요)
          try {
            const notifId = `notif_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
            await db.execute(sql`
              INSERT INTO notifications (id, recipient_id, recipient_type, type, title, body, ref_id, ref_type, pool_id, is_read)
              SELECT ${notifId}, ${reqRow.parent_id}, 'parent_account',
                     'parent_request_acknowledged', ${ack.title}, ${ack.body},
                     ${req.params.id}, 'request', ${me.swimming_pool_id}, false
              WHERE NOT EXISTS (
                SELECT 1 FROM notifications
                WHERE type = 'parent_request_acknowledged'
                  AND ref_id = ${req.params.id}
                  AND recipient_id = ${reqRow.parent_id}
              )
            `);
          } catch (notifErr) { console.error("[parent-requests read notification error]", notifErr); }

          // Push 발송
          try {
            const { sendPushToUser } = await import("../lib/push-service.js");
            await sendPushToUser(
              reqRow.parent_id, true, "parent_request_acknowledged",
              ack.title, ack.body,
              { requestId: req.params.id },
              `req_ack_${req.params.id}`
            );
          } catch (pushErr) { console.error("[parent-requests read push error]", pushErr); }
        }
      }
      // 이미 읽음(is_read_by_teacher=true)이면 UPDATE/알림 없음 → 중복 알림 방지

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

      // 요청 정보 조회 (알림 발송용 + 이전 상태 확인)
      const [reqRow] = await db.execute(sql`
        SELECT parent_id, request_type, student_id, status AS prev_status FROM parent_student_requests
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

      // 상태가 실제로 변경된 경우에만 알림/push 발송 (중복 알림 방지)
      const statusChanged = reqRow?.prev_status !== status;
      if (reqRow && status !== "pending" && statusChanged) {
        // 대화 스레드에 상태 변경 시스템 메시지 기록
        const typeNameSys = REQUEST_TYPE_NAMES[reqRow.request_type] || "요청";
        const sysMsgContent = status === "done"
          ? `${typeNameSys}이 처리됐습니다.`
          : `${typeNameSys}을 처리하지 못했습니다.`;
        await insertSystemMessage(req.params.id, me.swimming_pool_id, sysMsgContent);
      }

      if (reqRow?.parent_id && status !== "pending" && statusChanged) {
        const TYPE_LABELS: Record<string, string> = {
          absence: "결석", makeup: "보강", postpone: "연기",
          withdrawal: "퇴원", counseling: "상담", inquiry: "문의",
        };
        const typeLabel = TYPE_LABELS[reqRow.request_type] || "수업";
        const pushTitle = status === "done"
          ? `${typeLabel} 요청이 처리됐습니다`
          : `${typeLabel} 요청이 거절됐습니다`;
        const pushBody = status === "done"
          ? "선생님이 요청을 확인하고 처리했습니다."
          : (admin_note ? `거절 사유: ${admin_note}` : "요청이 거절됐습니다. 수영장에 문의해주세요.");

        // Notification DB 저장 (중복 방지: 1시간 내 동일 ref_id+recipient_id+type 차단)
        try {
          const notifId = `notif_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
          await db.execute(sql`
            INSERT INTO notifications (id, recipient_id, recipient_type, type, title, body, ref_id, ref_type, pool_id, is_read)
            SELECT ${notifId}, ${reqRow.parent_id}, 'parent_account',
                   'parent_request_result', ${pushTitle}, ${pushBody},
                   ${req.params.id}, 'request', ${me.swimming_pool_id}, false
            WHERE NOT EXISTS (
              SELECT 1 FROM notifications
              WHERE type = 'parent_request_result'
                AND ref_id = ${req.params.id}
                AND recipient_id = ${reqRow.parent_id}
                AND created_at > NOW() - INTERVAL '1 hour'
            )
          `);
        } catch (notifErr) {
          console.error("[parent-requests PATCH notification error]", notifErr);
        }

        // Push 발송
        try {
          const { sendPushToUser } = await import("../lib/push-service.js");
          await sendPushToUser(
            reqRow.parent_id, true, "parent_request_result",
            pushTitle, pushBody,
            { requestId: req.params.id },
            `req_result_${req.params.id}`
          );
        } catch (pushErr) { console.error("[parent-requests PATCH push error]", pushErr); }
      }

      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: "서버 오류" });
    }
  }
);

// ─── 업무 대화 스레드: 메시지 조회 ──────────────────────────────────────────
// GET /parent-requests/:requestId/messages
// teacher/parent 공통. 조회 시 상대방 메시지 읽음 처리
router.get("/parent-requests/:requestId/messages", requireAuth,
  async (req: AuthRequest, res) => {
    try {
      await ensureMessagesTable();
      const { role, userId } = req.user!;
      const requestId = req.params.requestId;

      const [reqRow] = await db.execute(sql`
        SELECT id, parent_id, swimming_pool_id, teacher_user_id FROM parent_student_requests
        WHERE id = ${requestId} LIMIT 1
      `).then(r => r.rows as any[]);

      if (!reqRow) { res.status(404).json({ success: false, message: "요청을 찾을 수 없습니다." }); return; }

      if (role === "parent_account") {
        if (reqRow.parent_id !== userId) { res.status(403).json({ success: false, message: "접근 권한 없음" }); return; }
        // 선생님이 보낸 메시지를 학부모 읽음으로 처리
        await db.execute(sql`
          UPDATE parent_request_messages SET is_read_by_parent = true
          WHERE request_id = ${requestId} AND sender_type IN ('teacher','system') AND is_read_by_parent = false
        `).catch(() => {});
        // 해당 request의 parent_request_reply notification도 읽음 처리 → badge 감소
        await db.execute(sql`
          UPDATE notifications SET is_read = true
          WHERE recipient_id = ${userId} AND ref_id = ${requestId}
            AND ref_type = 'request' AND type = 'parent_request_reply' AND is_read = false
        `).catch(() => {});
      } else if (["teacher", "pool_admin", "super_admin"].includes(role)) {
        const [me] = await superAdminDb.select({ swimming_pool_id: usersTable.swimming_pool_id })
          .from(usersTable).where(eq(usersTable.id, userId)).limit(1);
        if (reqRow.swimming_pool_id !== me?.swimming_pool_id) { res.status(403).json({ success: false, message: "접근 권한 없음" }); return; }
        // 학부모가 보낸 메시지를 선생님 읽음으로 처리
        await db.execute(sql`
          UPDATE parent_request_messages SET is_read_by_teacher = true
          WHERE request_id = ${requestId} AND sender_type = 'parent' AND is_read_by_teacher = false
        `).catch(() => {});
      } else {
        res.status(403).json({ success: false, message: "접근 권한 없음" }); return;
      }

      const messages = await db.execute(sql`
        SELECT * FROM parent_request_messages WHERE request_id = ${requestId} ORDER BY created_at ASC
      `).then(r => r.rows);

      res.json({ success: true, messages });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: "서버 오류" });
    }
  }
);

// ─── 업무 대화 스레드: 메시지 전송 ──────────────────────────────────────────
// POST /parent-requests/:requestId/messages
// teacher → 학부모 알림/push / parent → 선생님 new_message_count 증가
router.post("/parent-requests/:requestId/messages", requireAuth,
  async (req: AuthRequest, res) => {
    try {
      await ensureMessagesTable();
      const { role, userId } = req.user!;
      const requestId = req.params.requestId;
      const { content } = req.body;
      if (!content?.trim()) { res.status(400).json({ success: false, message: "내용을 입력해주세요." }); return; }

      const [reqRow] = await db.execute(sql`
        SELECT id, parent_id, teacher_user_id, swimming_pool_id, request_type
        FROM parent_student_requests WHERE id = ${requestId} LIMIT 1
      `).then(r => r.rows as any[]);
      if (!reqRow) { res.status(404).json({ success: false, message: "요청을 찾을 수 없습니다." }); return; }

      let senderType: string;
      let isReadByTeacher = false;
      let isReadByParent = false;

      if (role === "parent_account") {
        if (reqRow.parent_id !== userId) { res.status(403).json({ success: false, message: "접근 권한 없음" }); return; }
        senderType = "parent";
        isReadByParent = true;
      } else if (["teacher", "pool_admin", "super_admin"].includes(role)) {
        const [me] = await superAdminDb.select({ swimming_pool_id: usersTable.swimming_pool_id })
          .from(usersTable).where(eq(usersTable.id, userId)).limit(1);
        if (reqRow.swimming_pool_id !== me?.swimming_pool_id) { res.status(403).json({ success: false, message: "접근 권한 없음" }); return; }
        senderType = "teacher";
        isReadByTeacher = true;
      } else {
        res.status(403).json({ success: false, message: "접근 권한 없음" }); return;
      }

      const msgId = `prm_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      await db.execute(sql`
        INSERT INTO parent_request_messages
        (id, request_id, swimming_pool_id, sender_type, sender_id, message_type, content, is_read_by_teacher, is_read_by_parent)
        VALUES (${msgId}, ${requestId}, ${reqRow.swimming_pool_id}, ${senderType}, ${userId}, 'message', ${content.trim()}, ${isReadByTeacher}, ${isReadByParent})
      `);
      const [message] = await db.execute(sql`SELECT * FROM parent_request_messages WHERE id = ${msgId}`).then(r => r.rows as any[]);

      const typeLabel = REQUEST_TYPE_NAMES[reqRow.request_type] || "요청";

      if (senderType === "teacher" && reqRow.parent_id) {
        // Push 문구: 개인정보/내용 노출 없이 단순 도착 알림
        const pushTitle = "새로운 소식이 도착했습니다";
        const pushBody  = "선생님에게서 새로운 소식이 도착했습니다.";
        // notification DB 기록 (push OFF여도 유지)
        try {
          const notifId = `notif_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
          await db.execute(sql`
            INSERT INTO notifications (id, recipient_id, recipient_type, type, title, body, ref_id, ref_type, pool_id, is_read)
            VALUES (${notifId}, ${reqRow.parent_id}, 'parent_account', 'parent_request_reply',
                    ${pushTitle}, ${pushBody}, ${requestId}, 'request', ${reqRow.swimming_pool_id}, false)
          `).catch(() => {});
        } catch {}
        // Push 발송 (학부모 news 설정 ON인 경우만)
        try {
          const [ps] = (await db.execute(sql`
            SELECT is_enabled FROM push_settings
            WHERE parent_account_id = ${reqRow.parent_id} AND notification_type = 'news' LIMIT 1
          `).catch(() => ({ rows: [] }))).rows as any[];
          const pushEnabled = ps ? Boolean(ps.is_enabled) : true; // 기본 ON
          if (pushEnabled) {
            const { sendPushToUser } = await import("../lib/push-service.js");
            await sendPushToUser(reqRow.parent_id, true, "parent_request_reply",
              pushTitle, pushBody, { requestId }, `req_reply_${msgId}`);
          }
        } catch (pushErr) { console.error("[parent-requests teacher→parent push error]", pushErr); }
      }

      if (senderType === "parent" && reqRow.teacher_user_id) {
        // Parent→Teacher Push (개인정보 노출 없이 단순 도착 알림)
        const pushTitle = "새로운 소식이 도착했습니다";
        const pushBody  = "학부모에게서 새로운 소식이 도착했습니다.";
        // Push 발송 (선생님 news 설정 ON인 경우만)
        try {
          const [ps] = (await db.execute(sql`
            SELECT is_enabled FROM push_settings
            WHERE user_id = ${reqRow.teacher_user_id} AND notification_type = 'news' LIMIT 1
          `).catch(() => ({ rows: [] }))).rows as any[];
          const pushEnabled = ps ? Boolean(ps.is_enabled) : true; // 기본 ON
          if (pushEnabled) {
            const { sendPushToUser } = await import("../lib/push-service.js");
            await sendPushToUser(reqRow.teacher_user_id, false, "parent_request_reply",
              pushTitle, pushBody, { requestId }, `req_parent_${msgId}`);
          }
        } catch (pushErr) { console.error("[parent-requests parent→teacher push error]", pushErr); }
      }

      res.json({ success: true, message });
    } catch (err) {
      console.error(err);
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
// PATCH /admin/parent-v2-pending/:id
// { action: "approve", student_id?: string }  — student_id: 관리자 직접 선택 학생
// { action: "reject",  reason?: string }
// 허용 status: pending → approve/reject, rejected → approve (재심사)
router.patch("/admin/parent-v2-pending/:id", requireAuth, requireRole("pool_admin", "sub_admin", "super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const [me] = await superAdminDb.select({ swimming_pool_id: usersTable.swimming_pool_id })
        .from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
      if (!me?.swimming_pool_id) { res.status(403).json({ success: false, message: "소속 수영장 없음" }); return; }

      const { action, reason, student_id } = req.body;
      if (!["approve", "reject"].includes(action)) {
        res.status(400).json({ success: false, message: "action은 approve 또는 reject여야 합니다." }); return;
      }

      const { approveParentV2Pending, rejectParentV2Pending } = await import("../lib/auto-link-v2.js");
      let result: { success: boolean; message: string; linkedCount?: number };

      if (action === "approve") {
        // student_id: 관리자가 직접 선택한 학생 (없으면 자동 매칭 시도)
        result = await approveParentV2Pending(req.params.id, me.swimming_pool_id, student_id || undefined);
      } else {
        result = await rejectParentV2Pending(req.params.id, me.swimming_pool_id, reason);
      }

      if (!result.success) {
        res.status(400).json({ success: false, message: result.message }); return;
      }

      // 학부모에게 결과 알림 (push)
      try {
        const [pending] = (await db.execute(sql`
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

      res.json({ success: true, message: result.message, linked_count: result.linkedCount });
    } catch (e) {
      console.error("[admin/parent-v2-pending PATCH]", e);
      res.status(500).json({ success: false, message: "서버 오류" });
    }
  }
);

// ─── 관리자: pending_reason=NULL 건 일괄 재시도 ──────────────────────────
// POST /admin/parent-v2-retry-all
// 기존 NULL pending 건을 안전한 자동매칭 규칙으로 재시도하고 pending_reason 업데이트
router.post("/admin/parent-v2-retry-all", requireAuth, requireRole("pool_admin", "sub_admin", "super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const [me] = await superAdminDb.select({ swimming_pool_id: usersTable.swimming_pool_id })
        .from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
      if (!me?.swimming_pool_id) { res.status(403).json({ success: false, message: "소속 수영장 없음" }); return; }

      const { retryNullPendingByPool } = await import("../lib/auto-link-v2.js");
      const result = await retryNullPendingByPool(me.swimming_pool_id);

      res.json({ success: true, ...result });
    } catch (e) {
      console.error("[admin/parent-v2-retry-all POST]", e);
      res.status(500).json({ success: false, message: "서버 오류" });
    }
  }
);

export default router;
