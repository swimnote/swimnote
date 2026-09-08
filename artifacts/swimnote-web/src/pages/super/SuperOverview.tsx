/**
 * SuperOverview — 실제 운영 데이터 연결
 * - dashboard-stats: X세분화 + diary + parent + teacher + curriculum + subscription KPI
 * - servers/status, incidents(OPEN/INVESTIGATING)
 * - Promise.allSettled 섹션 독립
 * - 30초 자동 갱신
 */
import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { api } from "@/lib/api";

// ──────────────────────────── Types ────────────────────────────
interface Stats {
  stats: {
    // 수영장
    total_operators?: number;
    active_operators?: number;
    base_operators?: number;
    xmode_operators?: number;
    // X 세분화
    x_paid_count?: number;
    x_manual_count?: number;
    x_override_count?: number;
    x_force_disabled_count?: number;
    // 구독 상태
    subscription_ok_count?: number;
    subscription_issue_count?: number;
    // 사용자
    total_students?: number;
    total_teachers?: number;
    total_parents?: number;
    // 콘텐츠
    total_diaries?: number;
    total_ai_diaries?: number;
    // 커리큘럼
    curriculum_ready_pools?: number;
    // 시스템
    recent_warnings?: number;
  };
  todo: {
    pending_approval?: { id: string; name: string }[];
    payment_failed?: { id: string; name: string }[];
    storage_danger?: { id: string; name: string }[];
    deletion_pending?: { id: string; name: string }[];
    support_open_count?: number;
    support_overdue_count?: number;
    security_events?: { id: string; pool_name?: string; description?: string; created_at: string }[];
    x_setup_review_count?: number;
    x_structuring_pending_count?: number;
  };
}

interface ServiceStatus {
  id: string; name: string;
  status: "LIVE" | "DEGRADED" | "UNKNOWN";
  latency_ms: number | null; note: string; last_checked: string;
}
interface ServersData { checked_at: string; services: Record<string, ServiceStatus>; }
interface Incident { id: string; title: string; severity: string; status: string; service?: string; created_at: string; }

