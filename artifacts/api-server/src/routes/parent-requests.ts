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

// ─── 공개: 수영장 이름 검색 ───────────────────────────────────────────
// name 없으면 전체 목록(반려 제외) 반환, name 있으면 이름 검색
router.get("/pools/public-search", async (req, res) => {
  try {
    const { name } = req.query;
    const nameStr = name ? String(name).trim() : "";

    const results = nameStr.length > 0
      ? await superAdminDb.select({
          id: swimmingPoolsTable.id,
          name: swimmingPoolsTable.name,
          address: swimmingPoolsTable.address,
          phone: swimmingPoolsTable.phone,
        }).from(swimmingPoolsTable)
          .where(and(
            sql`approval_status != 'rejected'`,
            ilike(swimmingPoolsTable.name, `%${nameStr}%`)
          ))
          .orderBy(swimmingPoolsTable.name)
          .limit(50)
      : await superAdminDb.select({
          id: swimmingPoolsTable.id,
          name: swimmingPoolsTable.name,
          address: swimmingPoolsTable.address,
          phone: swimmingPoolsTable.phone,
        }).from(swimmingPoolsTable)
          .where(sql`approval_status != 'rejected'`)
          .orderBy(swimmingPoolsTable.name)
          .limit(100);

    res.json({ success: true, data: results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "서버 오류" });
  }
});

