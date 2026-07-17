import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import {
  LayoutDashboard, CalendarDays, ClipboardCheck, BookOpen,
  Megaphone, RefreshCw, UmbrellaOff, Users, UserCheck,
  ShieldCheck, Receipt, Calculator, UserMinus, Baby,
  UserX, Settings, Building2, Layers, FileText,
  UserCog, Palette, DoorOpen, ChevronDown, ChevronRight,
  Crown, Zap,
} from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

const PRIMARY = "#0369A1";

interface MenuItem { label: string; path: string; icon: React.ElementType; }
interface MenuGroup { label: string; icon: React.ElementType; items: MenuItem[]; }

const MENU: (MenuItem | MenuGroup)[] = [
  { label: "대시보드", path: "/admin", icon: LayoutDashboard },
  {
    label: "수업관리", icon: CalendarDays,
    items: [
      { label: "수업 목록",   path: "/admin/classes",    icon: CalendarDays },
      { label: "출석 관리",   path: "/admin/attendance",  icon: ClipboardCheck },
      { label: "선생님 일지", path: "/admin/diary",       icon: BookOpen },
      { label: "공지사항",    path: "/admin/notices",     icon: Megaphone },
      { label: "보강 관리",   path: "/admin/makeups",     icon: RefreshCw },
      { label: "휴일 설정",   path: "/admin/holidays",    icon: UmbrellaOff },
    ],
  },
  {
    label: "운영관리", icon: Users,
    items: [
      { label: "회원 목록",   path: "/admin/members",    icon: Users },
      { label: "선생님 목록", path: "/admin/teachers",   icon: UserCheck },
      { label: "승인 관리",   path: "/admin/approvals",  icon: ShieldCheck },
      { label: "월별 수입",   path: "/admin/revenue",    icon: Receipt },
      { label: "정산",        path: "/admin/settlement", icon: Calculator },
    ],
  },
  {
    label: "인원관리", icon: Baby,
    items: [
      { label: "미배정 회원", path: "/admin/people-pending", icon: UserMinus },
      { label: "학부모 목록", path: "/admin/parents",        icon: Baby },
      { label: "탈퇴 회원",   path: "/admin/withdrawn",      icon: UserX },
    ],
  },
  {
    label: "설정", icon: Settings,
    items: [
      { label: "수영장 정보", path: "/admin/settings/pool",            icon: Building2 },
      { label: "레벨 설정",   path: "/admin/settings/levels",          icon: Layers },
      { label: "일지 템플릿", path: "/admin/settings/diary-templates", icon: FileText },
      { label: "수업 정원",   path: "/admin/settings/capacity",        icon: DoorOpen },
      { label: "단가 설정",   path: "/admin/settings/pricing",         icon: Receipt },
      { label: "권한 설정",   path: "/admin/settings/permissions",     icon: UserCog },
      { label: "브랜딩",      path: "/admin/settings/branding",        icon: Palette },
    ],
  },
];

function isGroup(item: MenuItem | MenuGroup): item is MenuGroup { return "items" in item; }

const PREMIER_TIERS = new Set(["center_200", "advance", "pro", "max"]);
const COACH_TIERS   = new Set(["starter", "basic", "standard"]);

function PlanBadge({ tier }: { tier: string }) {
  if (PREMIER_TIERS.has(tier)) return (
    <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-600">
      <Crown size={9} /> Premier
    </span>
  );
  if (COACH_TIERS.has(tier)) return (
    <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-100 text-purple-600">
      <Zap size={9} /> Coach
    </span>
  );
  return <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#F3F4F6] text-[#999]">Free</span>;
}

