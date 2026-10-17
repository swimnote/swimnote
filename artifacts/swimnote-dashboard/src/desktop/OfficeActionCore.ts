import { filterMembers, type MemberFilters, type MemberSummary } from "../pages/members/member-query";
import { confirmResultRead, type OfficeTask, type ResultReadEvidence } from "./OfficeTaskContract";
import type { OfficeDestination } from "./OfficeNavigation";
import { OFFICE_MEMBER_TABS, type OfficeMemberTab } from "./OfficeNavigation";
import type { OfficeStage3Transport, OfficeWriteReceipt } from "./office-stage3-transport";
import { officePage, isOfficeApiRequest } from "../../desktop/office-access.cts";

export type ActionId = "office.home.open" | "office.members.open" | "office.member.open" | "office.members.search" | "office.member.update" | "office.member.move" | "office.page.open" | "office.operation.execute";
export type ActionOrigin = "menu" | "shortcut" | "result" | "structured";
export type ActionActor = { userId: string; poolId: string; role: string };
export type ActionOutcome =
  | { status: "success"; kind: "open" | "query" | "mutation"; destination: OfficeDestination; count?: number; filters?: MemberFilters; receipt?: OfficeWriteReceipt; data?: unknown }
  | { status: "failed"; code: "unsupported" | "input" | "forbidden" | "missing" | "query" | "navigation"; message: string }
  | { status: "cancelled"; message: string }
  | { status: "unknown"; message: string };
