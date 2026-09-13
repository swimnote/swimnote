import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation, Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE SAFETY MAP
//
// Only routes listed here as `live: true` will receive actual <Link> navigation.
// All other items render as a <span> (visually identical, no navigation) until
// the corresponding WP creates the real page and sets it to live.
//
// EXISTING routes (live):
//   /          /education  /app  /support  /delete-account
//   /login     /design-system   /admin/*  /super/*  /:slug (pool)
//
// FUTURE routes — will be activated in WP4/5/6/7:
//   /swimnote  /swimnote-x  /swimnote-office
//   /ai  /technology  /patents  /company  /contact  /terms  /privacy
// ─────────────────────────────────────────────────────────────────────────────
const LIVE_ROUTES = new Set([
  "/",
  "/education",
  "/app",
  "/support",
  "/delete-account",
  "/login",
  "/design-system",
]);

function isLiveRoute(href: string): boolean {
  // Strip hash for lookup
  const path = href.split("#")[0];
  return LIVE_ROUTES.has(path);
}

// ── Product nav items ──────────────────────────────────────────────────────────
const PRODUCT_LINKS = [
  { label: "SWIMNOTE",        labelMobile: "SWIMNOTE",  href: "/swimnote"        },
  { label: "SWIMNOTE X",      labelMobile: "SWIMNOTE X",href: "/swimnote-x"      },
  { label: "SWIMNOTE OFFICE", labelMobile: "OFFICE",    href: "/swimnote-office" },
] as const;

// ── Expanded ⋯ menu groups ─────────────────────────────────────────────────────
const MENU_GROUPS = [
  {
    heading: "기술 & AI",
    items: [
      { label: "SWIMNOTE AI",     href: "/ai"                   },
      { label: "기술 및 개발",    href: "/technology"            },
      { label: "특허 / IP",       href: "/patents"               },
      { label: "AI 및 기술 투자", href: "/technology#investment" },
    ],
  },
  {
    heading: "회사",
    items: [
      { label: "회사 소개", href: "/company" },
    ],
  },
  {
    heading: "지원",
    items: [
      { label: "고객센터",         href: "/support" },  // LIVE
      { label: "도입 문의",        href: "/contact" },
      { label: "이용약관",         href: "/terms"   },
      { label: "개인정보처리방침", href: "/privacy"  },
    ],
  },
];

// ── Focusable element selector ────────────────────────────────────────────────
const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
}

// ── Breakpoint ────────────────────────────────────────────────────────────────
const DESKTOP_BP = 980;

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

// ── NavItem — live route or inert span ───────────────────────────────────────
interface NavItemProps {
  href: string;
  onClick?: () => void;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
  "aria-label"?: string;
}

function NavItem({ href, onClick, style, children, "aria-label": ariaLabel }: NavItemProps) {
  const live = isLiveRoute(href);

  const baseStyle: React.CSSProperties = {
    display: "block",
    padding: "8px 10px",
    marginLeft: -10,
    borderRadius: "var(--ds-radius-sm)",
    fontSize: "var(--ds-text-body-sm)",
    fontWeight: "var(--ds-fw-regular)",
    color: "var(--ds-text-primary)",
    textDecoration: "none",
    transition: "var(--ds-transition-color)",
    ...style,
  };

  const hoverOn  = (e: React.MouseEvent<HTMLElement>) => {
    e.currentTarget.style.background = "var(--ds-n-050)";
    e.currentTarget.style.color = "var(--ds-n-900)";
  };
  const hoverOff = (e: React.MouseEvent<HTMLElement>) => {
    e.currentTarget.style.background = "transparent";
    e.currentTarget.style.color = "var(--ds-text-primary)";
  };

  if (live) {
    return (
      <Link
        href={href}
        onClick={onClick}
        aria-label={ariaLabel}
        style={baseStyle}
        onMouseEnter={hoverOn}
        onMouseLeave={hoverOff}
      >
        {children}
      </Link>
    );
  }

  // Future route — visually identical but not a link; not focusable via keyboard
  // (tabIndex=-1 since it has no real destination)
  return (
    <span
      aria-label={ariaLabel ? `${ariaLabel} (준비 중)` : undefined}
      aria-disabled="true"
      style={{
        ...baseStyle,
        cursor: "default",
        color: "var(--ds-n-300)",   // subtly dimmed to indicate unavailability
      }}
      title="준비 중"
    >
      {children}
    </span>
  );
}

// ── ExpandedMenu ──────────────────────────────────────────────────────────────
//
// SEMANTIC DECISION: role="navigation" (not role="dialog")
//
// Reason: This panel is a navigation mega-menu, not a modal dialog.
// Using role="dialog" + aria-modal would inert the background, requiring
// a complete focus trap — which is not appropriate for navigation overlays
// where users expect Tab to move through menu items naturally.
// role="navigation" is semantically correct, and we manage focus manually:
//   - On open: first focusable item receives focus
//   - Tab/Shift+Tab: contained within panel via keydown handler
//   - ESC: closes + returns focus to ⋯ trigger
//   - Outside click: closes
// This pattern matches ARIA APG "Navigation" disclosure pattern.
// ─────────────────────────────────────────────────────────────────────────────
interface ExpandedMenuProps {
  open: boolean;
  onClose: () => void;
  isDesktop: boolean;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
}

