/**
 * SuperServers — 서버 관리
 * SA0-A: 기존 db-status / infra-usage / system-health API 재배치.
 * 없는 telemetry → UNKNOWN 표시. fake 데이터 생성 금지.
 */
import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";

type ServiceStatus = "ok" | "degraded" | "error" | "unknown";

interface ServiceCard {
  name: string;
  status: ServiceStatus;
  latency?: string;
  lastCheck?: string;
  lastError?: string;
  detail?: string;
}

interface DbStatusData {
  db_connected?: boolean;
  retry_queue_size?: number;
  dead_letter_count?: number;
  event_log_count?: number;
}

interface InfraUsageData {
  super_db?: { pool_size?: number; idle?: number };
  storage?: { total_used_gb?: number };
}

function StatusBadge({ status }: { status: ServiceStatus }) {
  const cfg = {
    ok:       { cls: "bg-green-100 text-green-700", label: "OK" },
    degraded: { cls: "bg-amber-100 text-amber-700",  label: "DEGRADED" },
    error:    { cls: "bg-red-100 text-red-700",      label: "ERROR" },
    unknown:  { cls: "bg-gray-100 text-gray-500",    label: "UNKNOWN" },
  }[status];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

function ServiceRow({ card }: { card: ServiceCard }) {
  return (
    <div className="flex items-start justify-between py-3 border-b border-[#f5f5f5] last:border-0 gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-[#111]">{card.name}</span>
          <StatusBadge status={card.status} />
        </div>
        {card.detail && <p className="text-[11px] text-[#999] mt-0.5">{card.detail}</p>}
        {card.lastError && <p className="text-[11px] text-red-500 mt-0.5">오류: {card.lastError}</p>}
      </div>
      <div className="text-right shrink-0">
        {card.latency && <p className="text-[11px] text-[#888]">{card.latency}</p>}
        {card.lastCheck && <p className="text-[10px] text-[#bbb]">{card.lastCheck}</p>}
      </div>
    </div>
  );
}

export default function SuperServers() {
  const [dbStatus, setDbStatus] = useState<DbStatusData | null>(null);
  const [dbError, setDbError] = useState(false);
  const [infra, setInfra] = useState<InfraUsageData | null>(null);
  const [infraError, setInfraError] = useState(false);
  const [lastChecked, setLastChecked] = useState<string>("");
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const now = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
    setLastChecked(now);

    await Promise.allSettled([
      api.get<DbStatusData>("/super/db-status")
        .then((d) => { setDbStatus(d); setDbError(false); })
        .catch(() => setDbError(true)),

      api.get<InfraUsageData>("/super/infra-usage/summary")
        .then((d) => { setInfra(d); setInfraError(false); })
        .catch(() => setInfraError(true)),
    ]);

    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const dbServiceStatus: ServiceStatus = dbError ? "error" : dbStatus?.db_connected === false ? "error" : dbStatus?.db_connected ? "ok" : "unknown";

  const services: ServiceCard[] = [
    {
      name: "APP API — Front Door",
      status: "unknown",
      detail: "https://swimnote.kr/api — 외부 헬스체크 미구현",
    },
    {
      name: "APP API — Render Origin",
      status: "unknown",
      detail: "https://swimnote-api.onrender.com/api",
    },
    {
      name: "AI Engine",
      status: "unknown",
      detail: "https://swimnote.ai.kr — 헬스체크 미구현",
    },
    {
      name: "Database",
      status: dbServiceStatus,
      detail: dbError
        ? "조회 실패"
        : dbStatus
          ? `retry_queue: ${dbStatus.retry_queue_size ?? "—"} / dead_letters: ${dbStatus.dead_letter_count ?? "—"}`
          : "—",
      lastCheck: lastChecked || undefined,
    },
    {
      name: "Storage (R2)",
      status: infraError || !infra ? "unknown" : "ok",
      detail: infra?.storage?.total_used_gb != null
        ? `총 사용량: ${infra.storage.total_used_gb.toFixed(2)} GB`
        : "데이터 없음",
    },
    {
      name: "RevenueCat",
      status: "unknown",
      detail: "webhook 상태 — 구독/결제 메뉴에서 확인",
    },
    {
      name: "OpenAI",
      status: "unknown",
      detail: "AI Engine 통해 간접 사용 — 직접 상태 확인 미구현",
    },
    {
      name: "Push (APNs/FCM)",
      status: "unknown",
      detail: "push 발송 텔레메트리 미구현",
    },
  ];

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[20px] font-bold text-[#111]">서버 관리</h1>
          <p className="text-[12px] text-[#999] mt-0.5">서비스 상태 · DB · 인프라 사용량</p>
        </div>
        <button
          onClick={fetchAll}
          disabled={loading}
          className="text-[12px] text-[#888] hover:text-[#111] border border-[#e5e5e5] px-3 py-1.5 rounded-lg disabled:opacity-50"
        >
          {loading ? "확인 중..." : "새로고침"}
        </button>
      </div>

      {/* Service status grid */}
      <div className="bg-white border border-[#e5e5e5] rounded-lg p-5 mb-5">
        <h3 className="text-[11px] font-bold text-[#999] uppercase tracking-wider mb-1">서비스 상태</h3>
        <p className="text-[11px] text-[#bbb] mb-4">
          실제 telemetry가 없는 항목은 UNKNOWN으로 표시. fake 상태 생성 금지.
        </p>
        {services.map((s) => <ServiceRow key={s.name} card={s} />)}
      </div>

      {/* DB Details */}
      <div className="bg-white border border-[#e5e5e5] rounded-lg p-5 mb-5">
        <h3 className="text-[11px] font-bold text-[#999] uppercase tracking-wider mb-4">Database 상세</h3>
        {dbError ? (
          <p className="text-[12px] text-red-500">db-status 조회 실패</p>
        ) : !dbStatus ? (
          <p className="text-[12px] text-[#aaa]">{loading ? "불러오는 중..." : "데이터 없음"}</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "연결 상태", value: dbStatus.db_connected ? "OK" : "FAIL" },
              { label: "Retry Queue", value: dbStatus.retry_queue_size ?? "—" },
              { label: "Dead Letters", value: dbStatus.dead_letter_count ?? "—" },
              { label: "Event Logs", value: dbStatus.event_log_count ?? "—" },
            ].map((item) => (
              <div key={item.label} className="bg-[#f8f8f8] rounded-lg px-3 py-3">
                <p className="text-[10px] text-[#999] mb-1">{item.label}</p>
                <p className="text-[15px] font-bold text-[#111]">{String(item.value)}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Infra Usage */}
      <div className="bg-white border border-[#e5e5e5] rounded-lg p-5 mb-5">
        <h3 className="text-[11px] font-bold text-[#999] uppercase tracking-wider mb-4">인프라 사용량</h3>
        {infraError ? (
          <p className="text-[12px] text-red-500">infra-usage 조회 실패</p>
        ) : !infra ? (
          <p className="text-[12px] text-[#aaa]">{loading ? "불러오는 중..." : "데이터 없음"}</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[
              { label: "DB Pool 크기", value: infra?.super_db?.pool_size ?? "—" },
              { label: "DB Idle", value: infra?.super_db?.idle ?? "—" },
              { label: "Storage 사용", value: infra?.storage?.total_used_gb != null ? `${infra.storage.total_used_gb.toFixed(2)} GB` : "—" },
            ].map((item) => (
              <div key={item.label} className="bg-[#f8f8f8] rounded-lg px-3 py-3">
                <p className="text-[10px] text-[#999] mb-1">{item.label}</p>
                <p className="text-[15px] font-bold text-[#111]">{String(item.value)}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* OTA / App Version */}
      <div className="bg-white border border-[#e5e5e5] rounded-lg p-5">
        <h3 className="text-[11px] font-bold text-[#999] uppercase tracking-wider mb-4">OTA / 앱 버전</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[
            { label: "iOS App 버전", value: "1.3.x" },
            { label: "runtimeVersion", value: "config 기준" },
            { label: "latest iOS OTA", value: "—" },
            { label: "latest Android OTA", value: "—" },
            { label: "preview OTA", value: "—" },
          ].map((item) => (
            <div key={item.label} className="bg-[#f8f8f8] rounded-lg px-3 py-3">
              <p className="text-[10px] text-[#999] mb-1">{item.label}</p>
              <p className="text-[13px] font-semibold text-[#555]">{item.value}</p>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-[#bbb] mt-3">동적 OTA 버전 조회는 향후 연결 예정</p>
      </div>
    </div>
  );
}