export const OFFICE_ACTIONS = Object.freeze({
  "office.page.open": { purpose: "기존 PC 업무 화면 열기", kind: "open", permission: "pool_admin", confirmation: "none", input: "{path}", queries: [], invalidates: [] },
  "office.operation.execute": { purpose: "기존 화면의 허용된 일반 API 실행", kind: "mutation", permission: "pool_admin", confirmation: "existing-ui", input: "{path,method,body?}", queries: [], invalidates: [] },
  "office.home.open": { purpose: "홈 현황 열기", kind: "open", confirmation: "none", permission: "pool_admin", input: "{}", queries: ["dashboard-stats"], invalidates: [] },
  "office.members.open": { purpose: "기존 회원 화면 복원 또는 목록 열기", kind: "open", confirmation: "none", permission: "pool_admin", input: "{view?:'list'}", queries: ["students", "class-groups"], invalidates: [] },
  "office.member.open": { purpose: "회원 ID로 빠른/전체 상세 및 탭 열기", kind: "open", confirmation: "none", permission: "pool_admin", input: "{memberId,view?:'full',tab?:basic|contacts|classes|notes|growth}", queries: ["students"], invalidates: [] },
  "office.members.search": { purpose: "기존 회원 검색·필터 조회", kind: "query", confirmation: "none", permission: "pool_admin", input: "{search?,status?,classId?}", queries: ["students"], invalidates: [] },
  "office.member.update": { purpose: "일반 회원정보 조건부 저장", kind: "mutation", confirmation: "explicit-save", businessPolicy: "validate-then-execute", releaseRestriction: "preview-confirm-until-integrated-acceptance", permission: "pool_admin", input: "{memberId,requestId,expectedRevision,changes}", queries: ["students"], invalidates: ["students"] },
  "office.member.move": { purpose: "명시한 소속 한 반만 이동", kind: "mutation", confirmation: "preview-confirm", businessPolicy: "validate-then-execute", releaseRestriction: "preview-confirm-until-integrated-acceptance", permission: "pool_admin", input: "{memberId,requestId,expectedRevision,fromClassId,toClassId}", queries: ["students"], invalidates: ["students", "class-groups"] },
} as const);
type MembersRead = { data: MemberSummary[]; source: "network" | "cache"; queryStartedAt: number; receivedAt: number };
export type ActionDependencies = {
  actor: ActionActor; scope: string; isCurrent: () => boolean;
  open: (destination: OfficeDestination, exactList?: boolean) => boolean;
  destination: () => OfficeDestination;
  navigationVersion?: () => number;
  filters: () => MemberFilters;
  updateFilters: (filters: MemberFilters) => void;
  members: (signal: AbortSignal, fresh: boolean) => Promise<MembersRead>;
  readHome: (signal: AbortSignal) => Promise<Omit<MembersRead, "data">>;
  now?: () => number;
  stage3?: OfficeStage3Transport;
  changed?: () => Promise<void>;
  existingApi?: (path: string, method: string, body?: string) => Promise<unknown>;
  changedExisting?: (path: string) => Promise<void>;
};
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const own = (v: object, key: string) => Object.prototype.hasOwnProperty.call(v, key);
const id = (v: unknown) => typeof v === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(v);
const failed = (code: Extract<ActionOutcome, { status: "failed" }>["code"], message: string): ActionOutcome => ({ status: "failed", code, message });
const cancelled = (): ActionOutcome => ({ status: "cancelled", message: "이전 요청 또는 세션을 취소했습니다." });
function inputFor(action: ActionId, input: unknown): Record<string, any> | null {
  if (!object(input)) return null;
  if (action === "office.page.open") return Object.keys(input).length === 1 &&
    typeof input.path === "string" && officePage(input.path) ? input : null;
  if (action === "office.operation.execute") return Object.keys(input).every(k => ["path", "method", "body"].includes(k)) &&
    typeof input.path === "string" && typeof input.method === "string" && ["POST", "PATCH", "PUT"].includes(input.method) &&
    isOfficeApiRequest(input.path, input.method) && (input.body === undefined || typeof input.body === "string" && input.body.length <= 5_000_000) ? input : null;
  if (action === "office.member.update" || action === "office.member.move") {
    const keys = ["memberId", "requestId", "expectedRevision", ...(action === "office.member.update" ? ["changes"] : ["fromClassId", "toClassId"])];
    if (Object.keys(input).some(k => !keys.includes(k)) || !id(input.memberId) || !id(input.requestId) ||
        typeof input.expectedRevision !== "string" || !/^[a-f0-9]{32}$/.test(input.expectedRevision)) return null;
    if (action === "office.member.update" && (!object(input.changes) || !Object.keys(input.changes).length ||
      Object.entries(input.changes).some(([k, v]) => !["name", "phone", "birth_date", "birth_year", "parent_name", "memo"].includes(k) || typeof v !== "string"))) return null;
    if (action === "office.member.move" && (!id(input.fromClassId) || !id(input.toClassId) || input.fromClassId === input.toClassId)) return null;
    return input;
  }
  if (action === "office.home.open") return Object.keys(input).length ? null : {};
  if (action === "office.members.open") return Object.keys(input).length === 0 ? {}
    : Object.keys(input).length === 1 && own(input, "view") && input.view === "list" ? { view: "list" } : null;
  if (action === "office.member.open") {
    if (!own(input, "memberId") || !id(input.memberId) || Object.keys(input).some(k => !["memberId", "view", "tab"].includes(k))) return null;
    if (input.view !== undefined && input.view !== "full") return null;
    if (input.tab !== undefined && (input.view !== "full" || !OFFICE_MEMBER_TABS.includes(input.tab as OfficeMemberTab))) return null;
    return { memberId: input.memberId as string, ...(input.view === "full" ? { view: "full", tab: (input.tab ?? "basic") as string } : {}) };
  }
  if (Object.keys(input).some(k => !["search", "status", "classId"].includes(k))) return null;
  if (input.search !== undefined && (typeof input.search !== "string" || input.search.length > 200)) return null;
  if (input.status !== undefined && !["", "active", "suspended", "withdrawn", "inactive", "pending", "archived", "unassigned"].includes(input.status as string)) return null;
  if (input.classId !== undefined && input.classId !== "" && !id(input.classId)) return null;
  return input as Record<string, string>;
}

