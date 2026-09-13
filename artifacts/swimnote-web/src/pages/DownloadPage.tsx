// /download — SWIMNOTE 앱 설치 안내
// 별도 영업/도입 문의 없이 앱 설치 후 구독 선택으로 바로 이용 가능

const APPSTORE_URL = "https://apps.apple.com/app/id6761360360";
const GOOGLEPLAY_URL = "https://play.google.com/store/apps/details?id=com.swimnote.app";

function AppleIcon() {
  return (
    <svg viewBox="0 0 24 24" style={{ width: 22, height: 22, fill: "currentColor", flexShrink: 0 }}>
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98l-.09.06c-.22.13-2.2 1.28-2.18 3.81.03 3.02 2.65 4.03 2.68 4.04l-.05.22zM13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" style={{ width: 22, height: 22, fill: "currentColor", flexShrink: 0 }}>
      <path d="M3.18 23.76c.3.17.63.24.97.21l12.38-7.19-2.61-2.61-10.74 9.59zm-1.81-21.1v18.68c0 .53.15 1 .43 1.37L13.45 11.5 1.8 1.29c-.28.37-.43.84-.43 1.37zm20.23 7.91l-2.88-1.67-3.03 3.03 3.03 3.03 2.9-1.68c.83-.48.83-1.23-.02-1.71zM4.15.24l12.38 7.19-2.61 2.61L3.18.45C3.48.28 3.86.07 4.15.24z" />
    </svg>
  );
}

export default function DownloadPage() {
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
        SWIMNOTE
      </p>

      {/* Headline */}
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
        앱을 설치하고<br />바로 시작하세요.
      </h1>

      {/* Description */}
      <p
        style={{
          fontSize: "var(--ds-text-body)",
          color: "var(--ds-text-secondary)",
          lineHeight: 1.7,
          maxWidth: 380,
          marginBottom: 52,
        }}
      >
        SWIMNOTE는 별도의 도입 상담 없이
        앱 설치 후 가입하고 원하는 구독을 선택해
        바로 이용할 수 있습니다.
      </p>

      {/* Store cards */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 20,
          justifyContent: "center",
          maxWidth: 560,
          width: "100%",
        }}
      >
        {/* App Store */}
        <a
          href={APPSTORE_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="App Store에서 SWIMNOTE 다운로드"
          style={{
            flex: "1 1 220px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 20,
            padding: "32px 24px",
            borderRadius: "var(--ds-radius-md)",
            border: "1px solid var(--ds-border-med)",
            background: "var(--ds-n-000)",
            textDecoration: "none",
            color: "inherit",
            transition: "border-color 0.15s, box-shadow 0.15s",
          }}
          onMouseEnter={e => {
            const el = e.currentTarget as HTMLElement;
            el.style.borderColor = "var(--ds-n-400)";
            el.style.boxShadow = "0 2px 12px rgba(0,0,0,0.06)";
          }}
          onMouseLeave={e => {
            const el = e.currentTarget as HTMLElement;
            el.style.borderColor = "var(--ds-border-med)";
            el.style.boxShadow = "none";
          }}
        >
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: 12,
              background: "var(--ds-n-900)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
            }}
          >
            <AppleIcon />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <p
              style={{
                fontSize: 11,
                fontWeight: "var(--ds-fw-medium)",
                color: "var(--ds-n-400)",
                letterSpacing: "0.02em",
                margin: 0,
              }}
            >
              Download on the
            </p>
            <p
              style={{
                fontSize: "var(--ds-text-body)",
                fontWeight: "var(--ds-fw-semibold)",
                color: "var(--ds-n-900)",
                margin: 0,
              }}
              translate="no"
            >
              App Store
            </p>
          </div>
        </a>

        {/* Google Play */}
        <a
          href={GOOGLEPLAY_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Google Play에서 SWIMNOTE 다운로드"
          style={{
            flex: "1 1 220px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 20,
            padding: "32px 24px",
            borderRadius: "var(--ds-radius-md)",
            border: "1px solid var(--ds-border-med)",
            background: "var(--ds-n-000)",
            textDecoration: "none",
            color: "inherit",
            transition: "border-color 0.15s, box-shadow 0.15s",
          }}
          onMouseEnter={e => {
            const el = e.currentTarget as HTMLElement;
            el.style.borderColor = "var(--ds-n-400)";
            el.style.boxShadow = "0 2px 12px rgba(0,0,0,0.06)";
          }}
          onMouseLeave={e => {
            const el = e.currentTarget as HTMLElement;
            el.style.borderColor = "var(--ds-border-med)";
            el.style.boxShadow = "none";
          }}
        >
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: 12,
              background: "#01875f",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
            }}
          >
            <PlayIcon />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <p
              style={{
                fontSize: 11,
                fontWeight: "var(--ds-fw-medium)",
                color: "var(--ds-n-400)",
                letterSpacing: "0.02em",
                margin: 0,
              }}
            >
              Get it on
            </p>
            <p
              style={{
                fontSize: "var(--ds-text-body)",
                fontWeight: "var(--ds-fw-semibold)",
                color: "var(--ds-n-900)",
                margin: 0,
              }}
              translate="no"
            >
              Google Play
            </p>
          </div>
        </a>
      </div>

      {/* Footnote */}
      <p
        style={{
          fontSize: "var(--ds-text-caption)",
          color: "var(--ds-n-300)",
          marginTop: 36,
        }}
      >
        앱 내에서 이용 중인 수영장의 고객센터 문의가 가능합니다.
      </p>
    </section>
  );
}
