import { type ReactNode } from "react";

const MOBILE_BREAKPOINT = 900;

export function MobileGuard({ children }: { children: ReactNode }) {
  return (
    <>
      {/* Mobile message */}
      <div
        style={{
          display: "none",
          position: "fixed",
          inset: 0,
          zIndex: 9999,
          background: "var(--surface-off)",
          alignItems: "center",
          justifyContent: "center",
          padding: "32px 24px",
          textAlign: "center",
        }}
        className="mobile-guard-overlay"
      >
        <div>
          <div style={{ fontSize: "32px", marginBottom: "16px" }}>🖥️</div>
          <div
            style={{
              fontSize: "18px",
              fontWeight: 700,
              color: "var(--x-primary)",
              marginBottom: "12px",
            }}
          >
            SWIMNOTE PC 대시보드
          </div>
          <div
            style={{
              fontSize: "14px",
              color: "var(--text-muted)",
              lineHeight: 1.6,
              maxWidth: "320px",
            }}
          >
            PC 또는 태블릿의 넓은 화면에서 이용해주세요.
            <br />
            최소 {MOBILE_BREAKPOINT}px 이상의 화면이 필요합니다.
          </div>
        </div>
      </div>

      {/* Desktop content */}
      <div className="desktop-content">{children}</div>

      <style>{`
        @media (max-width: ${MOBILE_BREAKPOINT - 1}px) {
          .mobile-guard-overlay { display: flex !important; }
          .desktop-content { display: none !important; }
        }
      `}</style>
    </>
  );
}
