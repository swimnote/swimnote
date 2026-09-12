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

  const hasDarkHero = DARK_HERO_PAGES.includes(location);
  const onDark = hasDarkHero && !scrolled;

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 4);
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  const handleClick = (page: string) => {
    navigate(page);
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  return (
    <header
      className="fixed top-0 left-0 right-0 z-50 transition-all duration-500"
      style={{
        background: scrolled
          ? "rgba(255,255,255,0.88)"
          : "transparent",
        backdropFilter: scrolled ? "saturate(180%) blur(20px)" : "none",
        WebkitBackdropFilter: scrolled ? "saturate(180%) blur(20px)" : "none",
        borderBottom: scrolled ? "1px solid rgba(0,0,0,0.08)" : "1px solid transparent",
      }}
    >
      <div
        className="max-w-[980px] mx-auto px-5"
        style={{ height: 44, display: "flex", alignItems: "center", justifyContent: "space-between" }}
      >
        {/* 로고 */}
        <button
          onClick={() => handleClick("/")}
          aria-label="SWIMNOTE 홈"
          style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", padding: 0 }}
        >
          <img
            src={`${import.meta.env.BASE_URL}icon.png`}
            alt=""
            style={{ width: 22, height: 22, objectFit: "contain", borderRadius: 5 }}
          />
          <span
            style={{
              fontSize: 15,
              fontWeight: 600,
              letterSpacing: "-0.01em",
              color: onDark ? "#fff" : "#1d1d1f",
              transition: "color 0.3s",
            }}
            translate="no"
          >
            SWIMNOTE
          </span>
        </button>

        {/* 데스크톱 탭 */}
        <nav style={{ display: "flex", alignItems: "center" }} className="hidden md:flex">
          {links.map((l) => {
            const active = l.page === "/" ? location === "/" : location.startsWith(l.page);
            const textColor = onDark
              ? (active ? "#fff" : "rgba(255,255,255,0.72)")
              : (active ? "#1d1d1f" : "#6e6e73");
            return (
              <button
                key={l.label}
                onClick={() => handleClick(l.page)}
                style={{
                  height: 44,
                  padding: "0 12px",
                  fontSize: 12,
                  fontWeight: active ? 500 : 400,
                  color: textColor,
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  transition: "color 0.2s",
                  letterSpacing: "0.01em",
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = onDark ? "#fff" : "#1d1d1f"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = textColor; }}
              >
                {l.label}
              </button>
            );
          })}
        </nav>

        {/* 도입 문의 CTA (데스크톱) */}
        <button
          onClick={() => handleClick("/support")}
          className="hidden md:flex"
          style={{
            height: 28,
            padding: "0 14px",
            fontSize: 12,
            fontWeight: 500,
            color: onDark ? "#1d1d1f" : "#fff",
            background: onDark ? "rgba(255,255,255,0.92)" : "#1d1d1f",
            border: "none",
            borderRadius: 14,
            cursor: "pointer",
            transition: "all 0.3s",
            letterSpacing: "0.01em",
            whiteSpace: "nowrap",
            alignItems: "center",
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = "0.8"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}
        >
          도입 문의
        </button>

        {/* 모바일 탭 */}
        <nav
          className="flex md:hidden items-center gap-0 overflow-x-auto scrollbar-none"
          style={{ flex: 1, justifyContent: "flex-end" }}
        >
          {links.map((l) => {
            const active = l.page === "/" ? location === "/" : location.startsWith(l.page);
            return (
              <button
                key={l.label}
                onClick={() => handleClick(l.page)}
                style={{
                  flexShrink: 0,
                  padding: "0 8px",
                  fontSize: 11,
                  fontWeight: active ? 500 : 400,
                  color: onDark
                    ? (active ? "#fff" : "rgba(255,255,255,0.7)")
                    : (active ? "#1d1d1f" : "#6e6e73"),
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                {l.label}
              </button>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
