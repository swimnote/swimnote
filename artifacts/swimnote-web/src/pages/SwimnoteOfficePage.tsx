// WP6 — SWIMNOTE OFFICE Coming Soon
// 현재 미출시. 기능 개발 없음. 출시 예정 고지만 표시.

export default function SwimnoteOfficePage() {
  return (
    <section
      style={{
        minHeight: "calc(100vh - 52px - 80px)", // below header, above footer
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "80px 24px",
        background: "var(--ds-n-000)",
        textAlign: "center",
      }}
    >
      {/* Tag */}
      <p
        style={{
          fontSize: "var(--ds-text-label)",
          fontWeight: "var(--ds-fw-semibold)",
          letterSpacing: "var(--ds-ls-wider)",
          textTransform: "uppercase",
          color: "var(--ds-n-400)",
          marginBottom: 20,
        }}
        translate="no"
      >
        SWIMNOTE OFFICE
      </p>

      {/* Headline */}
      <h1
        style={{
          fontSize: "clamp(28px, 4vw, 42px)",
          fontWeight: "var(--ds-fw-bold)",
          letterSpacing: "-0.03em",
          color: "var(--ds-n-900)",
          marginBottom: 18,
          lineHeight: 1.18,
          maxWidth: 520,
        }}
      >
        수영장 운영을<br />
        더 넓은 화면에서.
      </h1>

      {/* Description */}
      <p
        style={{
          fontSize: "var(--ds-text-body)",
          color: "var(--ds-text-secondary)",
          lineHeight: 1.7,
          maxWidth: 400,
          marginBottom: 36,
        }}
      >
        회원과 운영 업무를 위한
        PC 기반 관리 환경을 준비하고 있습니다.
      </p>

      {/* Coming Soon badge */}
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          height: 36,
          padding: "0 18px",
          borderRadius: "var(--ds-radius-pill)",
          border: "1px solid var(--ds-border-strong)",
          fontSize: "var(--ds-text-body-sm)",
          fontWeight: "var(--ds-fw-medium)",
          color: "var(--ds-n-500)",
          background: "var(--ds-n-050)",
          letterSpacing: "0.01em",
        }}
      >
        출시 예정
      </div>

      {/* Note: distinguish from existing PC Dashboard */}
      <p
        style={{
          marginTop: 40,
          fontSize: 12,
          color: "var(--ds-n-300)",
          maxWidth: 360,
          lineHeight: 1.6,
        }}
      >
        현재 PC 대시보드(관리자 운영 화면)와는 별개로
        준비 중인 확장 서비스입니다.
      </p>
    </section>
  );
}
