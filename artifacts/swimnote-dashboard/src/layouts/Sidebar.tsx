import { useState } from "react";
import { useLocation } from "wouter";
import swimnoteXLogo from "@/assets/swimnote-x-logo.png";
import {
  Home, Users, Calendar, RotateCcw, TrendingUp,
  BookOpen, FileText, GraduationCap, DollarSign,
  Settings, LogOut, ChevronDown, ChevronRight,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

type NavItem =
  | { kind: "link"; label: string; icon: React.ReactNode; path: string }
  | {
      kind: "group";
      label: string;
      icon: React.ReactNode;
      children: { label: string; path: string }[];
    };

const NAV_ITEMS: NavItem[] = [
  { kind: "link", label: "홈", icon: <Home size={16} />, path: "/admin" },
  {
    kind: "group",
    label: "회원",
    icon: <Users size={16} />,
    children: [
      { label: "전체 회원", path: "/admin/members" },
      { label: "회원 등록", path: "/admin/members/new" },
      { label: "지난 회원", path: "/admin/members/withdrawn" },
      { label: "Archive (퇴원 기록)", path: "/admin/members/archive" },
      { label: "엑셀 일괄등록", path: "/admin/members/bulk" },
    ],
  },
  {
    kind: "group",
    label: "반 · 스케줄",
    icon: <Calendar size={16} />,
    children: [
      { label: "전체 스케줄", path: "/admin/schedule" },
      { label: "반 관리", path: "/admin/schedule/classes" },
    ],
  },
  {
    kind: "group",
    label: "보강",
    icon: <RotateCcw size={16} />,
    children: [
      { label: "보강 현황", path: "/admin/makeups" },
      { label: "보강 배정", path: "/admin/makeups/assign" },
    ],
  },
  {
    kind: "group",
    label: "성장리포트",
    icon: <TrendingUp size={16} />,
    children: [
      { label: "검수 대기", path: "/admin/growth-reports/pending" },
      { label: "발행 관리", path: "/admin/growth-reports/publish" },
      { label: "발행 완료", path: "/admin/growth-reports/published" },
    ],
  },
  {
    kind: "group",
    label: "커리큘럼",
    icon: <BookOpen size={16} />,
    children: [
      { label: "커리큘럼 관리", path: "/admin/curriculum" },
      { label: "커리큘럼 등록", path: "/admin/curriculum/new" },
      { label: "레벨 / 교육과정", path: "/admin/curriculum/levels" },
      { label: "일지 템플릿", path: "/admin/curriculum/templates" },
    ],
  },
  {
    kind: "link",
    label: "일지 · 피드",
    icon: <FileText size={16} />,
    path: "/admin/diary",
  },
  {
    kind: "link",
    label: "선생님",
    icon: <GraduationCap size={16} />,
    path: "/admin/teachers",
  },
  {
    kind: "link",
    label: "매출 · 정산",
    icon: <DollarSign size={16} />,
    path: "/admin/revenue",
  },
];

export function Sidebar() {
  const { state, logout } = useAuth();
  const [location, navigate] = useLocation();

  const poolName =
    state.status === "authenticated" ? (state.user.poolName ?? "내 수영장") : "";

  // Track which groups are open — default open the active group
  const initialOpen: Record<string, boolean> = {};
  NAV_ITEMS.forEach((item) => {
    if (item.kind === "group") {
      if (item.children.some((c) => location.startsWith(c.path))) {
        initialOpen[item.label] = true;
      }
    }
  });
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(initialOpen);

  function toggleGroup(label: string) {
    setOpenGroups((prev) => ({ ...prev, [label]: !prev[label] }));
  }

  function goTo(path: string) {
    navigate(path);
  }

  function handleLogout() {
    logout();
    navigate("/admin/login");
  }

  const isActive = (path: string) => {
    if (path === "/admin") return location === "/admin" || location === "/admin/";
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
      {/* Logo + Pool name */}
      <div
        style={{
          padding: "20px 16px 16px",
          borderBottom: "1px solid var(--border-default)",
          flexShrink: 0,
        }}
      >
        <div style={{ marginBottom: "6px" }}>
          <img
            src={swimnoteXLogo}
            alt="SwimNote X"
            style={{
              height: "28px",
              width: "auto",
              maxWidth: "180px",
              objectFit: "contain",
              display: "block",
            }}
          />
        </div>
        <div
          style={{
            fontSize: "13px",
            fontWeight: 600,
            color: "var(--text-strong)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
          title={poolName}
        >
          {poolName}
        </div>
      </div>

      {/* Navigation */}
      <nav
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "8px 0",
        }}
      >
        {NAV_ITEMS.map((item) => {
          if (item.kind === "link") {
            const active = isActive(item.path);
            return (
              <NavLinkItem
                key={item.path}
                icon={item.icon}
                label={item.label}
                active={active}
                onClick={() => goTo(item.path)}
              />
            );
          }

          const groupActive = item.children.some((c) => isActive(c.path));
          const open = !!openGroups[item.label];

          return (
            <div key={item.label}>
              <button
                onClick={() => toggleGroup(item.label)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  width: "100%",
                  padding: "8px 16px",
                  gap: "8px",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  fontSize: "13px",
                  fontWeight: groupActive ? 600 : 500,
                  color: groupActive ? "var(--x-primary)" : "var(--text-body)",
                  textAlign: "left",
                  transition: "background 0.1s",
                  borderRadius: "4px",
                  margin: "0 4px",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.background =
                    "var(--surface-subtle)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.background = "none";
                }}
              >
                <span style={{ color: groupActive ? "var(--x-primary)" : "var(--text-muted)", flexShrink: 0 }}>
                  {item.icon}
                </span>
                <span style={{ flex: 1 }}>{item.label}</span>
                <span style={{ color: "var(--text-faint)" }}>
                  {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </span>
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
                          display: "block",
                          width: "100%",
                          padding: "7px 16px 7px 40px",
                          background: childActive ? "var(--x-accent-soft, #E8F2FC)" : "none",
                          border: "none",
                          cursor: "pointer",
                          fontSize: "13px",
                          fontWeight: childActive ? 600 : 400,
                          color: childActive ? "var(--x-primary)" : "var(--text-muted)",
                          textAlign: "left",
                          transition: "background 0.1s, color 0.1s",
                          borderRadius: "4px",
                          margin: "1px 4px",
                        }}
                        onMouseEnter={(e) => {
                          if (!childActive)
                            (e.currentTarget as HTMLElement).style.background =
                              "var(--surface-subtle)";
                        }}
                        onMouseLeave={(e) => {
                          if (!childActive)
                            (e.currentTarget as HTMLElement).style.background = "none";
                        }}
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

        {/* Divider */}
        <div
          style={{
            height: "1px",
            background: "var(--border-default)",
            margin: "8px 16px",
          }}
        />

        <NavLinkItem
          icon={<Settings size={16} />}
          label="설정"
          active={isActive("/admin/settings")}
          onClick={() => goTo("/admin/settings")}
        />
      </nav>

      {/* Logout */}
      <div style={{ borderTop: "1px solid var(--border-default)", flexShrink: 0 }}>
        <button
          onClick={handleLogout}
          style={{
            display: "flex",
            alignItems: "center",
            width: "100%",
            padding: "14px 16px",
            gap: "8px",
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: "13px",
            color: "var(--text-muted)",
            transition: "background 0.1s",
          }}
          onMouseEnter={(e) =>
            ((e.currentTarget as HTMLElement).style.background =
              "var(--surface-subtle)")
          }
          onMouseLeave={(e) =>
            ((e.currentTarget as HTMLElement).style.background = "none")
          }
        >
          <LogOut size={15} />
          로그아웃
        </button>
      </div>
    </aside>
  );
}

function NavLinkItem({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        width: "100%",
        padding: "8px 16px",
        gap: "8px",
        background: active ? "var(--x-accent-soft, #E8F2FC)" : "none",
        border: "none",
        cursor: "pointer",
        fontSize: "13px",
        fontWeight: active ? 600 : 500,
        color: active ? "var(--x-primary)" : "var(--text-body)",
        textAlign: "left",
        transition: "background 0.1s",
        borderRadius: "4px",
        margin: "1px 4px",
      }}
      onMouseEnter={(e) => {
        if (!active)
          (e.currentTarget as HTMLElement).style.background = "var(--surface-subtle)";
      }}
      onMouseLeave={(e) => {
        if (!active) (e.currentTarget as HTMLElement).style.background = "none";
      }}
    >
      <span style={{ color: active ? "var(--x-primary)" : "var(--text-muted)", flexShrink: 0 }}>
        {icon}
      </span>
      {label}
    </button>
  );
}
