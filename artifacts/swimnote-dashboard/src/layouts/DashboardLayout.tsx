import { type ReactNode } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { Sidebar } from "./Sidebar";
import { MobileGuard } from "./MobileGuard";

export function DashboardLayout({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const [, navigate] = useLocation();

  // Loading splash
  if (state.status === "loading") {
    return (
      <div
        style={{
          height: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--surface-off)",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              width: "32px",
              height: "32px",
              border: "3px solid var(--border-default)",
              borderTopColor: "var(--x-primary)",
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
              margin: "0 auto 12px",
            }}
          />
          <div style={{ fontSize: "13px", color: "var(--text-muted)" }}>
            불러오는 중...
          </div>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  // Redirect if not authenticated
  if (state.status === "unauthenticated") {
    navigate("/admin/login");
    return null;
  }

  // Role guard
  if (state.user.role !== "pool_admin") {
    return (
      <div
        style={{
          height: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--surface-off)",
        }}
      >
        <div style={{ textAlign: "center", maxWidth: "320px" }}>
          <div style={{ fontSize: "28px", marginBottom: "12px" }}>🔒</div>
          <div style={{ fontSize: "16px", fontWeight: 700, color: "var(--text-strong)", marginBottom: "8px" }}>
            접근 권한 없음
          </div>
          <div style={{ fontSize: "14px", color: "var(--text-muted)" }}>
            이 페이지는 수영장 관리자만 이용할 수 있습니다.
          </div>
        </div>
      </div>
    );
  }

  return (
    <MobileGuard>
      <div
        style={{
          display: "flex",
          height: "100vh",
          overflow: "hidden",
        }}
      >
        <Sidebar />
        <main
          style={{
            flex: 1,
            minWidth: 0,
            height: "100vh",
            overflowY: "auto",
            background: "var(--surface-off)",
          }}
        >
          {children}
        </main>
      </div>
    </MobileGuard>
  );
}
