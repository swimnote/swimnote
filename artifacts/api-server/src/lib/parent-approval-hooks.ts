/**
 * parent-approval-hooks.ts — 보호자 승인 후 소급 알림 처리
 *
 * 목적:
 *   새로 승인된 보호자가 승인 전에 발행된 성장리포트의 존재를
 *   앱 알림을 통해 알 수 있도록 notification을 소급 생성.
 *
 * 원칙:
 *   - parent_students COMMIT 이후 fire-and-forget으로만 호출
 *   - 실패해도 parent_students 승인 유지 (rollback 금지)
 *   - 이미 존재하는 notification → ON CONFLICT DO NOTHING (멱등)
 *   - Push는 신규 INSERT된 notification 중 최신 1건만
 *   - created_at = growth_reports.published_at (소급 날짜 보존)
 *
 * 호출 규칙:
 *   onParentApproved({ parentId, studentId, poolId })
 *     .catch(err => console.warn("[parent-approval-hook] failed:", err?.message));
 *
 * 금지:
 *   - await onParentApproved(...) — 승인 API 블로킹 금지
 *   - 로그에 parentId raw / report content / JWT 포함 금지
 */

import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { sendPushToUser } from "../lib/push-service.js";

// ─────────────────────────────────────────────────────────────────────────────
// onParentApproved — Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * onParentApproved — 보호자 승인 후 소급 성장리포트 알림 생성
 *
 * @param parentId   parent_accounts.id (방금 approved된 보호자)
 * @param studentId  parent_students.student_id
 * @param poolId     swimming_pools.id (cross-pool 보호용)
 */
export async function onParentApproved(params: {
  parentId:  string;
  studentId: string;
  poolId:    string;
}): Promise<void> {
  const { parentId, studentId, poolId } = params;

  // ── Step 1: DB 재확인 (cross-pool 보호, 이미 approved인지 검증) ──────────
  const verifyRes = await db.execute(sql`
    SELECT ps.id
    FROM parent_students ps
    INNER JOIN students s ON s.id = ps.student_id
    WHERE ps.parent_id       = ${parentId}
      AND ps.student_id      = ${studentId}
      AND ps.status          = 'approved'
      AND s.swimming_pool_id = ${poolId}
    LIMIT 1
  `);
  if (!verifyRes.rows.length) {
    console.warn(
      `[parent-approval-hook] 검증 실패 — 관계없거나 pool 불일치` +
      ` student=${studentId.slice(0, 8)} pool=${poolId}`,
    );
    return;
  }

  // ── Step 2: Set-based notification INSERT ────────────────────────────────
  //
  //  - created_at = gr.published_at  ← 소급 날짜 보존
  //    (승인일 NOW()로 만들면 알림함에 수십 개가 오늘 날짜로 노출됨)
  //  - id = 'notif_bf_' + MD5(report_id + '_' + parent_id)
  //    — (report, parent) 고유, 결정론적 ID (중복 INSERT 시도 불필요)
  //  - ON CONFLICT DO NOTHING — partial unique index 재사용 (DB migration 없음)
  //    index: uq_notifications_gr_published on (type, ref_id, recipient_id)
  //           WHERE type = 'GROWTH_REPORT_PUBLISHED'
  //  - published_at IS NULL → skip (PUBLISHED 정책 이상이므로 로그 후 제외)
  const insertRes = await db.execute(sql`
    INSERT INTO notifications (
      id, recipient_id, recipient_type, pool_id,
      type, title, body,
      ref_id, ref_type, deep_link,
      is_read, created_at
    )
    SELECT
      'notif_bf_' || LEFT(MD5(gr.id || '_' || ${parentId}), 22),
      ${parentId},
      'parent_account',
      gr.swimming_pool_id,
      'GROWTH_REPORT_PUBLISHED',
      '지난달 성장리포트가 도착했습니다',
      '지난 한 달 동안의 성장 모습을 확인해보세요.',
      gr.id,
      'growth_report',
      '/parent/growth-report-detail?reportId=' || gr.id,
      false,
      gr.published_at
    FROM growth_reports gr
    WHERE gr.student_id        = ${studentId}
      AND gr.swimming_pool_id  = ${poolId}
      AND gr.product_status    = 'PUBLISHED'
      AND gr.deleted_at   IS NULL
      AND gr.published_at IS NOT NULL
    ON CONFLICT (type, ref_id, recipient_id)
      WHERE type = 'GROWTH_REPORT_PUBLISHED'
    DO NOTHING
    RETURNING ref_id, created_at
  `);

  const inserted = insertRes.rows as Array<{ ref_id: string; created_at: string | Date }>;
  const insertedCount = inserted.length;

  console.log(
    `[parent-approval-hook] student=${studentId.slice(0, 8)} ` +
    `pool=${poolId} inserted=${insertedCount}`,
  );

  // ── Step 3: 신규 INSERT 0건 → push 없음 ──────────────────────────────────
  //   ON CONFLICT로 모두 skip됐으면 재승인/API retry → push 중복 금지
  if (insertedCount === 0) return;

  // ── Step 4: 최신 published_at 기준 1건만 push ────────────────────────────
  //   과거 전체에 push 보내면 알림 spam → 최신 1건만
  //   push 문구: "지난달 성장리포트가 도착했습니다"가 아닌 소급 전용 문구
  const latest = inserted.reduce((a, b) =>
    new Date(a.created_at) > new Date(b.created_at) ? a : b,
  );

  const PUSH_TITLE = "확인할 수 있는 성장리포트가 있습니다";
  const PUSH_BODY  = "아이의 성장리포트를 SWIMNOTE에서 확인해보세요.";
  const deepLink   = `/parent/growth-report-detail?reportId=${latest.ref_id}`;

  await sendPushToUser(
    parentId, true, "GROWTH_REPORT_PUBLISHED",
    PUSH_TITLE, PUSH_BODY,
    {
      screen:           "growth_report_detail",
      growth_report_id: latest.ref_id,
      deep_link:        deepLink,
    },
    null,
  ).catch((err: unknown) => {
    // Push 실패해도 notification INSERT는 유지 (정상 처리로 간주)
    console.warn(
      `[parent-approval-hook] push 실패 (notification 유지)` +
      ` inserted=${insertedCount} err=${(err as any)?.message ?? String(err)}`,
    );
  });
}
