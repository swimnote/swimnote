import { useEffect, useState, useMemo } from "react";
import { useLocation } from "wouter";
import {
  Users, Receipt, RefreshCw, HardDrive, CalendarDays, ClipboardCheck,
  BookOpen, Megaphone, UserCheck, ShieldCheck, Building2,
  TrendingUp, TrendingDown, ArrowRight, Clock,
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar,
} from "recharts";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

const PRIMARY = "#0369A1";

function formatWon(n: number) {
  if (!n) return "0";
  if (n >= 100_000_000) return (n / 100_000_000).toFixed(1).replace(/\.0$/, "") + "억";
  if (n >= 10_000) return Math.floor(n / 10_000).toLocaleString("ko-KR") + "만";
  return n.toLocaleString("ko-KR");
}

function formatWonFull(n: number) {
  if (!n) return "0원";
  if (n >= 100_000_000) return (n / 100_000_000).toFixed(1).replace(/\.0$/, "") + "억원";
  if (n >= 10_000) return Math.floor(n / 10_000).toLocaleString("ko-KR") + "만원";
  return n.toLocaleString("ko-KR") + "원";
}

function TrendBadge({ curr, prev }: { curr: number; prev: number }) {
  if (!prev || prev === 0) return null;
  const pct = Math.round(((curr - prev) / prev) * 100);
  const up = pct >= 0;
  return (
    <span className={`flex items-center gap-0.5 text-[11px] font-semibold ${up ? "text-emerald-600" : "text-red-500"}`}>
      {up ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
      {up ? "+" : ""}{pct}%
    </span>
  );
}

interface StatCardProps {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
  color: string;
  bgColor: string;
  trend?: { curr: number; prev: number };
  onClick?: () => void;
}

function StatCard({ icon: Icon, label, value, sub, color, bgColor, trend, onClick }: StatCardProps) {
  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-2xl border border-[#EBEBEB] p-5 flex flex-col gap-3 transition-all hover:shadow-md hover:-translate-y-0.5 ${onClick ? "cursor-pointer" : ""}`}
    >
      <div className="flex items-center justify-between">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: bgColor }}>
          <Icon size={18} style={{ color }} />
        </div>
        {trend && <TrendBadge curr={trend.curr} prev={trend.prev} />}
      </div>
      <div>
        <p className="text-[24px] font-bold text-[#0A0A0A] leading-none">{value}</p>
        {sub && <p className="text-[11px] text-[#BBB] mt-1">{sub}</p>}
      </div>
      <p className="text-[12px] text-[#999] font-medium">{label}</p>
    </div>
  );
}

const QUICK_LINKS = [
  { label: "수업 목록",   path: "/admin/classes",    icon: CalendarDays, color: "#0369A1",  bg: "#EFF6FF" },
  { label: "출석 관리",   path: "/admin/attendance",  icon: ClipboardCheck, color: "#059669", bg: "#DCFCE7" },
  { label: "선생님 일지", path: "/admin/diary",       icon: BookOpen,     color: "#7C3AED", bg: "#EDE9FE" },
  { label: "공지사항",    path: "/admin/notices",     icon: Megaphone,    color: "#D97706", bg: "#FEF3C7" },
  { label: "회원 목록",   path: "/admin/members",    icon: Users,        color: "#DC2626", bg: "#FEE2E2" },
  { label: "선생님 목록", path: "/admin/teachers",   icon: UserCheck,    color: "#0891B2", bg: "#CFFAFE" },
  { label: "승인 관리",   path: "/admin/approvals",  icon: ShieldCheck,  color: "#65A30D", bg: "#ECFCCB" },
  { label: "보강 관리",   path: "/admin/makeups",    icon: RefreshCw,    color: "#7C3AED", bg: "#EDE9FE" },
  { label: "월별 수입",   path: "/admin/revenue",    icon: Receipt,      color: "#059669", bg: "#DCFCE7" },
  { label: "수영장 정보", path: "/admin/settings/pool", icon: Building2, color: "#0369A1", bg: "#EFF6FF" },
];

const MONTHS_KO = ["1월","2월","3월","4월","5월","6월","7월","8월","9월","10월","11월","12월"];

function getRecentMonths(n: number) {
  const result = [];
  const d = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const dt = new Date(d.getFullYear(), d.getMonth() - i, 1);
    result.push({
      label: MONTHS_KO[dt.getMonth()],
      ym: `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`,
    });
  }
  return result;
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white border border-[#EBEBEB] rounded-xl px-4 py-3 shadow-lg">
        <p className="text-[12px] font-semibold text-[#999] mb-1">{label}</p>
        <p className="text-[15px] font-bold text-[#0A0A0A]">{formatWonFull(payload[0].value)}</p>
      </div>
    );
  }
  return null;
};