function ExpandedMenu({ open, onClose, isDesktop, triggerRef }: ExpandedMenuProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // ── On open: focus first focusable item in panel ──────────────────────────
  useEffect(() => {
    if (!open || !panelRef.current) return;
    // rAF ensures panel is in DOM and animated before focus
    const id = requestAnimationFrame(() => {
      const items = getFocusable(panelRef.current!);
      items[0]?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  // ── Focus trap: Tab / Shift+Tab stay inside panel ─────────────────────────
  useEffect(() => {
    if (!open || !panelRef.current) return;
    const panel = panelRef.current;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        triggerRef.current?.focus();
        return;
      }
      if (e.key !== "Tab") return;

      const items = getFocusable(panel);
      if (items.length === 0) return;
      const first = items[0];
      const last  = items[items.length - 1];

      if (e.shiftKey) {
        // Shift+Tab at first item → wrap to last
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        // Tab at last item → wrap to first
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    panel.addEventListener("keydown", onKeyDown);
    return () => panel.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, triggerRef]);

  // ── Outside click close ───────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    const id = setTimeout(() => document.addEventListener("mousedown", onClick), 50);
    return () => { clearTimeout(id); document.removeEventListener("mousedown", onClick); };
  }, [open, onClose, triggerRef]);

  // ── Mobile scroll lock ────────────────────────────────────────────────────
  useEffect(() => {
    if (!isDesktop && open) {
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = ""; };
    }
  }, [open, isDesktop]);

  const panelStyle: React.CSSProperties = isDesktop
    ? {
        position: "fixed",
        top: 52,
        left: 0,
        right: 0,
        zIndex: 49,
        background: "rgba(255,255,255,0.97)",
        backdropFilter: "saturate(180%) blur(20px)",
        WebkitBackdropFilter: "saturate(180%) blur(20px)",
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
          // role="navigation" — mega-menu overlay, not a modal dialog
          // (see SEMANTIC DECISION comment above)
          role="navigation"
          aria-label="사이트 전체 메뉴"
          id="site-expanded-menu"
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
                      <NavItem href={item.href} onClick={onClose}>
                        {item.label}
                      </NavItem>
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

// ── Product tab — live Link or inert span ─────────────────────────────────────
interface ProductTabProps {
  href: string;
  label: string;
  active: boolean;
  isDesktop: boolean;
  tabActive: string;
  tabInactive: string;
}

function ProductTab({ href, label, active, isDesktop, tabActive, tabInactive }: ProductTabProps) {
  const live = isLiveRoute(href);

  const style: React.CSSProperties = {
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    height: isDesktop ? 52 : 48,
    padding: isDesktop ? "0 13px" : "0 10px",
    fontSize: isDesktop ? 13 : 12,
    fontWeight: active ? "var(--ds-fw-medium)" : "var(--ds-fw-regular)",
    color: active ? tabActive : live ? tabInactive : "var(--ds-n-300)",
    textDecoration: "none",
    whiteSpace: "nowrap",
    letterSpacing: "-0.005em",
    transition: "var(--ds-transition-color)",
    borderBottom: active ? "2px solid var(--ds-n-900)" : "2px solid transparent",
    boxSizing: "border-box",
    cursor: live ? "pointer" : "default",
  };

  if (live) {
    return (
      <Link
        href={href}
        style={style}
        translate="no"
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "var(--ds-n-700)"; }}
        onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.color = tabInactive; }}
      >
        {label}
      </Link>
    );
  }

  return (
    <span
      style={style}
      translate="no"
      title="준비 중"
      aria-disabled="true"
    >
      {label}
    </span>
  );
}

// ── SiteHeader ────────────────────────────────────────────────────────────────
export default function SiteHeader() {
  const [location] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const isDesktop = useIsDesktopNav();
  const moreRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { setMenuOpen(false); }, [location]);

  const closeMenu  = useCallback(() => setMenuOpen(false), []);
  const toggleMenu = useCallback(() => setMenuOpen((v) => !v), []);

  const isActive = (href: string) => location === href || location.startsWith(href + "/");

  const tabActive   = "var(--ds-n-900)";
  const tabInactive = "var(--ds-n-400)";

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
          background: "rgba(255,255,255,0.94)",
          backdropFilter: "saturate(180%) blur(20px)",
          WebkitBackdropFilter: "saturate(180%) blur(20px)",
          borderBottom: "1px solid var(--ds-border-light)",
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
          {/* ── Logo (always live) ──────────────────────────────── */}
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

          {/* ── Product tabs ──────────────────────────────────────── */}
          <nav
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
              maskImage: isDesktop
                ? "none"
                : "linear-gradient(to right, transparent 0px, black 12px, black calc(100% - 12px), transparent 100%)",
              WebkitMaskImage: isDesktop
                ? "none"
                : "linear-gradient(to right, transparent 0px, black 12px, black calc(100% - 12px), transparent 100%)",
              padding: isDesktop ? "0 20px" : "0 8px",
            }}
          >
            {PRODUCT_LINKS.map((item) => (
              <ProductTab
                key={item.href}
                href={item.href}
                label={isDesktop ? item.label : item.labelMobile}
                active={isActive(item.href)}
                isDesktop={isDesktop}
                tabActive={tabActive}
                tabInactive={tabInactive}
              />
            ))}
          </nav>

          {/* ── Right: PC Dashboard + ⋯ ──────────────────────────── */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            {/* PC Dashboard — /login is live */}
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

            {/* ⋯ */}
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
              <svg width="14" height="4" viewBox="0 0 14 4" fill="none" aria-hidden="true">
                <circle cx="2"  cy="2" r="1.4" fill="var(--ds-n-600)" />
                <circle cx="7"  cy="2" r="1.4" fill="var(--ds-n-600)" />
                <circle cx="12" cy="2" r="1.4" fill="var(--ds-n-600)" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      {/* ── Expanded menu ──────────────────────────────────────────── */}
      <ExpandedMenu
        open={menuOpen}
        onClose={closeMenu}
        isDesktop={isDesktop}
        triggerRef={moreRef}
      />

      {/* ── Mobile scrim ───────────────────────────────────────────── */}
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
