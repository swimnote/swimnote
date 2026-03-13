import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

interface NotifPayload {
  recipientId: string;
  recipientType: "parent_account" | "user";
  poolId: string;
  type: "diary_upload" | "photo_upload" | "photo_comment" | "diary_comment";
  title: string;
  body: string;
  refId?: string;
  refType?: string;
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
      INSERT INTO notifications (id, recipient_id, recipient_type, pool_id, type, title, body, ref_id, ref_type)
      VALUES (
        ${id}, ${payload.recipientId}, ${payload.recipientType},
        ${payload.poolId}, ${payload.type},
        ${payload.title}, ${payload.body},
        ${payload.refId || null}, ${payload.refType || null}
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
        title: "📦 사진 저장 공간 부족 경고",
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
 * 댓글 작성 알림 → 해당 수영장의 선생님(teacher)에게만 전송
 * 관리자(pool_admin)는 댓글 알림 수신 불필요
 */
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
