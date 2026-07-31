import { LogOut, Menu, X, Bell, Search } from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import AdminSidebar from "./AdminSidebar";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[#F5F6FA] flex flex-col">
      {/* ── 헤더 ── */}
      <header className="fixed top-0 left-0 right-0 z-40 h-14 bg-white/80 backdrop-blur-md border-b border-[#EBEBEB] flex items-center px-4 gap-3">
        <button
          className="lg:hidden p-1.5 rounded-lg hover:bg-[#F5F5F5] transition-colors"
          onClick={() => setMobileOpen(true)}
        >
          <Menu size={20} color="#555" />
        </button>

        {/* 로고 영역 (모바일) */}
        <div className="flex items-center gap-2 lg:hidden">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-[11px] font-black" style={{ background: "#002F5F" }}>
            S
          </div>
          <span className="font-bold text-[14px] text-[#0A0A0A]" translate="no">SWIMNOTE</span>
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-2">
          <div className="hidden sm:flex items-center gap-2 mr-2">
            <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl bg-[#F5F5F5]">
              <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0" style={{ background: "#0369A1" }}>
                {user?.name?.[0] || "A"}
              </div>
              <span className="text-[12px] font-semibold text-[#333]">{user?.name}</span>
            </div>
          </div>
          <button
            onClick={logout}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#E5E5E5] text-[12px] text-[#666] hover:bg-[#FEF2F2] hover:text-red-500 hover:border-red-200 transition-all"
          >
            <LogOut size={13} />
            <span className="hidden sm:inline">로그아웃</span>
          </button>
        </div>
      </header>

      {/* ── 모바일 사이드바 ── */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <div className="absolute left-0 top-0 bottom-0 w-[260px] bg-white shadow-2xl">
            <div className="flex items-center justify-between px-4 h-14 border-b border-[#EBEBEB]">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-md flex items-center justify-center text-white text-[10px] font-black" style={{ background: "#002F5F" }}>S</div>
                <span className="font-bold text-[13px]" translate="no">SWIMNOTE</span>
              </div>
              <button onClick={() => setMobileOpen(false)} className="p-1.5 rounded-lg hover:bg-[#F5F5F5]">
                <X size={18} color="#555" />
              </button>
            </div>
            <div onClick={() => setMobileOpen(false)} className="h-[calc(100%-56px)]">
              <AdminSidebar />
            </div>
          </div>
        </div>
      )}

      <div className="flex pt-14 flex-1">
        {/* ── 데스크탑 사이드바 ── */}
        <aside className="hidden lg:flex flex-col fixed left-0 top-14 bottom-0 w-[240px] bg-white border-r border-[#EBEBEB] z-30 shadow-sm">
          <AdminSidebar />
        </aside>

        {/* ── 컨텐츠 ── */}
        <main className="flex-1 lg:ml-[240px] min-h-[calc(100vh-56px)]">
          {children}
        </main>
      </div>
    </div>
  );
}
