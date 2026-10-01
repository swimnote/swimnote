import { db, superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  checkPushEnabled,
  sendPushToUser,
  sendPushToSuperAdmins,
  sendRawPushWithResult,
} from "../lib/push-service.js";
import {
  KnownGrowthReportPushRejection,
  UncertainGrowthReportPushError,
  notifyGrowthReportAdminsReady,
  notifyGrowthReportParentsPublished,
  recoverPublishedGrowthReportNotificationIntents,
  retryPendingGrowthReportNotifications,
  type GrowthReportNotification,
} from "./growth-report-notification-outbox.js";

async function deliverGrowthReportPush(
  item: GrowthReportNotification,
): Promise<void | { providerReceiptId?: string }> {
  const isParent = item.recipientType === "parent_account";
  if (!await checkPushEnabled(item.recipientId, item.type, isParent)) return;

  const tokenColumn = isParent ? sql.raw("parent_account_id") : sql.raw("user_id");
  const tokenRows = await db.execute(sql`
    SELECT DISTINCT token
    FROM push_tokens
    WHERE ${tokenColumn} = ${item.recipientId}
      AND token IS NOT NULL
      AND token != ''
  `);
  const tokens = (tokenRows.rows as Array<{ token: string }>).map(row => row.token);
  if (tokens.length === 0) return;

  const result = await sendRawPushWithResult(
    tokens,
    item.title,
    item.body,
    item.payload ?? {},
    { disableTransportRetries: true },
    item.poolId,
    item.reportId ?? `${item.poolId}:${item.reportPeriod}`,
  );
  if (result.failureCount > 0) {
    if (
      result.successCount === 0 &&
      result.definitiveRejectionCount === result.failureCount
    ) {
      throw new KnownGrowthReportPushRejection("Push provider explicitly rejected all tokens");
    }
    // Partial/error counts may include accepted devices. Preserve any Expo
    // ticket ids and never blindly retry the whole account fan-out.
    const providerReceiptId = result.providerReceiptIds.length > 0
      ? JSON.stringify(result.providerReceiptIds)
      : undefined;
    throw new UncertainGrowthReportPushError(
      "Push outcome has partial or ambiguous provider acceptance; reconcile before retry",
      providerReceiptId,
    );
  }
  return result.providerReceiptIds.length > 0
    ? { providerReceiptId: JSON.stringify(result.providerReceiptIds) }
    : undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Super Admin Notification — 슈퍼 어드민 전용 알림 (5종)
// ─────────────────────────────────────────────────────────────────────────────

export type SuperAdminNotifType =
  | "POOL_SIGNUP"          // 수영장 신규 가입
  | "INQUIRY_RECEIVED"     // 문의사항 접수
  | "X_TRIAL_STARTED"      // X 무료체험 시작
  | "PAID_PLAN_ACTIVATED"  // 유료 플랜 결제 성공
  | "CURRICULUM_UPLOADED"; // 커리큘럼 파일 업로드

/**
 * notifySuperAdmin — super_admin_notifications에 알림 삽입 (fire-and-forget)
 *
 * 중복 방지: idempotency_key UNIQUE. 같은 키로 두 번 호출 시 두 번째는 무시.
 */
export async function notifySuperAdmin(params: {
  type: SuperAdminNotifType;
  title: string;
  body?: string;
  poolId?: string | null;
  refId?: string | null;
  refType?: string | null;
  /** 멱등성 키 (같은 이벤트 중복 방지). 미전달 시 자동 생성 (dedup 없음). */
  idempotencyKey?: string;
}): Promise<void> {
  try {
    const { type, title, body = "", poolId, refId, refType, idempotencyKey } = params;
    const id = `san_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const ikey = idempotencyKey ?? null;

    await superAdminDb.execute(sql`
      INSERT INTO super_admin_notifications
        (id, type, title, body, pool_id, ref_id, ref_type, is_read, idempotency_key, created_at)
      VALUES
        (${id}, ${type}, ${title}, ${body}, ${poolId ?? null}, ${refId ?? null},
         ${refType ?? null}, FALSE, ${ikey}, NOW())
      ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL
      DO NOTHING
    `);

    // 앱 push (fire-and-forget, 실패해도 DB 저장은 유지)
    sendPushToSuperAdmins(title, body || title, { type, pool_id: poolId ?? undefined, ref_id: refId ?? undefined })
      .catch(e => console.error("[notifySuperAdmin] push 오류:", e));
  } catch (err) {
    console.error("[notifySuperAdmin] 오류:", err);
  }
}

interface NotifPayload {
  recipientId:   string;
  recipientType: "parent_account" | "user";
  poolId:        string;
  type: "diary_upload" | "photo_upload" | "photo_comment" | "diary_comment" | "storage_warning" | "GROWTH_REPORT_PUBLISHED";
  title:    string;
  body:     string;
  refId?:   string;
  refType?: string;
  deepLink?: string;
}

/**
 * 중복 알림 방지: 같은 (type, refId, recipientId) 조합이 1시간 내에 존재하면 생략
 */
async function isDuplicate(type: string, refId: string | undefined, recipientId: string): Promise<boolean> {
  if (!refId) return false;
  const rows = await db.execute(sql`
    SELECT 1 FROM notifications
    WHERE type = ${type}
      AND ref_id = ${refId}
      AND recipient_id = ${recipientId}
      AND created_at > now() - interval '1 hour'
    LIMIT 1
  `);
  return rows.rows.length > 0;
}

export async function sendNotification(payload: NotifPayload): Promise<void> {
  try {
    if (await isDuplicate(payload.type, payload.refId, payload.recipientId)) return;
    const id = `notif_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    await db.execute(sql`
      INSERT INTO notifications
        (id, recipient_id, recipient_type, pool_id, type, title, body, ref_id, ref_type, deep_link)
      VALUES (
        ${id}, ${payload.recipientId}, ${payload.recipientType},
        ${payload.poolId}, ${payload.type},
        ${payload.title}, ${payload.body},
        ${payload.refId || null}, ${payload.refType || null},
        ${payload.deepLink || null}
      )
    `);
  } catch (err) {
    console.error("[notify] 알림 생성 오류:", err);
  }
}

/** 수영일지 업로드 → 해당 그룹 학부모들에게 알림 */
export async function notifyDiaryUpload(poolId: string, classGroupId: string, diaryId: string, title: string): Promise<void> {
  try {
    const parents = await db.execute(sql`
      SELECT DISTINCT ps.parent_id
      FROM parent_students ps
      JOIN students s ON s.id = ps.student_id
      WHERE s.class_group_id = ${classGroupId}
        AND ps.status = 'approved'
    `);
    const promises = (parents.rows as any[]).map(p =>
      sendNotification({
        recipientId: p.parent_id,
        recipientType: "parent_account",
        poolId,
        type: "diary_upload",
        title: "새 수영 일지가 등록됐어요",
        body: title,
        refId: diaryId,
        refType: "diary",
      })
    );
    await Promise.allSettled(promises);
  } catch (err) { console.error("[notify] diary upload 알림 오류:", err); }
}

/** 개별 사진 업로드 → 해당 학생 학부모에게 알림 */
export async function notifyPhotoUpload(poolId: string, studentId: string, studentName: string, count: number): Promise<void> {
  try {
    const parents = await db.execute(sql`
      SELECT parent_id FROM parent_students
      WHERE student_id = ${studentId} AND status = 'approved'
    `);
    const promises = (parents.rows as any[]).map(p =>
      sendNotification({
        recipientId: p.parent_id,
        recipientType: "parent_account",
        poolId,
        type: "photo_upload",
        title: "새 사진이 업로드됐어요",
        body: `${studentName} 학생의 사진첩에 ${count}장이 새로 추가됐습니다`,
        refId: studentId,
        refType: "student",
      })
    );
    await Promise.allSettled(promises);
  } catch (err) { console.error("[notify] photo upload 알림 오류:", err); }
}

/**
 * 저장 공간 80% 경고 → 수영장 관리자(pool_admin)에게 알림
 * 24시간 내 동일 수영장 경고 재발송 방지
 */
export async function notifyStorageWarning(poolId: string, usagePercent: number): Promise<void> {
  try {
    const dup = await db.execute(sql`
      SELECT 1 FROM notifications
      WHERE type = 'storage_warning' AND pool_id = ${poolId}
        AND created_at > now() - interval '24 hours'
      LIMIT 1
    `);
    if (dup.rows.length > 0) return;

    const admins = await db.execute(sql`
      SELECT id FROM users WHERE swimming_pool_id = ${poolId} AND role = 'pool_admin'
    `);
    const pct = Math.round(usagePercent);
    await db.execute(sql`
      UPDATE swimming_pools SET storage_warning_sent_at = now() WHERE id = ${poolId}
    `);
    const promises = (admins.rows as any[]).map(a =>
      sendNotification({
        recipientId: a.id, recipientType: "user", poolId,
        type: "storage_warning",
        title: "사진 저장 공간 부족 경고",
        body: `사진 저장 공간 사용량이 ${pct}%에 도달했습니다. 용량 초과 시 추가 업로드가 제한될 수 있습니다.`,
        refId: poolId, refType: "pool",
      })
    );
    await Promise.allSettled(promises);
  } catch (err) { console.error("[notify] storage warning 오류:", err); }
}

/**
 * 업로드 후 호출 — 사용량 ≥ 80% 이면 경고 발송
 */
export async function checkStorageUsage(poolId: string): Promise<void> {
  try {
    const usageResult = await db.execute(sql`
      SELECT COALESCE(SUM(file_size_bytes), 0) AS total_bytes
      FROM student_photos WHERE swimming_pool_id = ${poolId}
    `);
    const totalBytes = Number((usageResult.rows[0] as any)?.total_bytes ?? 0);

    const cntResult = await db.execute(sql`
      SELECT COUNT(*) AS cnt FROM students
      WHERE swimming_pool_id = ${poolId} AND status = 'active'
    `);
    const memberCount = Number((cntResult.rows[0] as any)?.cnt ?? 0);

    const [poolRow] = (await db.execute(sql`
      SELECT approval_status FROM swimming_pools WHERE id = ${poolId} LIMIT 1
    `)).rows as any[];
    if (poolRow?.approval_status !== "approved") return;

    let tier = "free";
    if      (memberCount > 1000) tier = "paid_enterprise";
    else if (memberCount > 500)  tier = "paid_1000";
    else if (memberCount > 300)  tier = "paid_500";
    else if (memberCount > 100)  tier = "paid_300";
    else if (memberCount > 50)   tier = "paid_100";

    const policyResult = await db.execute(sql`
      SELECT quota_gb FROM storage_policy WHERE tier = ${tier} LIMIT 1
    `);
    const quotaGb  = Number((policyResult.rows[0] as any)?.quota_gb ?? 5);
    const quotaBytes = quotaGb * 1024 * 1024 * 1024;
    const usagePct  = (totalBytes / quotaBytes) * 100;

    if (usagePct >= 80) await notifyStorageWarning(poolId, usagePct);
  } catch (err) { console.error("[notify] storage usage check 오류:", err); }
}

/**
 * GR7: Growth Report PUBLISHED → 해당 student의 승인된 학부모들에게 알림 + Push 발송
 *
 * 원칙:
 *   - PUBLISHED 이후에만 호출 (DB commit 완료 후 fire-and-forget)
 *   - 멱등성: 동일 (type, ref_id=reportId, recipient_id=parentId) 존재 시 skip (영구 dedup)
 *   - 다중 보호자: parent_students DISTINCT parent_id로 deduplicate
 *   - Push preference: sendPushToUser가 기존 push_settings ON/OFF 확인
 *   - PII 금지: push body에 분석 내용 없음, 정적 Product 문구만 사용
 *   - ENGINE 호출 금지, GPT 호출 금지
 *   - Notification center 저장 (ref_id=reportId, ref_type='growth_report')
 */
export async function notifyGrowthReportPublished(params: {
  reportId:     string;
  studentId:    string;
  poolId:       string;
  reportPeriod: string; // e.g. "2026-07"
  publishedAt?: string;
  actorId?:     string;
}): Promise<void> {
  await notifyGrowthReportParentsPublished(
    db,
    params,
    deliverGrowthReportPush,
  );
}

/**
 * 댓글 작성 알림 → 해당 수영장의 선생님(teacher)에게만 전송
 * 관리자(pool_admin)는 댓글 알림 수신 불필요
 */
// ─────────────────────────────────────────────────────────────────────────────
// Paid Insight Notifications
// ─────────────────────────────────────────────────────────────────────────────

/**
 * notifyPaidInsightLevelUp
 *
 * Sent when a teacher confirms a student's level-up event.
 * Mentions Paid Insight as a way to see the growth analysis — NOT a sales push.
 *
 * Idempotency: (type, ref_id=levelEventId, recipient_id=parentId) — unique per event.
 * Duplicate: 0 per event per parent.
 */
export async function notifyPaidInsightLevelUp(params: {
  studentId:    string;
  studentName:  string;
  poolId:       string;
  levelEventId: string; // opaque ref_id for idempotency
  actorId:      string;
}): Promise<void> {
  const { studentId, studentName, poolId, levelEventId, actorId } = params;
  const TYPE = "PAID_INSIGHT_LEVEL_UP" as const;

  const title    = `${studentName}이(가) 새로운 레벨로 성장했어요`;
  const body     = "지금까지의 성장과 다음 단계 전략을 AI 인사이트 전략 리포트에서 확인할 수 있어요.";
  const deepLink = `/parent/growth-report-paid?studentId=${studentId}`;

  let parentIds: string[] = [];
  try {
    const pr = (await db.execute(sql`
      SELECT DISTINCT parent_id
      FROM parent_students
      WHERE student_id = ${studentId}
        AND status     = 'approved'
    `)).rows as any[];
    parentIds = pr.map(r => r.parent_id).filter(Boolean);
  } catch (err) {
    console.error("[notify] PAID_INSIGHT_LEVEL_UP parent fetch failed:", err);
    return;
  }

  for (const parentId of parentIds) {
    try {
      const dup = (await db.execute(sql`
        SELECT 1 FROM notifications
        WHERE type         = ${TYPE}
          AND ref_id       = ${levelEventId}
          AND recipient_id = ${parentId}
        LIMIT 1
      `)).rows;
      if (dup.length > 0) continue;

      const id = `notif_pi_lv_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      const insertRes = await db.execute(sql`
        INSERT INTO notifications
          (id, recipient_id, recipient_type, pool_id, type, title, body, ref_id, ref_type, deep_link, is_read)
        VALUES
          (${id}, ${parentId}, 'parent_account', ${poolId},
           ${TYPE}, ${title}, ${body},
           ${levelEventId}, 'level_event', ${deepLink}, false)
        ON CONFLICT DO NOTHING
        RETURNING id
      `);
      if (!insertRes.rows.length) continue;

      await sendPushToUser(
        parentId, true, TYPE, title, body,
        { screen: "paid_insight", student_id: studentId, deep_link: deepLink },
        actorId,
      ).catch(err => console.error(`[notify] PAID_INSIGHT_LEVEL_UP push failed parent=${parentId}:`, err));

      console.log(`[notify] PAID_INSIGHT_LEVEL_UP created: event=${levelEventId} parent=${parentId}`);
    } catch (err) {
      console.error(`[notify] PAID_INSIGHT_LEVEL_UP failed parent=${parentId}:`, err);
    }
  }
}

/**
 * notifyPaidInsightWithdrawal
 *
 * Sent when a student is withdrawn. Offers Paid Insight as a way to preserve
 * the growth record — NOT a discount, NOT a sales push.
 *
 * Idempotency: (type, ref_id=studentId, recipient_id=parentId) — once per student per parent.
 */
export async function notifyPaidInsightWithdrawal(params: {
  studentId:   string;
  studentName: string;
  poolId:      string;
  actorId:     string;
}): Promise<void> {
  const { studentId, studentName, poolId, actorId } = params;
  const TYPE = "PAID_INSIGHT_WITHDRAWAL" as const;

  const title    = "그동안의 성장기록이 쌓여 있어요";
  const body     = `${studentName}의 그동안 쌓인 성장과정을 마지막 인사이트 리포트로 남겨보세요.`;
  const deepLink = `/parent/growth-report-paid?studentId=${studentId}`;

  let parentIds: string[] = [];
  try {
    const pr = (await db.execute(sql`
      SELECT DISTINCT parent_id
      FROM parent_students
      WHERE student_id = ${studentId}
        AND status     = 'approved'
    `)).rows as any[];
    parentIds = pr.map(r => r.parent_id).filter(Boolean);
  } catch (err) {
    console.error("[notify] PAID_INSIGHT_WITHDRAWAL parent fetch failed:", err);
    return;
  }

  for (const parentId of parentIds) {
    try {
      const dup = (await db.execute(sql`
        SELECT 1 FROM notifications
        WHERE type         = ${TYPE}
          AND ref_id       = ${studentId}
          AND recipient_id = ${parentId}
        LIMIT 1
      `)).rows;
      if (dup.length > 0) continue;

      const id = `notif_pi_wd_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      const insertRes = await db.execute(sql`
        INSERT INTO notifications
          (id, recipient_id, recipient_type, pool_id, type, title, body, ref_id, ref_type, deep_link, is_read)
        VALUES
          (${id}, ${parentId}, 'parent_account', ${poolId},
           ${TYPE}, ${title}, ${body},
           ${studentId}, 'student', ${deepLink}, false)
        ON CONFLICT DO NOTHING
        RETURNING id
      `);
      if (!insertRes.rows.length) continue;

      await sendPushToUser(
        parentId, true, TYPE, title, body,
        { screen: "paid_insight", student_id: studentId, deep_link: deepLink },
        actorId,
      ).catch(err => console.error(`[notify] PAID_INSIGHT_WITHDRAWAL push failed parent=${parentId}:`, err));

      console.log(`[notify] PAID_INSIGHT_WITHDRAWAL created: student=${studentId} parent=${parentId}`);
    } catch (err) {
      console.error(`[notify] PAID_INSIGHT_WITHDRAWAL failed parent=${parentId}:`, err);
    }
  }
}

export async function notifyComment(
  poolId: string,
  type: "photo_comment" | "diary_comment",
  commenterName: string,
  refId: string,
  refLabel: string
): Promise<void> {
  try {
    // teacher 역할만 알림 수신 (pool_admin 제외)
    const teachers = await db.execute(sql`
      SELECT id FROM users
      WHERE swimming_pool_id = ${poolId}
        AND role = 'teacher'
    `);
    const typeLabel = type === "photo_comment" ? "사진" : "수영 일지";
    const promises = (teachers.rows as any[]).map(t =>
      sendNotification({
        recipientId: t.id,
        recipientType: "user",
        poolId,
        type,
        title: `${typeLabel}에 댓글이 달렸어요`,
        body: `${commenterName}님이 ${refLabel}에 댓글을 남겼습니다`,
        refId,
        refType: type === "photo_comment" ? "photo" : "diary",
      })
    );
    await Promise.allSettled(promises);
  } catch (err) { console.error("[notify] comment 알림 오류:", err); }
}

// ─────────────────────────────────────────────────────────────────────────────
// notifyBatchComplete — WP8: admin pool_admin 발송 준비 완료 알림
// ─────────────────────────────────────────────────────────────────────────────

export async function notifyBatchComplete(params: {
  poolId:  string;
  reportPeriod: string;
  message: string;
  readiness?: Record<string, number>;
}): Promise<void> {
  await notifyGrowthReportAdminsReady(
    db,
    params,
    deliverGrowthReportPush,
  );
}

/** Queue sweeper used by the monthly worker to retry provider failures/reclaim leases. */
export async function retryGrowthReportNotificationOutbox(limit = 100): Promise<number> {
  await recoverPublishedGrowthReportNotificationIntents(
    db,
    deliverGrowthReportPush,
    Math.max(1, Math.min(200, limit)),
  );
  return retryPendingGrowthReportNotifications(
    db,
    deliverGrowthReportPush,
    limit,
  );
}