// ──────────────────────────── Helpers ────────────────────────────
function Section({ title, children, error }: { title: string; children: React.ReactNode; error?: boolean }) {
  return (
    <div className={`bg-white border rounded-lg p-5 ${error ? "border-red-200" : "border-[#e5e5e5]"}`}>
      <h3 className="text-[11px] font-bold text-[#999] uppercase tracking-wider mb-4">{title}</h3>
      {children}
    </div>
  );
}
function KV({ label, value, valueClass, sub, onClick }: {
  label: string; value: React.ReactNode; valueClass?: string; sub?: string; onClick?: () => void;
}) {
  return (
    <div
      className={`flex items-center justify-between py-1.5 border-b border-[#f5f5f5] last:border-0 ${onClick ? "cursor-pointer hover:bg-[#fafafa] -mx-1 px-1 rounded" : ""}`}
      onClick={onClick}
    >
      <span className="text-[12px] text-[#888]">{label}{sub && <span className="text-[10px] text-[#bbb] ml-1">{sub}</span>}</span>
      <span className={`text-[13px] font-semibold ${valueClass ?? "text-[#111]"}`}>{value}</span>
    </div>
  );
}
function StatusDot({ status }: { status: string }) {
  const cls = status === "LIVE" ? "bg-green-500" : status === "DEGRADED" ? "bg-amber-500" : "bg-gray-300";
  return <span className={`inline-block w-2 h-2 rounded-full ${cls} mr-2`} />;
}
function SeverityBadge({ sev }: { sev: string }) {
  const colors: Record<string, string> = {
    SEV1: "bg-red-100 text-red-700", SEV2: "bg-orange-100 text-orange-700",
    SEV3: "bg-amber-100 text-amber-700", SEV4: "bg-gray-100 text-gray-600",
  };
  return <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded ${colors[sev] ?? colors.SEV4}`}>{sev}</span>;
}
const v = (n?: number | null) => n == null ? "—" : n.toLocaleString();

// ──────────────────────────── Component ────────────────────────────
export default function SuperOverview() {
  const [, navigate] = useLocation();

  const [statsData, setStatsData] = useState<Stats | null>(null);
  const [statsErr, setStatsErr] = useState(false);
  const [servers, setServers] = useState<ServersData | null>(null);
  const [serversErr, setServersErr] = useState(false);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [incidentsErr, setIncidentsErr] = useState(false);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function fetchAll() {
    const [sRes, svRes, inRes] = await Promise.allSettled([
      api.get<Stats>("/super/dashboard-stats"),
      api.get<ServersData>("/super/servers/status"),
      api.get<{ incidents: Incident[] }>("/super/incidents?status=OPEN&status=INVESTIGATING&limit=10"),
    ]);
    if (sRes.status  === "fulfilled") { setStatsData(sRes.value); setStatsErr(false); } else setStatsErr(true);
    if (svRes.status === "fulfilled") { setServers(svRes.value); setServersErr(false); } else setServersErr(true);
    if (inRes.status === "fulfilled") { setIncidents(inRes.value.incidents ?? []); setIncidentsErr(false); } else setIncidentsErr(true);
  }

  useEffect(() => {
    fetchAll();
    timerRef.current = setInterval(fetchAll, 30_000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  const stats   = statsData?.stats;
  const todo    = statsData?.todo;
  const svcList = servers ? Object.values(servers.services) : null;
  const openIncidentCount = incidents.filter(i => i.status === "OPEN" || i.status === "INVESTIGATING").length;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-[20px] font-bold text-[#111]">Overview</h1>
          <p className="text-[12px] text-[#999] mt-0.5">SWIMNOTE 전체 운영 상태</p>
        </div>
        <button onClick={fetchAll} className="text-[11px] text-[#aaa] hover:text-[#555] border border-[#e5e5e5] px-3 py-1.5 rounded-md transition-colors">새로고침</button>
      </div>

      {/* ── 상단 KPI 카드 (6개) ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: "전체 수영장",  val: stats?.total_operators,  color: "#111" },
          { label: "활성 수영장",  val: stats?.active_operators,  color: "#16a34a" },
          { label: "X MODE",       val: stats?.xmode_operators,   color: "#002F5F" },
          { label: "전체 학생",    val: stats?.total_students,    color: "#111" },
          { label: "전체 교사",    val: stats?.total_teachers,    color: "#111" },
          { label: "전체 학부모",  val: stats?.total_parents,     color: "#111" },
        ].map((c) => (
          <div key={c.label} className="bg-white rounded-lg border border-[#e5e5e5] px-4 py-3">
            <p className="text-[10px] text-[#aaa] mb-1">{c.label}</p>
            <p className="text-[22px] font-bold" style={{ color: c.color }}>{v(c.val)}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {/* ── SERVICE STATUS ── */}
        <Section title="Service Status" error={serversErr}>
          {serversErr ? (
            <p className="text-[12px] text-[#999]">데이터 로드 실패</p>
          ) : !svcList ? (
            <p className="text-[12px] text-[#bbb] animate-pulse">불러오는 중...</p>
          ) : (
            <>
              <div className="space-y-0">
                {svcList.map((svc) => (
                  <div key={svc.id} className="flex items-center justify-between py-1.5 border-b border-[#f5f5f5] last:border-0">
                    <span className="text-[12px] text-[#888]">{svc.name}</span>
                    <span className="flex items-center gap-2">
                      <span className={`flex items-center text-[12px] font-medium ${svc.status === "LIVE" ? "text-green-600" : svc.status === "DEGRADED" ? "text-amber-600" : "text-[#aaa]"}`}>
                        <StatusDot status={svc.status} />
                        {svc.status}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-[#bbb] mt-3 text-right">
                {servers?.checked_at ? new Date(servers.checked_at).toLocaleTimeString("ko-KR") : ""}
              </p>
            </>
          )}
        </Section>

        {/* ── 수영장 모드 세분화 ── */}
        <Section title="수영장 Mode 세분화" error={statsErr}>
          {statsErr ? <p className="text-[12px] text-[#999]">데이터 로드 실패</p> : (
            <>
              <KV label="BASE" value={v(stats?.base_operators)} />
              <KV label="X (전체 활성)" value={v(stats?.xmode_operators)} valueClass="text-[#002F5F]" />
              <KV label="∟ X Paid (RC)" value={v(stats?.x_paid_count)} sub="유료결제" valueClass="text-[#0369a1]" />
              <KV label="∟ X Manual" value={v(stats?.x_manual_count)} sub="수동부여" valueClass="text-[#0369a1]" />
              <KV label="∟ X Override" value={v(stats?.x_override_count)} sub="관리자재정의" valueClass={stats?.x_override_count ? "text-amber-600" : undefined} />
              <KV label="X Force-Disabled" value={v(stats?.x_force_disabled_count)} valueClass={stats?.x_force_disabled_count ? "text-red-600" : undefined} />
            </>
          )}
        </Section>

        {/* ── 콘텐츠/데이터 ── */}
        <Section title="콘텐츠 / 데이터" error={statsErr}>
          {statsErr ? <p className="text-[12px] text-[#999]">데이터 로드 실패</p> : (
            <>
              <KV label="전체 일지" value={v(stats?.total_diaries)} />
              <KV label="AI 일지" value={v(stats?.total_ai_diaries)} valueClass="text-[#002F5F]" />
              <KV label="Curriculum READY 수영장" value={v(stats?.curriculum_ready_pools)} valueClass={stats?.curriculum_ready_pools ? "text-green-700" : undefined} />
              <KV label="구독 정상" value={v(stats?.subscription_ok_count)} valueClass="text-green-700" />
              <KV label="구독 이상" value={v(stats?.subscription_issue_count)} valueClass={stats?.subscription_issue_count ? "text-red-600" : undefined}
                onClick={stats?.subscription_issue_count ? () => navigate("/super/billing") : undefined} />
              <KV label="최근 24h Warning/Error" value={v(stats?.recent_warnings)} valueClass={stats?.recent_warnings ? "text-amber-600" : undefined} />
            </>
          )}
        </Section>

        {/* ── 처리 필요 ── */}
        <Section title="Operations — 처리 필요" error={statsErr}>
          {statsErr ? <p className="text-[12px] text-[#999]">데이터 로드 실패</p> : (
            <>
              <KV label="미해결 장애" value={incidentsErr ? "—" : openIncidentCount}
                valueClass={openIncidentCount > 0 ? "text-red-600" : undefined}
                onClick={openIncidentCount > 0 ? () => navigate("/super/incidents") : undefined} />
              <KV label="승인 대기" value={v(todo?.pending_approval?.length)}
                valueClass={todo?.pending_approval?.length ? "text-amber-600" : undefined}
                onClick={todo?.pending_approval?.length ? () => navigate("/super/pools") : undefined} />
              <KV label="결제 이상" value={v(todo?.payment_failed?.length)}
                valueClass={todo?.payment_failed?.length ? "text-red-600" : undefined}
                onClick={todo?.payment_failed?.length ? () => navigate("/super/billing") : undefined} />
              <KV label="저장공간 위험" value={v(todo?.storage_danger?.length)}
                valueClass={todo?.storage_danger?.length ? "text-red-600" : undefined} />
              <KV label="미처리 고객문의" value={v(todo?.support_open_count)}
                valueClass={todo?.support_open_count ? "text-amber-600" : undefined}
                onClick={todo?.support_open_count ? () => navigate("/super/support") : undefined} />
              <KV label="X Setup 검토대기" value={v(todo?.x_setup_review_count)}
                valueClass={todo?.x_setup_review_count ? "text-amber-600" : undefined}
                onClick={todo?.x_setup_review_count ? () => navigate("/super/x-mode") : undefined} />
            </>
          )}
        </Section>

        {/* ── 활성 장애 ── */}
        <Section title="활성 장애" error={incidentsErr}>
          {incidentsErr ? <p className="text-[12px] text-[#999]">데이터 로드 실패</p>
          : incidents.length === 0 ? <p className="text-[12px] text-[#bbb] py-2">활성 장애 없음 ✓</p>
          : (
            <div className="space-y-2">
              {incidents.slice(0, 5).map((inc) => (
                <div key={inc.id} className="flex items-start gap-2 py-2 border-b border-[#f5f5f5] last:border-0 cursor-pointer hover:bg-[#fafafa] -mx-1 px-1 rounded"
                  onClick={() => navigate("/super/incidents")}>
                  <SeverityBadge sev={inc.severity} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-medium text-[#111] truncate">{inc.title}</div>
                    <div className="text-[11px] text-[#bbb] mt-0.5">{inc.service ?? "—"} · {new Date(inc.created_at).toLocaleDateString("ko-KR")}</div>
                  </div>
                  <span className="text-[11px] text-amber-600 font-medium">{inc.status}</span>
                </div>
              ))}
              <button onClick={() => navigate("/super/incidents")} className="text-[11px] text-[#002F5F] hover:underline mt-1">전체 장애 보기 →</button>
            </div>
          )}
        </Section>

        {/* ── 보안 이벤트 (최근 24h) ── */}
        <Section title="보안 이벤트 (최근 24h)" error={statsErr}>
          {statsErr ? <p className="text-[12px] text-[#999]">데이터 로드 실패</p>
          : !todo?.security_events?.length ? <p className="text-[12px] text-[#bbb] py-2">보안 이벤트 없음 ✓</p>
          : (
            <div className="space-y-1">
              {todo.security_events.slice(0, 5).map((e) => (
                <div key={e.id} className="py-1.5 border-b border-[#f5f5f5] last:border-0">
                  <p className="text-[12px] text-[#111] truncate">{e.description ?? "보안 이벤트"}</p>
                  <p className="text-[10px] text-[#bbb] mt-0.5">{e.pool_name ?? "—"} · {new Date(e.created_at).toLocaleString("ko-KR")}</p>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}
