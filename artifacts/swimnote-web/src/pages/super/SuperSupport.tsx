/**
 * SuperSupport — WP-CS-03R Super Admin Support Inbox
 * Human Support E2E: 문의 확인 → 상담사 답변 → 사용자 앱에서 확인
 *
 * Layout:
 *   Left (300px)  — 케이스 목록 + 필터
 *   Center (flex) — 대화 이력 (LEFT column)
 *   Right (560px) — Resolution Placeholder (CENTER) + User Context (RIGHT)
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "@/lib/api";

// ── Types ─────────────────────────────────────────────────────────────────────

interface SupportCase {
  id: string;
  pool_id:          string | null;
  pool_name:        string | null;
  actor_id:         string | null;
  actor_role:       string;
  mode:             string | null;
  state:            string;
  master_state:     string;
  escalation_reason: string | null;
  context_json:     Record<string, any> | null;
  turn_count:       number;
  last_message_at:  string | null;
  wait_since:       string | null;
  created_at:       string;
  updated_at:       string;
}

interface SupportMessage {
  id:          string;
  author_role: string;
  author_name: string;
  content:     string;
  message_type: string | null;
  created_at:  string;
}

interface CaseDetail {
  case:        SupportCase;
  ticket:      any | null;
  messages:    SupportMessage[];
  state:       string;
  master_state: string;
  pool_name:   string | null;
  context:     Record<string, any>;
}

interface Stats {
  agent_requested: number;
  agent_active:    number;
  phone_required:  number;
  total_open:      number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PRIMARY = "#002F5F";

const STATUS_FILTERS = [
  { id: "all",            label: "전체" },
  { id: "new",            label: "신규" },
  { id: "ai",             label: "AI 처리중" },
  { id: "agent_requested",label: "상담사 요청" },
  { id: "agent_active",   label: "상담중" },
  { id: "phone",          label: "전화 필요" },
  { id: "resolved",       label: "해결" },
  { id: "reopened",       label: "재오픈" },
] as const;

const ROLE_FILTERS = [
  { id: "all",        label: "전체" },
  { id: "pool_admin", label: "관리자" },
  { id: "teacher",    label: "강사" },
  { id: "parent",     label: "학부모" },
] as const;

const MODE_FILTERS = [
  { id: "all",    label: "전체" },
  { id: "normal", label: "Normal" },
  { id: "x",      label: "X" },
] as const;

const masterStateStyle: Record<string, { label: string; cls: string; dot: string }> = {
  AI_ACTIVE:       { label: "AI 처리중",   cls: "bg-blue-50 text-blue-600 border-blue-200",    dot: "bg-blue-400" },
  AGENT_REQUESTED: { label: "상담사 요청", cls: "bg-purple-50 text-purple-600 border-purple-200", dot: "bg-purple-500" },
  AGENT_ACTIVE:    { label: "상담중",       cls: "bg-indigo-50 text-indigo-600 border-indigo-200", dot: "bg-indigo-400" },
  PHONE_REQUIRED:  { label: "전화 필요",   cls: "bg-red-50 text-red-600 border-red-200",       dot: "bg-red-500" },
  WAITING:         { label: "대기중",       cls: "bg-amber-50 text-amber-600 border-amber-200", dot: "bg-amber-400" },
  RESOLVED:        { label: "해결됨",       cls: "bg-green-50 text-green-700 border-green-200", dot: "bg-green-400" },
  REOPENED:        { label: "재오픈",       cls: "bg-orange-50 text-orange-600 border-orange-200", dot: "bg-orange-400" },
};

const msgAuthorStyle: Record<string, { label: string; align: string; bubble: string; name: string }> = {
  user:    { label: "사용자",   align: "items-start",  bubble: "bg-[#f3f4f6] text-[#111]",   name: "text-[#555]" },
  ai:      { label: "AI",       align: "items-start",  bubble: "bg-blue-50 text-[#1a3a6b]",  name: "text-blue-500" },
  agent:   { label: "상담사",   align: "items-end",    bubble: "bg-[#002F5F] text-white",     name: "text-[#002F5F]" },
  system:  { label: "시스템",   align: "items-center", bubble: "bg-[#f0f0f0] text-[#888] text-[11px] px-3 py-1.5 rounded-full", name: "text-[#aaa]" },
};

const PHONE_REASON_LABELS: Record<string, string> = {
  billing:        "요금/결제",
  refund:         "환불",
  privacy_safety: "개인정보/안전",
  complex_case:   "복잡한 케이스",
  other:          "기타",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTime(raw: string | null | undefined): string {
  if (!raw) return "";
  const fixed = raw.replace(" ", "T");
  const d = new Date(fixed);
  if (isNaN(d.getTime())) return "";
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  return `${h}:${m}`;
}

function fmtDate(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.slice(0, 10);
}

function waitLabel(since: string | null | undefined): string {
  if (!since) return "";
  const fixed = since.replace(" ", "T");
  const ms = Date.now() - new Date(fixed).getTime();
  if (isNaN(ms) || ms < 0) return "";
  const mins = Math.floor(ms / 60000);
  if (mins < 1)  return "방금";
  if (mins < 60) return `${mins}분`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hrs}시간 ${rem}분` : `${hrs}시간`;
}

function roleLabel(role: string): string {
  const map: Record<string, string> = {
    pool_admin: "관리자",
    teacher:    "강사",
    parent:     "학부모",
    super_admin: "슈퍼관리자",
  };
  return map[role] ?? role;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SuperSupport() {
  // ── Tab state
  const [tab, setTab] = useState<"inbox" | "future">("inbox");

  // ── Inbox filters
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [roleFilter,   setRoleFilter]   = useState<string>("all");
  const [modeFilter,   setModeFilter]   = useState<string>("all");

  // ── Data
  const [cases,   setCases]   = useState<SupportCase[]>([]);
  const [stats,   setStats]   = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);

  // ── Selected case
  const [selectedId,  setSelectedId]  = useState<string | null>(null);
  const [detail,      setDetail]      = useState<CaseDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // ── Agent reply
  const [replyContent,  setReplyContent]  = useState("");
  const [replySending,  setReplySending]  = useState(false);
  const [replyError,    setReplyError]    = useState<string | null>(null);
  const convEndRef = useRef<HTMLDivElement>(null);

  // ── Phone required modal
  const [showPhoneModal,  setShowPhoneModal]  = useState(false);
  const [phoneReason,     setPhoneReason]     = useState("other");
  const [phoneSubmitting, setPhoneSubmitting] = useState(false);

  // ── Fetch list
  const fetchCases = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "200" });
      if (statusFilter !== "all") params.set("status_group", statusFilter);
      if (roleFilter !== "all")   params.set("role", roleFilter);
      if (modeFilter !== "all")   params.set("mode", modeFilter);
      const data = await api.get<{ cases: SupportCase[] }>(`/super/support/cases?${params}`);
      setCases(data.cases ?? []);
    } catch {
      setCases([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, roleFilter, modeFilter]);

  const fetchStats = useCallback(async () => {
    try {
      const data = await api.get<Stats>("/super/support/stats");
      setStats(data);
    } catch { /* best-effort */ }
  }, []);

  useEffect(() => { fetchCases(); fetchStats(); }, [fetchCases, fetchStats]);

  // ── Fetch detail
  const fetchDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    setReplyContent("");
    setReplyError(null);
    try {
      const data = await api.get<CaseDetail>(`/super/support/cases/${id}`);
      setDetail(data);
      setTimeout(() => convEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedId) fetchDetail(selectedId);
    else setDetail(null);
  }, [selectedId, fetchDetail]);

  // ── Agent reply
  const sendReply = async () => {
    if (!selectedId || !replyContent.trim()) return;
    setReplySending(true);
    setReplyError(null);
    try {
      await api.post(`/super/support/cases/${selectedId}/agent-reply`, { content: replyContent.trim() });
      setReplyContent("");
      await fetchDetail(selectedId);
      await fetchCases();
    } catch (e: any) {
      setReplyError(e?.message ?? "전송 실패");
    } finally {
      setReplySending(false);
    }
  };

  // ── Resolve
  const resolveCase = async () => {
    if (!selectedId) return;
    try {
      await api.post(`/super/support/cases/${selectedId}/resolve`, {});
      await fetchDetail(selectedId);
      await fetchCases();
      await fetchStats();
    } catch (e: any) {
      alert(e?.message ?? "해결 처리 실패");
    }
  };

  // ── Reopen
  const reopenCase = async () => {
    if (!selectedId) return;
    try {
      await api.post(`/super/support/cases/${selectedId}/reopen`, {});
      await fetchDetail(selectedId);
      await fetchCases();
    } catch (e: any) {
      alert(e?.message ?? "재오픈 실패");
    }
  };

  // ── Phone required
  const submitPhoneRequired = async () => {
    if (!selectedId) return;
    setPhoneSubmitting(true);
    try {
      await api.post(`/super/support/cases/${selectedId}/phone-required`, { reason: phoneReason });
      setShowPhoneModal(false);
      await fetchDetail(selectedId);
      await fetchCases();
    } catch (e: any) {
      alert(e?.message ?? "전화 필요 처리 실패");
    } finally {
      setPhoneSubmitting(false);
    }
  };

  // ── Computed
  const selectedCase = detail?.case ?? cases.find((c) => c.id === selectedId) ?? null;
  const isResolved   = ["AI_RESOLVED", "RESOLVED", "CLOSED"].includes(selectedCase?.state ?? "");
  const canReopen    = isResolved;
  const canResolve   = !isResolved;
  const canPhone     = !isResolved && selectedCase?.master_state !== "PHONE_REQUIRED";

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-5 pb-3 shrink-0">
        <div>
          <h1 className="text-[19px] font-bold text-[#111]">고객센터</h1>
          <p className="text-[12px] text-[#999] mt-0.5">
            수영장 및 사용자 문의 · 상담 관리
            {stats && stats.agent_requested > 0 && (
              <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full bg-purple-500 text-white text-[10px] font-bold">
                상담사 요청 {stats.agent_requested}
              </span>
            )}
            {stats && stats.total_open > 0 && (
              <span className="ml-1.5 inline-flex items-center px-2 py-0.5 rounded-full bg-red-500 text-white text-[10px] font-bold">
                열린 상담 {stats.total_open}
              </span>
            )}
          </p>
        </div>
        <button
          onClick={() => { fetchCases(); fetchStats(); }}
          className="text-[12px] text-[#888] hover:text-[#111] border border-[#e5e5e5] px-3 py-1.5 rounded-lg"
        >
          새로고침
        </button>
      </div>

      {/* Top tabs */}
      <div className="flex gap-0 px-6 mb-0 shrink-0 border-b border-[#eee]">
        <button
          onClick={() => setTab("inbox")}
          className={`px-4 py-2.5 text-[13px] font-semibold border-b-2 transition-all ${
            tab === "inbox"
              ? "border-[#002F5F] text-[#002F5F]"
              : "border-transparent text-[#aaa] hover:text-[#555]"
          }`}
        >
          상담
        </button>
        {["Solution DB", "FAQ", "Known Issues"].map((t) => (
          <button
            key={t}
            disabled
            className="px-4 py-2.5 text-[12px] border-b-2 border-transparent text-[#ccc] cursor-not-allowed"
          >
            {t}
          </button>
        ))}
      </div>

      {/* Main content */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* ── LEFT: Case list ── */}
        <div className="w-[300px] shrink-0 flex flex-col border-r border-[#eee] bg-[#fafafa]">
          {/* Status filter */}
          <div className="p-3 border-b border-[#eee] space-y-2">
            <div className="flex flex-wrap gap-1">
              {STATUS_FILTERS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setStatusFilter(f.id)}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-all ${
                    statusFilter === f.id
                      ? "bg-[#002F5F] text-white"
                      : "bg-white border border-[#e5e5e5] text-[#888] hover:bg-[#f0f0f0]"
                  }`}
                >
                  {f.label}
                  {f.id === "agent_requested" && stats && stats.agent_requested > 0 && (
                    <span className="ml-1 bg-purple-500 text-white text-[9px] px-1.5 py-0.5 rounded-full">
                      {stats.agent_requested}
                    </span>
                  )}
                </button>
              ))}
            </div>
            <div className="flex gap-1.5">
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                className="flex-1 text-[11px] border border-[#e5e5e5] rounded-lg px-2 py-1 bg-white text-[#555]"
              >
                {ROLE_FILTERS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
              <select
                value={modeFilter}
                onChange={(e) => setModeFilter(e.target.value)}
                className="flex-1 text-[11px] border border-[#e5e5e5] rounded-lg px-2 py-1 bg-white text-[#555]"
              >
                {MODE_FILTERS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
            </div>
          </div>

          {/* Case list */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="py-12 text-center text-[#bbb] text-[12px]">불러오는 중...</div>
            ) : cases.length === 0 ? (
              <div className="py-12 text-center text-[#bbb] text-[12px]">문의 없음</div>
            ) : (
              cases.map((c) => {
                const ms  = masterStateStyle[c.master_state] ?? masterStateStyle["WAITING"];
                const sel = selectedId === c.id;
                return (
                  <div
                    key={c.id}
                    onClick={() => setSelectedId(c.id)}
                    className={`px-3 py-2.5 border-b border-[#eee] cursor-pointer transition-all ${
                      sel ? "bg-[#eef2ff] border-l-[3px] border-l-[#002F5F]" : "hover:bg-white border-l-[3px] border-l-transparent"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${ms.dot}`} />
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${ms.cls}`}>
                        {ms.label}
                      </span>
                      {c.master_state === "AGENT_REQUESTED" && c.wait_since && (
                        <span className="text-[10px] text-purple-500 font-semibold">
                          {waitLabel(c.wait_since)}
                        </span>
                      )}
                      {c.mode === "x" && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#001a3a] text-white font-bold">X</span>
                      )}
                    </div>
                    <p className="text-[12px] font-semibold text-[#111] truncate">
                      {c.pool_name ?? "수영장 미지정"}
                    </p>
                    <p className="text-[11px] text-[#888] mt-0.5">
                      {roleLabel(c.actor_role)} · {fmtDate(c.last_message_at ?? c.updated_at)}
                      {c.turn_count > 0 && <span className="ml-1">({c.turn_count}턴)</span>}
                    </p>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ── CENTER + RIGHT: Detail ── */}
        {!selectedId ? (
          <div className="flex-1 flex items-center justify-center text-[#ccc] text-[13px]">
            케이스를 선택하세요
          </div>
        ) : detailLoading ? (
          <div className="flex-1 flex items-center justify-center text-[#bbb] text-[13px]">
            불러오는 중...
          </div>
        ) : !detail ? (
          <div className="flex-1 flex items-center justify-center text-[#bbb] text-[13px]">
            케이스를 불러올 수 없습니다
          </div>
        ) : (
          <div className="flex-1 flex min-h-0 overflow-hidden">
            {/* ── CONVERSATION (LEFT column) ── */}
            <div className="flex-1 flex flex-col min-h-0 border-r border-[#eee]">
              {/* Conv header */}
              <div className="px-5 py-3 border-b border-[#eee] flex items-center justify-between shrink-0">
                <div>
                  <p className="text-[13px] font-bold text-[#111]">
                    {detail.pool_name ?? "수영장 미지정"}
                  </p>
                  <p className="text-[11px] text-[#aaa] mt-0.5">
                    {detail.case.id.slice(-10)} · {roleLabel(detail.case.actor_role)}
                    {detail.case.mode === "x" && " · X 모드"}
                  </p>
                </div>
                <button
                  onClick={() => { setSelectedId(null); setDetail(null); }}
                  className="text-[#ccc] hover:text-[#888] text-[18px] leading-none"
                >
                  ×
                </button>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {detail.messages.length === 0 ? (
                  <p className="text-[12px] text-[#ccc] text-center py-8">메시지 없음</p>
                ) : (
                  detail.messages.map((msg) => {
                    const style = msgAuthorStyle[msg.author_role] ?? msgAuthorStyle["user"];
                    return (
                      <div key={msg.id} className={`flex flex-col ${style.align} gap-1`}>
                        <p className={`text-[10px] font-semibold ${style.name}`}>
                          {msg.author_name || style.label}
                          <span className="ml-1.5 font-normal text-[#ccc]">{fmtTime(msg.created_at)}</span>
                        </p>
                        <div className={`max-w-[85%] px-3 py-2 rounded-xl text-[13px] whitespace-pre-wrap ${style.bubble}`}>
                          {msg.content}
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={convEndRef} />
              </div>

              {/* Reply input */}
              <div className="p-4 border-t border-[#eee] shrink-0">
                {isResolved ? (
                  <div className="flex gap-2">
                    <div className="flex-1 px-3 py-2 bg-[#f8f8f8] rounded-xl text-[12px] text-[#bbb]">
                      해결된 상담입니다
                    </div>
                    {canReopen && (
                      <button
                        onClick={reopenCase}
                        className="px-4 py-2 rounded-xl border border-orange-300 text-orange-600 text-[12px] font-semibold hover:bg-orange-50 transition-colors"
                      >
                        재오픈
                      </button>
                    )}
                  </div>
                ) : (
                  <>
                    <textarea
                      value={replyContent}
                      onChange={(e) => setReplyContent(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) sendReply(); }}
                      placeholder="답변을 입력하세요... (Cmd+Enter 전송)"
                      rows={3}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-[#e5e5e5] text-[13px] text-[#0a0a0a] placeholder:text-[#ccc] focus:outline-none focus:border-[#002F5F] resize-none transition-colors mb-2"
                    />
                    {replyError && (
                      <p className="text-[11px] text-red-500 mb-2">{replyError}</p>
                    )}
                    <div className="flex gap-2">
                      <button
                        onClick={sendReply}
                        disabled={replySending || !replyContent.trim()}
                        className="flex-1 py-2.5 rounded-xl text-white text-[13px] font-semibold transition-opacity hover:opacity-85 disabled:opacity-40"
                        style={{ background: PRIMARY }}
                      >
                        {replySending ? "전송 중..." : "답변 전송"}
                      </button>
                      {canResolve && (
                        <button
                          onClick={resolveCase}
                          className="px-4 py-2.5 rounded-xl border border-green-300 text-green-700 text-[12px] font-semibold hover:bg-green-50 transition-colors"
                        >
                          해결 완료
                        </button>
                      )}
                      {canPhone && (
                        <button
                          onClick={() => setShowPhoneModal(true)}
                          className="px-4 py-2.5 rounded-xl border border-red-200 text-red-500 text-[12px] font-semibold hover:bg-red-50 transition-colors"
                        >
                          전화 필요
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* ── RIGHT PANEL (Resolution + User Context) ── */}
            <div className="w-[280px] shrink-0 flex flex-col min-h-0 bg-[#fafafa]">
              {/* Resolution Assistant placeholder */}
              <div className="p-4 border-b border-[#eee]">
                <p className="text-[11px] font-bold text-[#999] uppercase tracking-wide mb-2">
                  AI Resolution Assistant
                </p>
                <div className="bg-white rounded-xl border border-[#eee] p-3 text-center">
                  <p className="text-[12px] text-[#aaa]">준비중</p>
                  <p className="text-[10px] text-[#ccc] mt-1">
                    AI 분석 · 추천 해결책<br />향후 구현 예정
                  </p>
                </div>
                {/* Status summary */}
                <div className="mt-3 space-y-1.5">
                  {[
                    ["상태",        masterStateStyle[detail.master_state]?.label ?? detail.master_state],
                    ["상담사 요청", detail.case.master_state === "AGENT_REQUESTED" ? "요청됨" : "없음"],
                    ["대기시간",    detail.case.wait_since ? waitLabel(detail.case.wait_since) : "—"],
                    ["시도한 해결", "없음 / 향후"],
                    ["Known Issue", "없음 / 향후"],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between text-[11px]">
                      <span className="text-[#aaa]">{k}</span>
                      <span className="text-[#555] font-medium">{v}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* User Context */}
              <div className="flex-1 overflow-y-auto p-4">
                <p className="text-[11px] font-bold text-[#999] uppercase tracking-wide mb-2">
                  User Context
                </p>
                <div className="space-y-1.5">
                  {[
                    ["수영장",       detail.pool_name ?? "—"],
                    ["역할",         roleLabel(detail.case.actor_role)],
                    ["모드",         detail.case.mode === "x" ? "X" : detail.case.mode === "normal" ? "Normal" : "—"],
                    ["구독 플랜",    detail.context?.subscription_plan ?? "—"],
                    ["앱 버전",      detail.context?.app_version ?? "—"],
                    ["런타임 버전",  detail.context?.runtime_version ?? "—"],
                    ["현재 화면",    detail.context?.current_route ?? "—"],
                    ["기기/OS",      detail.context?.device_os ?? "—"],
                    ["문의 시작",    fmtDate(detail.created_at)],
                    ["마지막 업데이트", fmtDate(detail.updated_at)],
                    ["총 메시지",    String(detail.messages.length)],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between text-[11px] py-0.5">
                      <span className="text-[#aaa] shrink-0 mr-2">{k}</span>
                      <span className="text-[#555] font-medium text-right truncate">{v}</span>
                    </div>
                  ))}
                </div>

                {/* Ticket info */}
                {detail.ticket && (
                  <div className="mt-4 bg-white rounded-xl border border-[#eee] p-3">
                    <p className="text-[10px] font-bold text-[#aaa] mb-1.5">연결된 티켓</p>
                    <p className="text-[12px] font-semibold text-[#111]">{detail.ticket.subject}</p>
                    <p className="text-[10px] text-[#bbb] mt-0.5">
                      상담 요청: {detail.ticket.consultation_requested ? "예" : "아니오"} ·{" "}
                      {fmtDate(detail.ticket.created_at)}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Phone required modal */}
      {showPhoneModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-[360px] shadow-xl">
            <h3 className="text-[15px] font-bold text-[#111] mb-1">전화 필요 처리</h3>
            <p className="text-[12px] text-[#888] mb-4">
              사유를 선택하면 케이스가 PHONE_REQUIRED 상태로 전환됩니다.
            </p>
            <div className="space-y-2 mb-4">
              {Object.entries(PHONE_REASON_LABELS).map(([val, lbl]) => (
                <label key={val} className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="radio"
                    name="phone_reason"
                    value={val}
                    checked={phoneReason === val}
                    onChange={() => setPhoneReason(val)}
                    className="w-4 h-4 accent-[#002F5F]"
                  />
                  <span className="text-[13px] text-[#333]">{lbl}</span>
                </label>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowPhoneModal(false)}
                className="flex-1 py-2.5 rounded-xl border border-[#e5e5e5] text-[13px] text-[#555] hover:bg-[#f5f5f5]"
              >
                취소
              </button>
              <button
                onClick={submitPhoneRequired}
                disabled={phoneSubmitting}
                className="flex-1 py-2.5 rounded-xl bg-red-500 text-white text-[13px] font-semibold disabled:opacity-50"
              >
                {phoneSubmitting ? "처리 중..." : "전화 필요 처리"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
