import { LogOut, Menu, X } from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import AdminSidebar from "./AdminSidebar";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[#F5F6FA] flex flex-col">
      {/* ── 상단 헤더 ── */}
      <header className="fixed top-0 left-0 right-0 z-40 h-14 bg-white border-b border-[#EBEBEB] flex items-center px-4 gap-4">
        <button
          className="lg:hidden p-1.5 rounded-lg hover:bg-[#F5F5F5]"
          onClick={() => setMobileOpen(true)}
        >
          <Menu size={20} color="#555" />
        </button>
        <div className="flex items-center gap-2.5 w-[220px]">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-[11px] font-black tracking-tighter"
            style={{ background: "#002F5F" }}
          >
            S
          </div>
          <span className="font-bold text-[15px] text-[#0A0A0A] tracking-tight" translate="no">SWIMNOTE</span>
        </div>
        <div className="hidden lg:block w-px h-5 bg-[#E5E5E5]" />
        <div className="flex-1 hidden lg:block">
          <span className="text-[13px] font-semibold text-[#333]">관리자 대시보드</span>
        </div>
        <div className="flex items-center gap-3 ml-auto">
          <div className="text-right hidden sm:block">
            <p className="text-[12px] font-semibold text-[#0A0A0A]">{user?.name}</p>
            <p className="text-[11px] text-[#999]">{user?.email}</p>
          </div>
          <button
            onClick={logout}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#E5E5E5] text-[12px] text-[#666] hover:bg-[#FEF2F2] hover:text-red-600 hover:border-red-200 transition-colors"
          >
            <LogOut size={13} />
            <span className="hidden sm:inline">로그아웃</span>
          </button>
        </div>
      </header>

      {/* ── 모바일 사이드바 오버레이 ── */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <div className="absolute left-0 top-0 bottom-0 w-64 bg-white shadow-xl">
            <div className="flex items-center justify-between px-4 h-14 border-b border-[#EBEBEB]">
              <span className="font-bold text-[14px]" translate="no">SWIMNOTE</span>
              <button onClick={() => setMobileOpen(false)}>
                <X size={20} color="#555" />
              </button>
            </div>
            <div onClick={() => setMobileOpen(false)}>
              <AdminSidebar />
            </div>
          </div>
        </div>
      )}

      <div className="flex pt-14 flex-1">
        {/* ── 데스크탑 사이드바 ── */}
        <aside className="hidden lg:flex flex-col fixed left-0 top-14 bottom-0 w-[240px] bg-white border-r border-[#EBEBEB] z-30">
          <AdminSidebar />
        </aside>

        {/* ── 메인 컨텐츠 ── */}
        <main className="flex-1 lg:ml-[240px] min-h-[calc(100vh-56px)]">
          {children}
        </main>
      </div>
    </div>
  );
}
