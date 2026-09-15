/**
 * pg-realtime.ts — PostgreSQL LISTEN/NOTIFY + SSE 관리
 *
 * 책임:
 *  1. notifyPoolEvent() — 단일 pool에 coarse-grained event NOTIFY
 *  2. startListener()   — 전용 persistent pg.Client로 LISTEN
 *  3. SSE 클라이언트 레지스트리 — pool 격리 브로드캐스트
 *
 * 채널명: pool_events (단일 채널, payload JSON 안의 pool_id로 격리)
 *
 * 주의:
 *  - NOTIFY payload에 개인정보(이름/전화/일지내용) 절대 금지
 *  - 타 pool에 event 절대 전달 금지
 */

import pg from "pg";
import type { Response } from "express";

const { Client } = pg;

// ── Event Types ──────────────────────────────────────────────────────────────
export type PoolEventType =
  | "member.changed"
  | "class.changed"
  | "makeup.changed"
  | "growth_report.changed"
  | "diary.changed"
  | "teacher.changed"
  | "curriculum.changed"
  | "pool_settings.changed";

export interface PoolEventPayload {
  type: PoolEventType;
  pool_id: string;
  entity_id?: string;
}

// ── SSE Client Registry ──────────────────────────────────────────────────────
interface SseClient {
  poolId: string;
  res: Response;
}

const clients = new Set<SseClient>();

export function addSseClient(client: SseClient): void {
  clients.add(client);
  console.log(`[realtime] SSE connect pool=${client.poolId} total=${clients.size}`);
}

export function removeSseClient(client: SseClient): void {
  clients.delete(client);
  console.log(`[realtime] SSE disconnect pool=${client.poolId} total=${clients.size}`);
}

// ── Broadcast to SSE clients (pool-isolated) ─────────────────────────────────
function broadcastToPool(event: PoolEventPayload): void {
  const payload = JSON.stringify({ type: event.type, entity_id: event.entity_id ?? null });
  let sent = 0;
  for (const client of clients) {
    // Pool isolation: only deliver to matching pool
    if (client.poolId !== event.pool_id) continue;
    try {
      client.res.write(`data: ${payload}\n\n`);
      sent++;
    } catch {
      // write fails if client disconnected — cleanup handled by close event
    }
  }
  if (sent > 0) {
    console.log(`[realtime] broadcast type=${event.type} pool=${event.pool_id} clients=${sent}`);
  }
}

// ── NOTIFY helper (call after successful DB write) ───────────────────────────
// Uses the shared db pool from @workspace/db for the NOTIFY query.
// Because NOTIFY in a transaction is delivered after commit, callers should
// call this AFTER the transaction if they cannot pass a tx client.

let _db: any = null;

export function setRealtimeDb(db: any): void {
  _db = db;
}

export async function notifyPoolEvent(event: Omit<PoolEventPayload, never>): Promise<void> {
  try {
    const payload = JSON.stringify({ type: event.type, pool_id: event.pool_id, entity_id: event.entity_id ?? null });
    if (listenClient) {
      // LISTEN 전용 direct connection에서 pg_notify 전송
      // → 동일 PostgreSQL 인스턴스/백엔드 보장 → 즉시 수신
      await listenClient.query("SELECT pg_notify($1, $2)", ["pool_events", payload]);
    } else if (_db) {
      // listenClient 미준비 시 drizzle pool fallback
      const { sql: dSql } = await import("drizzle-orm");
      await _db.execute(dSql`SELECT pg_notify('pool_events', ${payload})`);
    }
  } catch (e: any) {
    // NOTIFY failure must NOT affect business mutation — just log
    console.warn(`[realtime] notify failed type=${event.type}: ${e?.message}`);
  }
}

// ── Dedicated LISTEN Client ──────────────────────────────────────────────────
let listenClient: InstanceType<typeof Client> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1000;
const MAX_RECONNECT_DELAY = 30_000;

export async function startListener(): Promise<void> {
  // REALTIME_DATABASE_URL: LISTEN 전용 direct PostgreSQL connection (pooler 우회)
  // 일반 API DB는 기존 SUPABASE_DATABASE_URL 유지
  const connStr = process.env.REALTIME_DATABASE_URL
    || process.env.SUPABASE_DATABASE_URL
    || process.env.POOL_DATABASE_URL;
  if (!connStr) {
    console.warn("[realtime] No DATABASE_URL — LISTEN disabled");
    return;
  }
  const usingDirect = Boolean(process.env.REALTIME_DATABASE_URL);
  console.log(`[realtime] LISTEN using ${usingDirect ? "REALTIME_DATABASE_URL (direct)" : "pooler URL"}`);


  async function connect() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }

    // URL을 파싱하여 개별 필드로 구성 — connectionString + ssl 혼용 시 SSL 불일치 방지
    // (drizzle pool의 buildConfig와 동일한 방식)
    let clientConfig: any;
    try {
      const u = new URL(connStr!);
      const urlPassword = decodeURIComponent(u.password);
      clientConfig = {
        host:     u.hostname,
        port:     parseInt(u.port || "5432", 10),
        user:     decodeURIComponent(u.username),
        password: urlPassword,
        database: u.pathname.replace(/^\//, ""),
        ssl:      { rejectUnauthorized: false },
        connectionTimeoutMillis: 15000,
        keepAlive: true,
      };
    } catch {
      // URL 파싱 실패 시 connectionString 방식으로 폴백
      clientConfig = { connectionString: connStr, ssl: { rejectUnauthorized: false } };
    }

    const client = new Client(clientConfig);

    client.on("error", (err) => {
      console.error("[realtime] LISTEN client error:", err.message);
    });

    client.on("end", () => {
      console.warn("[realtime] LISTEN client disconnected — scheduling reconnect");
      listenClient = null;
      scheduleReconnect();
    });

    client.on("notification", (msg) => {
      if (msg.channel !== "pool_events") return;
      try {
        const event: PoolEventPayload = JSON.parse(msg.payload ?? "{}");
        if (!event.type || !event.pool_id) return;
        broadcastToPool(event);
      } catch (e: any) {
        console.warn("[realtime] bad notification payload:", e?.message);
      }
    });

    try {
      await client.connect();
      await client.query("LISTEN pool_events");
      listenClient = client;
      reconnectDelay = 1000; // reset on success
      console.log("[realtime] LISTEN pool_events — ready");
    } catch (e: any) {
      console.error("[realtime] LISTEN connect failed:", e?.message);
      await client.end().catch(() => {});
      scheduleReconnect();
    }
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    console.log(`[realtime] reconnect in ${reconnectDelay}ms`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
  }

  await connect();
}
