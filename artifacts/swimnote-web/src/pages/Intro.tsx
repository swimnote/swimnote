import { Link } from "wouter";
import { useEffect, useRef, useState, useCallback } from "react";

const BASE = import.meta.env.BASE_URL;
const API_BASE = import.meta.env.VITE_API_BASE || "/api";

// ── color_theme → CSS 색상 (APP/WEB 동일 해석) ──────────────────────────────
import { parseBannerTheme } from "@/lib/bannerTheme";
// parseBannerTheme: preset + custom:#BG:#TEXT 통합 파서 (APP과 동일 로직)

// ── Banner 타입 ───────────────────────────────────────────────────────────────
interface PublicBanner {
  id: string;
  title: string;
  description: string | null;
  color_theme: string;
  display_url: string | null;
  link_url: string | null;
  link_label: string | null;
  display_seconds: number;
  sort_order: number;
}

// ── BannerCarousel ────────────────────────────────────────────────────────────
function BannerCarousel() {
  const [banners, setBanners] = useState<PublicBanner[]>([]);
  const [idx, setIdx] = useState(0);
  const [loaded, setLoaded] = useState(false); // fetch 완료 여부
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hiddenRef = useRef(false);

  // 배너 fetch
  useEffect(() => {
    let alive = true;
    fetch(`${API_BASE}/public/banners`, { cache: "no-store" })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!alive) return;
        const list: PublicBanner[] = d?.banners ?? [];
        setBanners(list);
        setLoaded(true);
      })
      .catch(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, []);

  // 자동 전환
  const advance = useCallback(() => {
    setIdx(i => (i + 1) % (banners.length || 1));
  }, [banners.length]);

  const resetTimer = useCallback((sec: number) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (!hiddenRef.current) advance();
    }, sec * 1000);
  }, [advance]);

  useEffect(() => {
    if (banners.length < 2) return;
    const sec = banners[idx]?.display_seconds ?? 15;
    resetTimer(sec);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [idx, banners, resetTimer]);

  // Page Visibility API — tab 숨김 시 타이머 정지
  useEffect(() => {
    const onVisChange = () => {
      hiddenRef.current = document.hidden;
      if (!document.hidden && banners.length >= 2) {
        const sec = banners[idx]?.display_seconds ?? 15;
        resetTimer(sec);
      }
    };
    document.addEventListener("visibilitychange", onVisChange);
    return () => document.removeEventListener("visibilitychange", onVisChange);
  }, [idx, banners, resetTimer]);

  const goTo = (i: number) => {
    setIdx(i);
    if (timerRef.current) clearTimeout(timerRef.current);
  };
  const prev = () => goTo((idx - 1 + banners.length) % banners.length);
  const next = () => goTo((idx + 1) % banners.length);

  // fetch 완료 전 또는 배너 없음: 렌더링 안 함
  if (!loaded || banners.length === 0) return null;

  const b = banners[idx];
  const colors = parseBannerTheme(b.color_theme);
  const isImage = !!b.display_url;
  const hasLink =
    b.link_url?.startsWith("https://") || b.link_url?.startsWith("http://");
  // http → 실제 서버는 항상 https 반환이지만 혹시 http가 오면 안전하게 허용 안 함
  const safeLink = b.link_url?.startsWith("https://") ? b.link_url : null;

  return (
    <div
      style={{
        width: "100%",
        maxWidth: "var(--ds-content-max)",
        margin: "0 auto",
        position: "relative",
        borderRadius: "var(--ds-radius-lg)",
        overflow: "hidden",
        // 16:5 비율
        aspectRatio: "16 / 5",
      }}
      aria-label="공지 배너"
    >
      {/* 슬라이드 */}
      {isImage ? (
        <img
          src={b.display_url!}
          alt={b.title}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            display: "block",
          }}
          loading="lazy"
        />
      ) : (
        <div
          style={{
            width: "100%",
            height: "100%",
            background: colors.bg,
            color: colors.text,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            padding: "0 clamp(20px, 5%, 48px)",
            boxSizing: "border-box",
          }}
        >
          <p
            style={{
              fontSize: "clamp(14px, 1.6vw, 20px)",
              fontWeight: "var(--ds-fw-bold)",
              letterSpacing: "-0.02em",
              lineHeight: 1.3,
              margin: 0,
              color: "inherit",
            }}
          >
            {b.title}
          </p>
          {b.description && (
            <p
              style={{
                fontSize: "clamp(11px, 1.1vw, 14px)",
                marginTop: "0.4em",
                opacity: 0.85,
                lineHeight: 1.5,
                color: "inherit",
              }}
            >
              {b.description}
            </p>
          )}
          {safeLink && b.link_label && (
            <a
              href={safeLink}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-block",
                marginTop: "0.6em",
                fontSize: "clamp(11px, 1vw, 13px)",
                fontWeight: "var(--ds-fw-medium)",
                color: "inherit",
                opacity: 0.8,
                textDecoration: "underline",
              }}
            >
              {b.link_label}
            </a>
          )}
        </div>
      )}

      {/* 이미지 배너 위 link overlay */}
      {isImage && safeLink && (
        <a
          href={safeLink}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={b.title}
          style={{
            position: "absolute",
            inset: 0,
            display: "block",
          }}
        />
      )}

      {/* 좌/우 버튼 (2개 이상일 때만) */}
      {banners.length >= 2 && (
        <>
          <button
            onClick={prev}
            aria-label="이전 배너"
            style={{
              position: "absolute",
              left: 8,
              top: "50%",
              transform: "translateY(-50%)",
              background: "rgba(0,0,0,0.28)",
              border: "none",
              borderRadius: "50%",
              width: 32,
              height: 32,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontSize: 16,
              zIndex: 2,
              transition: "background 0.15s",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(0,0,0,0.5)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "rgba(0,0,0,0.28)"; }}
          >
            ‹
          </button>
          <button
            onClick={next}
            aria-label="다음 배너"
            style={{
              position: "absolute",
              right: 8,
              top: "50%",
              transform: "translateY(-50%)",
              background: "rgba(0,0,0,0.28)",
              border: "none",
              borderRadius: "50%",
              width: 32,
              height: 32,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontSize: 16,
              zIndex: 2,
              transition: "background 0.15s",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(0,0,0,0.5)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "rgba(0,0,0,0.28)"; }}
          >
            ›
          </button>
        </>
      )}

      {/* dot indicator (2개 이상일 때만) */}
      {banners.length >= 2 && (
        <div
          style={{
            position: "absolute",
            bottom: 8,
            left: 0,
            right: 0,
            display: "flex",
            justifyContent: "center",
            gap: 6,
            zIndex: 2,
          }}
          role="tablist"
          aria-label="배너 선택"
        >
          {banners.map((_, i) => (
            <button
              key={i}
              role="tab"
              aria-selected={i === idx}
              aria-label={`배너 ${i + 1}`}
              onClick={() => goTo(i)}
              style={{
                width: i === idx ? 20 : 8,
                height: 8,
                borderRadius: 4,
                background: i === idx ? "#fff" : "rgba(255,255,255,0.5)",
                border: "none",
                padding: 0,
                cursor: "pointer",
                transition: "width 0.2s, background 0.2s",
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

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
        {/* Banner Carousel — 활성 배너 있을 때만 표시 */}
        <BannerCarousel />

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
