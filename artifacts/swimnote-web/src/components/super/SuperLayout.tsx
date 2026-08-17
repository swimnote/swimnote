import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";

const NAV_ITEMS = [
  { path: "/super/overview",   label: "Overview" },
  { path: "/super/pools",      label: "수영장 관리" },
  { path: "/super/billing",    label: "구독 / 결제" },
  { path: "/super/x-mode",     label: "X MODE 운영" },
  { path: "/super/ai",         label: "AI 운영" },
  { path: "/super/support",    label: "고객센터" },
  { path: "/super/servers",    label: "서버 관리" },
  { path: "/super/incidents",  label: "장애 관리" },
  { path: "/super/partner",    label: "Partner Analytics" },
  { path: "/super/audit",      label: "감사 / 로그" },
  { path: "/super/settings",   label: "시스템 설정" },
];

function NavItem({ path, label }: { path: string; label: string }) {
  const [location, navigate] = useLocation();
  // /super/pools/:id 도 /super/pools 활성으로 처리
  const isActive =
    path === "/super/overview"
      ? location === path || location === "/super"
      : location === path || location.startsWith(path + "/");

  return (
    <button
      onClick={() => navigate(path)}
      className={`w-full text-left px-4 py-2 text-[13px] transition-colors ${
        isActive
          ? "bg-[#002F5F] text-white font-semibold"
          : "text-[#444] hover:bg-[#f0f0f0] hover:text-[#111]"
      }`}
    >
      {label}
    </button>
  );
}

export default function SuperLayout({ children }: { children: React.ReactNode }) {
  const [, navigate] = useLocation();
  const { user, logout } = useAuth();

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <div className="flex h-screen overflow-hidden bg-[#f5f5f7]">
      {/* ── Sidebar ── */}
      <aside className="w-48 bg-white border-r border-[#e5e5e5] flex flex-col shrink-0">
        {/* Brand */}
        <div className="px-4 py-4 border-b border-[#e5e5e5]">
          <div className="text-[13px] font-black text-[#002F5F]" translate="no">SWIMNOTE</div>
          <div className="text-[11px] text-[#999] mt-0.5">Super Admin Console</div>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-2 overflow-y-auto">
          {NAV_ITEMS.map((item) => (
            <NavItem key={item.path} path={item.path} label={item.label} />
          ))}
        </nav>

        {/* User / logout */}
        <div className="px-4 py-3 border-t border-[#e5e5e5]">
          <div className="text-[11px] text-[#999] mb-1 truncate">{user?.name}</div>
          <button
            onClick={handleLogout}
            className="text-[11px] text-[#aaa] hover:text-[#333] transition-colors"
          >
            로그아웃
          </button>
        </div>
      </aside>

      {/* ── Main content ── */}
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
