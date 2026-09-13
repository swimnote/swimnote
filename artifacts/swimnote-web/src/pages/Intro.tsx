import { Link } from "wouter";

const BASE = import.meta.env.BASE_URL;

// ── Logo wrapper — 두 카드 동일 높이 영역, 로고는 각 자연 크기 기준 ─────────
// 두 카드 모두 로고 영역 height 72px 고정 → 헤드라인 세로 정렬 기준 통일
function LogoSlot({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        height: 72,
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
          {/* icon.png: 투명 PNG 앱 아이콘 — 56px 정사각형 */}
          <ProductCard
            logo={
              <LogoSlot>
                <img
                  src={`${BASE}icon.png`}
                  alt="SWIMNOTE 앱 아이콘"
                  draggable={false}
                  style={{ width: 56, height: 56, objectFit: "contain", borderRadius: 12, display: "block" }}
                />
              </LogoSlot>
            }
            tag="SWIMNOTE"
            headline="어린이수영장 운영의 기본."
            desc="회원, 반관리, 출결, 보강, 수업일지와 학부모 소통까지 어린이수영장 운영에 필요한 기능을 하나의 앱으로 관리합니다."
            ctaHref="/swimnote"
          />

          {/* ── SWIMNOTE X ────────────────────────────────────────── */}
          {/* swimnote-x-logomark.png: 흰 배경 PNG, multiply로 배경 소거
              height 56px auto-width — 이미지 자연 비율 유지, SWIMNOTE 아이콘과 시각 높이 통일 */}
          <ProductCard
            logo={
              <LogoSlot>
                <img
                  src={`${BASE}swimnote-x-logomark.png`}
                  alt="SWIMNOTE X 로고"
                  draggable={false}
                  style={{
                    height: 56,
                    width: "auto",
                    objectFit: "contain",
                    display: "block",
                    mixBlendMode: "multiply",
                  }}
                />
              </LogoSlot>
            }
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
