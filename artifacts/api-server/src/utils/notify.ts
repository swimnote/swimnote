import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { sendPushToUser } from "../lib/push-service.js";

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
  publishedAt:  string;
  actorId:      string;
}): Promise<void> {
  const { reportId, studentId, poolId, reportPeriod, actorId } = params;

  // 학생 이름 조회 (PII 최소: 이름만, 진단/분석 내용 금지)
  let studentName = "학생";
  try {
    const sr = (await db.execute(sql`
      SELECT name FROM students WHERE id = ${studentId} LIMIT 1
    `)).rows as any[];
    if (sr.length > 0 && sr[0].name) studentName = sr[0].name;
  } catch { /* 이름 조회 실패는 무시 — 기본값 "학생" 사용 */ }

  // report_period → "M월" (e.g. "2026-07" → "7월")
  const month = parseInt(reportPeriod.split("-")[1] ?? "1", 10);
  const monthLabel = `${month}월`;

  // Product 문구 (정적, ENGINE 해석/GPT 생성 금지)
  // §I 정책: "지난달 성장리포트가 도착했습니다" / "지난 한 달 동안의 성장 모습을 확인해보세요."
  const title    = "지난달 성장리포트가 도착했습니다";
  const body     = "지난 한 달 동안의 성장 모습을 확인해보세요.";
  const deepLink = `/parent/growth-report-detail?reportId=${reportId}`;

  // 승인된 보호자 조회 (DISTINCT — 중복 relation 방어)
  let parentIds: string[] = [];
  try {
    const parentRows = (await db.execute(sql`
      SELECT DISTINCT parent_id
      FROM parent_students
      WHERE student_id = ${studentId}
        AND status = 'approved'
    `)).rows as any[];
    parentIds = parentRows.map(r => r.parent_id).filter(Boolean);
  } catch (err) {
    console.error("[notify] GR7 parent_students 조회 실패:", err);
    return;
  }

  for (const parentId of parentIds) {
    try {
      // 영구 멱등성: 동일 (type, ref_id, recipient_id) 이미 존재 시 skip (시간 제한 없음)
      const dup = (await db.execute(sql`
        SELECT 1 FROM notifications
        WHERE type = 'GROWTH_REPORT_PUBLISHED'
          AND ref_id = ${reportId}
          AND recipient_id = ${parentId}
        LIMIT 1
      `)).rows;
      if (dup.length > 0) continue;

      // Notification Center에 저장 (GR7 §13)
      const id = `notif_gr_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      await db.execute(sql`
        INSERT INTO notifications
          (id, recipient_id, recipient_type, pool_id, type, title, body,
           ref_id, ref_type, deep_link, is_read)
        VALUES
          (${id}, ${parentId}, 'parent_account', ${poolId},
           'GROWTH_REPORT_PUBLISHED', ${title}, ${body},
           ${reportId}, 'growth_report', ${deepLink}, false)
      `);

      // Push delivery (기존 preference 정책 존중 — sendPushToUser가 ON/OFF 확인)
      await sendPushToUser(
        parentId, true, "GROWTH_REPORT_PUBLISHED", title, body,
        {
          screen:           "growth_report_detail",
          growth_report_id: reportId,
          report_period:    reportPeriod,
          deep_link:        deepLink,
        },
        actorId,
      ).catch(err => {
        // Push 실패는 Notification Center 저장에 영향 없음 (spec §17)
        console.error(`[notify] GR7 push failed parent=${parentId}:`, err);
      });

      console.log(`[notify] GR7 notification created: report=${reportId} parent=${parentId}`);
    } catch (err) {
      // 개별 parent 실패는 다른 parent에 영향 없음
      console.error(`[notify] GR7 notification failed parent=${parentId}:`, err);
    }
  }
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
