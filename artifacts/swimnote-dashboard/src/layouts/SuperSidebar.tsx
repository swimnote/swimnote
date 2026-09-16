import { useState } from "react";
import { useLocation } from "wouter";
import {
  LayoutDashboard, Building2, CreditCard, Users, HeadphonesIcon,
  Brain, Server, AlertTriangle, Settings, LogOut, ChevronDown, ChevronRight,
  LayoutGrid,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

type NavItem =
  | { kind: "link"; label: string; icon: React.ReactNode; path: string }
  | { kind: "group"; label: string; icon: React.ReactNode; children: { label: string; path: string }[] };

const NAV_ITEMS: NavItem[] = [
  { kind: "link", label: "개요", icon: <LayoutDashboard size={16} />, path: "/super" },
  {
    kind: "group",
    label: "수영장",
    icon: <Building2 size={16} />,
    children: [
      { label: "전체 수영장", path: "/super/pools" },
      { label: "운영자 관리", path: "/super/operators" },
    ],
  },
  { kind: "link", label: "결제·매출", icon: <CreditCard size={16} />, path: "/super/billing" },
  { kind: "link", label: "전체 회원", icon: <Users size={16} />, path: "/super/members" },
  { kind: "link", label: "고객지원", icon: <HeadphonesIcon size={16} />, path: "/super/support" },
  {
    kind: "group",
    label: "AI · 지식",
    icon: <Brain size={16} />,
    children: [
      { label: "AI 현황", path: "/super/ai" },
      { label: "지식 관리", path: "/super/ai/knowledge" },
    ],
  },
  {
    kind: "group",
    label: "서버 · 장애",
    icon: <Server size={16} />,
    children: [
      { label: "서버 상태", path: "/super/servers" },
      { label: "장애 관리", path: "/super/incidents" },
    ],
  },
  {
    kind: "group",
    label: "콘텐츠",
    icon: <LayoutGrid size={16} />,
    children: [
      { label: "카드 배너 관리", path: "/super/ads" },
    ],
  },
  { kind: "link", label: "감사 로그", icon: <AlertTriangle size={16} />, path: "/super/audit" },
];

export function SuperSidebar() {
  const { state, logout } = useAuth();
  const [location, navigate] = useLocation();

  const initialOpen: Record<string, boolean> = {};
  NAV_ITEMS.forEach((item) => {
    if (item.kind === "group") {
      if (item.children.some((c) => location.startsWith(c.path))) {
        initialOpen[item.label] = true;
      }
    }
  });
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(initialOpen);

  const adminName =
    state.status === "authenticated" ? (state.user.name ?? "슈퍼관리자") : "";

  function toggleGroup(label: string) {
    setOpenGroups((prev) => ({ ...prev, [label]: !prev[label] }));
  }

  function goTo(path: string) { navigate(path); }

  function handleLogout() {
    logout();
    navigate("/admin/super");
  }

  const isActive = (path: string) => {
    if (path === "/super") return location === "/super" || location === "/super/";
    return location.startsWith(path);
  };

  return (
    <aside
      style={{
        width: "240px",
        minWidth: "240px",
        height: "100vh",
        background: "var(--surface-white)",
        borderRight: "1px solid var(--border-default)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Logo */}
      <div style={{ padding: "20px 16px 16px", borderBottom: "1px solid var(--border-default)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
          <span style={{ fontSize: "15px", fontWeight: 800, color: "var(--x-primary)", letterSpacing: "-0.3px" }}>
            SWIMNOTE
          </span>
          <span style={{ fontSize: "10px", fontWeight: 700, color: "#fff", background: "#1E293B", borderRadius: "3px", padding: "1px 5px" }}>
            SUPER
          </span>
        </div>
        <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-strong)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {adminName}
        </div>
      </div>

      {/* Navigation */}
      <nav style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
        {NAV_ITEMS.map((item) => {
          if (item.kind === "link") {
            const active = isActive(item.path);
            return (
              <NavLinkItem key={item.path} icon={item.icon} label={item.label} active={active} onClick={() => goTo(item.path)} />
            );
          }

          const groupActive = item.children.some((c) => isActive(c.path));
          const open = !!openGroups[item.label];

          return (
            <div key={item.label}>
              <button
                onClick={() => toggleGroup(item.label)}
                style={{
                  display: "flex", alignItems: "center", width: "100%",
                  padding: "8px 16px", gap: "8px", background: "none", border: "none",
                  cursor: "pointer", fontSize: "13px",
                  fontWeight: groupActive ? 600 : 500,
                  color: groupActive ? "var(--x-primary)" : "var(--text-body)",
                  textAlign: "left", transition: "background 0.1s", borderRadius: "4px", margin: "0 4px",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--surface-subtle)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "none"; }}
              >
                <span style={{ color: groupActive ? "var(--x-primary)" : "var(--text-muted)", flexShrink: 0 }}>{item.icon}</span>
                <span style={{ flex: 1 }}>{item.label}</span>
                <span style={{ color: "var(--text-faint)" }}>{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
              </button>
              {open && (
                <div style={{ marginBottom: "2px" }}>
                  {item.children.map((child) => {
                    const childActive = isActive(child.path);
                    return (
                      <button
                        key={child.path}
                        onClick={() => goTo(child.path)}
                        style={{
                          display: "block", width: "100%", padding: "7px 16px 7px 40px",
                          background: childActive ? "var(--x-accent-soft, #E8F2FC)" : "none",
                          border: "none", cursor: "pointer", fontSize: "13px",
                          fontWeight: childActive ? 600 : 400,
                          color: childActive ? "var(--x-primary)" : "var(--text-muted)",
                          textAlign: "left", transition: "background 0.1s, color 0.1s",
                          borderRadius: "4px", margin: "1px 4px",
                        }}
                        onMouseEnter={(e) => { if (!childActive) (e.currentTarget as HTMLElement).style.background = "var(--surface-subtle)"; }}
                        onMouseLeave={(e) => { if (!childActive) (e.currentTarget as HTMLElement).style.background = "none"; }}
                      >
                        {child.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        <div style={{ height: "1px", background: "var(--border-default)", margin: "8px 16px" }} />
        <NavLinkItem icon={<Settings size={16} />} label="설정" active={isActive("/super/settings")} onClick={() => goTo("/super/settings")} />
      </nav>

      {/* Logout */}
      <div style={{ borderTop: "1px solid var(--border-default)", flexShrink: 0 }}>
        <button
          onClick={handleLogout}
          style={{
            display: "flex", alignItems: "center", width: "100%", padding: "14px 16px",
            gap: "8px", background: "none", border: "none", cursor: "pointer",
            fontSize: "13px", color: "var(--text-muted)", transition: "background 0.1s",
          }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "var(--surface-subtle)")}
          onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "none")}
        >
          <LogOut size={15} />
          로그아웃
        </button>
      </div>
    </aside>
  );
}

function NavLinkItem({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", width: "100%", padding: "8px 16px",
        gap: "8px", background: active ? "var(--x-accent-soft, #E8F2FC)" : "none",
        border: "none", cursor: "pointer", fontSize: "13px",
        fontWeight: active ? 600 : 500,
        color: active ? "var(--x-primary)" : "var(--text-body)",
        textAlign: "left", transition: "background 0.1s", borderRadius: "4px", margin: "1px 4px",
      }}
      onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = "var(--surface-subtle)"; }}
      onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = "none"; }}
    >
      <span style={{ color: active ? "var(--x-primary)" : "var(--text-muted)", flexShrink: 0 }}>{icon}</span>
      {label}
    </button>
  );
}
