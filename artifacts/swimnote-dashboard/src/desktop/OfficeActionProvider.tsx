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
import { api, performOfficeOperation } from "../lib/api-client";
import { registerOfficeOperations } from "./office-operation";
import { OFFICE_PAGES } from "../../desktop/office-access.cts";
import { useAuth } from "../contexts/AuthContext";
import { recoverableWrite,OfficeRecovery } from "./OfficeRecovery";
import {readOfficeAiEditor,applyOfficeAiDraft} from "./office-ai-editor";

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
  const { state: authState } = useAuth();
  const hasAi = authState.status === "authenticated" && authState.user.hasX;
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
      existingApi: (path,method,body)=>recoverableWrite(owner,path,method,body,()=>performOfficeOperation(path,method,body)),
      readDiary: id => api.get<unknown>(`/diaries/${encodeURIComponent(id)}`),
      confirmExisting: message => window.confirm(message),
      changedExisting: async (path, method) => {
        const keys = path.includes("attendance") ? ["oap", "attendance", "makeups", "admin-makeups"] :
          path.includes("makeups") ? ["oap", "makeups", "admin-makeups"] :
          path.includes("diary-template") ? ["diary-template-levels", "diary-templates"] :
          path.includes("diaries") ? ["oap", "diaries", "admin-diaries", "diaries-admin", "diary-detail"] :
          path.includes("growth-reports") ? ["oap", "growth-reports-list", "gr-monthly-list", "growth-reports"] :
          path.includes("teacher-invites") ? ["teacher-invites", "teachers", "oap"] :
          path.includes("videos") ? ["oap", "diaries", "diary-detail"] :
          path.includes("photos") || path.includes("notices") || path.includes("parent-requests") ? ["oap", "photos", "notices", "parent-requests"] :
          path.includes("curriculum") ? ["curriculum-levels", "curriculum-versions", "curriculum-nodes", "curriculum-facets"] :
          path.includes("homepage") ? ["homepage-settings"] :
          path.includes("settlement") ? ["settlement-admin-overview", "settlement-admin-teacher-detail"] :
          ["oap", "students", "class-groups", "dashboard-stats"];
        const deletedId = method === "DELETE" ? path.split("/").pop() : undefined;
        await Promise.all(keys.map(key => qc.invalidateQueries({ queryKey: [key],
          predicate: query => !deletedId || !query.queryKey.includes(deletedId) }, { throwOnError: true })));
      },
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
      if (!hasAi) {
        setNotice("일상 AI 작업창은 스윔노트 AI 이용권이 필요합니다. 일반 메뉴와 무료 데이터 이전은 이용권 없이 사용할 수 있습니다.");
        return;
      }
      const deleteDiary = /^일지\s+([A-Za-z0-9_-]{1,160})\s+삭제(?:해줘|해주세요)?[.!]?$/u.exec(text.trim());
      if (deleteDiary) {
        await core.runStructured({ action: "office.diary.delete", input: { diaryId: deleteDiary[1] } });
        publish(); return;
      }
      if (/일지.*삭제|영상.*(?:업로드|전송)|선택한.*파일/.test(text)) {
        setNotice("자연어 대상 추측·파일 자동 선택은 지원하지 않습니다. 일지 삭제는 '일지 ID 삭제'로 명시한 뒤 실제 반·수업일 확인이 필요합니다. 영상은 화면에서 파일·반·회원을 선택해 전송하세요."); return;
      }
      const normalized = (v: string) => v.replace(/열어주세요|보여주세요|열어줘|보여줘|열기|화면|메뉴|[·\s]/g, "");
      const page = OFFICE_PAGES.find(p => normalized(p[1]) === normalized(text));
      if (page) { await core.runStructured({ action: "office.page.open", input: { path: page[0] } }); publish(); return; }
      setNotice(""); // A new request must not retain the previous clarification/error as its current result.
      const destination = navRef.current.getDestination();
      const selectedId = destination.screen === "members" ? destination.memberId : undefined;
      try {
        const editor=readOfficeAiEditor(`${owner.userId}:${owner.poolId}`);
        const command=/^(?:현재)?(공지|답장|양식|입력)(미리보기|저장|발송)(?:해줘|해주세요)?[.!]?$/.exec(text.replace(/\s/g,""));
        if(command&&!editor){setNotice("현재 선택한 공지·답장 입력 양식을 먼저 여세요. 모델 호출·실행 요청 없음.");return;}
        if(editor){
          if(editor.locked){setNotice("현재 양식이 처리 중이거나 결과 확인 대기입니다. 초안 요청·입력 변경을 하지 않았습니다.");return;}
          if(command){
            if(!editor.formKind||(command[1]==="공지"&&editor.formKind!=="notice")||(command[1]==="답장"&&editor.formKind!=="parent-reply")){
              setNotice("명령과 현재 선택한 입력 양식이 다릅니다. 해당 대상 양식을 먼저 여세요.");return;
            }
            if(command[2]==="미리보기"){editor.preview?.();setNotice("현재 양식의 미리보기만 열었습니다. 저장·발송 요청 없음.");return;}
            if(command[2]==="발송"&&!editor.canSend){setNotice("현재 양식은 발송 대상/알림 선택이 확정되지 않았습니다. 직접 확인하세요.");return;}
            editor.requestSubmit?.();setNotice("기존 양식의 미리보기·사용자 확인 절차로 연결했습니다. 모델은 호출하지 않았으며 완료로 간주하지 않습니다.");return;
          }
          const catalog=await api.get<{modelEnabled?:boolean}>("/office/operations/workspace/catalog");
          if(!isCurrent()||readOfficeAiEditor(editor.scope)!==editor)return;
          if(catalog.modelEnabled!==true){setNotice("현재 입력 양식과 공통 Action 연결은 구현됐습니다. 모델 실행 스위치 OFF이며 실제 모델 응답은 미확인입니다. 직접 입력·저장은 계속 가능합니다.");return;}
          const draft=await api.post<any>("/office/operations/workspace/interpret",{text,
            ...(editor.formKind?{formKind:editor.formKind,draftContext:editor.draftContext}:{}),
            ...(editor.resource?{resource:editor.resource}:{}),...(editor.recordId?{recordId:editor.recordId}:{}),
            ...(editor.memberId?{memberId:editor.memberId}:{})});
          if(!isCurrent()||readOfficeAiEditor(editor.scope)!==editor)return;
          if(draft.kind==="clarify"){setNotice(String(draft.question));return;}
          if(draft.kind==="unavailable"){setNotice(String(draft.message));return;}
          const data=editor.resource||editor.formKind?draft.data:draft.command;
          if((editor.formKind?(draft.kind!=="form-draft"||draft.formKind!==editor.formKind||(draft.recordId??undefined)!==editor.recordId):
            editor.resource?(draft.kind!=="operations-draft"||draft.resource!==editor.resource||(draft.recordId??undefined)!==editor.recordId):draft.kind!=="draft")||
            !data||typeof data!=="object"||Array.isArray(data))throw new Error("Invalid editor draft");
          // This is an explicit field handoff, not a saved or approved business action.
          applyOfficeAiDraft(editor,data);
          setNotice("초안을 현재 공통 입력 양식에 채웠습니다. 저장되지 않았습니다. 대상·필드·금액·영향을 확인하고 같은 양식의 저장/미리보기/확정 Action으로 실행하세요.");
          return;
        }
        if(!stage3){setNotice("실제 AI 전송은 통합 배포 승인 전 비활성입니다.");return;}
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
      } catch (e) {
        const error = e as { code?: string; status?: number };
        if (isCurrent()) setNotice(error.code === "AI_NOT_ENABLED" ? "서버의 AI 해석이 비활성입니다. 다른 PC 업무는 계속 사용할 수 있습니다."
          : error.status === 401 || error.status === 403 ? "AI 해석 권한 또는 로그인 상태를 확인하세요."
          : "AI 해석 결과를 확인할 수 없습니다. 이 해석 경로에서는 업무 실행 요청을 보내지 않았습니다.");
      }
    };
    const confirmProposal = async (id: string) => {
      const proposal = proposals.get(id); if (!proposal || !isCurrent()) return;
      proposals.delete(id); publish(); await execute(proposal.request, "structured");
    };
    const openResult = async (taskId: string, resultId: string) => { await core.openTaskResult(taskId, resultId); publish(); };
    const resolveWrite = async (requestId: string) => { await core.resolveMutation(requestId); publish(); };
    return { core, execute, membersQuery, homeQueryFn, life, interpret, confirmProposal, openResult, resolveWrite, publish };
  }, [actor.userId, actor.poolId, actor.role, generation, qc, stage3, hasAi]);
  useLayoutEffect(() => {
    session.life.live = true;
    const unregisterOperations = registerOfficeOperations(async operation => {
      if (!session.life.live) throw { status: 403, message: "현재 세션이 아닙니다." };
      try {
        const pending = session.core.execute({ action: "office.operation.execute", input: operation }, "menu");
        session.publish();
        const result = await pending;
        if (result.status === "cancelled") throw { status: 499, code: "OFFICE_CANCELLED", message: "실행 전 승인을 취소했습니다. 서버 요청은 보내지 않았습니다." };
        if (result.status === "unknown") throw { status: 409, code: "OFFICE_OUTCOME_UNKNOWN", message: result.message };
        if (result.status !== "success") throw { status: result.code === "forbidden" ? 403 : 400, code: result.code, message: result.message };
        return result.data;
      } finally {
        session.publish();
      }
    });
    return () => {
      unregisterOperations();
      session.life.live = false;
      session.core.cancelAll();
      // StrictMode's synchronous setup/cleanup probe is not a new authenticated session.
      queueMicrotask(() => { if (!session.life.live) session.core.dispose(); });
    };
  }, [session]);
  return <OfficeActionContext.Provider value={{ ...session, actorRole: actor.role,
    notice: noticeState.owner === session.life ? noticeState.text : "",
    tasks: taskState.owner === session.life ? taskState.tasks : [], stage3Enabled: !!stage3,
    aiMode: stage3 ? stage3.mode ?? "server" : "off" }}><OfficeRecovery actor={actor}/>{children}</OfficeActionContext.Provider>;
}
