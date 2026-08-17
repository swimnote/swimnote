import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";

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

interface SearchPool {
  id: string;
  name: string;
  owner_name: string | null;
  approval_status: string;
  subscription_status: string;
  xmode_active: boolean;
  xmode_config_status: string;
}

function NavItem({ path, label }: { path: string; label: string }) {
  const [location, navigate] = useLocation();
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

function PoolSearchBar() {
  const [, navigate] = useLocation();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchPool[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (q.length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setLoading(true);
      api.get<{ pools: SearchPool[] }>(`/super/pools/search?q=${encodeURIComponent(q)}`)
        .then((d) => {
          setResults(d.pools ?? []);
          setOpen(true);
        })
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 400);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [q]);

  // ESC closes
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Click-outside closes
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function select(pool: SearchPool) {
    setQ("");
    setOpen(false);
    navigate(`/super/pools/${pool.id}`);
  }

  const statusColor = (s: string) =>
    s === "active" || s === "trial" ? "text-green-600"
      : s === "expired" || s === "suspended" ? "text-red-500"
      : "text-[#aaa]";

  return (
    <div ref={containerRef} className="relative px-2 py-2 border-b border-[#f0f0f0]">
      <div className="relative">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="수영장 검색..."
          className="w-full h-7 pl-6 pr-2 text-[12px] bg-[#f5f5f7] border border-[#e5e5e5] rounded-md outline-none focus:border-[#002F5F] focus:ring-1 focus:ring-[#002F5F]/20 placeholder-[#bbb]"
        />
        <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[#bbb] text-[11px]">⌕</span>
        {loading && (
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[#bbb]">…</span>
        )}
      </div>

      {open && results.length > 0 && (
        <div className="absolute left-2 right-2 top-full mt-1 bg-white border border-[#e5e5e5] rounded-lg shadow-lg z-50 max-h-64 overflow-y-auto">
          {results.map((pool) => (
            <button
              key={pool.id}
              onClick={() => select(pool)}
              className="w-full text-left px-3 py-2 hover:bg-[#f5f5f7] border-b border-[#f5f5f5] last:border-0 transition-colors"
            >
              <div className="flex items-center gap-1.5">
                <span className="text-[12px] font-semibold text-[#111] truncate">{pool.name}</span>
                {pool.xmode_active && (
                  <span className="px-1 py-0.5 text-[9px] font-bold bg-[#002F5F] text-white rounded">X</span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[11px] text-[#888]">{pool.owner_name ?? "—"}</span>
                <span className={`text-[10px] font-medium ${statusColor(pool.subscription_status)}`}>
                  {pool.subscription_status}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      {open && results.length === 0 && q.length >= 2 && !loading && (
        <div className="absolute left-2 right-2 top-full mt-1 bg-white border border-[#e5e5e5] rounded-lg shadow-lg z-50 px-3 py-4 text-center text-[12px] text-[#999]">
          결과 없음
        </div>
      )}
    </div>
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

        {/* Global Pool Search */}
        <PoolSearchBar />

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
