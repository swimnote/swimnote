import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, BookOpen, FileText, Database, MessageSquare,
  ScanSearch, Settings, ScrollText, ChevronRight, ChevronDown,
  Menu, X, Activity, Crosshair, ClipboardList, Wrench,
  Globe, FlaskConical, Bot, Network, Video, CheckCircle, Map,
  LogOut
} from "lucide-react";

const BRAND = "#0a2540";

interface NavItem {
  id: string;
  label: string;
  labelEn?: string;
  icon: React.ReactNode;
  path?: string;
  badge?: string;
  children?: NavItem[];
}

const NAV_ITEMS: NavItem[] = [
  { id: "dashboard", label: "대시보드", labelEn: "Dashboard", icon: <LayoutDashboard size={16} />, path: "/ai-admin/dashboard" },
  { id: "knowledge-factory", label: "지식 팩토리", labelEn: "Knowledge Factory", icon: <BookOpen size={16} />, path: "/ai-admin/knowledge-factory", badge: "LIVE" },
  { id: "documents", label: "문서", labelEn: "Documents", icon: <FileText size={16} />, path: "/ai-admin/documents", badge: "LIVE" },
  { id: "knowledge-db", label: "지식 DB", labelEn: "Knowledge DB", icon: <Database size={16} />, path: "/ai-admin/knowledge-db", badge: "LIVE" },
  { id: "ai-question-test", label: "AI 질문 테스트", labelEn: "AI Question Test", icon: <MessageSquare size={16} />, path: "/ai-admin/ai-question-test", badge: "LIVE" },
  {
    id: "misconception",
    label: "오개념 헌터",
    labelEn: "Misconception Hunter",
    icon: <ScanSearch size={16} />,
    badge: "NEW",
    children: [
      { id: "mc-overview", label: "개요", labelEn: "Overview", icon: <Activity size={14} />, path: "/ai-admin/misconception/overview" },
      { id: "mc-claim-inbox", label: "주장 수집함", labelEn: "Claim Inbox", icon: <ClipboardList size={14} />, path: "/ai-admin/misconception/claim-inbox" },
      { id: "mc-workbench", label: "검증 워크벤치", labelEn: "Verification Workbench", icon: <Wrench size={14} />, path: "/ai-admin/misconception/verification-workbench" },
      { id: "mc-sources", label: "출처 인텔리전스", labelEn: "Source Intelligence", icon: <Globe size={14} />, path: "/ai-admin/misconception/source-intelligence" },
      { id: "mc-dta", label: "DTA 검증실", labelEn: "DTA Lab", icon: <FlaskConical size={14} />, path: "/ai-admin/misconception/dta-lab" },
      { id: "mc-automation", label: "자동사냥 설정", labelEn: "Hunter Automation", icon: <Bot size={14} />, path: "/ai-admin/misconception/hunter-automation" },
      { id: "mc-diagnostic", label: "오류·원인 연결", labelEn: "Diagnostic Mapping", icon: <Network size={14} />, path: "/ai-admin/misconception/diagnostic-mapping" },
      { id: "mc-video", label: "영상분석 연결", labelEn: "Video Analysis Bridge", icon: <Video size={14} />, path: "/ai-admin/misconception/video-analysis-bridge" },
      { id: "mc-approved", label: "검증 완료 판정", labelEn: "Approved Decisions", icon: <CheckCircle size={14} />, path: "/ai-admin/misconception/approved-decisions" },
      { id: "mc-blueprint", label: "시스템 설계도", labelEn: "System Blueprint", icon: <Map size={14} />, path: "/ai-admin/misconception/system-blueprint" },
    ],
  },
  { id: "system-logs", label: "시스템 로그", labelEn: "System Logs", icon: <ScrollText size={16} />, path: "/ai-admin/system-logs" },
  { id: "settings", label: "설정", labelEn: "Settings", icon: <Settings size={16} />, path: "/ai-admin/settings" },
];

const BADGE_STYLE: Record<string, string> = {
  LIVE: "bg-emerald-100 text-emerald-700",
  NEW: "bg-blue-100 text-blue-700",
  PLANNED: "bg-amber-100 text-amber-700",
  PROTOTYPE: "bg-purple-100 text-purple-700",
  LOCKED: "bg-gray-100 text-gray-500",
};

