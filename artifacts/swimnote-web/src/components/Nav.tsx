import { useState, useEffect } from "react";
import { useLocation } from "wouter";

type NavLink = { label: string; page: string };

const links: NavLink[] = [
  { label: "소개",        page: "/" },
  { label: "교육시스템",  page: "/education" },
  { label: "스윔노트 앱", page: "/app" },
  { label: "도입 문의",   page: "/support" },
];

const DARK_HERO_PAGES = ["/"];

export default function Nav() {
  const [location, navigate] = useLocation();
  const [scrolled, setScrolled] = useState(false);
  const [wide, setWide] = useState(typeof window !== "undefined" ? window.innerWidth >= 768 : true);

  const hasDarkHero = DARK_HERO_PAGES.includes(location);
  const onDark = hasDarkHero && !scrolled;

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    const onResize = () => setWide(window.innerWidth >= 768);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onResize); };
  }, []);

  const handleClick = (page: string) => {
    navigate(page);
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  const baseColor   = onDark ? "rgba(255,255,255,0.68)" : "#6e6e73";
  const activeColor = onDark ? "#fff" : "#1d1d1f";

  return (
    <header
      style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 50,
        height: 44,
        display: "flex", alignItems: "center",
        background: scrolled ? "rgba(255,255,255,0.88)" : "transparent",
        backdropFilter: scrolled ? "saturate(180%) blur(20px)" : "none",
        WebkitBackdropFilter: scrolled ? "saturate(180%) blur(20px)" : "none",
        borderBottom: scrolled ? "1px solid rgba(0,0,0,0.08)" : "1px solid transparent",
        transition: "background 0.4s, border-color 0.4s",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 980,
          margin: "0 auto",
          padding: "0 20px",
          height: "100%",
          display: "flex",
          alignItems: "center",
          gap: 0,
        }}
      >
        {/* 로고 */}
        <button
          onClick={() => handleClick("/")}
          aria-label="SWIMNOTE 홈"
          style={{ display: "flex", alignItems: "center", gap: 7, background: "none", border: "none", cursor: "pointer", padding: 0, flexShrink: 0, marginRight: wide ? 0 : "auto" }}
        >
          <img
            src={`${import.meta.env.BASE_URL}icon.png`}
            alt=""
            style={{ width: 24, height: 24, objectFit: "contain", borderRadius: 6 }}
          />
          {wide && (
            <span
              style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.01em", color: activeColor, transition: "color 0.3s" }}
              translate="no"
            >
              SWIMNOTE
            </span>
          )}
        </button>

        {/* 데스크톱 탭 (중앙) */}
        {wide && (
          <nav style={{ flex: 1, display: "flex", justifyContent: "center", alignItems: "center" }}>
            {links.map((l) => {
              const active = l.page === "/" ? location === "/" : location.startsWith(l.page);
              return (
                <button
                  key={l.label}
                  onClick={() => handleClick(l.page)}
                  style={{
                    padding: "0 14px", height: 44,
                    fontSize: 12, fontWeight: active ? 500 : 400,
                    color: active ? activeColor : baseColor,
                    background: "none", border: "none", cursor: "pointer",
                    transition: "color 0.2s", letterSpacing: "0.01em",
                    whiteSpace: "nowrap",
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = activeColor; }}
                  onMouseLeave={e => { if (!( l.page === "/" ? location === "/" : location.startsWith(l.page))) (e.currentTarget as HTMLElement).style.color = baseColor; }}
                >
                  {l.label}
                </button>
              );
            })}
          </nav>
        )}

        {/* 데스크톱 CTA */}
        {wide && (
          <button
            onClick={() => handleClick("/support")}
            style={{
              flexShrink: 0,
              height: 28, padding: "0 14px",
              fontSize: 12, fontWeight: 500,
              color: onDark ? "#1d1d1f" : "#fff",
              background: onDark ? "rgba(255,255,255,0.92)" : "#1d1d1f",
              border: "none", borderRadius: 14, cursor: "pointer",
              transition: "opacity 0.2s", whiteSpace: "nowrap",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = "0.75"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}
          >
            도입 문의
          </button>
        )}

        {/* 모바일 탭 (스크롤 가능) */}
        {!wide && (
          <nav
            style={{
              display: "flex", alignItems: "center",
              overflowX: "auto", gap: 0,
              scrollbarWidth: "none",
              msOverflowStyle: "none",
            }}
          >
            {links.map((l) => {
              const active = l.page === "/" ? location === "/" : location.startsWith(l.page);
              return (
                <button
                  key={l.label}
                  onClick={() => handleClick(l.page)}
                  style={{
                    flexShrink: 0,
                    padding: "0 9px", lineHeight: "44px", height: 44,
                    fontSize: 11, fontWeight: active ? 500 : 400,
                    whiteSpace: "nowrap",
                    color: onDark ? (active ? "#fff" : "rgba(255,255,255,0.68)") : (active ? "#1d1d1f" : "#6e6e73"),
                    background: "none", border: "none", cursor: "pointer",
                  }}
                >
                  {l.label}
                </button>
              );
            })}
          </nav>
        )}
      </div>
    </header>
  );
}
