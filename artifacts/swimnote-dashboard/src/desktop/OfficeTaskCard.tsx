import { taskPresentation, unreadResults, type OfficeTask, type TaskResult } from "./OfficeTaskContract";

/** Future collapsed-manager badge; no synthetic tasks are installed in the live manager. */
export function OfficeTaskSummary({ tasks }: { tasks: OfficeTask[] }) {
  return <span aria-label="미열람 결과">미열람 {tasks.reduce((n, task) => n + unreadResults(task), 0)}</span>;
}

/** Controlled presentation only. Not mounted by the disconnected manager; synthetic tests supply tasks. */
export function OfficeTaskCard({ task, onOpenResult, onConfirm }: {
  task: OfficeTask; onOpenResult: (result: TaskResult) => void; onConfirm?: () => void;
}) {
  const status = taskPresentation(task);
  return <article className="office-task-card" aria-label={`작업: ${task.request}`}>
    <header><h3>{task.request}</h3><span className="office-task-status" data-tone={status.tone}>{status.label}</span></header>
    <p>작업 대상: {task.targetLabel}</p><p>{task.summary}</p>
    {task.status === "partial" && <p>{task.incomplete || "완료되지 않은 대상의 상태 확인이 필요합니다."}</p>}
    {task.status === "failed" && <p>{task.failureReason || "실패 사유 확인이 필요합니다."}</p>}
    <div className="office-task-previews" aria-label="대상·메시지·첨부 미리보기">
      {task.preview.targets.map((v, i) => <p key={`t${i}`}>대상: {v}</p>)}
      {task.preview.messages.map((v, i) => <p key={`m${i}`}>메시지: {v}</p>)}
      {task.preview.attachments.map((v, i) => <p key={`a${i}`}>첨부: {v}</p>)}
      {task.changes.length > 0 && <table><caption>변경 전 → 후</caption><tbody>{task.changes.map((c, i) =>
        <tr key={i}><th>{c.field}</th><td>{c.before}</td><td>→ {c.after}</td></tr>)}</tbody></table>}
    </div>
    {task.status === "confirmation_required" && <button type="button" disabled={!onConfirm} onClick={onConfirm}>실행 확인</button>}
    {task.results.map(result => <div key={result.id}>
      <p>{result.label} · {({ screen: "화면", image: "이미지", table: "표", file: "파일" })[result.kind]}
        {" · "}{result.viewedAt === undefined ? "미열람" : "열람함"}
        {" · "}{({ not_stored: "보관 안 됨", stored: "보관됨", failed: "보관 실패" })[result.storage]}</p>
      <button type="button" disabled={!(task.status === "completed" || task.status === "partial")}
        onClick={() => onOpenResult(result)}>결과 보기: {result.label}</button>
    </div>)}
  </article>;
}