function NavBadge({ badge }: { badge: string }) {
  return (
    <span className={`ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded ${BADGE_STYLE[badge] ?? "bg-gray-100 text-gray-500"}`}>
      {badge}
    </span>
  );
}

function SidebarItem({ item, depth = 0, onNavigate }: { item: NavItem; depth?: number; onNavigate?: () => void }) {
  const [location] = useLocation();
  const [expanded, setExpanded] = useState(() => {
    if (item.children) {
      return item.children.some(c => location.startsWith(c.path ?? ""));
    }
    return false;
  });

  const isActive = item.path ? location === item.path || (item.path !== "/ai-admin" && location.startsWith(item.path)) : false;
  const hasChildren = !!item.children?.length;

  if (hasChildren) {
    const isChildActive = item.children!.some(c => c.path && location.startsWith(c.path));
    return (
      <div>
        <button
          onClick={() => setExpanded(e => !e)}
          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all
            ${isChildActive ? "bg-blue-50 text-[#0a2540]" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"}`}
          style={{ paddingLeft: `${12 + depth * 12}px` }}
        >
          <span className={isChildActive ? "text-blue-600" : "text-slate-400"}>{item.icon}</span>
          <span className="flex-1 text-left">{item.label}</span>
          {item.badge && <NavBadge badge={item.badge} />}
          <span className="text-slate-400">
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
        </button>
        {expanded && (
          <div className="mt-0.5 ml-3 border-l border-slate-100 pl-2">
            {item.children!.map(child => (
              <SidebarItem key={child.id} item={child} depth={depth + 1} onNavigate={onNavigate} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <Link
      href={item.path!}
      onClick={onNavigate}
      className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer
        ${isActive ? "bg-[#0a2540] text-white" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"}`}
      style={{ paddingLeft: `${12 + depth * 12}px` }}
    >
      <span className={isActive ? "text-white" : "text-slate-400"}>{item.icon}</span>
      <span className="flex-1">{item.label}</span>
      {item.badge && !isActive && <NavBadge badge={item.badge} />}
    </Link>
  );
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-[#f8fafc]">
      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-slate-200 flex flex-col
        transform transition-transform duration-200
        ${mobileOpen ? "translate-x-0" : "-translate-x-full"}
        lg:relative lg:translate-x-0 lg:flex
      `}>
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 h-14 border-b border-slate-100 shrink-0">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: BRAND }}
          >
            <Crosshair size={16} className="text-white" />
          </div>
          <div>
            <div className="text-[13px] font-bold text-[#0a2540]" translate="no">SWIMNOTE AI</div>
            <div className="text-[10px] text-slate-400">관리자 시스템</div>
          </div>
          <button
            onClick={() => setMobileOpen(false)}
            className="ml-auto lg:hidden text-slate-400 hover:text-slate-600"
          >
            <X size={18} />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
          {NAV_ITEMS.map(item => (
            <SidebarItem key={item.id} item={item} onNavigate={() => setMobileOpen(false)} />
          ))}
        </nav>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-slate-100 shrink-0">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <div className="w-6 h-6 rounded-full bg-slate-200 flex items-center justify-center text-slate-600 font-bold text-[10px]">A</div>
            <span>Admin</span>
            <button className="ml-auto hover:text-red-500 transition-colors">
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/30 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Topbar */}
        <header className="h-14 bg-white border-b border-slate-200 flex items-center px-4 gap-3 shrink-0">
          <button
            onClick={() => setMobileOpen(true)}
            className="lg:hidden text-slate-500 hover:text-slate-700"
          >
            <Menu size={20} />
          </button>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span className="font-mono text-[10px] bg-slate-100 px-2 py-0.5 rounded">PROTOTYPE MODE</span>
            <span>수집 및 검증 구조가 준비되었습니다. 자동 크롤링과 DTA 자동판정은 단계적으로 연결됩니다.</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[10px] text-slate-400">v0.1-prototype</span>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
