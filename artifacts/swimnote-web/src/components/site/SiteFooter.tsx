import { Link } from "wouter";

const FOOTER_LINKS = [
  { label: "고객센터",         href: "/support"  },
  { label: "앱 설치",          href: "/download" },
  { label: "이용약관",         href: "/terms"   },
  { label: "개인정보처리방침", href: "/privacy"  },
];

export default function SiteFooter() {
  return (
    <footer
      style={{
        borderTop: "1px solid var(--ds-border-med)",
        background: "var(--ds-n-000)",
        padding: "40px 24px 32px",
      }}
      role="contentinfo"
    >
      <div style={{ maxWidth: "var(--ds-content-max)", margin: "0 auto" }}>
        {/* Top row: logo + links */}
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            flexWrap: "wrap",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: "20px 32px",
          }}
        >
          {/* Brand */}
          <Link
            href="/"
            aria-label="SWIMNOTE 홈"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              textDecoration: "none",
              flexShrink: 0,
            }}
          >
            <img
              src={`${import.meta.env.BASE_URL}icon.png`}
              alt=""
              aria-hidden="true"
              style={{ width: 20, height: 20, objectFit: "contain", borderRadius: 5 }}
            />
            <span
              style={{
                fontSize: 14,
                fontWeight: "var(--ds-fw-semibold)",
                letterSpacing: "-0.01em",
                color: "var(--ds-n-900)",
              }}
              translate="no"
            >
              SWIMNOTE
            </span>
          </Link>

          {/* Links */}
          <nav
            aria-label="Footer 링크"
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "10px 28px",
            }}
          >
            {FOOTER_LINKS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  fontSize: "var(--ds-text-caption)",
                  color: "var(--ds-n-400)",
                  textDecoration: "none",
                  transition: "var(--ds-transition-color)",
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "var(--ds-n-700)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "var(--ds-n-400)"; }}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        {/* Bottom row: copyright */}
        <div
          style={{
            marginTop: 28,
            paddingTop: 20,
            borderTop: "1px solid var(--ds-n-050)",
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "8px 24px",
          }}
        >
          <p
            style={{
              fontSize: 11,
              color: "var(--ds-n-300)",
              margin: 0,
            }}
          >
            &copy; {new Date().getFullYear()} SWIMNOTE. All rights reserved.
          </p>
          <a
            href="https://swimnote-web.onrender.com/admin/super"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: 11,
              color: "var(--ds-n-300)",
              textDecoration: "none",
              transition: "var(--ds-transition-color)",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "var(--ds-n-600)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "var(--ds-n-300)"; }}
          >
            관리자 로그인
          </a>
        </div>
      </div>
    </footer>
  );
}
