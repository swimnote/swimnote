import { useState, useEffect } from "react";
import { useLocation } from "wouter";

type NavLink = {
  label: string;
  page: string;
  external?: boolean;
};

const links: NavLink[] = [
  { label: "소개",        page: "/" },
  { label: "교육시스템",  page: "/education" },
  { label: "스윔노트 앱", page: "/app" },
  { label: "대시보드",    page: "/login" },
  { label: "도입 문의",   page: "/support" },
];

export default function Nav() {
  const [location, navigate] = useLocation();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 4);
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  const isActive = (l: NavLink) => {
    if (l.page === "/") return location === "/";
    return location.startsWith(l.page);
  };

  const handleClick = (l: NavLink) => {
    navigate(l.page);
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  return (
    <header
      className="fixed top-0 left-0 right-0 z-50 transition-all duration-300"
      style={{
        background: scrolled ? "rgba(255,255,255,0.82)" : "rgba(255,255,255,0.0)",
        backdropFilter: scrolled ? "saturate(180%) blur(20px)" : "none",
        WebkitBackdropFilter: scrolled ? "saturate(180%) blur(20px)" : "none",
        borderBottom: scrolled ? "1px solid rgba(0,0,0,0.08)" : "1px solid transparent",
      }}
    >
      <div className="max-w-[980px] mx-auto px-4 h-[44px] flex items-center justify-between">
        {/* 로고 */}
        <button
          onClick={() => { navigate("/"); window.scrollTo({ top: 0, behavior: "instant" }); }}
          className="shrink-0 flex items-center"
          aria-label="SWIMNOTE 홈"
        >
          <img
            src={`${import.meta.env.BASE_URL}logo.png`}
            alt="SWIMNOTE"
            className="h-7 w-auto object-contain"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
              (e.currentTarget.nextSibling as HTMLElement).style.display = "block";
            }}
          />
          <span
            className="hidden text-[15px] font-semibold tracking-tight"
            style={{ color: "#1d1d1f" }}
            translate="no"
          >
            SWIMNOTE
          </span>
        </button>

        {/* 탭 */}
        <nav className="hidden md:flex items-center gap-0">
          {links.map((l) => {
            const active = isActive(l);
            return (
              <button
                key={l.label}
                onClick={() => handleClick(l)}
                className="px-4 h-[44px] flex items-center text-[12px] font-normal transition-colors duration-150 cursor-pointer select-none"
                style={{ color: active ? "#000" : "#6e6e73" }}
                onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.color = "#1d1d1f"; }}
                onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.color = "#6e6e73"; }}
              >
                {l.label}
              </button>
            );
          })}
        </nav>

        {/* 로그인 */}
        <a
          href={`${import.meta.env.BASE_URL}login`}
          className="hidden md:flex items-center text-[12px] transition-colors duration-150 shrink-0"
          style={{ color: "#6e6e73" }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#1d1d1f"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#6e6e73"; }}
        >
          로그인
        </a>

        {/* 모바일 메뉴 */}
        <nav className="flex md:hidden items-center gap-3 overflow-x-auto scrollbar-none">
          {links.map((l) => {
            const active = isActive(l);
            return (
              <button
                key={l.label}
                onClick={() => handleClick(l)}
                className="shrink-0 text-[11px] font-normal transition-colors py-1"
                style={{ color: active ? "#000" : "#6e6e73" }}
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
