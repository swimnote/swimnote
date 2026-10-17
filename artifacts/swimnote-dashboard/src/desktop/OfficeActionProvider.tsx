import { newOfficeRequestId } from "../lib/office-request-id";
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getAuthGeneration } from "../lib/token";
import { memberQuery } from "../pages/members/member-query";
import { loadDashboardStats } from "../pages/HomePage";
import { OfficeActionCore, type ActionActor } from "./OfficeActionCore";
import { OfficeActionContext } from "./OfficeActionContext";
import { useOfficeNavigation } from "./OfficeNavigation";
import { productionStage3Transport, type OfficeStage3Transport } from "./office-stage3-transport";
import type { OfficeTask } from "./OfficeTaskContract";

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
export function OfficeActionProvider({ actor, children, stage3 = productionStage3Transport }: {
  actor: ActionActor; children: ReactNode; stage3?: OfficeStage3Transport;
}) {
  const nav = useOfficeNavigation();
  if (!nav) throw new Error("OfficeActionProvider requires OfficeNavigationProvider");
  const navRef = useRef(nav); navRef.current = nav;
  const actorRef = useRef(actor); actorRef.current = actor;
  const qc = useQueryClient(), generation = getAuthGeneration();
  const [noticeState, setNoticeState] = useState<{ owner: object | null; text: string }>({ owner: null, text: "" });
  const [taskState, setTaskState] = useState<{ owner: object | null; tasks: OfficeTask[] }>({ owner: null, tasks: [] });
  const session = useMemo(() => {
    const owner = { ...actor };
    const life = { live: true };
    const setNotice = (text: string) => setNoticeState({ owner: life, text });
    const setTasks = (tasks: OfficeTask[]) => setTaskState({ owner: life, tasks });
    const isCurrent = () => life.live && getAuthGeneration() === generation &&
      actorRef.current.userId === owner.userId && actorRef.current.poolId === owner.poolId && actorRef.current.role === owner.role;
    type Receipt = { serial: number; queryStartedAt: number; receivedAt: number };
    let serial = 0, membersReceipt: Receipt | undefined, homeReceipt: Receipt | undefined;
    const proposals = new Map<string, { task: OfficeTask; request: unknown }>();
    const membersQuery: typeof memberQuery = { ...memberQuery,
      queryKey: ["students", "office", owner.userId, owner.poolId, String(generation)],
      queryFn: async context => {
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
      stage3,
      changed: async () => {
        await qc.invalidateQueries({ queryKey: ["students"] });
        await qc.invalidateQueries({ queryKey: ["class-groups"] });
        await qc.invalidateQueries({ queryKey: ["dashboard-stats", owner.poolId] });
      },
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
      const pending = core.execute(request, origin);
      if (isCurrent()) setTasks([...proposals.values()].map(p => p.task).concat(core.getTasks()));
      const outcome = await pending;
      if (isCurrent()) setTasks([...proposals.values()].map(p => p.task).concat(core.getTasks()));
      if (isCurrent() && outcome.status !== "cancelled") setNotice(outcome.status === "success" ? "" : outcome.message);
      return outcome;
    };
    const publish = () => { if (isCurrent()) setTasks([...proposals.values()].map(p => p.task).concat(core.getTasks())); };
    const interpret = async (text: string) => {
      if (!isCurrent()) return;
      if (!stage3) { setNotice("실제 AI 전송은 통합 배포 승인 전 비활성입니다."); return; }
      setNotice(""); // A new request must not retain the previous clarification/error as its current result.
      const destination = navRef.current.getDestination();
      const selectedId = destination.screen === "members" ? destination.memberId : undefined;
      try {
        const result = await stage3.interpret({ text, ...(selectedId ? { memberId: selectedId } : {}) }) as any;
        if (!isCurrent()) return;
        const current = navRef.current.getDestination();
        if ((current.screen === "members" ? current.memberId : undefined) !== selectedId) return;
        if (result.kind === "clarify") { setNotice(String(result.question)); return; }
        if (result.kind === "search") {
          await core.runStructured({ action: "office.members.search", input: { search: result.search } }); publish(); return;
        }
        if (result.kind !== "proposal" || result.confirmation !== "required" || !selectedId || result.command?.memberId !== selectedId)
          throw new Error("Invalid proposal");
        const read = await qc.fetchQuery({ ...membersQuery, staleTime: 0, retry: false });
        if (!isCurrent()) return;
        const student = read.find(s => s.id === selectedId) as any;
        if (!student?.office_revision) throw new Error("Missing revision");
        const c = result.command, requestId = newOfficeRequestId(), taskId = "proposal:" + requestId;
        const request = { action: c.action === "update" ? "office.member.update" : c.action === "move" ? "office.member.move" : "invalid",
          input: { memberId: selectedId, requestId, expectedRevision: student.office_revision,
            ...(c.action === "update" ? { changes: c.changes } : { fromClassId: c.fromClassId, toClassId: c.toClassId }) } };
        const changes = c.action === "update"
          ? Object.entries(c.changes ?? {}).map(([field, after]) => ({ field, before: String(student[field] ?? ""), after: String(after) }))
          : [{ field: "이동할 소속 반", before: String(c.fromClassId ?? ""), after: String(c.toClassId ?? "") }];
        proposals.set(taskId, { request, task: { id: taskId, scope: "current", request: "AI 작업 제안 · 실행 전 확인", targetLabel: student.name,
          status: "confirmation_required", summary: "실행되지 않았습니다. 대상과 변경 전후를 확인하세요.", changes,
          preview: { targets: [student.name], messages: [], attachments: [] }, results: [] } });
        publish();
      } catch { if (isCurrent()) setNotice("AI 요청 결과를 확인할 수 없습니다. 실행하지 않았습니다."); }
    };
    const confirmProposal = async (id: string) => {
      const proposal = proposals.get(id); if (!proposal || !isCurrent()) return;
      proposals.delete(id); publish(); await execute(proposal.request, "structured");
    };
    const openResult = async (taskId: string, resultId: string) => { await core.openTaskResult(taskId, resultId); publish(); };
    const resolveWrite = async (requestId: string) => { await core.resolveMutation(requestId); publish(); };
    return { core, execute, membersQuery, homeQueryFn, life, interpret, confirmProposal, openResult, resolveWrite };
  }, [actor.userId, actor.poolId, actor.role, generation, qc, stage3]);
  useLayoutEffect(() => {
    session.life.live = true;
    return () => {
      session.life.live = false;
      session.core.cancelAll();
      // StrictMode's synchronous setup/cleanup probe is not a new authenticated session.
      queueMicrotask(() => { if (!session.life.live) session.core.dispose(); });
    };
  }, [session]);
  return <OfficeActionContext.Provider value={{ ...session,
    notice: noticeState.owner === session.life ? noticeState.text : "",
    tasks: taskState.owner === session.life ? taskState.tasks : [], stage3Enabled: !!stage3,
    aiMode: stage3 ? stage3.mode ?? "server" : "off" }}>{children}</OfficeActionContext.Provider>;
}
