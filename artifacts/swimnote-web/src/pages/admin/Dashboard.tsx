import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Users, Receipt, RefreshCw, HardDrive, CalendarDays, ClipboardCheck, BookOpen, Megaphone, UserCheck, ShieldCheck, Building2, TrendingUp } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

function StatCard({ icon: Icon, label, value, sub, color }: { icon: React.ElementType; label: string; value: string | number; sub?: string; color: string }) {
  return (
    <div className="bg-white rounded-2xl border border-[#EBEBEB] p-5 flex items-start gap-4">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: color + "20" }}>
        <Icon size={20} style={{ color }} />
      </div>
      <div>
        <p className="text-[12px] text-[#999] font-medium">{label}</p>
        <p className="text-[22px] font-bold text-[#0A0A0A] leading-tight mt-0.5">{value}</p>
        {sub && <p className="text-[11px] text-[#BBB] mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

const QUICK_LINKS = [
  { label: "수업 목록", path: "/admin/classes", icon: CalendarDays, color: "#0369A1" },
  { label: "출석 관리", path: "/admin/attendance", icon: ClipboardCheck, color: "#059669" },
  { label: "선생님 일지", path: "/admin/diary", icon: BookOpen, color: "#7C3AED" },
  { label: "공지사항", path: "/admin/notices", icon: Megaphone, color: "#D97706" },
  { label: "회원 목록", path: "/admin/members", icon: Users, color: "#DC2626" },
  { label: "선생님 목록", path: "/admin/teachers", icon: UserCheck, color: "#0891B2" },
  { label: "승인 관리", path: "/admin/approvals", icon: ShieldCheck, color: "#65A30D" },
  { label: "보강 관리", path: "/admin/makeups", icon: RefreshCw, color: "#7C3AED" },
  { label: "월별 수입", path: "/admin/revenue", icon: Receipt, color: "#059669" },
  { label: "수영장 정보", path: "/admin/settings/pool", icon: Building2, color: "#0369A1" },
];

export default function Dashboard() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [stats, setStats] = useState<any>(null);
  const [stats2, setStats2] = useState<any>(null);
  const [storage, setStorage] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get<any>("/admin/dashboard-stats").catch(() => null),
      api.get<any>("/admin/dashboard-stats2").catch(() => null),
      api.get<any>("/admin/storage").catch(() => null),
    ]).then(([s, s2, st]) => {
      setStats(s);
      setStats2(s2);
      setStorage(st);
    }).finally(() => setLoading(false));
  }, []);

  const storagePct = storage ? Math.min(100, Math.round((storage.total_bytes / (storage.quota_bytes || 5 * 1024 ** 3)) * 100)) : 0;

  function formatWon(n: number) {
    if (!n) return "0원";
    if (n >= 100_000_000) return (n / 100_000_000).toFixed(1).replace(/\.0$/, "") + "억원";
    if (n >= 10_000) return Math.floor(n / 10_000) + "만원";
    return n.toLocaleString("ko-KR") + "원";
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* 헤더 */}
      <div className="mb-6">
        <h1 className="text-[22px] font-bold text-[#0A0A0A]">대시보드</h1>
        <p className="text-[13px] text-[#999] mt-1">안녕하세요, {user?.name}님. 오늘도 좋은 하루 되세요.</p>
      </div>

      {/* 핵심 지표 카드 */}
      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-white rounded-2xl border border-[#EBEBEB] p-5 h-24 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <StatCard icon={Users} label="전체 회원" value={stats?.total_members ?? 0} sub="명" color="#0369A1" />
          <StatCard icon={TrendingUp} label="이번달 수입" value={formatWon(stats?.monthly_revenue ?? 0)} color="#059669" />
          <StatCard icon={RefreshCw} label="보강 대기" value={stats2?.makeup_assigned ?? 0} sub="건" color="#D97706" />
          <StatCard icon={HardDrive} label="스토리지" value={`${storagePct}%`} sub={`${Math.round((storage?.total_bytes || 0) / 1024 / 1024)}MB 사용중`} color="#7C3AED" />
        </div>
      )}

      {/* 추가 지표 */}
      {!loading && stats && (
        <div className="grid grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
          {[
            { label: "선생님", value: stats.total_teachers ?? 0 },
            { label: "학부모 연결", value: stats.total_parents ?? 0 },
            { label: "수업 수", value: stats.total_classes ?? 0 },
            { label: "미배정", value: stats.unassigned_members ?? 0 },
            { label: "이번달 출석", value: stats.monthly_attendance ?? 0 },
            { label: "연기중", value: stats.suspended_members ?? 0 },
          ].map((item) => (
            <div key={item.label} className="bg-white rounded-xl border border-[#EBEBEB] p-3 text-center">
              <p className="text-[18px] font-bold text-[#0A0A0A]">{item.value}</p>
              <p className="text-[11px] text-[#999] mt-0.5">{item.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* 빠른 이동 */}
      <div className="bg-white rounded-2xl border border-[#EBEBEB] p-5">
        <h2 className="text-[14px] font-bold text-[#0A0A0A] mb-4">빠른 이동</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {QUICK_LINKS.map((link) => {
            const Icon = link.icon;
            return (
              <button
                key={link.path}
                onClick={() => navigate(link.path)}
                className="flex flex-col items-center gap-2 p-4 rounded-xl border border-[#F0F0F0] hover:border-[#BFDBFE] hover:bg-[#EFF6FF] transition-all group"
              >
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: link.color + "15" }}>
                  <Icon size={20} style={{ color: link.color }} />
                </div>
                <span className="text-[12px] font-medium text-[#555] group-hover:text-[#0369A1]">{link.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
