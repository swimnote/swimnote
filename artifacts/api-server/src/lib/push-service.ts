/**
 * push-service.ts — 중앙화된 Expo 푸시 알림 서비스
 *
 * 제공 함수:
 *  - sendRawPush(tokens, title, body, data) — Expo API 직접 호출
 *  - checkPushEnabled(userId, notifType) — 유저 ON/OFF 설정 확인
 *  - sendPushToUser(userId, role, notifType, title, body, data) — 유저 1명
 *  - sendPushToClassParents(classId, notifType, title, body, data) — 반 학부모 전체
 *  - sendPushToPoolAdmins(poolId, notifType, title, body, data) — 수영장 관리자
 *  - sendPushToPoolTeachers(poolId, notifType, title, body, data) — 수영장 선생님 전체
 *  - initPushTables() — DB 테이블 자동 생성
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

// ── Expo Push API ────────────────────────────────────────────────────
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: "default" | null;
  badge?: number;
}

/** Expo Push API로 실제 발송 */
export async function sendRawPush(
  tokens: string[],
  title: string,
  body: string,
  data: Record<string, unknown> = {}
): Promise<void> {
  if (!tokens.length) return;
  const messages: PushMessage[] = tokens.map(to => ({
    to, title, body, data, sound: "default",
  }));
  try {
    await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(messages),
    });
  } catch (e) {
    console.error("[push-service] Expo API 오류:", e);
  }
}

// ── 푸시 설정 ON/OFF 확인 ────────────────────────────────────────────

/**
 * 특정 유저(user_id 또는 parent_account_id)의 알림 타입 ON/OFF 조회
 * 설정 없으면 기본값 true(활성화)
 */
export async function checkPushEnabled(
  userId: string,
  notifType: string,
  isParent = false
): Promise<boolean> {
  try {
    const col = isParent ? "parent_account_id" : "user_id";
    const rows = await db.execute(sql`
      SELECT is_enabled FROM push_settings
      WHERE ${sql.raw(col)} = ${userId}
        AND notification_type = ${notifType}
      LIMIT 1
    `);
    if (!rows.rows.length) return true; // 기본값: 활성화
    return Boolean((rows.rows[0] as any).is_enabled);
  } catch {
    return true;
  }
}

/** 토큰 조회 (user_id) */
async function getTokensByUserId(userId: string): Promise<string[]> {
  const rows = await db.execute(sql`
    SELECT DISTINCT token FROM push_tokens
    WHERE user_id = ${userId} AND token IS NOT NULL AND token != ''
  `);
  return (rows.rows as any[]).map(r => r.token).filter(Boolean);
}

/** 토큰 조회 (parent_account_id) */
async function getTokensByParentId(parentId: string): Promise<string[]> {
  const rows = await db.execute(sql`
    SELECT DISTINCT token FROM push_tokens
    WHERE parent_account_id = ${parentId} AND token IS NOT NULL AND token != ''
  `);
  return (rows.rows as any[]).map(r => r.token).filter(Boolean);
}