// ─── 공개: 학부모 수영장 가입 요청 ───────────────────────────────────
router.post("/auth/pool-join-request", async (req, res) => {
  try {
    const { swimming_pool_id, parent_name, phone, child_name, child_birth_year, children_requested, loginId, password } = req.body;
    if (!swimming_pool_id || !parent_name?.trim() || !phone?.trim()) {
      res.status(400).json({ success: false, message: "수영장, 이름, 전화번호는 필수입니다." }); return;
    }
    if (!child_name?.trim() && (!children_requested || children_requested.length === 0)) {
      res.status(400).json({ success: false, message: "자녀 정보는 필수입니다." }); return;
    }
    const lid = loginId?.trim() || null;
    const pw = password?.trim() || null;
    if (!lid) { res.status(400).json({ success: false, message: "아이디는 필수입니다." }); return; }
    if (lid.length < 4) { res.status(400).json({ success: false, message: "아이디는 4자 이상이어야 합니다." }); return; }
    if (!pw) { res.status(400).json({ success: false, message: "비밀번호는 필수입니다." }); return; }
    if (pw.length < 4) { res.status(400).json({ success: false, message: "비밀번호는 4자리 이상이어야 합니다." }); return; }

    const [pool] = await superAdminDb.select({ id: swimmingPoolsTable.id })
      .from(swimmingPoolsTable).where(eq(swimmingPoolsTable.id, swimming_pool_id)).limit(1);
    if (!pool) {
      res.status(404).json({ success: false, message: "수영장을 찾을 수 없습니다." }); return;
    }

    const dupIdInAccounts = await db.execute(sql`SELECT id FROM parent_accounts WHERE login_id = ${lid} LIMIT 1`);
    const dupIdInRequests = await superAdminDb.execute(sql`SELECT id FROM parent_pool_requests WHERE login_id = ${lid} AND request_status = 'pending' LIMIT 1`);
    if (dupIdInAccounts.rows.length > 0 || dupIdInRequests.rows.length > 0) {
      res.status(409).json({ success: false, message: "이미 사용 중인 아이디입니다." }); return;
    }

    const dup = await superAdminDb.execute(sql`
      SELECT id FROM parent_pool_requests
      WHERE swimming_pool_id = ${swimming_pool_id}
        AND phone = ${phone.trim()}
        AND request_status = 'pending'
      LIMIT 1
    `);
    if (dup.rows.length > 0) {
      res.status(409).json({ success: false, message: "이미 승인 대기 중인 요청이 있습니다." }); return;
    }

    const id = genId("ppr");
    const childrenData = children_requested?.length > 0
      ? children_requested
      : [{ childName: child_name.trim(), childBirthYear: child_birth_year }];

    const pwHash = await hashPassword(pw);

    // ── 학생 명부 매칭 → 자동 승인 체크 ────────────────────────────────
    // 이름(공백제거+소문자) + 생년 조합으로 매칭. 생년 없으면 이름만으로 매칭.
    // 학생 DB에 있으면 무조건 자동승인 (없을 때만 수동 대기)
    let matchedStudents: Array<{ id: string; name: string }> = [];

    // 자녀별 매칭 조건: (이름 일치) AND (생년 일치 OR 생년 미입력 OR DB에 생년 없음)
    const perChildConditions = childrenData
      .map((c: any) => {
        const rawName = (c.childName || "").trim();
        if (!rawName) return null;
        const normName = rawName.replace(/\s+/g, "").toLowerCase();
        const byear = c.childBirthYear ? String(c.childBirthYear) : null;

        const nameMatch = sql`REPLACE(LOWER(${studentsTable.name}), ' ', '') = ${normName}`;
        if (byear) {
          // 이름 일치 AND (생년 일치 OR 학생 생년 미입력)
          return sql`(${nameMatch} AND (${studentsTable.birth_year} = ${byear} OR ${studentsTable.birth_year} IS NULL))`;
        }
        return nameMatch;
      })
      .filter(Boolean) as any[];

    if (perChildConditions.length > 0) {
      matchedStudents = await db
        .select({ id: studentsTable.id, name: studentsTable.name })
        .from(studentsTable)
        .where(
          and(
            eq(studentsTable.swimming_pool_id, swimming_pool_id),
            // 탈퇴/삭제 제외한 모든 상태 포함 (pending_approval 포함)
            sql`${studentsTable.status} NOT IN ('withdrawn', 'archived', 'deleted')`,
            isNull(studentsTable.parent_user_id),
            or(...perChildConditions),
          )
        )
        .limit(10);
    }

    if (matchedStudents.length > 0) {
      // ── 자동 승인 ─────────────────────────────────────────────────────
      const paId = genId("pa");
      await db.execute(sql`
        INSERT INTO parent_accounts (id, swimming_pool_id, phone, pin_hash, name, login_id, created_at, updated_at)
        VALUES (${paId}, ${swimming_pool_id}, ${phone.trim()}, ${pwHash}, ${parent_name.trim()}, ${lid}, NOW(), NOW())
      `);
      await superAdminDb.execute(sql`
        INSERT INTO parent_pool_requests (id, swimming_pool_id, parent_name, phone, child_name, child_birth_year, children_requested, login_id, password_hash, request_status, parent_account_id, requested_at, processed_at)
        VALUES (${id}, ${swimming_pool_id}, ${parent_name.trim()}, ${phone.trim()},
                ${child_name?.trim() || null}, ${child_birth_year || null},
                ${JSON.stringify(childrenData)}, ${lid}, ${pwHash}, 'auto_approved', ${paId}, NOW(), NOW())
      `);
      // 매칭된 학생들과 연결 + 학생 status를 active로 전환
      for (const student of matchedStudents) {
        const psId = genId("ps");
        await db.execute(sql`
          INSERT INTO parent_students (id, parent_id, student_id, swimming_pool_id, status, approved_at)
          VALUES (${psId}, ${paId}, ${student.id}, ${swimming_pool_id}, 'approved', NOW())
          ON CONFLICT DO NOTHING
        `);
        await db.execute(sql`
          UPDATE students
          SET parent_user_id = ${paId},
              status = CASE
                WHEN status IN ('unregistered', 'pending_approval') THEN 'active'
                ELSE status
              END,
              updated_at = NOW()
          WHERE id = ${student.id} AND parent_user_id IS NULL
        `);
      }
      return res.status(201).json({
        success: true,
        data: {
          id,
          status: "auto_approved",
          parent_account_id: paId,
          matched_students: matchedStudents.map((s: any) => s.name),
          message: "자녀 정보가 학생 명부와 일치하여 자동으로 승인되었습니다.",
        },
      });
    }

    // ── 수동 승인 대기 ────────────────────────────────────────────────────
    await superAdminDb.execute(sql`
      INSERT INTO parent_pool_requests (id, swimming_pool_id, parent_name, phone, child_name, child_birth_year, children_requested, login_id, password_hash, request_status, requested_at)
      VALUES (${id}, ${swimming_pool_id}, ${parent_name.trim()}, ${phone.trim()},
              ${child_name?.trim() || null}, ${child_birth_year || null},
              ${JSON.stringify(childrenData)}, ${lid}, ${pwHash}, 'pending', NOW())
    `);

    res.status(201).json({ success: true, data: { id, status: "pending", message: "가입 요청이 접수되었습니다. 수영장 관리자 승인 후 이용 가능합니다." } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "서버 오류" });
  }
});

