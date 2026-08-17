/**
 * SuperIncidents — SA0-B: 장애 관리 CRUD
 * - 목록 (severity/status/service 필터)
 * - 생성 모달
 * - 상세 + 수정 패널
 */
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

interface Incident {
  id: string;
  title: string;
  severity: "SEV1" | "SEV2" | "SEV3" | "SEV4";
  status: "OPEN" | "INVESTIGATING" | "MITIGATED" | "RESOLVED";
  service?: string | null;
  description?: string | null;
  root_cause?: string | null;
  action_taken?: string | null;
  started_at?: string | null;
  detected_at?: string | null;
  resolved_at?: string | null;
  affected_pool_ids?: string[];
  affected_users_count?: number;
  reference?: string | null;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
}

const SEV_COLORS: Record<string, string> = {
  SEV1: "bg-red-100 text-red-700 border-red-200",
  SEV2: "bg-orange-100 text-orange-700 border-orange-200",
  SEV3: "bg-amber-100 text-amber-700 border-amber-200",
  SEV4: "bg-gray-100 text-gray-600 border-gray-200",
};

const STATUS_COLORS: Record<string, string> = {
  OPEN:          "bg-red-50 text-red-600",
  INVESTIGATING: "bg-amber-50 text-amber-700",
  MITIGATED:     "bg-blue-50 text-blue-600",
  RESOLVED:      "bg-green-50 text-green-700",
};

