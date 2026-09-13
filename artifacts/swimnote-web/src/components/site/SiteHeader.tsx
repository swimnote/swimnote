import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation, Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";

// ── Product nav items ──────────────────────────────────────────────────────────
// Routes not yet created (WP4/5/6) are marked future:true.
// They render as normal links — /:slug will catch them until the real pages exist.
// Risk reported in WP2 completion report.
const PRODUCT_LINKS = [
  { label: "SWIMNOTE",       labelMobile: "SWIMNOTE",  href: "/swimnote",        future: true },
  { label: "SWIMNOTE X",     labelMobile: "SWIMNOTE X",href: "/swimnote-x",      future: true },
  { label: "SWIMNOTE OFFICE",labelMobile: "OFFICE",    href: "/swimnote-office", future: true },
] as const;

// ── Expanded ⋯ menu groups ─────────────────────────────────────────────────────
const MENU_GROUPS = [
  {
    heading: "기술 & AI",
    items: [
      { label: "SWIMNOTE AI",   href: "/ai",         future: true },
      { label: "기술 및 개발",  href: "/technology",  future: true },
      { label: "특허 / IP",     href: "/patents",     future: true },
      { label: "AI 및 기술 투자", href: "/technology#investment", future: true },
    ],
  },
  {
    heading: "회사",
    items: [
      { label: "회사 소개", href: "/company", future: true },
    ],
  },
  {
    heading: "지원",
    items: [
      { label: "고객센터",         href: "/support",  future: false },
      { label: "도입 문의",        href: "/contact",  future: true  },
      { label: "이용약관",         href: "/terms",    future: true  },
      { label: "개인정보처리방침", href: "/privacy",  future: true  },
    ],
  },
];

// ── Breakpoint (matches DS --ds-bp-lg: 980px) ────────────────────────────────
const DESKTOP_BP = 980;

// ── Utility ───────────────────────────────────────────────────────────────────
function useIsDesktopNav() {
  const [isDesktop, setIsDesktop] = useState(
    typeof window !== "undefined" ? window.innerWidth >= DESKTOP_BP : true
  );
  useEffect(() => {
    const handle = () => setIsDesktop(window.innerWidth >= DESKTOP_BP);
    window.addEventListener("resize", handle, { passive: true });
    return () => window.removeEventListener("resize", handle);
  }, []);
  return isDesktop;
}

// ── ExpandedMenu ──────────────────────────────────────────────────────────────
interface ExpandedMenuProps {
  open: boolean;
  onClose: () => void;
  isDesktop: boolean;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
}

