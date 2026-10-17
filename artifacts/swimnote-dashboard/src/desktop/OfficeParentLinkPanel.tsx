import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api-client";
import { Blocked, ContractError, QState, arr, errMsg, rec } from "./OfficeAppShared";

type Pending = { id: string; parent_id: string; child_name_raw: string; pending_reason: string | null; rejection_reason: string | null; status: string; created_at: string; parent_name: string | null; parent_phone: string | null };
type Candidate = { id: string; name: string; parent_name: string | null; parent_phone: string | null; parent_phone2: string | null; parent_phone3: string | null; parent_phone4: string | null };
type Info = { pending_id: string; child_name_raw: string; parent_name: string; parent_phone: string; phone_verified: boolean; candidates: Candidate[]; reason: string | null };

/** Parent app link requests. pool_admin/sub_admin/super_admin. Never calls GET /admin/parents. */
export function ParentLinkPanel() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"pending" | "rejected">("pending");
  const [sel, setSel] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState("");
  const list = useQuery<Pending[]>({ queryKey: ["oap", "parent-v2", tab], queryFn: async () => {
    const o = rec(await api.get<unknown>(`/admin/parent-v2-pending?status=${tab}`), "GET /admin/parent-v2-pending");
    if (o.success !== true) throw new ContractError("GET /admin/parent-v2-pending");
    const rows = arr<Pending>(o.data, "GET /admin/parent-v2-pending");
    rows.forEach((r) => { if (typeof r.id !== "string" || typeof r.status !== "string") throw new ContractError("GET /admin/parent-v2-pending"); });
    return rows;
  } });
  const info = useQuery<Info>({ queryKey: ["oap", "parent-v2-info", sel], enabled: !!sel, queryFn: async () => {
    const o = rec(await api.get<unknown>(`/admin/parent-v2-pending/${encodeURIComponent(sel as string)}/approval-info`), "GET approval-info");
    const d = rec(o.data, "GET approval-info");
    if (o.success !== true || typeof d.phone_verified !== "boolean" || !Array.isArray(d.candidates)) throw new ContractError("GET approval-info");
    return d as unknown as Info;
  } });
  const done = (m: string) => { setMsg(m); setSel(null); setReason(""); qc.invalidateQueries({ queryKey: ["oap", "parent-v2"] }); qc.invalidateQueries({ queryKey: ["oap", "students-contacts"] }); };
  const approve = useMutation({
    mutationFn: async (v: { p: Pending; student_id: string }) => {
      if (v.p.status === "rejected") {
        const o = rec(await api.patch<unknown>(`/admin/parent-v2-pending/${encodeURIComponent(v.p.id)}`, { action: "approve", student_id: v.student_id }), "PATCH parent-v2-pending");
        if (o.success !== true) throw new ContractError("PATCH parent-v2-pending");
      } else {
        const o = rec(await api.post<unknown>(`/admin/parent-v2-pending/${encodeURIComponent(v.p.id)}/confirm`, { student_id: v.student_id }), "POST confirm");
        if (rec(o.data, "POST confirm").success !== true) throw new ContractError("POST confirm");
      }
    },
    onSuccess: () => done("연결을 승인했습니다."),
    onError: (e) => setMsg(`승인 결과를 확인하세요: ${errMsg(e)}`),
  });
  const reject = useMutation({
    mutationFn: async (p: Pending) => { if (rec(await api.patch<unknown>(`/admin/parent-v2-pending/${encodeURIComponent(p.id)}`, { action: "reject", reason: reason.trim() || undefined }), "PATCH parent-v2-pending").success !== true) throw new ContractError("PATCH parent-v2-pending"); },
    onSuccess: () => done("연결 요청을 거절했습니다."),
    onError: (e) => setMsg(`거절 결과를 확인하세요: ${errMsg(e)}`),
  });
  const rows = list.data ?? [];
  const cur = rows.find((r) => r.id === sel);
  const busy = approve.isPending || reject.isPending;
  return <>
    <div className="oap-row"><b>학부모 앱 연결 요청</b>
      {(["pending", "rejected"] as const).map((t) => <button key={t} aria-pressed={tab === t} onClick={() => { setTab(t); setSel(null); }}>{t === "pending" ? "대기" : "거절됨"}</button>)}
      {msg && <span className="oap-sub" role="status">{msg}</span>}</div>
    <QState q={list} />
    {!list.isLoading && !list.isError && (rows.length === 0 ? <div className="oap-empty">연결 요청이 없습니다.</div>
      : <div className="oap-card"><table><thead><tr><th>요청일</th><th>보호자(앱 가입)</th><th>가입 연락처</th><th>입력한 자녀 이름</th><th>사유</th><th /></tr></thead><tbody>
        {rows.map((r) => <tr key={r.id}><td>{r.created_at?.slice(0, 10)}</td><td>{r.parent_name ?? "-"}</td><td>{r.parent_phone ?? "-"}</td><td>{r.child_name_raw}</td><td>{r.rejection_reason ?? r.pending_reason ?? "-"}</td>
          <td><button aria-pressed={sel === r.id} onClick={() => setSel(sel === r.id ? null : r.id)}>확인</button></td></tr>)}</tbody></table></div>)}
    {cur && <div className="oap-card" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      <QState q={info} />
      {info.data && <>
        <span className="oap-sub">{info.data.phone_verified ? "가입 연락처가 같은 수영장의 등록 연락처와 일치합니다(서버 확인)." : "가입 연락처가 등록 연락처와 일치하지 않습니다. 관계를 직접 확인한 뒤 승인하세요."}</span>
        {info.data.candidates.length === 0 ? <div className="oap-empty">연결 가능한 회원 후보가 없습니다.</div>
          : <table><thead><tr><th>후보 회원</th><th>등록 보호자</th><th>등록 연락처</th><th /></tr></thead><tbody>
            {info.data.candidates.map((c) => <tr key={c.id}><td>{c.name}</td><td>{c.parent_name ?? "-"}</td><td>{[c.parent_phone, c.parent_phone2, c.parent_phone3, c.parent_phone4].filter(Boolean).join(" / ") || "-"}</td>
              <td><button disabled={busy} onClick={() => { if (window.confirm(`${info.data?.parent_name} 님(${info.data?.parent_phone})을 ${c.name} 회원의 보호자로 연결합니다. 학부모 앱으로 연결 완료 알림이 발송됩니다. 승인할까요?`)) approve.mutate({ p: cur, student_id: c.id }); }}>이 회원으로 승인</button></td></tr>)}</tbody></table>}
      </>}
      {cur.status === "pending" && <div className="oap-row"><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="거절 사유(선택, 학부모에게 표시)" />
        <button disabled={busy} onClick={() => { if (window.confirm("연결 요청을 거절합니다. 학부모 앱으로 거절 알림이 발송됩니다. 거절할까요?")) reject.mutate(cur); }}>거절</button></div>}
    </div>}
    <Blocked>승인은 서버가 후보와 소속 수영장을 다시 검증하며, 전화번호 인증과 로그인 세션 확인은 보호자 앱에서만 이루어집니다. 이 화면은 서버가 계산한 일치 여부만 표시하고 인증 상태를 바꾸지 않습니다.</Blocked>
  </>;
}