export default function Dashboard() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [stats, setStats] = useState<any>(null);
  const [stats2, setStats2] = useState<any>(null);
  const [storage, setStorage] = useState<any>(null);
  const [revenueData, setRevenueData] = useState<{ label: string; revenue: number }[]>([]);
  const [todayClasses, setTodayClasses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const months = useMemo(() => getRecentMonths(6), []);

  useEffect(() => {
    const fetchAll = async () => {
      try {
        const [s, s2, st, classes] = await Promise.all([
          api.get<any>("/admin/dashboard-stats").catch(() => null),
          api.get<any>("/admin/dashboard-stats2").catch(() => null),
          api.get<any>("/admin/storage").catch(() => null),
          api.get<any[]>("/class-groups").catch(() => []),
        ]);
        setStats(s);
        setStats2(s2);
        setStorage(st);
        setTodayClasses(Array.isArray(classes) ? classes.slice(0, 5) : []);

        const revenuePromises = months.map(m =>
          api.get<any>(`/admin/settlement-summary?month=${m.ym}`).catch(() => null)
        );
        const revenues = await Promise.all(revenuePromises);
        setRevenueData(months.map((m, i) => ({
          label: m.label,
          revenue: revenues[i]?.total_revenue || revenues[i]?.total || 0,
        })));
      } finally { setLoading(false); }
    };
    fetchAll();
  }, []);

  const storagePct = storage
    ? Math.min(100, Math.round((storage.total_bytes / (storage.quota_bytes || 5 * 1024 ** 3)) * 100))
    : 0;
  const storageMB = Math.round((storage?.total_bytes || 0) / 1024 / 1024);

  const currRevenue = revenueData[revenueData.length - 1]?.revenue || 0;
  const prevRevenue = revenueData[revenueData.length - 2]?.revenue || 0;
  const prevMembers = stats?.prev_month_members;

  const today = new Date();
  const todayLabel = `${today.getMonth() + 1}월 ${today.getDate()}일 (${["일","월","화","수","목","금","토"][today.getDay()]})`;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* 헤더 */}
      <div className="mb-7">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[22px] font-bold text-[#0A0A0A]">대시보드</h1>
            <p className="text-[13px] text-[#999] mt-0.5">
              {todayLabel} · 안녕하세요, <span className="font-semibold text-[#333]">{user?.name}</span>님
            </p>
          </div>
        </div>
      </div>

      {/* ── 핵심 지표 ── */}
      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {[...Array(4)].map((_, i) => <div key={i} className="h-36 bg-white rounded-2xl border border-[#EBEBEB] animate-pulse" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <StatCard icon={Users} label="전체 회원" value={`${stats?.total_members ?? 0}명`}
            sub={`선생님 ${stats?.total_teachers ?? 0}명`} color="#0369A1" bgColor="#EFF6FF"
            trend={prevMembers ? { curr: stats?.total_members ?? 0, prev: prevMembers } : undefined}
            onClick={() => navigate("/admin/members")} />
          <StatCard icon={TrendingUp} label="이번달 수입" value={formatWon(currRevenue)}
            sub={prevRevenue ? `지난달 ${formatWon(prevRevenue)}` : undefined}
            color="#059669" bgColor="#DCFCE7"
            trend={prevRevenue ? { curr: currRevenue, prev: prevRevenue } : undefined}
            onClick={() => navigate("/admin/revenue")} />
          <StatCard icon={RefreshCw} label="보강 대기" value={`${stats2?.makeup_assigned ?? 0}건`}
            sub="처리 필요" color="#D97706" bgColor="#FEF3C7"
            onClick={() => navigate("/admin/makeups")} />
          <StatCard icon={HardDrive} label="스토리지" value={`${storagePct}%`}
            sub={`${storageMB}MB 사용중`} color="#7C3AED" bgColor="#EDE9FE" />
        </div>
      )}

      {/* ── 수입 차트 + 미니 지표 ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        {/* 수입 차트 */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-[#EBEBEB] p-5">
          <div className="flex items-center justify-between mb-5">
            <div>
              <p className="font-bold text-[15px] text-[#0A0A0A]">월별 수입 추이</p>
              <p className="text-[12px] text-[#999] mt-0.5">최근 6개월</p>
            </div>
            <button onClick={() => navigate("/admin/revenue")}
              className="flex items-center gap-1 text-[12px] text-[#0369A1] font-semibold hover:opacity-70 transition-opacity">
              자세히 <ArrowRight size={13} />
            </button>
          </div>
          {revenueData.every(d => d.revenue === 0) ? (
            <div className="h-48 flex items-center justify-center">
              <div className="text-center">
                <Receipt size={32} className="mx-auto mb-2 text-[#E5E5E5]" />
                <p className="text-[13px] text-[#BBB]">수입 데이터가 없습니다</p>
              </div>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={190}>
              <AreaChart data={revenueData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0369A1" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#0369A1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#F0F0F0" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#999" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "#BBB" }} axisLine={false} tickLine={false} tickFormatter={v => formatWon(v)} />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="revenue" stroke="#0369A1" strokeWidth={2.5}
                  fill="url(#revenueGrad)" dot={{ fill: "#0369A1", strokeWidth: 0, r: 4 }}
                  activeDot={{ r: 6, fill: "#0369A1" }} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* 미니 지표들 */}
        <div className="flex flex-col gap-3">
          {[
            { label: "학부모 연결",  value: stats?.total_parents ?? 0,           unit: "명",  color: "#0369A1",  bg: "#EFF6FF" },
            { label: "미배정 회원",  value: stats?.unassigned_members ?? 0,       unit: "명",  color: "#D97706",  bg: "#FEF3C7" },
            { label: "연기중 회원",  value: stats?.suspended_members ?? 0,        unit: "명",  color: "#7C3AED",  bg: "#EDE9FE" },
            { label: "이번달 출석",  value: stats?.monthly_attendance ?? 0,       unit: "건",  color: "#059669",  bg: "#DCFCE7" },
          ].map((item) => (
            <div key={item.label} className="bg-white rounded-2xl border border-[#EBEBEB] px-5 py-4 flex items-center gap-4">
              <div className="w-8 h-8 rounded-xl flex-shrink-0 flex items-center justify-center" style={{ background: item.bg }}>
                <div className="w-2 h-2 rounded-full" style={{ background: item.color }} />
              </div>
              <div className="flex-1">
                <p className="text-[12px] text-[#999]">{item.label}</p>
                <p className="text-[18px] font-bold text-[#0A0A0A] leading-none mt-0.5">
                  {item.value}<span className="text-[12px] font-normal text-[#999] ml-0.5">{item.unit}</span>
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── 오늘의 수업 + 빠른 이동 ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 오늘의 수업 */}
        <div className="bg-white rounded-2xl border border-[#EBEBEB] p-5">
          <div className="flex items-center justify-between mb-4">
            <p className="font-bold text-[15px] text-[#0A0A0A]">오늘의 수업</p>
            <button onClick={() => navigate("/admin/classes")}
              className="flex items-center gap-1 text-[12px] text-[#0369A1] font-semibold hover:opacity-70">
              전체 <ArrowRight size={13} />
            </button>
          </div>
          {loading ? (
            <div className="space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="h-12 bg-[#F9F9F9] rounded-xl animate-pulse" />)}</div>
          ) : todayClasses.length === 0 ? (
            <div className="py-8 text-center">
              <CalendarDays size={28} className="mx-auto mb-2 text-[#E5E5E5]" />
              <p className="text-[12px] text-[#BBB]">오늘 수업이 없습니다</p>
            </div>
          ) : (
            <div className="space-y-2">
              {todayClasses.map((c: any) => (
                <div key={c.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-[#F9F9F9] hover:bg-[#EFF6FF] transition-colors">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#0369A1] flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-semibold text-[#0A0A0A] truncate">{c.name}</p>
                    {c.schedule_time && (
                      <p className="text-[11px] text-[#999] flex items-center gap-1 mt-0.5">
                        <Clock size={9} /> {c.schedule_time}
                      </p>
                    )}
                  </div>
                  <span className="text-[11px] text-[#BBB] flex-shrink-0">
                    {c.current_members ?? 0}/{c.capacity ?? 0}명
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 빠른 이동 */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-[#EBEBEB] p-5">
          <p className="font-bold text-[15px] text-[#0A0A0A] mb-4">바로 가기</p>
          <div className="grid grid-cols-5 gap-2">
            {QUICK_LINKS.map((link) => {
              const Icon = link.icon;
              return (
                <button key={link.path} onClick={() => navigate(link.path)}
                  className="flex flex-col items-center gap-2 p-3 rounded-xl border border-transparent hover:border-[#E5E5E5] hover:bg-[#FAFAFA] transition-all group">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center transition-transform group-hover:scale-110" style={{ background: link.bg }}>
                    <Icon size={17} style={{ color: link.color }} />
                  </div>
                  <span className="text-[11px] font-medium text-[#666] group-hover:text-[#0369A1] text-center leading-tight">{link.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
