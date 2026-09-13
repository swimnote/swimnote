import { Link } from "wouter";

const BASE = import.meta.env.BASE_URL;

// ── Product Block ─────────────────────────────────────────────────────────────
interface ProductBlockProps {
  tag: string;
  name: string;
  headline: string;
  desc: string;
  ctaLabel: string;
  ctaHref: string;
  imageSrc: string;
  imageAlt: string;
  reverse?: boolean;           // image on left on desktop
  bg?: string;
  accentColor?: string;
}

function ProductBlock({
  tag, name, headline, desc, ctaLabel, ctaHref,
  imageSrc, imageAlt,
  reverse = false,
  bg = "var(--ds-n-000)",
  accentColor = "var(--ds-n-900)",
}: ProductBlockProps) {
  const textBlock = (
    <div
      style={{
        flex: "1 1 340px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "40px 0",
      }}
    >
      <p
        style={{
          fontSize: "var(--ds-text-label)",
          fontWeight: "var(--ds-fw-semibold)",
          letterSpacing: "var(--ds-ls-wider)",
          textTransform: "uppercase",
          color: accentColor,
          marginBottom: 12,
        }}
        translate="no"
      >
        {tag}
      </p>
      <h2
        style={{
          fontSize: "clamp(26px, 3.5vw, 36px)",
          fontWeight: "var(--ds-fw-bold)",
          letterSpacing: "-0.025em",
          color: "var(--ds-n-900)",
          marginBottom: 14,
          lineHeight: 1.2,
        }}
      >
        {headline}
      </h2>
      <p
        style={{
          fontSize: "var(--ds-text-body)",
          color: "var(--ds-text-secondary)",
          lineHeight: 1.7,
          maxWidth: 400,
          marginBottom: 28,
        }}
      >
        {desc}
      </p>
      <div>
        <Link
          href={ctaHref}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            height: 40,
            padding: "0 20px",
            borderRadius: "var(--ds-radius-pill)",
            background: "var(--ds-n-900)",
            color: "var(--ds-n-000)",
            fontSize: "var(--ds-text-body-sm)",
            fontWeight: "var(--ds-fw-medium)",
            textDecoration: "none",
            transition: "opacity 0.15s",
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = "0.78"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}
        >
          {ctaLabel}
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M3 7h8M8 4l3 3-3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </Link>
      </div>
    </div>
  );

  const imageBlock = (
    <div
      style={{
        flex: "1 1 360px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "32px 0",
      }}
    >
      <img
        src={imageSrc}
        alt={imageAlt}
        style={{
          width: "100%",
          maxWidth: 420,
          height: "auto",
          borderRadius: "var(--ds-radius-lg)",
          objectFit: "cover",
          display: "block",
        }}
        loading="lazy"
      />
    </div>
  );

  return (
    <section style={{ background: bg }}>
      <div
        style={{
          maxWidth: "var(--ds-content-max)",
          margin: "0 auto",
          padding: "0 24px",
        }}
      >
        {/* Mobile: always text → image */}
        {/* Desktop: alternating via flex-direction */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "0 56px",
            alignItems: "center",
          }}
          className={reverse ? "product-block-reverse" : "product-block-normal"}
        >
          {reverse ? (
            <>
              <style>{`
                @media (min-width: 768px) {
                  .product-block-reverse { flex-direction: row-reverse; }
                }
              `}</style>
              {textBlock}
              {imageBlock}
            </>
          ) : (
            <>
              {textBlock}
              {imageBlock}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

// ── Intro (HOME) ──────────────────────────────────────────────────────────────
export default function Intro() {
  return (
    <>
      {/* Thin divider between blocks */}
      <style>{`
        .home-divider {
          height: 1px;
          background: var(--ds-border-light);
          margin: 0 24px;
          max-width: calc(var(--ds-content-max) - 48px);
          margin-left: auto;
          margin-right: auto;
        }
      `}</style>

      <ProductBlock
        tag="SWIMNOTE"
        name="SWIMNOTE"
        headline="수영장 운영의 모든 것."
        desc={`회원, 수업, 출결, 보강, 일지와\n학부모 소통까지 하나의 앱으로.`}
        ctaLabel="알아보기"
        ctaHref="/swimnote"
        imageSrc={`${BASE}intro-overview.png`}
        imageAlt="SWIMNOTE 서비스 소개"
        bg="var(--ds-n-000)"
      />

      <div className="home-divider" />

      <ProductBlock
        tag="SWIMNOTE X"
        name="SWIMNOTE X"
        headline="수영 교육을 시스템으로."
        desc={`커리큘럼, 수업 기록과 성장 데이터를\n하나의 교육 시스템으로 연결합니다.`}
        ctaLabel="알아보기"
        ctaHref="/swimnote-x"
        imageSrc={`${BASE}education-growth.png`}
        imageAlt="SWIMNOTE X 성장 데이터 화면"
        bg="var(--ds-n-000)"
        reverse={true}
        accentColor="var(--ds-sn-navy, #002F5F)"
      />
    </>
  );
}