export default function AdminSidebar() {
  const { user } = useAuth();
  const [location, navigate] = useLocation();
  const [pool, setPool] = useState<any>(null);
  const [subTier, setSubTier] = useState("free");

  const getDefaultOpen = () => {
    const result: Record<string, boolean> = {};
    MENU.forEach((item) => {
      if (isGroup(item)) {
        const active = item.items.some((sub) => location === sub.path || location.startsWith(sub.path + "/"));
        result[item.label] = active;
      }
    });
    if (!Object.values(result).some(Boolean)) result["수업관리"] = true;
    return result;
  };

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(getDefaultOpen);

  useEffect(() => {
    api.get<any>("/pools/my").then(p => setPool(p)).catch(() => {});
    api.get<any>("/billing/features").then(f => setSubTier(f?.tier || "free")).catch(() => {});
  }, []);

  const toggle = (label: string) => setOpenGroups(prev => ({ ...prev, [label]: !prev[label] }));
  const isActive = (path: string) => path === "/admin" ? location === "/admin" : location === path || location.startsWith(path + "/");

  const roleLabel = user?.role === "pool_admin" ? "대표" : user?.role === "sub_admin" ? "부관리자" : "관리자";

  return (
    <div className="flex flex-col h-full">
      {/* ── 수영장 정보 헤더 ── */}
      <div className="px-4 py-4 border-b border-[#F0F0F0]">
        <div className="flex items-center gap-2.5 mb-1">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center text-white text-[11px] font-black flex-shrink-0" style={{ background: PRIMARY }}>
            {pool?.name?.[0] || "S"}
          </div>
          <div className="min-w-0">
            <p className="font-bold text-[13px] text-[#0A0A0A] truncate">{pool?.name || "수영장"}</p>
          </div>
        </div>
        <div className="ml-[42px]">
          <PlanBadge tier={subTier} />
        </div>
      </div>

      {/* ── 메뉴 ── */}
      <nav className="flex-1 py-3 overflow-y-auto">
        {MENU.map((item) => {
          if (!isGroup(item)) {
            const Icon = item.icon;
            const active = isActive(item.path);
            return (
              <button key={item.path} onClick={() => navigate(item.path)}
                className={`flex items-center gap-3 w-full text-left transition-all text-[13px] font-medium relative
                  px-4 py-2.5 mx-0
                  ${active ? "text-[#0369A1] bg-[#EFF6FF]" : "text-[#555] hover:bg-[#F5F5F5] hover:text-[#0369A1]"}`}>
                {active && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-6 rounded-r-full bg-[#0369A1]" />}
                <Icon size={16} strokeWidth={active ? 2.5 : 1.8} />
                <span>{item.label}</span>
              </button>
            );
          }

          const open = openGroups[item.label] ?? false;
          const GroupIcon = item.icon;
          const hasActive = item.items.some(sub => isActive(sub.path));

          return (
            <div key={item.label}>
              <button onClick={() => toggle(item.label)}
                className={`flex items-center gap-3 px-4 py-2.5 w-full text-left transition-colors text-[12px] font-semibold uppercase tracking-wider
                  ${hasActive ? "text-[#0369A1]" : "text-[#AAA] hover:text-[#555]"}`}>
                <span className="flex-1">{item.label}</span>
                {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              </button>
              {open && (
                <div className="mb-1">
                  {item.items.map((sub) => {
                    const SubIcon = sub.icon;
                    const active = isActive(sub.path);
                    return (
                      <button key={sub.path} onClick={() => navigate(sub.path)}
                        className={`flex items-center gap-3 w-full text-left transition-all text-[13px] relative pl-10 pr-4 py-2.5
                          ${active ? "text-[#0369A1] bg-[#EFF6FF] font-semibold" : "text-[#666] hover:bg-[#F5F5F5] hover:text-[#0369A1]"}`}>
                        {active && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-[#0369A1]" />}
                        <SubIcon size={14} strokeWidth={active ? 2.5 : 1.8} />
                        <span>{sub.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* ── 유저 섹션 (하단) ── */}
      <div className="px-4 py-3 border-t border-[#F0F0F0]">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[12px] font-bold flex-shrink-0" style={{ background: "#0369A1" }}>
            {user?.name?.[0] || "A"}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-semibold text-[#0A0A0A] truncate">{user?.name}</p>
            <p className="text-[11px] text-[#999]">{roleLabel}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
