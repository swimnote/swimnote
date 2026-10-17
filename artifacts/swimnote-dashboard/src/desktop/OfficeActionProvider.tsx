import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getAuthGeneration } from "../lib/token";
import { memberQuery } from "../pages/members/member-query";
import { loadDashboardStats } from "../pages/HomePage";
import { OfficeActionCore, type ActionActor } from "./OfficeActionCore";
import { OfficeActionContext } from "./OfficeActionContext";
import { useOfficeNavigation } from "./OfficeNavigation";

let scopeSequence = 0;
const abortError = () => new DOMException("이전 조회를 취소했습니다.", "AbortError");
function observed<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(abortError()); return; }
    const abort = () => reject(abortError());
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

/** Adapter over the existing verified session, N01 Navigation and canonical QueryClient. */
export function OfficeActionProvider({ actor, children }: { actor: ActionActor; children: ReactNode }) {
  const nav = useOfficeNavigation();
  if (!nav) throw new Error("OfficeActionProvider requires OfficeNavigationProvider");
  const navRef = useRef(nav); navRef.current = nav;
  const actorRef = useRef(actor); actorRef.current = actor;
  const qc = useQueryClient(), generation = getAuthGeneration();
  const [notice, setNotice] = useState("");
  const session = useMemo(() => {
    const owner = { ...actor };
    const life = { live: true };
    const isCurrent = () => life.live && getAuthGeneration() === generation &&
      actorRef.current.userId === owner.userId && actorRef.current.poolId === owner.poolId && actorRef.current.role === owner.role;
    type Receipt = { serial: number; queryStartedAt: number; receivedAt: number };
    let serial = 0, membersReceipt: Receipt | undefined, homeReceipt: Receipt | undefined;
    const membersQuery: typeof memberQuery = { ...memberQuery, queryFn: async context => {
      const queryStartedAt = Date.now();
      const data = await memberQuery.queryFn(context);
      if (!isCurrent() || context.signal.aborted) throw abortError();
      membersReceipt = { serial: ++serial, queryStartedAt, receivedAt: Date.now() };
      return data;
    } };
    const homeQueryFn: typeof loadDashboardStats = async context => {
      const queryStartedAt = Date.now();
      const data = await loadDashboardStats(context);
      if (!isCurrent() || context.signal.aborted) throw abortError();
      homeReceipt = { serial: ++serial, queryStartedAt, receivedAt: Date.now() };
      return data;
    };
    const receipt = (before: number | undefined, after: Receipt | undefined) => ({
      source: after && after.serial !== before ? "network" as const : "cache" as const,
      queryStartedAt: after?.queryStartedAt ?? 0, receivedAt: after?.receivedAt ?? 0,
    });
    const core = new OfficeActionCore({
      actor: owner, scope: `${owner.userId}:${owner.poolId}:${generation}:${++scopeSequence}`, isCurrent,
      destination: () => navRef.current.getDestination(),
      navigationVersion: () => navRef.current.getRevision(),
      filters: () => {
        const { search, status, classId } = navRef.current.view;
        return { search, status, classId };
      },
      updateFilters: filters => navRef.current.updateView({ ...filters, page: 1 }),
      open: (destination, exactList) => {
        if (!isCurrent()) return false;
        return navRef.current.open(destination, { listOnly: exactList });
      },
      members: async (signal, fresh) => {
        const before = membersReceipt?.serial;
        const data = await observed(qc.fetchQuery({ ...membersQuery, staleTime: fresh ? 0 : memberQuery.staleTime, retry: false }), signal);
        if (!isCurrent()) throw abortError();
        return { data, ...receipt(before, membersReceipt) };
      },
      readHome: async signal => {
        const before = homeReceipt?.serial;
        await observed(qc.fetchQuery({ queryKey: ["dashboard-stats", owner.poolId], queryFn: homeQueryFn, staleTime: 0, retry: false }), signal);
        if (!isCurrent()) throw abortError();
        return receipt(before, homeReceipt);
      },
    });
    const execute: OfficeActionCore["execute"] = async (request, origin) => {
      const outcome = await core.execute(request, origin);
      if (isCurrent() && outcome.status !== "cancelled") setNotice(outcome.status === "success" ? "" : outcome.message);
      return outcome;
    };
    return { core, execute, membersQuery, homeQueryFn, life };
  }, [actor.userId, actor.poolId, actor.role, generation, qc]);
  useLayoutEffect(() => {
    session.life.live = true;
    return () => {
      session.life.live = false;
      session.core.cancelAll();
      // StrictMode's synchronous setup/cleanup probe is not a new authenticated session.
      queueMicrotask(() => { if (!session.life.live) session.core.dispose(); });
    };
  }, [session]);
  return <OfficeActionContext.Provider value={{ ...session, notice }}>{children}</OfficeActionContext.Provider>;
}
