/**
 * SuperOverview — SA0-B: 실제 운영 데이터 연결
 * - dashboard-stats, servers/status, incidents(OPEN/INVESTIGATING)
 * - Promise.allSettled 섹션 독립 — 하나 실패해도 나머지 유지
 * - 30초 자동 갱신
 */
import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { api } from "@/lib/api";

// ──────────────────────────── Types ────────────────────────────
interface Stats {
  stats: {
    total_operators?: number;
    active_operators?: number;
    xmode_operators?: number;
    total_students?: number;
    total_staff?: number;
  };
  todo: {
    pending_approval?: { id: string; name: string }[];
    payment_failed?: { id: string; name: string }[];
    support_open_count?: number;
    x_setup_review_count?: number;
    x_structuring_pending_count?: number;
  };
}

interface ServiceStatus {
  id: string;
  name: string;
  status: "LIVE" | "DEGRADED" | "UNKNOWN";
  latency_ms: number | null;
  note: string;
  last_checked: string;
}

interface ServersData {
  checked_at: string;
  services: Record<string, ServiceStatus>;
}

interface Incident {
  id: string;
  title: string;
  severity: string;
  status: string;
  service?: string;
  created_at: string;
}

// ──────────────────────────── Helpers ────────────────────────────
function Section({ title, children, error }: { title: string; children: React.ReactNode; error?: boolean }) {
  return (
    <div className={`bg-white border rounded-lg p-5 ${error ? "border-red-200" : "border-[#e5e5e5]"}`}>
      <h3 className="text-[11px] font-bold text-[#999] uppercase tracking-wider mb-4">{title}</h3>
      {children}
    </div>
  );
}

