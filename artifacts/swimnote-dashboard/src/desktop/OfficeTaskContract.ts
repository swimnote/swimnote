import { validOfficeDestination, type OfficeDestination } from "./OfficeNavigation";

/** UI-only future integration contract. Not an executor, API, persistent store or approval. */
export type TaskStatus = "ready" | "confirmation_required" | "running" | "completed" | "partial" | "failed" | "unknown" | "cancelled";
export type TaskResult = {
  id: string; label: string; target: OfficeDestination;
  kind: "screen" | "image" | "table" | "file";
  storage: "not_stored" | "stored" | "failed";
  expectedRevision?: string; viewedAt?: number;
};
export type OfficeTask = {
  id: string; scope: string; request: string; targetLabel: string; status: TaskStatus;
  summary: string; incomplete?: string; failureReason?: string; completedAt?: number;
  changes: { field: string; before: string; after: string }[];
  preview: { targets: string[]; messages: string[]; attachments: string[] };
  results: TaskResult[];
};
export type ResultReadEvidence = {
  scope: string; resultId: string; target: OfficeDestination;
  entered: boolean; outcome: "success" | "failed" | "forbidden" | "missing";
  source: "network" | "cache"; queryStartedAt: number; receivedAt: number;
  revision?: string;
};
export const unreadResults = (task: OfficeTask) =>
  task.status === "completed" || task.status === "partial" ? task.results.filter(r => r.viewedAt === undefined).length : 0;
export function taskPresentation(task: OfficeTask) {
  if (task.status === "completed") return unreadResults(task)
    ? { label: "완료 · 미열람", tone: "unread" } : { label: "완료 · 열람함", tone: "neutral" };
  return ({
    ready: { label: "준비", tone: "neutral" },
    confirmation_required: { label: "확인 대기", tone: "neutral" },
    running: { label: "실행 중", tone: "neutral" },
    partial: { label: "일부 완료", tone: "partial" },
    failed: { label: "실패", tone: "failed" },
    cancelled: { label: "취소됨", tone: "neutral" },
    unknown: { label: "결과 불명 · 상태 확인 필요", tone: "unknown" },
  })[task.status];
}

/** OPEN/click alone never changes read state. Require fresh post-action success for this exact scope/result. */
export function confirmResultRead(task: OfficeTask, evidence: ResultReadEvidence): OfficeTask {
  if (!(task.status === "completed" || task.status === "partial") || task.completedAt === undefined ||
      task.scope !== evidence.scope || !evidence.entered || evidence.outcome !== "success" ||
      evidence.source !== "network" || !validOfficeDestination(evidence.target) ||
      !Number.isFinite(task.completedAt) || !Number.isFinite(evidence.queryStartedAt) || !Number.isFinite(evidence.receivedAt) ||
      evidence.queryStartedAt < task.completedAt || evidence.receivedAt < evidence.queryStartedAt) return task;
  const result = task.results.find(r => r.id === evidence.resultId);
  if (!result || !validOfficeDestination(result.target) || result.viewedAt !== undefined ||
      result.target.screen !== evidence.target.screen ||
      (result.target.screen === "members" && evidence.target.screen === "members" &&
        (result.target.memberId !== evidence.target.memberId || result.target.view !== evidence.target.view ||
          (result.target.tab ?? "basic") !== (evidence.target.tab ?? "basic"))) ||
      (result.expectedRevision !== undefined && result.expectedRevision !== evidence.revision)) return task;
  return { ...task, results: task.results.map(r => r === result ? { ...r, viewedAt: evidence.receivedAt } : r) };
}
