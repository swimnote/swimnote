/**
 * SuperOverview — SA0-A: Overview shell
 * 실제 telemetry는 SA0-B에서 연결. 이번 단계는 섹션 구조만.
 * UNKNOWN_NOT_FAKE_ZERO: 데이터 없으면 "—" 또는 "UNKNOWN" 표시.
 */
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

interface DashboardStats {
  total_pools?: number;
  approved_pools?: number;
  pending_approval?: number;
  active_subscriptions?: number;
  total_users?: number;
}

function StatusDot({ status }: { status: "ok" | "error" | "unknown" }) {
  const cls =
    status === "ok" ? "bg-green-500" :
    status === "error" ? "bg-red-500" :
    "bg-gray-300";
  return <span className={`inline-block w-2 h-2 rounded-full ${cls} mr-2`} />;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-[#e5e5e5] rounded-lg p-5">
      <h3 className="text-[11px] font-bold text-[#999] uppercase tracking-wider mb-4">{title}</h3>
      {children}
    </div>
  );
}

function KV({ label, value, valueClass }: { label: string; value: React.ReactNode; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-[#f5f5f5] last:border-0">
      <span className="text-[12px] text-[#888]">{label}</span>
      <span className={`text-[13px] font-semibold ${valueClass ?? "text-[#111]"}`}>{value}</span>
    </div>
  );
}

export default function SuperOverview() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [statsErr, setStatsErr] = useState(false);

  useEffect(() => {
    api.get<DashboardStats>("/super/dashboard-stats")
      .then((d) => setStats(d))
      .catch(() => setStatsErr(true));
  }, []);

  const v = (n?: number) => (n == null ? "—" : String(n));

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-[20px] font-bold text-[#111]">Overview</h1>
        <p className="text-[12px] text-[#999] mt-0.5">SWIMNOTE 전체 운영 상태</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* SERVICE STATUS */}
        <Section title="Service Status">
          <div className="space-y-1">
            {[
              { label: "APP API", status: "unknown" as const },
              { label: "AI Engine", status: "unknown" as const },
              { label: "Database", status: "unknown" as const },
              { label: "Storage", status: "unknown" as const },
              { label: "RevenueCat", status: "unknown" as const },
              { label: "OpenAI", status: "unknown" as const },
              { label: "Push", status: "unknown" as const },
            ].map((s) => (
              <div key={s.label} className="flex items-center justify-between py-1.5 border-b border-[#f5f5f5] last:border-0">
                <span className="text-[12px] text-[#888]">{s.label}</span>
                <span className="flex items-center text-[12px] text-[#999]">
                  <StatusDot status={s.status} />
                  UNKNOWN
                </span>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-[#bbb] mt-3">실시간 상태 → 서버 관리</p>
        </Section>

        {/* BUSINESS */}
        <Section title="Business">
          {statsErr ? (
            <p className="text-[12px] text-[#999]">데이터 로드 실패</p>
          ) : (
            <>
              <KV label="전체 수영장" value={v(stats?.total_pools)} />
              <KV label="승인된 수영장" value={v(stats?.approved_pools)} valueClass="text-green-700" />
              <KV label="승인 대기" value={v(stats?.pending_approval)} valueClass={stats?.pending_approval ? "text-amber-600" : undefined} />
              <KV label="활성 구독" value={v(stats?.active_subscriptions)} />
              <KV label="전체 사용자" value={v(stats?.total_users)} />
              <KV label="X 수영장" value="—" />
            </>
          )}
        </Section>

        {/* OPERATIONS */}
        <Section title="Operations — 처리 필요">
          <KV label="미해결 장애" value="—" valueClass="text-[#999]" />
          <KV label="결제 이상" value="—" valueClass="text-[#999]" />
          <KV label="미처리 고객문의" value="—" valueClass="text-[#999]" />
          <KV label="X Setup 검토대기" value="—" valueClass="text-[#999]" />
          <KV label="홈페이지 제작대기" value="—" valueClass="text-[#999]" />
          <KV label="AI 오류" value="—" valueClass="text-[#999]" />
          <p className="text-[11px] text-[#bbb] mt-3">SA0-B에서 실시간 데이터 연결</p>
        </Section>

        {/* TODAY */}
        <Section title="Today">
          <KV label="오늘 신규 수영장" value="—" valueClass="text-[#999]" />
          <KV label="오늘 AI 호출" value="—" valueClass="text-[#999]" />
          <KV label="오늘 고객문의" value="—" valueClass="text-[#999]" />
          <KV label="오늘 오류" value="—" valueClass="text-[#999]" />
          <p className="text-[11px] text-[#bbb] mt-3">SA0-B에서 실시간 데이터 연결</p>
        </Section>
      </div>
    </div>
  );
}
