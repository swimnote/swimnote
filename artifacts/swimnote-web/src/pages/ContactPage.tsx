// /contact — 도입 문의
// 웹 문의 저장 API 없음 → "준비 중" 상태로 표시.
// 전화번호/이메일 공개 금지.

export default function ContactPage() {
  return (
    <section
      style={{
        minHeight: "calc(100vh - 52px - 80px)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "80px 24px",
        background: "var(--ds-n-000)",
        textAlign: "center",
      }}
    >
      <p
        style={{
          fontSize: "var(--ds-text-label)",
          fontWeight: "var(--ds-fw-semibold)",
          letterSpacing: "var(--ds-ls-wider)",
          textTransform: "uppercase",
          color: "var(--ds-n-400)",
          marginBottom: 20,
        }}
      >
        도입 문의
      </p>

      <h1
        style={{
          fontSize: "clamp(24px, 3.5vw, 36px)",
          fontWeight: "var(--ds-fw-bold)",
          letterSpacing: "-0.025em",
          color: "var(--ds-n-900)",
          marginBottom: 18,
          lineHeight: 1.25,
          maxWidth: 440,
        }}
      >
        웹 도입 문의 채널을
        준비하고 있습니다.
      </h1>

      <p
        style={{
          fontSize: "var(--ds-text-body)",
          color: "var(--ds-text-secondary)",
          lineHeight: 1.7,
          maxWidth: 380,
          marginBottom: 36,
        }}
      >
        현재 앱을 이미 사용 중인 수영장은
        앱 내 문의사항 기능을 이용해주세요.
      </p>

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
        }}
      >
        준비 중
      </div>
    </section>
  );
}
