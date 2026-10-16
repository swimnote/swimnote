import type { Request, Response } from "express";
import { addSseClient, removeSseClient } from "./pg-realtime.js";
import { checkStreamAccess, streamPrincipal, type StreamPrincipal } from "./sse-access.js";

export const STREAM_RECHECK_MS = 15_000;
export const STREAM_CHECK_TIMEOUT_MS = 2_000;
type Failure = "expired" | "revoked" | "unavailable";
type Member = { close: (reason?: Failure) => void; resync: () => void };
type Cohort = {
  principal: StreamPrincipal; members: Set<Member>; allowed: boolean; until: number;
  pending?: Promise<boolean>; timer?: ReturnType<typeof setTimeout>;
  cancel?: () => void;
};

/** One current-authority check per user/role/Pool, not per socket. No tokens in keys. */
export class StreamAuthority {
  private cohorts = new Map<string, Cohort>();
  constructor(private check = checkStreamAccess) {}

  join(principal: StreamPrincipal, member: Member) {
    const key = JSON.stringify([principal.userId, principal.role, principal.poolId]);
    let cohort = this.cohorts.get(key);
    if (!cohort) {
      cohort = { principal, members: new Set(), allowed: false, until: 0 };
      this.cohorts.set(key, cohort);
    }
    const group = cohort;
    group.members.add(member);
    const refresh = () => {
      if (group.pending) return group.pending;
      clearTimeout(group.timer);
      group.allowed = false;
      const started = Date.now();
      let deadline: ReturnType<typeof setTimeout> | undefined;
      group.pending = Promise.race([
        Promise.resolve().then(() => this.check(group.principal)),
        new Promise<boolean>((_, reject) => {
          group.cancel = () => reject(new Error("No stream subscribers"));
          deadline = setTimeout(() => reject(new Error("Authority timeout")), STREAM_CHECK_TIMEOUT_MS);
        }),
      ]).then(allowed => {
        if (!allowed) {
          [...group.members].forEach(m => m.close("revoked"));
          return false;
        }
        group.until = started + STREAM_RECHECK_MS;
        group.allowed = Date.now() < group.until;
        if (group.members.size && group.allowed) {
          group.timer = setTimeout(() => { void refresh(); }, Math.max(0, group.until - Date.now()));
          // Coarse replay request, not durable event replay: includes checks' paused window.
          [...group.members].forEach(m => m.resync());
        }
        return group.allowed;
      }, () => {
        [...group.members].forEach(m => m.close("unavailable"));
        return false;
      }).finally(() => { clearTimeout(deadline); group.cancel = undefined; group.pending = undefined; });
      return group.pending;
    };
    return {
      ready: () => group.allowed && Date.now() < group.until ? Promise.resolve(true) : refresh(),
      beforeEvent: (type: string) => { if (type === "pool_settings.changed") void refresh(); },
      allowed: () => {
        if (group.allowed && Date.now() < group.until) return true;
        void refresh();
        return false;
      },
      leave: () => {
        group.members.delete(member);
        if (!group.members.size) {
          clearTimeout(group.timer);
          group.cancel?.();
          if (this.cohorts.get(key) === group) this.cohorts.delete(key);
        }
      },
    };
  }
}

const authority = new StreamAuthority();

export async function openAdminStream(
  req: Request, res: Response, poolId: string, shared = authority,
): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "인증이 필요합니다." });
    return;
  }
  let principal: StreamPrincipal;
  try { principal = streamPrincipal(header.slice(7), poolId); }
  catch { res.status(401).json({ error: "세션이 만료되었습니다." }); return; }
  let closed = false;
  let started = false;
  let needsResync = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  let lease: ReturnType<StreamAuthority["join"]> | undefined;
  const client = {
    poolId, res,
    onWriteError: () => close(),
    beforeEvent: (type: string) => lease?.beforeEvent(type),
    canSend: () => {
      if (Date.now() >= principal.expiresAt) { close("expired"); return false; }
      const allowed = !closed && !!lease?.allowed();
      if (!allowed) needsResync = true;
      return allowed;
    },
  };
  function close(reason?: Failure) {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    clearTimeout(expiry);
    lease?.leave();
    if (started) removeSseClient(client);
    req.off("aborted", disconnected);
    res.off("close", disconnected);
    if (reason && !res.destroyed && !res.writableEnded) {
      if (res.headersSent) {
        // Control-only frame. Never includes token, user or Pool identifiers.
        try { res.write(`data: ${JSON.stringify({ type: "session.invalid", reason })}\n\n`); } catch { /* close below */ }
      } else {
        res.status(reason === "unavailable" ? 503 : reason === "expired" ? 401 : 403)
          .json({ error: reason });
        return;
      }
    }
    if (!res.writableEnded && !res.destroyed) res.end();
  }
  function disconnected() { close(); }
  lease = shared.join(principal, {
    close,
    resync: () => {
      if (started && needsResync && client.canSend()) {
        needsResync = false;
        try { res.write('data: {"type":"resync.required"}\n\n'); } catch { close(); }
      }
    },
  });
  req.on("aborted", disconnected);
  res.on("close", disconnected);
  // JWT lifetime can exceed Node's maximum timer delay. Always gate writes too.
  function armExpiry() {
    const remaining = principal.expiresAt - Date.now();
    if (remaining <= 0) { close("expired"); return; }
    expiry = setTimeout(armExpiry, Math.min(remaining, 2_147_483_647));
  }
  armExpiry();
  if (!(await lease.ready()) || closed) return;
  if (!client.canSend()) return;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  started = true;
  addSseClient(client);
  try { res.write('data: {"type":"connected"}\n\n'); } catch { close(); return; }
  heartbeat = setInterval(() => {
    if (!client.canSend()) return;
    try { res.write("data: ping\n\n"); } catch { close(); }
  }, 30_000);
}
