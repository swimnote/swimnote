/**
 * AuditLogs.tsx — WP14 Audit Log Viewer (super_admin only)
 *
 * READ ONLY. 수정/삭제 버튼 절대 없음.
 * 민감 필드는 서버에서 [REDACTED]로 마스킹됨.
 */
import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";

const PRIMARY  = "#002F5F";
const SECONDARY = "#01B2F1";

interface AuditLog {
  id:             string;
  entity_type:    string;
  entity_id:      string;
  entity_version: number;
  action:         string;
  actor_type:     string;
  actor_id:       string | null;
  pool_id:        string | null;
  pool_name?:     string | null;
  reason:         string | null;
  created_at:     string;
}

interface AuditLogDetail extends AuditLog {
  before_data:    unknown;
  after_data:     unknown;
  request_id:     string | null;
  correlation_id: string | null;
  ip_hash:        string | null;
}

const ACTION_LABELS: Record<string, string> = {
  create: "생성",
  update: "변경",
  delete: "삭제",
};
const ACTOR_LABELS: Record<string, string> = {
  super_admin: "슈퍼관리자",
  pool_admin:  "수영장관리자",
  teacher:     "강사",
  parent:      "학부모",
  system:      "시스템",
  revenuecat:  "RevenueCat",
};
const ACTION_COLOR: Record<string, string> = {
  create: "bg-green-50 text-green-700 border-green-200",
  update: "bg-blue-50 text-blue-700 border-blue-200",
  delete: "bg-red-50 text-red-700 border-red-200",
};

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleString("ko-KR", {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  } catch { return iso; }
}

