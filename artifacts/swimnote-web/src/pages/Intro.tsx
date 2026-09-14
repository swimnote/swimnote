import { Link } from "wouter";

const BASE = import.meta.env.BASE_URL;

// ── Logo wrapper — 110px 고정 높이, object-fit:contain 기준 ─────────────────
function LogoSlot({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        height: 130,
        display: "flex",
        alignItems: "center",
        marginBottom: 20,
        flexShrink: 0,
      }}
    >
      {children}
    </div>
  );
}

// ── Product Card ──────────────────────────────────────────────────────────────
interface ProductCardProps {
  logo:      React.ReactNode;
  tag:       string;
  headline:  string;
  desc:      string;
  ctaHref:   string;
}

function ProductCard({ logo, tag, headline, desc, ctaHref }: ProductCardProps) {
  return (
    <div
      style={{
        flex: "1 1 300px",
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        padding: "40px 36px",
        borderRadius: "var(--ds-radius-lg)",
        border: "1px solid var(--ds-border-med)",
        background: "var(--ds-n-000)",
      }}
    >
      {/* Logo */}
      {logo}

      {/* Tag — textTransform + letterSpacing 조합 클리핑 방지 */}
      <p
        style={{
          fontSize: "var(--ds-text-label)",
          fontWeight: "var(--ds-fw-semibold)",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--ds-n-400)",
          lineHeight: 1.4,
          overflow: "visible",
          marginBottom: 10,
          whiteSpace: "nowrap",
        }}
        translate="no"
      >
        {tag || null}
      </p>

      {/* Headline */}
      <h2
        style={{
          fontSize: "clamp(22px, 2.8vw, 28px)",
          fontWeight: "var(--ds-fw-bold)",
          letterSpacing: "-0.025em",
          color: "var(--ds-n-900)",
          lineHeight: 1.2,
          marginBottom: 12,
        }}
      >
        {headline}
      </h2>

      {/* Description */}
      <p
        style={{
          fontSize: "var(--ds-text-body-sm)",
          color: "var(--ds-text-secondary)",
          lineHeight: 1.65,
          marginBottom: 28,
          flexGrow: 1,
        }}
      >
        {desc}
      </p>

      {/* CTA */}
      <Link
        href={ctaHref}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          fontSize: "var(--ds-text-body-sm)",
          fontWeight: "var(--ds-fw-medium)",
          color: "var(--ds-n-900)",
          textDecoration: "none",
          borderBottom: "1px solid currentColor",
          paddingBottom: 1,
          transition: "opacity 0.15s",
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = "0.55"; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}
      >
        알아보기
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M3 7h8M8 4l3 3-3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </Link>
    </div>
  );
}

// ── Intro (HOME) ──────────────────────────────────────────────────────────────
export default function Intro() {
  return (
    <section
      style={{
        minHeight: "calc(100vh - 52px)",
        display: "flex",
        alignItems: "center",
        background: "var(--ds-n-050)",
        padding: "56px 24px",
      }}
    >
      <div
        style={{
          maxWidth: "var(--ds-content-max)",
          margin: "0 auto",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          gap: 20,
        }}
      >
        {/* Section label */}
        <p
          style={{
            fontSize: "var(--ds-text-label)",
            fontWeight: "var(--ds-fw-semibold)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--ds-n-400)",
            lineHeight: 1.4,
            marginBottom: 4,
          }}
          translate="no"
        >
          Products
        </p>

        {/* Two product cards */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 16,
          }}
        >
          {/* ── SWIMNOTE ──────────────────────────────────────────── */}
          {/* home-logo-swimnote.png: RGBA 투명 PNG, 아이콘+wordmark 포함 */}
          <ProductCard
            logo={
              <LogoSlot>
                <img
                  src={`${BASE}home-logo-swimnote.png`}
                  alt="SwimNote"
                  draggable={false}
                  style={{ height: "100%", width: "auto", objectFit: "contain", display: "block" }}
                />
              </LogoSlot>
            }
            tag=""
            headline="어린이수영장 운영의 기본."
            desc="회원, 반관리, 출결, 보강, 수업일지와 학부모 소통까지 어린이수영장 운영에 필요한 기능을 하나의 앱으로 관리합니다."
            ctaHref="/swimnote"
          />

          {/* ── SWIMNOTE X ────────────────────────────────────────── */}
          {/* home-logo-swimnote-x.png: RGBA 투명 PNG, 아이콘+SwimNoteX wordmark 포함 */}
          <ProductCard
            logo={
              <LogoSlot>
                <img
                  src={`${BASE}home-logo-swimnote-x.png`}
                  alt="SwimNote X"
                  draggable={false}
                  style={{ height: "100%", width: "auto", objectFit: "contain", display: "block" }}
                />
              </LogoSlot>
            }
            tag=""
            headline="수영 교육을 AI 시스템으로."
            desc="강력한 AI 수영교육 시스템. 커리큘럼, 수업 기록과 성장 데이터를 하나의 교육 시스템으로 연결합니다."
            ctaHref="/swimnote-x"
          />
        </div>
      </div>
    </section>
  );
}
