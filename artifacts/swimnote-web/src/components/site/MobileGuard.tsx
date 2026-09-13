import { Link } from "wouter";
import { isMobileOrTabletDevice } from "@/lib/useIsMobileDevice";

const BASE = import.meta.env.BASE_URL;

/**
 * MobileGuard
 *
 * Renders children on desktop/laptop.
 * Renders a "PC only" notice on mobile/tablet — no form or admin UI shown.
 * Applied to /login and /admin/* routes.
 */
export default function MobileGuard({ children }: { children: React.ReactNode }) {
  if (!isMobileOrTabletDevice()) return <>{children}</>;

  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 24px",
        background: "var(--ds-n-000)",
        textAlign: "center",
      }}
    >
      {/* Logo */}
      <img
        src={`${BASE}icon.png`}
        alt="SWIMNOTE"
        style={{
          width: 52,
          height: 52,
          borderRadius: 12,
          objectFit: "contain",
          marginBottom: 20,
        }}
      />

      <p
        style={{
          fontSize: "var(--ds-text-label)",
          fontWeight: "var(--ds-fw-semibold)",
          letterSpacing: "var(--ds-ls-wider)",
          textTransform: "uppercase",
          color: "var(--ds-n-400)",
          marginBottom: 16,
        }}
        translate="no"
      >
        SWIMNOTE
      </p>

      <h1
        style={{
          fontSize: "clamp(20px, 5vw, 26px)",
          fontWeight: "var(--ds-fw-bold)",
          letterSpacing: "-0.02em",
          color: "var(--ds-n-900)",
          marginBottom: 14,
          lineHeight: 1.3,
        }}
      >
        PC 대시보드는<br />
        데스크톱에서 이용할 수 있습니다.
      </h1>

      <p
        style={{
          fontSize: "var(--ds-text-body-sm)",
          color: "var(--ds-text-secondary)",
          lineHeight: 1.7,
          maxWidth: 300,
          marginBottom: 36,
        }}
      >
        원활한 관리 기능 이용을 위해
        PC에서 접속해주세요.
      </p>

      <Link
        href="/"
        style={{
          display: "inline-flex",
          alignItems: "center",
          height: 40,
          padding: "0 20px",
          borderRadius: "var(--ds-radius-pill)",
          background: "var(--ds-n-900)",
          color: "var(--ds-n-000)",
          fontSize: "var(--ds-text-body-sm)",
          fontWeight: "var(--ds-fw-medium)",
          textDecoration: "none",
        }}
      >
        홈으로
      </Link>
    </div>
  );
}