// ── 푸시 로그 기록 ────────────────────────────────────────────────────
async function logPush(
  targetUserId: string,
  role: string,
  type: string,
  status: "sent" | "skipped" | "failed",
  message: string,
  triggeredBy?: string
): Promise<void> {
  try {
    const id = `pl_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    await db.execute(sql`
      INSERT INTO push_logs (id, target_user_id, role, type, status, message, triggered_by, created_at)
      VALUES (${id}, ${targetUserId}, ${role}, ${type}, ${status}, ${message}, ${triggeredBy || null}, now())
      ON CONFLICT DO NOTHING
    `);
  } catch { /* 로그 실패는 무시 */ }
}

// ── 단일 유저 푸시 발송 ────────────────────────────────────────────────

/**
 * 유저 1명에게 푸시 발송 (settings ON/OFF 확인)
 * @param userId user_id (teachers, admins) 또는 parent_account_id (parents)
 * @param isParent true면 parent_account_id 기준
 */
export async function sendPushToUser(
  userId: string,
  isParent: boolean,
  notifType: string,
  title: string,
  body: string,
  data: Record<string, unknown> = {},
  triggeredBy?: string
): Promise<void> {
  try {
    const enabled = await checkPushEnabled(userId, notifType, isParent);
    if (!enabled) {
      await logPush(userId, isParent ? "parent" : "user", notifType, "skipped", `${notifType} OFF`, triggeredBy);
      return;
    }
    const tokens = isParent
      ? await getTokensByParentId(userId)
      : await getTokensByUserId(userId);
    if (!tokens.length) return;
    await sendRawPush(tokens, title, body, data);
    await logPush(userId, isParent ? "parent" : "user", notifType, "sent", body, triggeredBy);
  } catch (e) {
    console.error("[push-service] sendPushToUser 오류:", e);
  }
}

// ── 반 학부모 전체 푸시 ───────────────────────────────────────────────

/**
 * 특정 반(classId)의 학부모 전원에게 푸시 발송
 * 각 학부모의 개별 설정(notifType ON/OFF) 확인 후 발송
 */
export async function sendPushToClassParents(
  classId: string,
  notifType: string,
  title: string,
  body: string,
  data: Record<string, unknown> = {},
  triggeredBy?: string,
  skipIfDiaryRecentlySent = false
): Promise<void> {
  try {
    if (skipIfDiaryRecentlySent) {
      // 5분 내 diary_upload 푸시가 이미 발송된 경우 skip
      const recent = await db.execute(sql`
        SELECT id FROM push_logs
        WHERE triggered_by = ${triggeredBy || ""}
          AND type = 'diary_upload'
          AND status = 'sent'
          AND created_at > now() - interval '5 minutes'
        LIMIT 1
      `);
      if (recent.rows.length > 0) return;
    }

    // 이 반의 승인된 학부모 목록
    const parentRows = await db.execute(sql`
      SELECT DISTINCT ps.parent_id AS parent_account_id
      FROM students s
      JOIN parent_students ps ON ps.student_id = s.id AND ps.status = 'approved'
      WHERE s.class_group_id = ${classId} AND s.status != 'deleted'
    `);

    for (const p of parentRows.rows as any[]) {
      const pid = p.parent_account_id;
      const enabled = await checkPushEnabled(pid, notifType, true);
      if (!enabled) continue;
      const tokens = await getTokensByParentId(pid);
      if (!tokens.length) continue;
      await sendRawPush(tokens, title, body, data);
      await logPush(pid, "parent", notifType, "sent", body, triggeredBy);
    }
  } catch (e) {
    console.error("[push-service] sendPushToClassParents 오류:", e);
  }
}

// ── 수영장 학부모 전체 푸시 ───────────────────────────────────────────

/**
 * 특정 수영장(poolId)의 학부모 전원에게 푸시 발송
 */
export async function sendPushToPoolParents(
  poolId: string,
  notifType: string,
  title: string,
  body: string,
  data: Record<string, unknown> = {},
  triggeredBy?: string
): Promise<void> {
  try {
    const parentRows = await db.execute(sql`
      SELECT DISTINCT pa.id AS parent_account_id
      FROM parent_accounts pa
      WHERE pa.swimming_pool_id = ${poolId}
    `);
    for (const p of parentRows.rows as any[]) {
      const pid = p.parent_account_id;
      const enabled = await checkPushEnabled(pid, notifType, true);
      if (!enabled) continue;
      const tokens = await getTokensByParentId(pid);
      if (!tokens.length) continue;
      await sendRawPush(tokens, title, body, data);
      await logPush(pid, "parent", notifType, "sent", body, triggeredBy);
    }
  } catch (e) {
    console.error("[push-service] sendPushToPoolParents 오류:", e);
  }
}

// ── 수영장 관리자 푸시 ───────────────────────────────────────────────

/**
 * 특정 수영장(poolId)의 관리자에게 푸시 발송
 * notifType이 'subscription' | 'billing'이면 ON/OFF 무관 항상 발송
 */
export async function sendPushToPoolAdmins(
  poolId: string,
  notifType: string,
  title: string,
  body: string,
  data: Record<string, unknown> = {},
  triggeredBy?: string
): Promise<void> {
  try {
    const alwaysSend = ["subscription", "billing"].includes(notifType);
    const adminRows = await db.execute(sql`
      SELECT id FROM users
      WHERE swimming_pool_id = ${poolId}
        AND role IN ('pool_admin', 'sub_admin')
        AND deleted_at IS NULL
    `);
    for (const a of adminRows.rows as any[]) {
      const uid = a.id;
      if (!alwaysSend) {
        const enabled = await checkPushEnabled(uid, notifType, false);
        if (!enabled) continue;
      }
      const tokens = await getTokensByUserId(uid);
      if (!tokens.length) continue;
      await sendRawPush(tokens, title, body, data);
      await logPush(uid, "admin", notifType, "sent", body, triggeredBy);
    }
  } catch (e) {
    console.error("[push-service] sendPushToPoolAdmins 오류:", e);
  }
}

// ── 수영장 선생님 전체 푸시 ──────────────────────────────────────────

export async function sendPushToPoolTeachers(
  poolId: string,
  notifType: string,
  title: string,
  body: string,
  data: Record<string, unknown> = {},
  triggeredBy?: string
): Promise<void> {
  try {
    const teacherRows = await db.execute(sql`
      SELECT id FROM users
      WHERE swimming_pool_id = ${poolId}
        AND role = 'teacher'
        AND deleted_at IS NULL
    `);
    for (const t of teacherRows.rows as any[]) {
      const uid = t.id;
      const enabled = await checkPushEnabled(uid, notifType, false);
      if (!enabled) continue;
      const tokens = await getTokensByUserId(uid);
      if (!tokens.length) continue;
      await sendRawPush(tokens, title, body, data);
      await logPush(uid, "teacher", notifType, "sent", body, triggeredBy);
    }
  } catch (e) {
    console.error("[push-service] sendPushToPoolTeachers 오류:", e);
  }
}

// ── DB 테이블 자동 생성 ───────────────────────────────────────────────

export async function initPushTables(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS push_settings (
        id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        user_id          TEXT,
        parent_account_id TEXT,
        notification_type TEXT NOT NULL,
        is_enabled       BOOLEAN NOT NULL DEFAULT true,
        updated_at       TIMESTAMPTZ DEFAULT now()
      )
    `);
    // 부분 유니크 인덱스 (PostgreSQL UNIQUE 제약은 NULL을 다르게 처리하므로 partial index 사용)
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS push_settings_user_uniq
        ON push_settings (user_id, notification_type) WHERE user_id IS NOT NULL
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS push_settings_parent_uniq
        ON push_settings (parent_account_id, notification_type) WHERE parent_account_id IS NOT NULL
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS pool_push_settings (
        id                     TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        pool_id                TEXT NOT NULL UNIQUE,
        prev_day_push_time     TEXT NOT NULL DEFAULT '20:00',
        same_day_push_offset   INTEGER NOT NULL DEFAULT 1,
        tpl_notice             TEXT DEFAULT '📢 새 공지사항이 등록되었습니다.',
        tpl_prev_day           TEXT DEFAULT '📅 내일 수업이 있습니다. 준비하세요!',
        tpl_same_day           TEXT DEFAULT '⏰ 오늘 수업 {offset}시간 전입니다.',
        tpl_diary              TEXT DEFAULT '📒 새 수업 일지가 작성되었습니다.',
        tpl_photo              TEXT DEFAULT '📸 새 사진이 업로드되었습니다.',
        updated_at             TIMESTAMPTZ DEFAULT now()
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS push_logs (
        id              TEXT PRIMARY KEY,
        target_user_id  TEXT,
        role            TEXT,
        type            TEXT,
        status          TEXT,
        message         TEXT,
        triggered_by    TEXT,
        created_at      TIMESTAMPTZ DEFAULT now()
      )
    `);
    // 예약 발송 중복 방지용 테이블
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS push_scheduled_sent (
        id         TEXT PRIMARY KEY,
        pool_id    TEXT,
        class_id   TEXT,
        type       TEXT,
        sent_date  TEXT,
        sent_time  TEXT,
        created_at TIMESTAMPTZ DEFAULT now(),
        CONSTRAINT push_scheduled_unique UNIQUE (pool_id, class_id, type, sent_date, sent_time)
      )
    `);
  } catch (e) {
    console.error("[push-service] initPushTables 오류:", e);
  }
}
