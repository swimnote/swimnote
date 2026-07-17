import { useState } from "react";
import { useLocation } from "wouter";
import {
  LayoutDashboard, CalendarDays, ClipboardCheck, BookOpen,
  Megaphone, RefreshCw, UmbrellaOff, Users, UserCheck,
  ShieldCheck, Receipt, Calculator, UserMinus, Baby,
  UserX, Settings, Building2, Layers, FileText,
  UserCog, Palette, DoorOpen, ChevronDown, ChevronRight,
} from "lucide-react";

const PRIMARY = "#0369A1";

interface MenuItem {
  label: string;
  path: string;
  icon: React.ElementType;
}

interface MenuGroup {
  label: string;
  icon: React.ElementType;
  items: MenuItem[];
}

const MENU: (MenuItem | MenuGroup)[] = [
  { label: "대시보드", path: "/admin", icon: LayoutDashboard },
  {
    label: "수업관리",
    icon: CalendarDays,
    items: [
      { label: "수업 목록", path: "/admin/classes", icon: CalendarDays },
      { label: "출석 관리", path: "/admin/attendance", icon: ClipboardCheck },
      { label: "선생님 일지", path: "/admin/diary", icon: BookOpen },
      { label: "공지사항", path: "/admin/notices", icon: Megaphone },
      { label: "보강 관리", path: "/admin/makeups", icon: RefreshCw },
      { label: "휴일 설정", path: "/admin/holidays", icon: UmbrellaOff },
    ],
  },
  {
    label: "운영관리",
    icon: Users,
    items: [
      { label: "회원 목록", path: "/admin/members", icon: Users },
      { label: "선생님 목록", path: "/admin/teachers", icon: UserCheck },
      { label: "승인 관리", path: "/admin/approvals", icon: ShieldCheck },
      { label: "월별 수입", path: "/admin/revenue", icon: Receipt },
      { label: "정산", path: "/admin/settlement", icon: Calculator },
    ],
  },
  {
    label: "인원관리",
    icon: Baby,
    items: [
      { label: "미배정 회원", path: "/admin/people-pending", icon: UserMinus },
      { label: "학부모 목록", path: "/admin/parents", icon: Baby },
      { label: "탈퇴 회원", path: "/admin/withdrawn", icon: UserX },
    ],
  },
  {
    label: "설정",
    icon: Settings,
    items: [
      { label: "수영장 정보", path: "/admin/settings/pool", icon: Building2 },
      { label: "레벨 설정", path: "/admin/settings/levels", icon: Layers },
      { label: "일지 템플릿", path: "/admin/settings/diary-templates", icon: FileText },
      { label: "수업 정원", path: "/admin/settings/capacity", icon: DoorOpen },
      { label: "단가 설정", path: "/admin/settings/pricing", icon: Receipt },
      { label: "권한 설정", path: "/admin/settings/permissions", icon: UserCog },
      { label: "브랜딩", path: "/admin/settings/branding", icon: Palette },
    ],
  },
];

function isGroup(item: MenuItem | MenuGroup): item is MenuGroup {
  return "items" in item;
}

export default function AdminSidebar() {
  const [location, navigate] = useLocation();

  const getDefaultOpen = () => {
    const result: Record<string, boolean> = {};
    MENU.forEach((item) => {
      if (isGroup(item)) {
        const active = item.items.some((sub) => location === sub.path || location.startsWith(sub.path + "/"));
        result[item.label] = active || item.label === "수업관리";
      }
    });
    return result;
  };

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(getDefaultOpen);

  const toggle = (label: string) =>
    setOpenGroups((prev) => ({ ...prev, [label]: !prev[label] }));

  const isActive = (path: string) =>
    path === "/admin" ? location === "/admin" : location === path || location.startsWith(path + "/");

  return (
    <div className="flex flex-col h-full py-4 overflow-y-auto">
      {MENU.map((item) => {
        if (!isGroup(item)) {
          const Icon = item.icon;
          const active = isActive(item.path);
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={`flex items-center gap-3 px-4 py-2.5 mx-2 rounded-xl text-left transition-colors text-[13px] font-medium ${
                active ? "text-white" : "text-[#555] hover:bg-[#F0F7FF] hover:text-[#0369A1]"
              }`}
              style={active ? { background: PRIMARY } : {}}
            >
              <Icon size={16} strokeWidth={active ? 2.5 : 2} />
              <span>{item.label}</span>
            </button>
          );
        }

        const open = openGroups[item.label] ?? false;
        const GroupIcon = item.icon;
        const hasActive = item.items.some((sub) => isActive(sub.path));

        return (
          <div key={item.label}>
            <button
              onClick={() => toggle(item.label)}
              className={`flex items-center gap-3 px-4 py-2.5 mx-2 w-[calc(100%-16px)] rounded-xl text-left transition-colors text-[13px] font-semibold ${
                hasActive ? "text-[#0369A1]" : "text-[#333] hover:bg-[#F5F5F5]"
              }`}
            >
              <GroupIcon size={16} strokeWidth={2} />
              <span className="flex-1">{item.label}</span>
              {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
            {open && (
              <div className="ml-4 mb-1">
                {item.items.map((sub) => {
                  const SubIcon = sub.icon;
                  const active = isActive(sub.path);
                  return (
                    <button
                      key={sub.path}
                      onClick={() => navigate(sub.path)}
                      className={`flex items-center gap-3 px-4 py-2 mx-2 w-[calc(100%-16px)] rounded-xl text-left transition-colors text-[12.5px] ${
                        active
                          ? "font-semibold text-[#0369A1] bg-[#EFF6FF]"
                          : "text-[#666] hover:bg-[#F5F5F5] hover:text-[#0369A1]"
                      }`}
                    >
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
    </div>
  );
}
