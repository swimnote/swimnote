import { Link } from "wouter";

const BASE = import.meta.env.BASE_URL;

// ── Product Card ──────────────────────────────────────────────────────────────
interface ProductCardProps {
  iconSrc:    string;
  iconAlt:    string;
  iconStyle?: React.CSSProperties;
  tag:        string;
  headline:   string;
  desc:       string;
  ctaHref:    string;
}

function ProductCard({
  iconSrc, iconAlt, iconStyle,
  tag, headline, desc, ctaHref,
}: ProductCardProps) {
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
      {/* Logo / Icon */}
      <img
        src={iconSrc}
        alt={iconAlt}
        style={{
          marginBottom: 28,
          objectFit: "contain",
          display: "block",
          flexShrink: 0,
          ...iconStyle,
        }}
        draggable={false}
      />

      {/* Tag */}
      <p
        style={{
          fontSize: "var(--ds-text-label)",
          fontWeight: "var(--ds-fw-semibold)",
          letterSpacing: "var(--ds-ls-wider)",
          textTransform: "uppercase",
          color: "var(--ds-n-400)",
          marginBottom: 10,
        }}
        translate="no"
      >
        {tag}
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
            letterSpacing: "var(--ds-ls-wider)",
            textTransform: "uppercase",
            color: "var(--ds-n-400)",
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
          {/* SWIMNOTE */}
          <ProductCard
            iconSrc={`${BASE}icon.png`}
            iconAlt="SWIMNOTE 앱 아이콘"
            iconStyle={{ width: 52, height: 52, borderRadius: 12 }}
            tag="SWIMNOTE"
            headline="수영장 운영의 모든 것."
            desc="회원, 수업, 출결, 보강, 일지와 학부모 소통까지 하나의 앱으로."
            ctaHref="/swimnote"
          />

          {/* SWIMNOTE X */}
          <ProductCard
            iconSrc={`${BASE}swimnote-x-logo.png`}
            iconAlt="SWIMNOTE X 로고"
            iconStyle={{ height: 52, width: "auto", maxWidth: 160 }}
            tag="SWIMNOTE X"
            headline="수영 교육을 시스템으로."
            desc="커리큘럼, 수업 기록과 성장 데이터를 하나의 교육 시스템으로 연결합니다."
            ctaHref="/swimnote-x"
          />
        </div>
      </div>
    </section>
  );
}