function KV({ label, value, valueClass, onClick }: {
  label: string; value: React.ReactNode; valueClass?: string; onClick?: () => void
}) {
  return (
    <div
      className={`flex items-center justify-between py-1.5 border-b border-[#f5f5f5] last:border-0 ${onClick ? "cursor-pointer hover:bg-[#fafafa] -mx-1 px-1 rounded" : ""}`}
      onClick={onClick}
    >
      <span className="text-[12px] text-[#888]">{label}</span>
      <span className={`text-[13px] font-semibold ${valueClass ?? "text-[#111]"}`}>{value}</span>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const cls =
    status === "LIVE"     ? "bg-green-500" :
    status === "DEGRADED" ? "bg-amber-500" :
                            "bg-gray-300";
  return <span className={`inline-block w-2 h-2 rounded-full ${cls} mr-2`} />;
}

function SeverityBadge({ sev }: { sev: string }) {
  const colors: Record<string, string> = {
    SEV1: "bg-red-100 text-red-700",
    SEV2: "bg-orange-100 text-orange-700",
    SEV3: "bg-amber-100 text-amber-700",
    SEV4: "bg-gray-100 text-gray-600",
  };
  return (
    <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded ${colors[sev] ?? colors.SEV4}`}>{sev}</span>
  );
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

    if (sRes.status  === "fulfilled") { setStatsData(sRes.value); setStatsErr(false); }
    else setStatsErr(true);

    if (svRes.status === "fulfilled") { setServers(svRes.value); setServersErr(false); }
    else setServersErr(true);

    if (inRes.status === "fulfilled") { setIncidents(inRes.value.incidents ?? []); setIncidentsErr(false); }
    else setIncidentsErr(true);
  }

  useEffect(() => {
    fetchAll();
    timerRef.current = setInterval(fetchAll, 30_000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  const stats    = statsData?.stats;
  const todo     = statsData?.todo;
  const svcList  = servers ? Object.values(servers.services) : null;
  const openIncidentCount = incidents.filter(i => i.status === "OPEN" || i.status === "INVESTIGATING").length;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-[20px] font-bold text-[#111]">Overview</h1>
          <p className="text-[12px] text-[#999] mt-0.5">SWIMNOTE 전체 운영 상태</p>
        </div>
        <button
          onClick={fetchAll}
          className="text-[11px] text-[#aaa] hover:text-[#555] border border-[#e5e5e5] px-3 py-1.5 rounded-md transition-colors"
        >
          새로고침
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                      <span className="text-[11px] text-[#bbb] hidden sm:block max-w-[120px] truncate">{svc.note || ""}</span>
                      <span className={`flex items-center text-[12px] font-medium ${
                        svc.status === "LIVE" ? "text-green-600" :
                        svc.status === "DEGRADED" ? "text-amber-600" : "text-[#aaa]"
                      }`}>
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

        {/* ── BUSINESS ── */}
        <Section title="Business" error={statsErr}>
          {statsErr ? (
            <p className="text-[12px] text-[#999]">데이터 로드 실패</p>
          ) : (
            <>
              <KV label="전체 수영장" value={v(stats?.total_operators)} />
              <KV label="활성 수영장" value={v(stats?.active_operators)} valueClass="text-green-700" />
              <KV label="X MODE 수영장" value={v(stats?.xmode_operators)} valueClass={stats?.xmode_operators ? "text-[#002F5F]" : undefined} />
              <KV label="전체 회원" value={v(stats?.total_students)} />
              <KV label="전체 스태프" value={v(stats?.total_staff)} />
            </>
          )}
        </Section>

        {/* ── OPERATIONS ── */}
        <Section title="Operations — 처리 필요" error={statsErr}>
          {statsErr ? (
            <p className="text-[12px] text-[#999]">데이터 로드 실패</p>
          ) : (
            <>
              <KV
                label="미해결 장애"
                value={incidentsErr ? "—" : openIncidentCount}
                valueClass={openIncidentCount > 0 ? "text-red-600" : undefined}
                onClick={openIncidentCount > 0 ? () => navigate("/super/incidents") : undefined}
              />
              <KV
                label="승인 대기"
                value={v(todo?.pending_approval?.length)}
                valueClass={todo?.pending_approval?.length ? "text-amber-600" : undefined}
                onClick={todo?.pending_approval?.length ? () => navigate("/super/pools") : undefined}
              />
              <KV
                label="결제 이상"
                value={v(todo?.payment_failed?.length)}
                valueClass={todo?.payment_failed?.length ? "text-red-600" : undefined}
                onClick={todo?.payment_failed?.length ? () => navigate("/super/billing") : undefined}
              />
              <KV
                label="미처리 고객문의"
                value={v(todo?.support_open_count)}
                valueClass={todo?.support_open_count ? "text-amber-600" : undefined}
                onClick={todo?.support_open_count ? () => navigate("/super/support") : undefined}
              />
              <KV
                label="X Setup 검토대기"
                value={v(todo?.x_setup_review_count)}
                valueClass={todo?.x_setup_review_count ? "text-amber-600" : undefined}
                onClick={todo?.x_setup_review_count ? () => navigate("/super/x-mode") : undefined}
              />
              <KV
                label="X 자료정리 대기"
                value={v(todo?.x_structuring_pending_count)}
                valueClass={todo?.x_structuring_pending_count ? "text-[#002F5F]" : undefined}
              />
            </>
          )}
        </Section>

        {/* ── ACTIVE INCIDENTS ── */}
        <Section title="활성 장애" error={incidentsErr}>
          {incidentsErr ? (
            <p className="text-[12px] text-[#999]">데이터 로드 실패</p>
          ) : incidents.length === 0 ? (
            <p className="text-[12px] text-[#bbb] py-2">활성 장애 없음 ✓</p>
          ) : (
            <div className="space-y-2">
              {incidents.map((inc) => (
                <div
                  key={inc.id}
                  className="flex items-start gap-2 py-2 border-b border-[#f5f5f5] last:border-0 cursor-pointer hover:bg-[#fafafa] -mx-1 px-1 rounded"
                  onClick={() => navigate("/super/incidents")}
                >
                  <SeverityBadge sev={inc.severity} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-medium text-[#111] truncate">{inc.title}</div>
                    <div className="text-[11px] text-[#bbb] mt-0.5">
                      {inc.service ?? "—"} · {new Date(inc.created_at).toLocaleDateString("ko-KR")}
                    </div>
                  </div>
                  <span className="text-[11px] text-amber-600 font-medium">{inc.status}</span>
                </div>
              ))}
              <button
                onClick={() => navigate("/super/incidents")}
                className="text-[11px] text-[#002F5F] hover:underline mt-1"
              >
                전체 장애 보기 →
              </button>
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}