/** Thin allowlist executor. All writes use the gated canonical service; no arbitrary URL/API/SQL. */
export class OfficeActionCore {
  private active = true;
  private sequence = 0;
  private intent = 0;
  private pending = new Map<string, { promise: Promise<ActionOutcome>; abort: AbortController }>();
  private tasks = new Map<string, OfficeTask>();
  private taskFilters = new Map<string, MemberFilters>();
  private structured = new Map<string, Promise<OfficeTask | null>>();
  private resultsPending = new Map<string, Promise<ActionOutcome>>();
  private now: () => number;
  private writes = new Map<string, { key: string; outcome?: ActionOutcome; memberId: string; receipt?: OfficeWriteReceipt; serverRequestId?: string }>();
  private unknownOperations = new Set<string>();
  canWrite() { return !!this.deps.stage3; }
  constructor(private deps: ActionDependencies) { this.now = deps.now ?? Date.now; }
  private current() { return this.active && this.deps.isCurrent(); }
  private permitted() { return this.deps.actor.role === "pool_admin" && !!this.deps.actor.userId && !!this.deps.actor.poolId; }
  dispose() {
    this.active = false;
    for (const request of this.pending.values()) request.abort.abort();
    this.pending.clear(); this.tasks.clear(); this.taskFilters.clear(); this.structured.clear(); this.resultsPending.clear();
    this.writes.clear(); this.unknownOperations.clear();
  }
  cancelAll() { for (const request of this.pending.values()) request.abort.abort(); }
  getTasks(): OfficeTask[] { return structuredClone([...this.tasks.values()]); }
  execute(request: unknown, origin: ActionOrigin = "structured"): Promise<ActionOutcome> {
    void origin; // Caller metadata only; never changes the Action's meaning or permissions.
    if (!this.current()) return Promise.resolve(cancelled());
    if (!this.permitted()) return Promise.resolve(failed("forbidden", "현재 사용자·수영장 권한으로 실행할 수 없습니다."));
    if (!object(request) || !own(request, "action") || !own(request, "input") || Object.keys(request).some(k => k !== "action" && k !== "input") ||
        typeof request.action !== "string" || !own(OFFICE_ACTIONS, request.action))
      return Promise.resolve(failed("unsupported", "현재 지원하지 않는 Action입니다."));
    const action = request.action as ActionId, input = inputFor(action, request.input);
    if (!input) return Promise.resolve(failed("input", "Action 입력 형식이 올바르지 않습니다."));
    const key = JSON.stringify([action, Object.entries(input).sort()]);
    const existing = this.pending.get(key);
    if (existing) return existing.promise;
    if (action === "office.operation.execute") {
      if (this.unknownOperations.has(key))
        return Promise.reject({ status: 409, message: "이 요청의 저장 결과가 불명입니다. 기존 화면에서 상태를 조회하고 중복 실행하지 마세요." });
      const abort = new AbortController();
      const taskId = `${this.deps.scope}:operation:${++this.sequence}`;
      const target = this.deps.destination();
      const task: OfficeTask = { id: taskId, scope: this.deps.scope, request: "기존 업무 API 처리",
        targetLabel: officePage(target.screen === "page" ? target.path : "")?.[1] ?? "회원 업무",
        status: "running", summary: "서버 응답 확인 중", changes: [], preview: { targets: [], messages: [], attachments: [] }, results: [] };
      this.tasks.set(taskId, task);
      const run = Promise.resolve().then(async (): Promise<ActionOutcome> => {
        if (!this.current() || !this.deps.existingApi) return cancelled();
        let responded = false;
        try {
          const data = await this.deps.existingApi(input.path, input.method, input.body);
          responded = true;
          if (!this.current()) return cancelled();
          await this.deps.changedExisting?.(input.path);
          if (!this.current()) return cancelled();
          this.tasks.set(taskId, { ...task, status: "completed", summary: "기존 API 응답 수신 · 해당 화면의 처리 결과를 확인하세요.",
            completedAt: this.now(), results: [] });
          return { status: "success", kind: "mutation", destination: target, data };
        } catch (e) {
          const error = e as { status?: number; message?: string; code?: string };
          const rejected = !responded && !!error.status && error.status >= 400 && error.status < 500 && error.status !== 410;
          const message = rejected ? error.message ?? "서버가 요청을 거부했습니다." :
            "저장 결과를 확인할 수 없습니다. 기존 화면에서 상태를 조회하고 같은 요청을 재전송하지 마세요.";
          if (!rejected) this.unknownOperations.add(key);
          if (this.current()) this.tasks.set(taskId, { ...task, status: rejected ? "failed" : "unknown", summary: message });
          throw { ...error, message };
        }
      }).finally(() => this.pending.delete(key));
      this.pending.set(key, { promise: run, abort }); return run;
    }
    if (action === "office.member.update" || action === "office.member.move") {
      if (!this.deps.stage3) return Promise.resolve(failed("forbidden", "통합 배포 전 회원 저장·반이동은 비활성입니다."));
      const previous = this.writes.get(input.requestId);
      if (previous) return Promise.resolve(previous.key === key ? previous.outcome ?? { status: "unknown", message: "기존 요청 결과를 확인하세요." } : failed("input", "요청 번호를 다른 변경에 재사용할 수 없습니다."));
      if ([...this.writes.values()].some(w => w.memberId === input.memberId && w.outcome?.status === "unknown"))
        return Promise.resolve({ status: "unknown", message: "이 회원의 이전 요청 상태 확인이 필요합니다. 재전송하지 마세요." });
      const controller = new AbortController();
      const write = this.mutate(action, input, key, controller.signal).finally(() => this.pending.delete(key));
      this.pending.set(key, { promise: write, abort: controller }); return write;
    }
    const abort = new AbortController(), intent = ++this.intent, navigationVersion = this.deps.navigationVersion?.();
    const run = async (): Promise<ActionOutcome> => {
      try {
        if (!this.current() || abort.signal.aborted || intent !== this.intent) return cancelled();
        let destination: OfficeDestination, count: number | undefined, filters: MemberFilters | undefined;
        if (action === "office.page.open") destination = { screen: "page", path: input.path };
        else if (action === "office.home.open") destination = { screen: "home" };
        else if (action === "office.members.open") destination = { screen: "members" };
        else {
          const read = await this.deps.members(abort.signal, false);
          if (!this.current() || abort.signal.aborted || intent !== this.intent || this.deps.navigationVersion?.() !== navigationVersion) return cancelled();
          if (action === "office.member.open") {
            if (!read.data.some(s => s.id === input.memberId)) return failed("missing", "해당 회원이 없거나 조회 권한이 없습니다.");
            destination = { screen: "members", memberId: input.memberId,
              ...(input.view === "full" ? { view: "full" as const, tab: input.tab as OfficeMemberTab } : {}) };
          } else {
            filters = { ...this.deps.filters(), ...input };
            count = filterMembers(read.data, filters).length;
            this.deps.updateFilters(filters);
            destination = { screen: "members" };
          }
        }
        if (!this.current() || abort.signal.aborted) return cancelled();
        if (!this.deps.open(destination, action === "office.members.search" || action === "office.members.open" && input.view === "list")) return failed("navigation", "현재 화면을 열 수 없습니다.");
        // OPEN is navigation success only. It never claims a write or query completion.
        return { status: "success", kind: OFFICE_ACTIONS[action].kind, destination: this.deps.destination(),
          ...(count === undefined ? {} : { count }), ...(filters ? { filters } : {}) };
      } catch (error) {
        if (!this.current() || abort.signal.aborted || error instanceof DOMException && error.name === "AbortError") return cancelled();
        if (object(error) && typeof error.status === "number")
          return failed(error.status === 403 || error.status === 401 ? "forbidden" : error.status === 404 ? "missing" : "query", "회원 조회에 실패했습니다. 권한·연결 상태를 확인하세요.");
        return { status: "unknown", message: "조회 결과를 확인할 수 없습니다. 상태를 확인한 뒤 다시 시도하세요." };
      }
    };
    // Schedule after registration so synchronous OPENs are coalesced too.
    const promise = Promise.resolve().then(run).finally(() => this.pending.delete(key));
    this.pending.set(key, { promise, abort });
    return promise;
  }
  private async mutate(action: "office.member.update" | "office.member.move", input: Record<string, any>, key: string, signal: AbortSignal): Promise<ActionOutcome> {
    const taskId = `${this.deps.scope}:write:${input.requestId}`;
    const tab: OfficeMemberTab = action === "office.member.move" ? "classes" : Object.keys(input.changes).every(k => k === "memo") ? "notes" : "basic";
    const target: OfficeDestination = { screen: "members", memberId: input.memberId, view: "full", tab };
    const task: OfficeTask = { id: taskId, scope: this.deps.scope, request: action === "office.member.move" ? "회원 반이동" : "회원정보 저장",
      targetLabel: input.memberId, status: "running", summary: "서버 결과 확인 중", changes: [],
      preview: { targets: [input.memberId], messages: [], attachments: [] }, results: [] };
    this.tasks.set(taskId, task);
    const entry: { key: string; outcome?: ActionOutcome; memberId: string; receipt?: OfficeWriteReceipt; serverRequestId?: string } = { key, memberId: input.memberId };
    this.writes.set(input.requestId, entry);
    let outcome: ActionOutcome;
    let commandSent = false;
    try {
      const command = { action: action === "office.member.move" ? "move" : "update", ...input };
      if (this.deps.stage3!.prepare) {
        const issued = await this.deps.stage3!.prepare!(command);
        entry.serverRequestId = issued.requestId;
        if (!this.current() || signal.aborted) return cancelled();
      } else if (this.deps.stage3!.mode === "server") throw new Error("Server issuance is required");
      commandSent = true;
      const receipt = await this.deps.stage3!.write({ ...command, requestId: entry.serverRequestId ?? input.requestId });
      if (receipt.memberId !== input.memberId || receipt.requestId !== (entry.serverRequestId ?? input.requestId) ||
          receipt.action !== (action === "office.member.move" ? "move" : "update")) throw new Error("Receipt scope mismatch");
      entry.receipt = receipt;
      if (!this.current() || signal.aborted) return cancelled();
      await this.deps.changed?.();
      const read = await this.deps.members(signal, true);
      if (!this.current() || signal.aborted) return cancelled();
      if (read.source !== "network" || !read.data.some(s => s.id === receipt.memberId && (s as any).office_revision === receipt.revision))
        throw new Error("Committed revision not verified");
      outcome = { status: "success", kind: "mutation", destination: target, receipt };
      this.tasks.set(taskId, { ...task, status: "completed", summary: "서버 저장 및 정상 재조회 확인 · 자동 이동 없음",
        completedAt: this.now(), changes: receipt.changes,
        results: [{ id: taskId + ":result", label: "변경된 회원정보", target, kind: "screen", storage: "not_stored", expectedRevision: receipt.revision }] });
    } catch (e) {
      if (!this.current()) return cancelled();
      const status = object(e) && typeof e.status === "number" ? e.status : 0;
      // An expired reconciliation window does not prove the original operation never committed.
      const explicitPreflightRejection = !commandSent && object(e) && e.responseReceived === true && e.code === "NOT_ENABLED";
      const known = explicitPreflightRejection || !entry.receipt && status >= 400 && status < 500 && status !== 410;
      outcome = known ? failed(status === 403 || status === 401 ? "forbidden" : "query",
        object(e) && typeof e.message === "string" ? e.message : "서버가 변경을 거부했습니다. 입력은 보존됩니다.")
        : { status: "unknown", message: "결과 불명입니다. 같은 변경을 재전송하지 말고 요청 상태를 확인하세요." };
      this.tasks.set(taskId, { ...task, status: known ? "failed" : "unknown", summary: "message" in outcome ? outcome.message : "결과 확인 필요" });
    }
    entry.outcome = outcome;
    return outcome;
  }
  async resolveMutation(requestId: string): Promise<ActionOutcome> {
    const entry = this.writes.get(requestId);
    if (!entry || !this.deps.stage3 || !this.current()) return cancelled();
    try {
      const serverId = entry.serverRequestId ?? requestId;
      const receipt = await this.deps.stage3.status(serverId);
      if (receipt.requestId !== serverId || receipt.memberId !== entry.memberId) throw new Error("Receipt scope mismatch");
      if (!this.current()) return cancelled();
      const read = await this.deps.members(new AbortController().signal, true);
      if (!this.current() || read.source !== "network" || !read.data.some(s => s.id === receipt.memberId && (s as any).office_revision === receipt.revision))
        throw new Error("Receipt revision not observed");
      const taskId = `${this.deps.scope}:write:${requestId}`, task = this.tasks.get(taskId)!;
      const target: OfficeDestination = { screen: "members", memberId: receipt.memberId, view: "full", tab: receipt.action === "move" ? "classes" : "basic" };
      this.tasks.set(taskId, { ...task, status: "completed", summary: "완료 기록과 현재 조회로 저장 확인", changes: receipt.changes, completedAt: this.now(),
        results: [{ id: taskId + ":result", label: "변경된 회원정보", target, kind: "screen", storage: "not_stored", expectedRevision: receipt.revision }] });
      return entry.outcome = { status: "success", kind: "mutation", destination: target, receipt };
    } catch { return { status: "unknown", message: "완료를 확인할 수 없습니다. 재실행하지 마세요." }; }
  }
  /** Structured queries and confirmed proposals use the same allowlist as menus. */
  runStructured(request: unknown): Promise<OfficeTask | null> {
    if (!this.current()) return Promise.resolve(null);
    if (object(request) && request.action === "office.operation.execute") {
      const task: OfficeTask = { id: `${this.deps.scope}:action:${++this.sequence}`, scope: this.deps.scope,
        request: "일반 업무 API 요청", targetLabel: "현재 수영장", status: "failed",
        summary: "일반 저장은 연결된 기존 업무 화면의 확인 절차에서 실행하세요. AI 일반화 연결 전에는 직접 실행하지 않습니다.",
        changes: [], preview: { targets: [], messages: [], attachments: [] }, results: [] };
      this.tasks.set(task.id, task); return Promise.resolve(structuredClone(task));
    }
    if (object(request) && ["office.member.update", "office.member.move"].includes(String(request.action))) {
      return this.execute(request, "structured").then(() => {
        if (!this.current() || !object(request.input)) return null;
        const requestId = request.input.requestId;
        return this.getTasks().find(t => t.id === `${this.deps.scope}:write:${requestId}`) ?? null;
      });
    }
    let key: string;
    try { key = JSON.stringify(request) ?? "undefined"; } catch { return Promise.resolve(null); }
    const existing = this.structured.get(key);
    if (existing) return existing;
    const taskId = `${this.deps.scope}:action:${++this.sequence}`;
    const task: OfficeTask = { id: taskId, scope: this.deps.scope, request: "구조화된 조회·화면 요청", targetLabel: "현재 수영장",
      status: "running", summary: "조회 또는 화면 열기 확인 중", changes: [], preview: { targets: [], messages: [], attachments: [] }, results: [] };
    this.tasks.set(taskId, task);
    const promise = this.execute(request, "structured").then(outcome => {
      if (!this.current()) return null;
      if (outcome.status === "success" && outcome.filters) this.taskFilters.set(taskId, { ...outcome.filters });
      const completed: OfficeTask = outcome.status === "success" ? {
        ...task, status: "completed", completedAt: this.now(),
        summary: outcome.kind === "query" ? `조회 성공 · ${outcome.count ?? 0}명 · 업무 데이터 변경 없음` : "화면 열기 성공 · 업무 데이터 변경 없음",
        results: [{ id: taskId + ":result", label: outcome.kind === "query" ? "회원 조회" : "업무 화면", target: outcome.destination,
          kind: outcome.kind === "query" ? "table" : "screen", storage: "not_stored" }],
      } : { ...task, status: outcome.status === "failed" ? "failed" : outcome.status === "cancelled" ? "cancelled" : "unknown",
        summary: outcome.message, failureReason: outcome.message };
      this.tasks.set(taskId, completed); return structuredClone(completed);
    }).finally(() => this.structured.delete(key));
    this.structured.set(key, promise);
    return promise;
  }
  openTaskResult(taskId: string, resultId: string): Promise<ActionOutcome> {
    const key = `${taskId}:${resultId}`, existing = this.resultsPending.get(key);
    if (existing) return existing;
    const promise = Promise.resolve().then(() => this.readTaskResult(taskId, resultId)).finally(() => this.resultsPending.delete(key));
    this.resultsPending.set(key, promise);
    return promise;
  }
  private async readTaskResult(taskId: string, resultId: string): Promise<ActionOutcome> {
    if (!this.current()) return cancelled();
    const task = this.tasks.get(taskId), result = task?.results.find(r => r.id === resultId);
    if (!task || !result || task.scope !== this.deps.scope) return failed("missing", "현재 세션의 결과가 아닙니다.");
    if (result.target.screen === "page") return this.execute({ action: "office.page.open", input: { path: result.target.path } }, "result");
    const filters = this.taskFilters.get(taskId);
    const request = filters ? { action: "office.members.search", input: { ...filters } }
      : result.target.screen === "home" ? { action: "office.home.open", input: {} }
      : result.target.memberId ? { action: "office.member.open", input: { memberId: result.target.memberId,
        ...(result.target.view === "full" ? { view: "full", tab: result.target.tab ?? "basic" } : {}) } } : { action: "office.members.open", input: { view: "list" } };
    const outcome = await this.execute(request, "result");
    if (outcome.status !== "success" || !this.current()) return outcome;
    const abort = new AbortController();
    const navigationVersion = this.deps.navigationVersion?.();
    // Also isolate the post-OPEN read; completion is not a read receipt.
    const key = `result:${taskId}:${resultId}`;
    try {
      const promise = Promise.resolve(outcome);
      this.pending.set(key, { promise, abort });
      const target = result.target;
      let memberPresent = true;
      let revision: string | undefined;
      let read: Omit<MembersRead, "data">;
      if (target.screen === "home") read = await this.deps.readHome(abort.signal);
      else {
        const members = await this.deps.members(abort.signal, true);
        memberPresent = !target.memberId || members.data.some(s => s.id === target.memberId);
        revision = (members.data.find(s => s.id === (target.screen === "members" ? target.memberId : "")) as any)?.office_revision;
        read = members;
      }
      if (!this.current() || abort.signal.aborted) return cancelled();
      const current = this.deps.destination();
      const entered = this.deps.navigationVersion?.() === navigationVersion && current.screen === target.screen &&
        (target.screen === "home" || current.screen === "members" && current.memberId === target.memberId &&
          current.view === target.view && (current.tab ?? "basic") === (target.tab ?? "basic"));
      const evidence: ResultReadEvidence = { scope: this.deps.scope, resultId, target, entered,
        outcome: memberPresent ? "success" : "missing", source: read.source, revision, queryStartedAt: read.queryStartedAt, receivedAt: read.receivedAt };
      const latest = this.tasks.get(taskId);
      if (latest) this.tasks.set(taskId, confirmResultRead(latest, evidence));
      return memberPresent ? outcome : failed("missing", "결과 회원이 없거나 조회 권한이 없습니다.");
    } catch (error) {
      if (!this.current() || abort.signal.aborted || error instanceof DOMException && error.name === "AbortError") return cancelled();
      return failed("query", "결과 조회에 실패했습니다. 결과는 미열람으로 유지합니다.");
    } finally { this.pending.delete(key); }
  }
}
