import { useState, useEffect } from "react";
import { useLocation } from "wouter";

const PRIMARY = "#002F5F";
const SECONDARY = "#01B2F1";

type NavLink = {
  label: string;
  page?: string;
  anchor?: string;
  highlight?: boolean;
};

const links: NavLink[] = [
  { label: "소개", page: "/" },
  { label: "교육시스템", page: "/education" },
  { label: "스윔노트 앱", page: "/app", highlight: true },
  { label: "대한수영영법연구원", page: "/", anchor: "research" },
  { label: "도입·제휴 문의", page: "/support" },
];

export default function Nav() {
  const [location, navigate] = useLocation();
  const [scrolled, setScrolled] = useState(false);
  const [activeAnchor, setActiveAnchor] = useState<string | null>(null);

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  const handleClick = (l: NavLink) => {
    if (l.anchor) {
      setActiveAnchor(l.label);
      if (location !== l.page) {
        navigate(l.page!);
        setTimeout(() => {
          document.getElementById(l.anchor!)?.scrollIntoView({ behavior: "smooth" });
        }, 150);
      } else {
        document.getElementById(l.anchor)?.scrollIntoView({ behavior: "smooth" });
      }
    } else {
      setActiveAnchor(null);
      navigate(l.page!);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const isActive = (l: NavLink) => {
    if (l.anchor) return activeAnchor === l.label;
    if (activeAnchor) return false;
    if (l.page === "/") return location === "/";
    return location.startsWith(l.page!);
  };

  return (
    <header className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${scrolled ? "bg-white/96 backdrop-blur-md border-b border-[#e8e8e8]" : "bg-white"}`}>
      <div className="max-w-6xl mx-auto px-3 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-2">
        <button onClick={() => { navigate("/"); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
          <span className="flex items-center cursor-pointer select-none shrink-0">
            <img src={`${import.meta.env.BASE_URL}logo.png`} alt="SWIMNOTE" className="h-8 sm:h-10 w-auto object-contain" onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
              (e.currentTarget.nextSibling as HTMLElement).style.display = "block";
            }} />
            <span className="hidden text-[18px] font-black tracking-tight" style={{ color: PRIMARY }} translate="no">SWIMNOTE</span>
          </span>
        </button>

        <nav className="flex items-center gap-0.5 sm:gap-1 overflow-x-auto scrollbar-none">
          {links.map((l) => {
            const active = isActive(l);
            const isHighlight = l.highlight;
            return (
              <button
                key={l.label}
                onClick={() => handleClick(l)}
                className={`px-2 sm:px-4 py-1.5 sm:py-2 rounded-full text-[11px] sm:text-[13.5px] font-medium transition-all duration-150 cursor-pointer select-none whitespace-nowrap ${
                  active
                    ? "text-white"
                    : isHighlight
                    ? "hover:bg-[#f4f4f4] hover:text-[#0a0a0a]"
                    : "text-[#555] hover:text-[#0a0a0a] hover:bg-[#f4f4f4]"
                }`}
                style={
                  active
                    ? { background: isHighlight ? SECONDARY : PRIMARY }
                    : isHighlight
                    ? { color: SECONDARY }
                    : {}
                }
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