function JsonBlock({ data, label }: { data: unknown; label: string }) {
  if (data === null || data === undefined) return null;
  return (
    <div className="mb-3">
      <p className="text-[11px] font-semibold text-[#888] mb-1.5">{label}</p>
      <pre className="text-[11px] text-[#333] bg-[#f8f9fb] rounded-xl p-3 overflow-x-auto whitespace-pre-wrap break-all">
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}

const ENTITY_TYPE_OPTIONS = [
  "swimming_pool_xmode",
  "global_template_set",
  "x_global_template",
  "growth_event",
];

export default function AuditLogs() {
  // 필터 state
  const [action,      setAction]      = useState("");
  const [entityType,  setEntityType]  = useState("");
  const [poolId,      setPoolId]      = useState("");
  const [from,        setFrom]        = useState("");
  const [to,          setTo]          = useState("");

  // 목록 state
  const [logs,      setLogs]      = useState<AuditLog[]>([]);
  const [total,     setTotal]     = useState(0);
  const [offset,    setOffset]    = useState(0);
  const LIMIT = 20;

  type LoadState = "idle" | "loading" | "success" | "error";
  const [loadState, setLoadState] = useState<LoadState>("idle");

  // 상세 모달
  const [detail,        setDetail]        = useState<AuditLogDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailId,      setDetailId]      = useState<string | null>(null);

  const buildQuery = useCallback((off = offset) => {
    const params = new URLSearchParams();
    params.set("limit",  String(LIMIT));
    params.set("offset", String(off));
    if (action)     params.set("action",      action);
    if (entityType) params.set("entity_type", entityType);
    if (poolId)     params.set("pool_id",     poolId);
    if (from)       params.set("from",        from);
    if (to)         params.set("to",          to);
    return `/super/audit-logs?${params.toString()}`;
  }, [offset, action, entityType, poolId, from, to]);

  const fetchLogs = useCallback(async (off = 0) => {
    setLoadState("loading");
    try {
      const data = await api.get<{ logs: AuditLog[]; total: number }>(buildQuery(off));
      setLogs(data.logs ?? []);
      setTotal(data.total ?? 0);
      setOffset(off);
      setLoadState("success");
    } catch {
      setLoadState("error");
    }
  }, [buildQuery]);

  useEffect(() => { fetchLogs(0); }, []); // 최초 1회

  const handleSearch = () => fetchLogs(0);

  const handleDetail = async (id: string) => {
    setDetailId(id);
    setDetailLoading(true);
    setDetail(null);
    try {
      const data = await api.get<{ log: AuditLogDetail }>(`/super/audit-logs/${id}`);
      setDetail(data.log);
    } catch { /* 404 등 — 모달은 열리지만 내용 없음 */ }
    finally { setDetailLoading(false); }
  };

  const closeDetail = () => { setDetailId(null); setDetail(null); };

  const totalPages = Math.ceil(total / LIMIT);
  const currentPage = Math.floor(offset / LIMIT) + 1;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-[17px] font-bold text-[#0a0a0a]">감사 로그</h2>
          <p className="text-[12px] text-[#aaa] mt-0.5">READ ONLY — 수정·삭제 없음</p>
        </div>
        <button
          onClick={handleSearch}
          className="text-[12px] text-[#888] hover:text-[#0a0a0a] transition-colors"
        >
          새로고침
        </button>
      </div>

      {/* 필터 바 */}
      <div className="bg-white rounded-2xl border border-[#ebebeb] p-4 mb-4 flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-semibold text-[#888]">Action</label>
          <select
            value={action}
            onChange={e => setAction(e.target.value)}
            className="px-3 py-2 rounded-xl border border-[#e5e5e5] text-[13px] focus:outline-none focus:border-[#01B2F1]"
          >
            <option value="">전체</option>
            <option value="create">생성</option>
            <option value="update">변경</option>
            <option value="delete">삭제</option>
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-semibold text-[#888]">대상 유형</label>
          <select
            value={entityType}
            onChange={e => setEntityType(e.target.value)}
            className="px-3 py-2 rounded-xl border border-[#e5e5e5] text-[13px] focus:outline-none focus:border-[#01B2F1]"
          >
            <option value="">전체</option>
            {ENTITY_TYPE_OPTIONS.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-semibold text-[#888]">Pool ID</label>
          <input
            type="text"
            value={poolId}
            onChange={e => setPoolId(e.target.value)}
            placeholder="pool_xxx"
            className="px-3 py-2 rounded-xl border border-[#e5e5e5] text-[13px] w-[160px] focus:outline-none focus:border-[#01B2F1]"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-semibold text-[#888]">From</label>
          <input
            type="date"
            value={from}
            onChange={e => setFrom(e.target.value)}
            className="px-3 py-2 rounded-xl border border-[#e5e5e5] text-[13px] focus:outline-none focus:border-[#01B2F1]"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-semibold text-[#888]">To</label>
          <input
            type="date"
            value={to}
            onChange={e => setTo(e.target.value)}
            className="px-3 py-2 rounded-xl border border-[#e5e5e5] text-[13px] focus:outline-none focus:border-[#01B2F1]"
          />
        </div>

        <button
          onClick={handleSearch}
          className="px-5 py-2 rounded-xl text-white text-[13px] font-semibold transition-opacity hover:opacity-85"
          style={{ background: PRIMARY }}
        >
          검색
        </button>

        {(action || entityType || poolId || from || to) && (
          <button
            onClick={() => {
              setAction(""); setEntityType(""); setPoolId(""); setFrom(""); setTo("");
              setTimeout(() => fetchLogs(0), 0);
            }}
            className="px-4 py-2 rounded-xl border border-[#ebebeb] text-[13px] text-[#888] hover:bg-[#f5f5f5]"
          >
            초기화
          </button>
        )}
      </div>

      {/* 총 건수 */}
      {loadState === "success" && (
        <p className="text-[12px] text-[#aaa] mb-3">
          총 {total.toLocaleString()}건
          {totalPages > 1 && ` (${currentPage}/${totalPages} 페이지)`}
        </p>
      )}

      {/* 로딩 */}
      {loadState === "loading" && (
        <div className="py-20 text-center text-[#aaa] text-[14px]">불러오는 중...</div>
      )}

      {/* 에러 */}
      {loadState === "error" && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-8 text-center">
          <p className="text-[14px] text-red-600 font-semibold mb-2">데이터를 불러오지 못했습니다.</p>
          <button
            onClick={handleSearch}
            className="mt-2 px-5 py-2 rounded-xl text-white text-[13px] font-semibold"
            style={{ background: PRIMARY }}
          >
            다시 시도
          </button>
        </div>
      )}

      {/* 빈 상태 */}
      {loadState === "success" && logs.length === 0 && (
        <div className="bg-white rounded-2xl border border-[#ebebeb] py-20 text-center">
          <p className="text-[14px] text-[#aaa]">감사 로그가 없습니다.</p>
        </div>
      )}

      {/* 목록 */}
      {loadState === "success" && logs.length > 0 && (
        <>
          <div className="space-y-2">
            {logs.map(log => {
              const actionCls = ACTION_COLOR[log.action] ?? "bg-gray-100 text-gray-600 border-gray-200";
              return (
                <div
                  key={log.id}
                  onClick={() => handleDetail(log.id)}
                  className="bg-white rounded-2xl border border-[#ebebeb] p-4 cursor-pointer hover:border-[#ddd] hover:shadow-sm transition-all"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                    {/* action badge */}
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold border shrink-0 ${actionCls}`}>
                      {ACTION_LABELS[log.action] ?? log.action}
                    </span>

                    {/* entity */}
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold text-[#0a0a0a] truncate">
                        {log.entity_type}
                        <span className="font-normal text-[#888] ml-1.5 text-[12px]">
                          #{log.entity_id.slice(0, 16)}{log.entity_id.length > 16 ? "…" : ""}
                        </span>
                      </p>
                      <p className="text-[11px] text-[#aaa] mt-0.5 truncate">
                        {ACTOR_LABELS[log.actor_type] ?? log.actor_type}
                        {log.actor_id && ` · ${log.actor_id.slice(0, 12)}…`}
                        {log.pool_name && ` · ${log.pool_name}`}
                        {log.reason && ` · ${log.reason}`}
                      </p>
                    </div>

                    {/* timestamp */}
                    <p className="text-[11px] text-[#bbb] shrink-0">{fmtDate(log.created_at)}</p>
                    <span className="text-[#ccc] text-[12px] shrink-0 hidden sm:block">›</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* 페이지네이션 */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-6">
              <button
                disabled={offset === 0}
                onClick={() => fetchLogs(Math.max(0, offset - LIMIT))}
                className="px-4 py-2 rounded-xl border border-[#ebebeb] text-[13px] text-[#555] hover:bg-[#f5f5f5] disabled:opacity-40"
              >
                ← 이전
              </button>
              <span className="text-[13px] text-[#888] px-2">
                {currentPage} / {totalPages}
              </span>
              <button
                disabled={offset + LIMIT >= total}
                onClick={() => fetchLogs(offset + LIMIT)}
                className="px-4 py-2 rounded-xl border border-[#ebebeb] text-[13px] text-[#555] hover:bg-[#f5f5f5] disabled:opacity-40"
              >
                다음 →
              </button>
            </div>
          )}
        </>
      )}

      {/* 상세 모달 */}
      {detailId && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4"
          onClick={closeDetail}
        >
          <div
            className="bg-white rounded-2xl w-full max-w-2xl shadow-xl flex flex-col"
            style={{ maxHeight: "80vh" }}
            onClick={e => e.stopPropagation()}
          >
            {/* 모달 헤더 */}
            <div className="p-5 border-b border-[#f0f0f0] flex items-center justify-between shrink-0">
              <p className="text-[15px] font-bold text-[#0a0a0a]">감사 로그 상세</p>
              <button onClick={closeDetail} className="text-[#bbb] hover:text-[#888] text-[20px] leading-none">×</button>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {detailLoading && (
                <div className="py-16 text-center text-[#aaa] text-[14px]">불러오는 중...</div>
              )}

              {!detailLoading && !detail && (
                <div className="py-16 text-center text-red-500 text-[14px]">상세 정보를 불러오지 못했습니다.</div>
              )}

              {!detailLoading && detail && (
                <div className="space-y-4">
                  {/* 기본 정보 그리드 */}
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { label: "ID",           value: detail.id },
                      { label: "Action",       value: ACTION_LABELS[detail.action] ?? detail.action },
                      { label: "Entity Type",  value: detail.entity_type },
                      { label: "Entity ID",    value: detail.entity_id },
                      { label: "Entity Ver.",  value: String(detail.entity_version) },
                      { label: "Actor Type",   value: ACTOR_LABELS[detail.actor_type] ?? detail.actor_type },
                      { label: "Actor ID",     value: detail.actor_id ?? "—" },
                      { label: "Pool",         value: detail.pool_name ? `${detail.pool_name} (${detail.pool_id})` : (detail.pool_id ?? "—") },
                      { label: "Reason",       value: detail.reason ?? "—" },
                      { label: "Timestamp",    value: fmtDate(detail.created_at) },
                      { label: "Request ID",   value: detail.request_id ?? "—" },
                      { label: "Correlation",  value: detail.correlation_id ?? "—" },
                      { label: "IP Hash",      value: detail.ip_hash ?? "—" },
                    ].map(({ label, value }) => (
                      <div key={label} className="bg-[#f8f9fb] rounded-xl p-3">
                        <p className="text-[10px] font-semibold text-[#aaa] mb-1">{label}</p>
                        <p className="text-[12px] text-[#333] break-all">{value}</p>
                      </div>
                    ))}
                  </div>

                  {/* Before / After Data */}
                  <JsonBlock data={detail.before_data} label="Before Data (마스킹 적용)" />
                  <JsonBlock data={detail.after_data}  label="After Data (마스킹 적용)" />

                  {/* 불변 안내 */}
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-center">
                    <p className="text-[11px] text-amber-700 font-semibold">감사 로그는 읽기 전용입니다. 수정·삭제 불가.</p>
                  </div>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-[#f0f0f0] shrink-0 text-right">
              <button
                onClick={closeDetail}
                className="px-6 py-2.5 rounded-xl border border-[#ebebeb] text-[13px] font-semibold text-[#555] hover:bg-[#f5f5f5]"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
