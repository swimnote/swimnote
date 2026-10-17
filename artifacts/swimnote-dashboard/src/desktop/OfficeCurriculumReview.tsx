import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api-client";
import { Blocked, ContractError, QState, arr, rec } from "./OfficeAppShared";
import "./OfficeAppPages.css";

type FileRow = { id: string; file_type: string; original_filename: string | null; uploaded_at: string; submission_version?: number };
type Revision = { id: string; section: string; message: string; requested_at: string; status: string };
type Status = { submission: Record<string, unknown> | null; files: FileRow[]; pending_revisions: Revision[] };

/** pool_admin view of the DOCX curriculum submission (GET /x-setup/status). Structuring, editing and approval are super_admin-only server routes. */
export function OfficeCurriculumReview() {
  const q = useQuery<Status>({ queryKey: ["oap", "x-setup-status"], queryFn: async () => {
    const o = rec(await api.get<unknown>("/x-setup/status"), "GET /x-setup/status");
    if (!Array.isArray(o.files) || !Array.isArray(o.pending_revisions)) throw new ContractError("GET /x-setup/status");
    return { submission: o.submission && typeof o.submission === "object" ? (o.submission as Record<string, unknown>) : null, files: arr<FileRow>(o.files, "files"), pending_revisions: arr<Revision>(o.pending_revisions, "pending_revisions") };
  } });
  const flags = Object.entries(q.data?.submission ?? {}).filter(([k, v]) => /status|submitted|approved/i.test(k) && (typeof v === "string" || typeof v === "boolean" || v === null));
  const cur = (q.data?.files ?? []).filter((f) => f.file_type === "curriculum");
  return <div className="oap" data-testid="office-curriculum-review">
    <div><h1>교육과정 검수 현황</h1><p className="oap-sub">업로드한 교육과정 문서의 제출·검수 상태</p></div>
    <QState q={q} />
    {q.data && <>
      <div className="oap-card"><table><thead><tr><th>제출 항목</th><th>값</th></tr></thead><tbody>
        {flags.length === 0 ? <tr><td colSpan={2}>제출 상태 정보가 없습니다.</td></tr> : flags.map(([k, v]) => <tr key={k}><td>{k}</td><td>{v === null ? "-" : String(v)}</td></tr>)}</tbody></table></div>
      <div className="oap-card"><table><thead><tr><th>교육과정 파일</th><th>업로드</th></tr></thead><tbody>
        {cur.length === 0 ? <tr><td colSpan={2}>업로드된 교육과정 문서가 없습니다.</td></tr> : cur.map((f) => <tr key={f.id}><td>{f.original_filename ?? "-"}</td><td>{f.uploaded_at?.slice(0, 16).replace("T", " ")}</td></tr>)}</tbody></table></div>
      {q.data.pending_revisions.length === 0 ? <div className="oap-empty">보완 요청이 없습니다.</div>
        : <div className="oap-card"><table><thead><tr><th>구분</th><th>보완 요청 내용</th><th>요청일</th></tr></thead><tbody>
          {q.data.pending_revisions.map((r) => <tr key={r.id}><td>{r.section}</td><td>{r.message}</td><td>{r.requested_at?.slice(0, 10)}</td></tr>)}</tbody></table></div>}
    </>}
    <Blocked>파싱된 교육과정의 구조 확인, 수정, 승인은 서버에서 super_admin 전용입니다(POST /super/x-setup/:poolId/structure, GET .../structured, PATCH .../curriculum/structured, POST .../structured/approve). pool_admin 계정으로는 호출할 수 없어 PC에서 직접 검수하거나 승인할 수 없으며, 이 화면은 조회만 제공합니다. 파일 제출은 업로드 화면에서 처리합니다.</Blocked>
  </div>;
}
