// /download — SWIMNOTE 앱 설치 안내
// QR asset: app-store-qr.png / google-play-qr.png (공식 제공)

const BASE = import.meta.env.BASE_URL;

const APPSTORE_URL    = "https://apps.apple.com/app/id6761360360";
const GOOGLEPLAY_URL  = "https://play.google.com/store/apps/details?id=com.swimnote.app";

const STORES = [
  {
    key:    "appstore",
    qr:     `${BASE}app-store-qr.png`,
    qrAlt:  "App Store QR 코드",
    label:  "App Store",
    sub:    "Download on the",
    href:   APPSTORE_URL,
  },
  {
    key:    "googleplay",
    qr:     `${BASE}google-play-qr.png`,
    qrAlt:  "Google Play QR 코드",
    label:  "Google Play",
    sub:    "Get it on",
    href:   GOOGLEPLAY_URL,
  },
] as const;

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
          gap: 24,
          justifyContent: "center",
          maxWidth: 560,
          width: "100%",
        }}
      >
        {STORES.map(({ key, qr, qrAlt, label, sub, href }) => (
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${label}에서 SWIMNOTE 다운로드`}
            style={{
              flex: "1 1 200px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 16,
              padding: "28px 20px 24px",
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
            {/* QR image — quiet zone 포함, 왜곡/crop 없음 */}
            <img
              src={qr}
              alt={qrAlt}
              style={{
                width: 160,
                height: 160,
                objectFit: "contain",
                display: "block",
                imageRendering: "pixelated",
              }}
              draggable={false}
            />

            {/* Store label */}
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <p
                style={{
                  fontSize: 11,
                  fontWeight: "var(--ds-fw-medium)",
                  color: "var(--ds-n-400)",
                  letterSpacing: "0.02em",
                  margin: 0,
                }}
              >
                {sub}
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
                {label}
              </p>
            </div>
          </a>
        ))}
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
