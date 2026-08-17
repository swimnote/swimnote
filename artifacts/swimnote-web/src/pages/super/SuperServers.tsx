/**
 * SuperServers — SA0-B: 서버 관리
 * - /super/servers/status 연결
 * - 30초 자동 갱신
 * - 기존 db-status/infra-usage 탭 유지
 */
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

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

interface InfraData {
  db: { size_mb?: number; latency_ms?: number; connection_count?: number; pool?: string; error?: string }[];
  storage: { bucket?: string; used_mb?: number; error?: string };
  summary?: string;
  error?: string;
}

const STATUS_STYLE: Record<string, string> = {
  LIVE:     "bg-green-100 text-green-700 border-green-200",
  DEGRADED: "bg-amber-100 text-amber-700 border-amber-200",
  UNKNOWN:  "bg-gray-100  text-gray-500  border-gray-200",
};

const DOT_STYLE: Record<string, string> = {
  LIVE:     "bg-green-500",
  DEGRADED: "bg-amber-400",
  UNKNOWN:  "bg-gray-300",
};

function ServiceCard({ svc }: { svc: ServiceStatus }) {
  return (
    <div className={`bg-white border rounded-lg p-4 ${
      svc.status === "DEGRADED" ? "border-amber-200" :
      svc.status === "LIVE"     ? "border-[#e5e5e5]" : "border-[#e5e5e5]"
    }`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[13px] font-semibold text-[#111]">{svc.name}</span>
        <span className={`flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-bold rounded border ${STATUS_STYLE[svc.status] ?? STATUS_STYLE.UNKNOWN}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${DOT_STYLE[svc.status] ?? DOT_STYLE.UNKNOWN}`} />
          {svc.status}
        </span>
      </div>

      {svc.latency_ms != null && (
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[11px] text-[#bbb]">응답</span>
          <span className={`text-[12px] font-semibold ${svc.latency_ms > 200 ? "text-amber-600" : "text-green-600"}`}>
            {svc.latency_ms}ms
          </span>
        </div>
      )}

      {svc.note && (
        <p className="text-[11px] text-[#888] leading-relaxed mt-1">{svc.note}</p>
      )}

      <p className="text-[10px] text-[#ccc] mt-2">
        {svc.last_checked ? new Date(svc.last_checked).toLocaleTimeString("ko-KR") : ""}
      </p>
    </div>
  );
}

type TabKey = "status" | "infra";

export default function SuperServers() {
  const [tab, setTab] = useState<TabKey>("status");

  const [servers, setServers] = useState<ServersData | null>(null);
  const [serversErr, setServersErr] = useState(false);
  const [serversLoading, setServersLoading] = useState(true);

  const [infra, setInfra] = useState<InfraData | null>(null);
  const [infraErr, setInfraErr] = useState(false);
  const [infraLoading, setInfraLoading] = useState(false);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function fetchStatus() {
    setServersLoading(true); setServersErr(false);
    api.get<ServersData>("/super/servers/status")
      .then((d) => setServers(d))
      .catch(() => setServersErr(true))
      .finally(() => setServersLoading(false));
  }

  function fetchInfra() {
    setInfraLoading(true); setInfraErr(false);
    api.get<InfraData>("/super/infra-usage/summary")
      .then((d) => setInfra(d))
      .catch(() => setInfraErr(true))
      .finally(() => setInfraLoading(false));
  }

  useEffect(() => {
    fetchStatus();
    fetchInfra();
    timerRef.current = setInterval(fetchStatus, 30_000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  const svcList = servers ? Object.values(servers.services) : [];
  const degraded = svcList.filter(s => s.status === "DEGRADED").length;
  const live = svcList.filter(s => s.status === "LIVE").length;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="text-[20px] font-bold text-[#111]">서버 관리</h1>
          <p className="text-[12px] text-[#999] mt-0.5">서비스 상태 · 인프라 사용량</p>
        </div>
        <div className="flex items-center gap-3">
          {servers && (
            <span className="text-[11px] text-[#bbb]">
              갱신: {new Date(servers.checked_at).toLocaleTimeString("ko-KR")}
              {" · "}LIVE {live} / DEGRADED {degraded}
            </span>
          )}
          <button
            onClick={fetchStatus}
            className="text-[11px] text-[#888] hover:text-[#333] border border-[#e5e5e5] px-3 py-1.5 rounded-md transition-colors"
          >
            새로고침
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-[#e5e5e5] mb-5">
        {([["status", "서비스 상태"], ["infra", "인프라 사용량"]] as [TabKey, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 text-[13px] font-medium border-b-2 transition-colors -mb-px ${
              tab === key ? "border-[#002F5F] text-[#002F5F]" : "border-transparent text-[#888] hover:text-[#444]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Status Tab */}
      {tab === "status" && (
        <>
          {serversLoading && !servers ? (
            <p className="text-[13px] text-[#bbb] animate-pulse py-10 text-center">불러오는 중...</p>
          ) : serversErr ? (
            <p className="text-[13px] text-red-500 py-10 text-center">서버 상태 조회 실패</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {svcList.map(svc => <ServiceCard key={svc.id} svc={svc} />)}
            </div>
          )}

          {degraded > 0 && (
            <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-lg">
              <p className="text-[13px] font-semibold text-amber-700">⚠️ {degraded}개 서비스 DEGRADED</p>
              <ul className="mt-1 space-y-0.5">
                {svcList.filter(s => s.status === "DEGRADED").map(s => (
                  <li key={s.id} className="text-[12px] text-amber-600">• {s.name}: {s.note}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {/* Infra Tab */}
      {tab === "infra" && (
        <>
          {infraLoading ? (
            <p className="text-[13px] text-[#bbb] animate-pulse py-10 text-center">불러오는 중...</p>
          ) : infraErr ? (
            <p className="text-[13px] text-red-500 py-10 text-center">인프라 데이터 로드 실패</p>
          ) : infra ? (
            <div className="space-y-4">
              {infra.summary && (
                <div className="bg-[#f5f5f7] rounded-lg px-4 py-3 text-[12px] text-[#666]">
                  {infra.summary}
                </div>
              )}
              {/* DB */}
              {infra.db?.length > 0 && (
                <div className="bg-white border border-[#e5e5e5] rounded-lg p-4">
                  <h3 className="text-[11px] font-bold text-[#999] uppercase tracking-wider mb-3">Database</h3>
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="border-b border-[#f0f0f0]">
                        <th className="text-left py-2 text-[11px] text-[#aaa] font-semibold">Pool</th>
                        <th className="text-right py-2 text-[11px] text-[#aaa] font-semibold">크기</th>
                        <th className="text-right py-2 text-[11px] text-[#aaa] font-semibold">응답</th>
                        <th className="text-right py-2 text-[11px] text-[#aaa] font-semibold">연결</th>
                      </tr>
                    </thead>
                    <tbody>
                      {infra.db.map((d, i) => (
                        <tr key={i} className="border-b border-[#f5f5f5] last:border-0">
                          <td className="py-2 text-[#555]">{d.pool ?? `DB ${i+1}`}</td>
                          <td className="py-2 text-right text-[#888]">{d.size_mb ? `${d.size_mb.toFixed(1)} MB` : "—"}</td>
                          <td className={`py-2 text-right font-medium ${(d.latency_ms ?? 0) > 200 ? "text-amber-600" : "text-green-600"}`}>
                            {d.latency_ms != null ? `${d.latency_ms}ms` : "—"}
                          </td>
                          <td className="py-2 text-right text-[#888]">{d.connection_count ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {/* Storage */}
              {infra.storage && (
                <div className="bg-white border border-[#e5e5e5] rounded-lg p-4">
                  <h3 className="text-[11px] font-bold text-[#999] uppercase tracking-wider mb-3">Storage</h3>
                  {infra.storage.error ? (
                    <p className="text-[12px] text-[#bbb]">{infra.storage.error}</p>
                  ) : (
                    <div className="flex items-center gap-4 text-[12px]">
                      <span className="text-[#888]">{infra.storage.bucket ?? "R2"}</span>
                      <span className="font-semibold text-[#111]">
                        {infra.storage.used_mb != null
                          ? `${(infra.storage.used_mb / 1024).toFixed(2)} GB`
                          : "—"}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <p className="text-[12px] text-[#bbb] py-8 text-center">데이터 없음</p>
          )}
        </>
      )}
    </div>
  );
}