function SevBadge({ sev }: { sev: string }) {
  return (
    <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded border ${SEV_COLORS[sev] ?? SEV_COLORS.SEV4}`}>
      {sev}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`px-2 py-0.5 text-[11px] font-semibold rounded ${STATUS_COLORS[status] ?? "bg-gray-50 text-gray-600"}`}>
      {status}
    </span>
  );
}

function fmtDate(s?: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
}

// ──────── Create/Edit Form ────────
interface IncidentForm {
  title: string;
  severity: string;
  status: string;
  service: string;
  description: string;
  root_cause: string;
  action_taken: string;
  started_at: string;
  detected_at: string;
  affected_users_count: string;
  reference: string;
}

const EMPTY_FORM: IncidentForm = {
  title: "", severity: "SEV3", status: "OPEN", service: "",
  description: "", root_cause: "", action_taken: "",
  started_at: "", detected_at: "",
  affected_users_count: "0", reference: "",
};

function IncidentFormModal({
  initial,
  onClose,
  onSaved,
}: {
  initial?: Incident | null;
  onClose: () => void;
  onSaved: (inc: Incident) => void;
}) {
  const [form, setForm] = useState<IncidentForm>(
    initial
      ? {
          title: initial.title,
          severity: initial.severity,
          status: initial.status,
          service: initial.service ?? "",
          description: initial.description ?? "",
          root_cause: initial.root_cause ?? "",
          action_taken: initial.action_taken ?? "",
          started_at: initial.started_at ? new Date(initial.started_at).toISOString().slice(0, 16) : "",
          detected_at: initial.detected_at ? new Date(initial.detected_at).toISOString().slice(0, 16) : "",
          affected_users_count: String(initial.affected_users_count ?? 0),
          reference: initial.reference ?? "",
        }
      : EMPTY_FORM,
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const f = (key: keyof IncidentForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  async function save() {
    if (!form.title.trim()) { setErr("제목을 입력하세요."); return; }
    setSaving(true); setErr("");
    try {
      const body = {
        ...form,
        affected_users_count: parseInt(form.affected_users_count, 10) || 0,
        started_at:  form.started_at  ? new Date(form.started_at).toISOString()  : null,
        detected_at: form.detected_at ? new Date(form.detected_at).toISOString() : null,
      };
      let result: Incident;
      if (initial) {
        const r = await api.patch<{ incident: Incident }>(`/super/incidents/${initial.id}`, body);
        result = r.incident;
      } else {
        const r = await api.post<{ incident: Incident }>("/super/incidents", body);
        result = r.incident;
      }
      onSaved(result);
    } catch (e: any) {
      setErr(e?.data?.error ?? "저장 실패");
    } finally {
      setSaving(false);
    }
  }

  const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div>
      <label className="block text-[11px] text-[#888] mb-1">{label}</label>
      {children}
    </div>
  );

  const inputCls = "w-full border border-[#e5e5e5] rounded-md px-3 py-1.5 text-[12px] outline-none focus:border-[#002F5F] focus:ring-1 focus:ring-[#002F5F]/20";
  const textareaCls = `${inputCls} resize-none`;

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#f0f0f0]">
          <h2 className="text-[16px] font-bold text-[#111]">{initial ? "장애 수정" : "장애 등록"}</h2>
          <button onClick={onClose} className="text-[#bbb] hover:text-[#333] text-[20px] leading-none">×</button>
        </div>

        <div className="px-6 py-4 space-y-4">
          <Field label="제목 *">
            <input value={form.title} onChange={f("title")} placeholder="장애 제목" className={inputCls} />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Severity">
              <select value={form.severity} onChange={f("severity")} className={inputCls}>
                {["SEV1", "SEV2", "SEV3", "SEV4"].map(s => <option key={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select value={form.status} onChange={f("status")} className={inputCls}>
                {["OPEN", "INVESTIGATING", "MITIGATED", "RESOLVED"].map(s => <option key={s}>{s}</option>)}
              </select>
            </Field>
          </div>

          <Field label="서비스">
            <input value={form.service} onChange={f("service")} placeholder="e.g. APP API, AI Engine" className={inputCls} />
          </Field>

          <Field label="설명">
            <textarea value={form.description} onChange={f("description")} rows={3} placeholder="장애 내용 상세" className={textareaCls} />
          </Field>

          <Field label="근본 원인">
            <textarea value={form.root_cause} onChange={f("root_cause")} rows={2} placeholder="RCA 결과" className={textareaCls} />
          </Field>

          <Field label="조치 내용">
            <textarea value={form.action_taken} onChange={f("action_taken")} rows={2} placeholder="취한 조치" className={textareaCls} />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="장애 시작">
              <input type="datetime-local" value={form.started_at} onChange={f("started_at")} className={inputCls} />
            </Field>
            <Field label="감지 시각">
              <input type="datetime-local" value={form.detected_at} onChange={f("detected_at")} className={inputCls} />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="영향 받은 사용자 수">
              <input type="number" min={0} value={form.affected_users_count} onChange={f("affected_users_count")} className={inputCls} />
            </Field>
            <Field label="Reference / URL">
              <input value={form.reference} onChange={f("reference")} placeholder="Slack 링크, PR, 커밋 등" className={inputCls} />
            </Field>
          </div>

          {err && <p className="text-[12px] text-red-500">{err}</p>}
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-[#f0f0f0]">
          <button onClick={onClose} className="px-4 py-2 text-[13px] text-[#888] hover:text-[#333] border border-[#e5e5e5] rounded-lg">
            취소
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="px-5 py-2 text-[13px] font-semibold bg-[#002F5F] text-white rounded-lg hover:bg-[#001f40] disabled:opacity-50 transition-colors"
          >
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ──────── Detail Panel ────────
function IncidentPanel({ incident, onEdit, onClose }: {
  incident: Incident;
  onEdit: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-y-0 right-0 w-full max-w-md bg-white border-l border-[#e5e5e5] shadow-2xl z-40 flex flex-col">
      <div className="flex items-center justify-between px-5 py-4 border-b border-[#f0f0f0]">
        <div className="flex items-center gap-2">
          <SevBadge sev={incident.severity} />
          <StatusBadge status={incident.status} />
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onEdit} className="text-[12px] text-[#002F5F] hover:underline">수정</button>
          <button onClick={onClose} className="text-[#bbb] hover:text-[#333] text-[20px] leading-none ml-2">×</button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        <h2 className="text-[16px] font-bold text-[#111]">{incident.title}</h2>

        <table className="w-full text-[12px]">
          <tbody>
            {[
              ["서비스", incident.service],
              ["장애 시작", fmtDate(incident.started_at)],
              ["감지 시각", fmtDate(incident.detected_at)],
              ["해결 시각", fmtDate(incident.resolved_at)],
              ["영향 사용자", incident.affected_users_count ? `${incident.affected_users_count.toLocaleString()}명` : null],
              ["등록자", incident.created_by],
              ["등록일", fmtDate(incident.created_at)],
            ].map(([label, val]) => (
              <tr key={label as string} className="border-b border-[#f5f5f5] last:border-0">
                <td className="py-2 text-[#888] w-24">{label as string}</td>
                <td className="py-2 text-[#111] font-medium">{val ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {incident.description && (
          <div>
            <div className="text-[11px] text-[#aaa] font-semibold uppercase mb-1">설명</div>
            <p className="text-[12px] text-[#444] whitespace-pre-wrap leading-relaxed">{incident.description}</p>
          </div>
        )}
        {incident.root_cause && (
          <div>
            <div className="text-[11px] text-[#aaa] font-semibold uppercase mb-1">근본 원인</div>
            <p className="text-[12px] text-[#444] whitespace-pre-wrap leading-relaxed">{incident.root_cause}</p>
          </div>
        )}
        {incident.action_taken && (
          <div>
            <div className="text-[11px] text-[#aaa] font-semibold uppercase mb-1">조치 내용</div>
            <p className="text-[12px] text-[#444] whitespace-pre-wrap leading-relaxed">{incident.action_taken}</p>
          </div>
        )}
        {(incident.affected_pool_ids?.length ?? 0) > 0 && (
          <div>
            <div className="text-[11px] text-[#aaa] font-semibold uppercase mb-1">영향 수영장</div>
            <div className="flex flex-wrap gap-1">
              {incident.affected_pool_ids!.map(pid => (
                <span key={pid} className="px-2 py-0.5 bg-[#f0f0f0] rounded text-[11px] text-[#555]">{pid}</span>
              ))}
            </div>
          </div>
        )}
        {incident.reference && (
          <div>
            <div className="text-[11px] text-[#aaa] font-semibold uppercase mb-1">Reference</div>
            <p className="text-[12px] text-[#002F5F] break-all">{incident.reference}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ──────── Main Page ────────
const SEVERITY_FILTER = ["", "SEV1", "SEV2", "SEV3", "SEV4"];
const STATUS_FILTER   = ["", "OPEN", "INVESTIGATING", "MITIGATED", "RESOLVED"];

export default function SuperIncidents() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [sevFilter, setSevFilter] = useState("");
  const [stFilter,  setStFilter]  = useState("");
  const [svcFilter, setSvcFilter] = useState("");

  const [selected, setSelected] = useState<Incident | null>(null);
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);

  function buildQuery() {
    const p: string[] = [];
    if (sevFilter) p.push(`severity=${sevFilter}`);
    if (stFilter)  p.push(`status=${stFilter}`);
    if (svcFilter) p.push(`service=${encodeURIComponent(svcFilter)}`);
    p.push("limit=200");
    return p.join("&");
  }

  function load() {
    setLoading(true); setError(false);
    api.get<{ incidents: Incident[]; total: number }>(`/super/incidents?${buildQuery()}`)
      .then((r) => { setIncidents(r.incidents ?? []); setTotal(r.total); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [sevFilter, stFilter, svcFilter]);

  function onSaved(inc: Incident) {
    setIncidents(prev => {
      const idx = prev.findIndex(i => i.id === inc.id);
      if (idx >= 0) {
        const next = [...prev]; next[idx] = inc; return next;
      }
      return [inc, ...prev];
    });
    setSelected(inc);
    setEditing(false);
    setCreating(false);
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="text-[20px] font-bold text-[#111]">장애 관리</h1>
          <p className="text-[12px] text-[#999] mt-0.5">서비스 장애 등록, 추적, 사후 분석</p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="px-4 py-2 text-[13px] font-semibold bg-[#002F5F] text-white rounded-lg hover:bg-[#001f40] transition-colors"
        >
          + 장애 등록
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-4 flex-wrap">
        <select value={sevFilter} onChange={e => setSevFilter(e.target.value)}
          className="border border-[#e5e5e5] rounded-md px-3 py-1.5 text-[12px] outline-none focus:border-[#002F5F]">
          {SEVERITY_FILTER.map(s => <option key={s} value={s}>{s || "Severity 전체"}</option>)}
        </select>
        <select value={stFilter} onChange={e => setStFilter(e.target.value)}
          className="border border-[#e5e5e5] rounded-md px-3 py-1.5 text-[12px] outline-none focus:border-[#002F5F]">
          {STATUS_FILTER.map(s => <option key={s} value={s}>{s || "Status 전체"}</option>)}
        </select>
        <input
          value={svcFilter}
          onChange={e => setSvcFilter(e.target.value)}
          placeholder="서비스 검색..."
          className="border border-[#e5e5e5] rounded-md px-3 py-1.5 text-[12px] outline-none focus:border-[#002F5F] w-40"
        />
        <span className="text-[12px] text-[#bbb] self-center ml-auto">{total}건</span>
      </div>

      {/* Table */}
      {loading ? (
        <p className="text-[13px] text-[#bbb] animate-pulse py-10 text-center">불러오는 중...</p>
      ) : error ? (
        <p className="text-[13px] text-red-500 py-10 text-center">데이터 로드 실패</p>
      ) : (
        <div className="bg-white border border-[#e5e5e5] rounded-lg overflow-hidden">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-[#f0f0f0] bg-[#fafafa]">
                <th className="text-left px-4 py-3 text-[11px] text-[#888] font-semibold">장애명</th>
                <th className="text-left px-3 py-3 text-[11px] text-[#888] font-semibold">Sev</th>
                <th className="text-left px-3 py-3 text-[11px] text-[#888] font-semibold">Status</th>
                <th className="text-left px-3 py-3 text-[11px] text-[#888] font-semibold">서비스</th>
                <th className="text-left px-3 py-3 text-[11px] text-[#888] font-semibold">등록일</th>
              </tr>
            </thead>
            <tbody>
              {incidents.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-[12px] text-[#bbb]">장애 기록 없음</td>
                </tr>
              ) : incidents.map((inc) => (
                <tr
                  key={inc.id}
                  className={`border-b border-[#f5f5f5] last:border-0 cursor-pointer transition-colors ${
                    selected?.id === inc.id ? "bg-[#f0f4ff]" : "hover:bg-[#fafafa]"
                  }`}
                  onClick={() => { setSelected(inc); setEditing(false); }}
                >
                  <td className="px-4 py-3 font-medium text-[#111] max-w-xs truncate">{inc.title}</td>
                  <td className="px-3 py-3"><SevBadge sev={inc.severity} /></td>
                  <td className="px-3 py-3"><StatusBadge status={inc.status} /></td>
                  <td className="px-3 py-3 text-[#888]">{inc.service ?? "—"}</td>
                  <td className="px-3 py-3 text-[#bbb]">{fmtDate(inc.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail Panel */}
      {selected && !editing && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setSelected(null)} />
          <IncidentPanel
            incident={selected}
            onEdit={() => setEditing(true)}
            onClose={() => setSelected(null)}
          />
        </>
      )}

      {/* Edit Modal */}
      {editing && selected && (
        <IncidentFormModal initial={selected} onClose={() => setEditing(false)} onSaved={onSaved} />
      )}

      {/* Create Modal */}
      {creating && (
        <IncidentFormModal onClose={() => setCreating(false)} onSaved={onSaved} />
      )}
    </div>
  );
}