function ExpandedMenu({ open, onClose, isDesktop, triggerRef }: ExpandedMenuProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // ESC close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); triggerRef.current?.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose, triggerRef]);

  // Outside click close
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) onClose();
    };
    // slight delay so the triggering click doesn't immediately close
    const id = setTimeout(() => document.addEventListener("mousedown", onClick), 50);
    return () => { clearTimeout(id); document.removeEventListener("mousedown", onClick); };
  }, [open, onClose, triggerRef]);

  // Scroll lock on mobile
  useEffect(() => {
    if (!isDesktop && open) {
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = ""; };
    }
  }, [open, isDesktop]);

  const panelStyle: React.CSSProperties = isDesktop
    ? {
        position: "fixed",
        top: 52,       // header height
        left: 0,
        right: 0,
        zIndex: 49,
        background: "rgba(255,255,255,0.97)",
        backdropFilter: "saturate(180%) blur(24px)",
        WebkitBackdropFilter: "saturate(180%) blur(24px)",
        borderBottom: "1px solid var(--ds-border-light)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.06)",
      }
    : {
        position: "fixed",
        top: 48,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 49,
        background: "var(--ds-n-000)",
        overflowY: "auto",
      };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label="확장 메뉴"
          style={panelStyle}
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        >
          <div
            style={{
              maxWidth: isDesktop ? "var(--ds-content-max)" : "100%",
              margin: "0 auto",
              padding: isDesktop ? "32px 24px 36px" : "24px 24px 40px",
              display: "grid",
              gridTemplateColumns: isDesktop ? "repeat(3, 1fr)" : "1fr",
              gap: isDesktop ? "0 48px" : "32px",
            }}
          >
            {MENU_GROUPS.map((group) => (
              <div key={group.heading}>
                <p
                  style={{
                    fontSize: "var(--ds-text-label)",
                    fontWeight: "var(--ds-fw-semibold)",
                    letterSpacing: "var(--ds-ls-wider)",
                    textTransform: "uppercase",
                    color: "var(--ds-n-400)",
                    marginBottom: 14,
                    paddingBottom: 10,
                    borderBottom: "1px solid var(--ds-border-light)",
                  }}
                >
                  {group.heading}
                </p>
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                  {group.items.map((item) => (
                    <li key={item.label}>
                      <Link
                        href={item.href}
                        onClick={onClose}
                        style={{
                          display: "block",
                          padding: "8px 10px",
                          marginLeft: -10,
                          borderRadius: "var(--ds-radius-sm)",
                          fontSize: "var(--ds-text-body-sm)",
                          fontWeight: "var(--ds-fw-regular)",
                          color: "var(--ds-text-primary)",
                          textDecoration: "none",
                          transition: "var(--ds-transition-color)",
                        }}
                        onMouseEnter={e => {
                          (e.currentTarget as HTMLElement).style.background = "var(--ds-n-050)";
                          (e.currentTarget as HTMLElement).style.color = "var(--ds-n-900)";
                        }}
                        onMouseLeave={e => {
                          (e.currentTarget as HTMLElement).style.background = "transparent";
                          (e.currentTarget as HTMLElement).style.color = "var(--ds-text-primary)";
                        }}
                      >
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── SiteHeader ────────────────────────────────────────────────────────────────
export default function SiteHeader() {
  const [location] = useLocation();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const isDesktop = useIsDesktopNav();
  const moreRef = useRef<HTMLButtonElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);

  // Scroll detection
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close menu on route change
  useEffect(() => { setMenuOpen(false); }, [location]);

  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const toggleMenu = useCallback(() => setMenuOpen((v) => !v), []);

  // Active product tab detection
  const isActive = (href: string) => location === href || location.startsWith(href + "/");

  // Tab text color (product tabs always on white header — no dark-hero mode)
  const tabActive   = "var(--ds-n-900)";
  const tabInactive = "var(--ds-n-400)";

  const headerBg = scrolled || menuOpen
    ? "rgba(255,255,255,0.94)"
    : "rgba(255,255,255,0.94)";
  const headerBorder = "1px solid var(--ds-border-light)";

  return (
    <>
      <header
        style={{
          position: "fixed",
          top: 0, left: 0, right: 0,
          zIndex: 50,
          height: isDesktop ? 52 : 48,
          display: "flex",
          alignItems: "center",
          background: headerBg,
          backdropFilter: "saturate(180%) blur(20px)",
          WebkitBackdropFilter: "saturate(180%) blur(20px)",
          borderBottom: headerBorder,
          transition: "background 0.3s",
        }}
        role="banner"
      >
        <div
          style={{
            width: "100%",
            maxWidth: isDesktop ? "var(--ds-content-max-wide)" : "100%",
            margin: "0 auto",
            padding: isDesktop ? "0 24px" : "0 12px",
            height: "100%",
            display: "flex",
            alignItems: "center",
            gap: 0,
          }}
        >
          {/* ── Logo ─────────────────────────────────────────────── */}
          <Link
            href="/"
            aria-label="SWIMNOTE 홈으로"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              textDecoration: "none",
              flexShrink: 0,
              padding: "0 4px",
            }}
          >
            <img
              src={`${import.meta.env.BASE_URL}icon.png`}
              alt=""
              aria-hidden="true"
              style={{ width: 22, height: 22, objectFit: "contain", borderRadius: 5 }}
            />
            <span
              style={{
                fontSize: 14,
                fontWeight: "var(--ds-fw-semibold)",
                letterSpacing: "-0.01em",
                color: "var(--ds-n-900)",
                lineHeight: 1,
              }}
              translate="no"
            >
              SWIMNOTE
            </span>
          </Link>

          {/* ── Product tabs (center / scroll on mobile) ─────────── */}
          <nav
            ref={tabsRef}
            aria-label="제품 메뉴"
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: isDesktop ? "center" : "flex-start",
              overflowX: "auto",
              scrollbarWidth: "none",
              msOverflowStyle: "none",
              WebkitOverflowScrolling: "touch",
              gap: 0,
              // fade edges on mobile
              maskImage: isDesktop ? "none" : "linear-gradient(to right, transparent 0px, black 12px, black calc(100% - 12px), transparent 100%)",
              WebkitMaskImage: isDesktop ? "none" : "linear-gradient(to right, transparent 0px, black 12px, black calc(100% - 12px), transparent 100%)",
              padding: isDesktop ? "0 20px" : "0 8px",
            }}
          >
            {PRODUCT_LINKS.map((item) => {
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  style={{
                    flexShrink: 0,
                    display: "inline-flex",
                    alignItems: "center",
                    height: isDesktop ? 52 : 48,
                    padding: isDesktop ? "0 13px" : "0 10px",
                    fontSize: isDesktop ? 13 : 12,
                    fontWeight: active ? "var(--ds-fw-medium)" : "var(--ds-fw-regular)",
                    color: active ? tabActive : tabInactive,
                    textDecoration: "none",
                    whiteSpace: "nowrap",
                    letterSpacing: "-0.005em",
                    transition: "var(--ds-transition-color)",
                    borderBottom: active ? "2px solid var(--ds-n-900)" : "2px solid transparent",
                    boxSizing: "border-box",
                  }}
                  onMouseEnter={e => {
                    if (!active) (e.currentTarget as HTMLElement).style.color = "var(--ds-n-700)";
                  }}
                  onMouseLeave={e => {
                    if (!active) (e.currentTarget as HTMLElement).style.color = tabInactive;
                  }}
                  translate="no"
                >
                  {isDesktop ? item.label : item.labelMobile}
                </Link>
              );
            })}
          </nav>

          {/* ── Right: PC Dashboard + ⋯ ──────────────────────────── */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            {/* PC Dashboard button */}
            <Link
              href="/login"
              style={{
                display: "inline-flex",
                alignItems: "center",
                height: 30,
                padding: "0 13px",
                borderRadius: "var(--ds-radius-pill)",
                background: "var(--ds-n-900)",
                color: "var(--ds-n-000)",
                fontSize: 12,
                fontWeight: "var(--ds-fw-medium)",
                textDecoration: "none",
                whiteSpace: "nowrap",
                letterSpacing: "-0.005em",
                transition: "opacity 0.15s",
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = "0.78"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}
              aria-label="PC 대시보드 로그인"
            >
              {isDesktop ? "PC 대시보드" : "PC"}
            </Link>

            {/* ⋯ button */}
            <button
              ref={moreRef}
              onClick={toggleMenu}
              aria-expanded={menuOpen}
              aria-controls="site-expanded-menu"
              aria-label={menuOpen ? "메뉴 닫기" : "더 보기 메뉴 열기"}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 30,
                height: 30,
                borderRadius: "var(--ds-radius-pill)",
                background: menuOpen ? "var(--ds-n-100)" : "transparent",
                border: "1px solid",
                borderColor: menuOpen ? "var(--ds-border-med)" : "var(--ds-border-strong)",
                cursor: "pointer",
                transition: "var(--ds-transition-color)",
                flexShrink: 0,
                padding: 0,
              }}
              onMouseEnter={e => {
                if (!menuOpen) (e.currentTarget as HTMLElement).style.background = "var(--ds-n-050)";
              }}
              onMouseLeave={e => {
                if (!menuOpen) (e.currentTarget as HTMLElement).style.background = "transparent";
              }}
            >
              {/* ⋯ dots */}
              <svg width="14" height="4" viewBox="0 0 14 4" fill="none" aria-hidden="true">
                <circle cx="2" cy="2" r="1.4" fill="var(--ds-n-600)" />
                <circle cx="7" cy="2" r="1.4" fill="var(--ds-n-600)" />
                <circle cx="12" cy="2" r="1.4" fill="var(--ds-n-600)" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      {/* ── Expanded menu overlay ─────────────────────────────────── */}
      <div id="site-expanded-menu">
        <ExpandedMenu
          open={menuOpen}
          onClose={closeMenu}
          isDesktop={isDesktop}
          triggerRef={moreRef}
        />
      </div>

      {/* ── Scrim (mobile only) ───────────────────────────────────── */}
      <AnimatePresence>
        {menuOpen && !isDesktop && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={closeMenu}
            aria-hidden="true"
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 48,
              background: "rgba(0,0,0,0.18)",
            }}
          />
        )}
      </AnimatePresence>
    </>
  );
}