// ─── 관리자: 학부모 요청 목록 ────────────────────────────────────────
router.get("/admin/parent-requests", requireAuth, requireRole("pool_admin", "super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const { status } = req.query;
      const [me] = await superAdminDb.select({ swimming_pool_id: usersTable.swimming_pool_id })
        .from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
      if (!me?.swimming_pool_id) { res.status(403).json({ success: false, message: "소속 수영장 없음" }); return; }

      let q = `SELECT * FROM parent_pool_requests WHERE swimming_pool_id = '${me.swimming_pool_id}'`;
      if (status && ["pending", "approved", "rejected"].includes(status as string)) {
        q += ` AND request_status = '${status}'`;
      }
      q += ` ORDER BY requested_at DESC`;

      const result = await superAdminDb.execute(sql.raw(q));
      res.json({ success: true, data: result.rows });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: "서버 오류" });
    }
  }
);

// ─── 관리자: 학부모 요청 승인/거절 (학생 연결 지원) ──────────────────
/**
 * body:
 *   action: "approve" | "reject"
 *   rejection_reason?: string  (거절 시)
 *   pin?: string               (승인 시 초기 PIN, 기본 "0000")
 *   link_student_id?: string   (승인 시 기존 학생과 연결)
 *   create_student?: boolean   (승인 시 요청 데이터로 신규 학생 생성)
 *   child_name?: string        (신규 생성 시 이름 override)
 *   child_birth_year?: string  (신규 생성 시 출생년도 override)
 */
router.patch("/admin/parent-requests/:id", requireAuth, requireRole("pool_admin", "super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const {
        action, rejection_reason, pin,
        link_student_id, create_student,
        child_name: bodyChildName, child_birth_year: bodyChildBirthYear,
      } = req.body;

      if (!["approve", "reject", "revoke"].includes(action)) {
        res.status(400).json({ success: false, message: "action은 approve, reject, revoke 중 하나여야 합니다." }); return;
      }

      const [me] = await superAdminDb.select({ swimming_pool_id: usersTable.swimming_pool_id })
        .from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
      if (!me?.swimming_pool_id) { res.status(403).json({ success: false, message: "소속 수영장 없음" }); return; }

      const existing = await superAdminDb.execute(sql`
        SELECT * FROM parent_pool_requests
        WHERE id = ${req.params.id} AND swimming_pool_id = ${me.swimming_pool_id}
        LIMIT 1
      `);
      if (!existing.rows.length) { res.status(404).json({ success: false, message: "요청을 찾을 수 없습니다." }); return; }

      const request = existing.rows[0] as any;

      // revoke는 승인(approved/auto_approved) 상태에서 가능
      if (action === "revoke") {
        if (!["approved", "auto_approved"].includes(request.request_status)) {
          res.status(409).json({ success: false, message: "승인된 학부모만 승인 해제할 수 있습니다." }); return;
        }
        if (request.parent_account_id) {
          // 학생 연결만 해제 (계정은 유지 — 학부모는 홈에서 "자녀 없음" 상태로 진입)
          await db.execute(sql`
            UPDATE students SET parent_user_id = NULL, updated_at = NOW()
            WHERE parent_user_id = ${request.parent_account_id}
          `);
          // parent_students 연결 해제
          await db.execute(sql`
            DELETE FROM parent_students WHERE parent_id = ${request.parent_account_id}
          `);
          // swimming_pool_id 초기화 (재연결 가능하도록)
          await db.execute(sql`
            UPDATE parent_accounts SET swimming_pool_id = NULL, updated_at = NOW()
            WHERE id = ${request.parent_account_id}
          `);
        }
        await superAdminDb.execute(sql`
          UPDATE parent_pool_requests SET request_status = 'revoked', processed_at = NOW(), processed_by = ${req.user!.userId}
          WHERE id = ${req.params.id}
        `);
        res.json({ success: true, message: "자녀 연결이 해제되었습니다. 학부모는 로그인 후 자녀 연결 화면을 볼 수 있습니다." }); return;
      }

      if (request.request_status !== "pending") {
        res.status(409).json({ success: false, message: "이미 처리된 요청입니다." }); return;
      }

      if (action === "approve") {
        // ── 1. parent_account 생성 또는 기존 계정 조회 ──────────────
        const defaultPin = pin || "0000";
        const pinHash = await hashPassword(defaultPin);
        const paId = genId("pa");

        const dupAcc = await db.execute(sql`
          SELECT id FROM parent_accounts
          WHERE phone = ${request.phone} AND swimming_pool_id = ${me.swimming_pool_id}
          LIMIT 1
        `);

        let parentAccountId = dupAcc.rows[0]?.id as string | undefined;
        if (!parentAccountId) {
          const finalPinHash = request.password_hash || pinHash;
          const finalLoginId = request.login_id || null;
          await db.execute(sql`
            INSERT INTO parent_accounts (id, swimming_pool_id, phone, pin_hash, name, login_id, created_at, updated_at)
            VALUES (${paId}, ${me.swimming_pool_id}, ${request.phone}, ${finalPinHash}, ${request.parent_name}, ${finalLoginId}, NOW(), NOW())
          `);
          parentAccountId = paId;
        }

        // ── 2. 승인 처리 ────────────────────────────────────────────
        await superAdminDb.execute(sql`
          UPDATE parent_pool_requests
          SET request_status = 'approved', processed_at = NOW(), processed_by = ${req.user!.userId},
              parent_account_id = ${parentAccountId}
          WHERE id = ${req.params.id}
        `);

        let linkedStudentId: string | null = null;

        // ── 3-auto. 이름으로 자동 매칭 (link_student_id 미제공 시 항상 시도)
        // bodyChildName 있으면 관리자가 확인한 이름 우선 사용
        if (!link_student_id) {
          const autoMatchName = (bodyChildName?.trim() || request.child_name || "").trim();
          if (autoMatchName) {
            const normalName = autoMatchName.replace(/\s+/g, "").toLowerCase();
            const autoMatch = await db.execute(sql`
              SELECT id FROM students
              WHERE swimming_pool_id = ${me.swimming_pool_id}
                AND LOWER(REPLACE(name, ' ', '')) = ${normalName}
                AND status NOT IN ('deleted', 'withdrawn', 'archived')
                AND (parent_user_id IS NULL OR parent_user_id = ${parentAccountId})
              LIMIT 1
            `);
            if (autoMatch.rows.length > 0) {
              const studentId = (autoMatch.rows[0] as any).id;
              const existLink = await db.execute(sql`
                SELECT id FROM parent_students WHERE parent_id = ${parentAccountId} AND student_id = ${studentId} LIMIT 1
              `);
              if (!existLink.rows.length) {
                const psId = genId("ps");
                await db.execute(sql`
                  INSERT INTO parent_students (id, parent_id, student_id, swimming_pool_id, status, approved_by, approved_at, created_at)
                  VALUES (${psId}, ${parentAccountId}, ${studentId}, ${me.swimming_pool_id}, 'approved', ${req.user!.userId}, NOW(), NOW())
                `);
              } else {
                await db.execute(sql`UPDATE parent_students SET status='approved', approved_by=${req.user!.userId}, approved_at=NOW() WHERE id=${(existLink.rows[0] as any).id}`);
              }
              await db.execute(sql`UPDATE students SET parent_user_id=${parentAccountId}, updated_at=NOW() WHERE id=${studentId}`);
              linkedStudentId = studentId;
            }
          }
        }

        // ── 3a. 기존 학생과 연결 ────────────────────────────────────
        if (!linkedStudentId && link_student_id) {
          const [existStudent] = await db.select({ id: studentsTable.id, swimming_pool_id: studentsTable.swimming_pool_id })
            .from(studentsTable).where(eq(studentsTable.id, link_student_id)).limit(1);

          if (existStudent && existStudent.swimming_pool_id === me.swimming_pool_id) {
            // parent_students 연결 (이미 있으면 skip)
            const existLink = await db.select({ id: parentStudentsTable.id })
              .from(parentStudentsTable)
              .where(and(
                eq(parentStudentsTable.parent_id, parentAccountId),
                eq(parentStudentsTable.student_id, existStudent.id),
              )).limit(1);

            if (!existLink.length) {
              const psId = genId("ps");
              await db.insert(parentStudentsTable).values({
                id: psId,
                parent_id: parentAccountId,
                student_id: existStudent.id,
                swimming_pool_id: me.swimming_pool_id,
                status: "approved",
                approved_by: req.user!.userId,
                approved_at: new Date(),
              });
            } else {
              // 기존 링크가 있으면 status를 approved로 업데이트
              await db.update(parentStudentsTable)
                .set({ status: "approved", approved_by: req.user!.userId, approved_at: new Date() })
                .where(eq(parentStudentsTable.id, existLink[0].id));
            }

            // student의 parent_user_id 업데이트
            await db.update(studentsTable)
              .set({ parent_user_id: parentAccountId, status: "active", updated_at: new Date() })
              .where(eq(studentsTable.id, existStudent.id));

            linkedStudentId = existStudent.id;
          }
        }

        // ── 3b. 신규 학생 생성 후 연결 ──────────────────────────────
        if (create_student && !linkedStudentId) {
          // 자녀 이름/출생년도: body에서 override하거나 request에서 추출
          const childrenList: Array<{ childName: string; childBirthYear: number | null }> =
            Array.isArray(request.children_requested) && request.children_requested.length > 0
              ? request.children_requested
              : [{ childName: request.child_name || request.parent_name, childBirthYear: request.child_birth_year || null }];

          // 첫 번째 자녀로 신규 학생 생성 (bodyChildName으로 override 가능)
          const studentName = bodyChildName?.trim() || childrenList[0]?.childName || request.parent_name;
          const birthYear = bodyChildBirthYear
            ? String(bodyChildBirthYear)
            : (childrenList[0]?.childBirthYear ? String(childrenList[0].childBirthYear) : null);

          const inviteCode = generateInviteCode();
          const newStudentId = genId("student");

          const [newStudent] = await db.insert(studentsTable).values({
            id: newStudentId,
            swimming_pool_id: me.swimming_pool_id,
            name: studentName,
            birth_year: birthYear,
            parent_name: request.parent_name,
            parent_phone: request.phone,
            parent_user_id: parentAccountId,
            registration_path: "parent_requested",
            status: "unregistered",
            weekly_count: 1,
            invite_code: inviteCode,
            assigned_class_ids: [],
            schedule_labels: null,
          }).returning();

          if (newStudent) {
            const psId = genId("ps");
            await db.insert(parentStudentsTable).values({
              id: psId,
              parent_id: parentAccountId,
              student_id: newStudentId,
              swimming_pool_id: me.swimming_pool_id,
              status: "approved",
              approved_by: req.user!.userId,
              approved_at: new Date(),
            });
            linkedStudentId = newStudentId;
          }
        }

        res.json({
          success: true,
          message: "승인되었습니다.",
          default_pin: !dupAcc.rows[0]?.id ? defaultPin : undefined,
          parent_account_id: parentAccountId,
          linked_student_id: linkedStudentId,
        });
      } else {
        // ── 거절 ────────────────────────────────────────────────────
        await superAdminDb.execute(sql`
          UPDATE parent_pool_requests
          SET request_status = 'rejected', processed_at = NOW(), processed_by = ${req.user!.userId},
              rejection_reason = ${rejection_reason || null}
          WHERE id = ${req.params.id}
        `);
        res.json({ success: true, message: "거절되었습니다." });
      }
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: "서버 오류" });
    }
  }
);

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

// ─── 공개: 학부모 본인 요청 상태 확인 (requestId로 조회) ──────────────────
router.get("/auth/parent-join-status/:id", async (req, res) => {
  try {
    const result = await superAdminDb.execute(sql`
      SELECT id, request_status, rejection_reason, processed_at
      FROM parent_pool_requests WHERE id = ${req.params.id} LIMIT 1
    `);
    if (!result.rows.length) { res.status(404).json({ success: false, message: "요청을 찾을 수 없습니다." }); return; }
    const row = result.rows[0] as any;
    res.json({ success: true, data: { status: row.request_status, rejectReason: row.rejection_reason, processedAt: row.processed_at } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "서버 오류" });
  }
});

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

export default router;
