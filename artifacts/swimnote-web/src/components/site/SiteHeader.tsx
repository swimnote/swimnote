import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE SAFETY MAP
// Only routes listed here as `live: true` will receive actual navigation.
// ─────────────────────────────────────────────────────────────────────────────
const LIVE_ROUTES = new Set([
  "/",
  "/education",
  "/app",
  "/support",
  "/delete-account",
  "/login",
  "/design-system",
  "/swimnote",
  "/swimnote-x",
  "/swimnote-office",
  "/ai",
  "/technology",
  "/patents",
  "/company",
  "/contact",
  "/download",
  "/terms",
  "/privacy",
]);

function isLiveRoute(href: string): boolean {
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
      { label: "고객센터",         href: "/support"  },
      { label: "앱 설치",          href: "/download" },
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

// ── rect hit-test helper ──────────────────────────────────────────────────────
function pointInRect(rect: DOMRect, x: number, y: number): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

// ── ExpandedMenu ──────────────────────────────────────────────────────────────
//
// CONSTITUTION §3: {menuOpen && <ExpandedMenu>} — AnimatePresence 없음.
// menuOpen=false → 이 컴포넌트 자체가 unmount → DOM 즉시 제거.
// open animation만 motion으로 적용 (close는 즉시 unmount).
//
// CONSTITUTION §5: menu item click = close → navigate 순서.
// NavItem 대신 직접 <a> 핸들러로 close→navigate 강제.
// ─────────────────────────────────────────────────────────────────────────────
interface ExpandedMenuProps {
  onClose: () => void;
  isDesktop: boolean;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  panelRef: React.RefObject<HTMLDivElement | null>;
}

function ExpandedMenu({ onClose, isDesktop, triggerRef, panelRef }: ExpandedMenuProps) {
  const [, navigate] = useLocation();

  // ── On mount: focus first focusable item ─────────────────────────────────
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      if (!panelRef.current) return;
      const items = getFocusable(panelRef.current);
      items[0]?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [panelRef]);

  // ── ESC + Tab focus trap ──────────────────────────────────────────────────
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

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
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last)  { e.preventDefault(); first.focus(); }
      }
    };

    panel.addEventListener("keydown", onKeyDown);
    return () => panel.removeEventListener("keydown", onKeyDown);
  }, [onClose, triggerRef, panelRef]);

  // ── Mobile scroll lock ────────────────────────────────────────────────────
  useEffect(() => {
    if (isDesktop) return;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, [isDesktop]);

  // ── Menu item click handler: CLOSE → NAVIGATE ────────────────────────────
  const handleItemClick = useCallback(
    (href: string): ((e: React.MouseEvent) => void) =>
      (e: React.MouseEvent): void => {
        e.preventDefault();
        onClose(); // panel unmounts immediately (no AnimatePresence delay)
        const [path, hash] = href.split("#");
        navigate(path || "/");
        if (hash) {
          // hash scroll after navigation settles
          requestAnimationFrame(() => {
            window.location.hash = hash;
          });
        }
      },
    [onClose, navigate],
  );

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

  const itemBaseStyle: React.CSSProperties = {
    display: "block",
    padding: "8px 10px",
    marginLeft: -10,
    borderRadius: "var(--ds-radius-sm)",
    fontSize: "var(--ds-text-body-sm)",
    fontWeight: "var(--ds-fw-regular)",
    color: "var(--ds-text-primary)",
    textDecoration: "none",
    transition: "var(--ds-transition-color)",
    cursor: "pointer",
    background: "transparent",
    border: "none",
    fontFamily: "inherit",
    textAlign: "left",
    width: "100%",
    boxSizing: "border-box",
  };

  const inertStyle: React.CSSProperties = {
    ...itemBaseStyle,
    cursor: "default",
    color: "var(--ds-n-300)",
  };

  return (
    <motion.div
      ref={panelRef}
      role="navigation"
      aria-label="사이트 전체 메뉴"
      id="site-expanded-menu"
      style={panelStyle}
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
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
              {group.items.map((item) => {
                const live = isLiveRoute(item.href);
                return (
                  <li key={item.label}>
                    {live ? (
                      <a
                        href={item.href}
                        onClick={handleItemClick(item.href)}
                        style={itemBaseStyle}
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
                      </a>
                    ) : (
                      <span style={inertStyle} aria-disabled="true" title="준비 중">
                        {item.label}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </motion.div>
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
  const [, navigate] = useLocation();

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
    background: "transparent",
    border: "none",
    borderBottomWidth: 2,
    borderBottomStyle: "solid",
    borderBottomColor: active ? "var(--ds-n-900)" : "transparent",
    fontFamily: "inherit",
  };

  if (live) {
    return (
      <a
        href={href}
        onClick={e => { e.preventDefault(); navigate(href); }}
        style={style}
        translate="no"
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "var(--ds-n-700)"; }}
        onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.color = tabInactive; }}
      >
        {label}
      </a>
    );
  }

  return (
    <span style={style} translate="no" title="준비 중" aria-disabled="true">
      {label}
    </span>
  );
}

// ── SiteHeader ────────────────────────────────────────────────────────────────
//
// CONSTITUTION §4: 단일 closeMegaMenu 함수 — 모든 dismiss trigger가 이것만 호출.
// CONSTITUTION §3: {menuOpen && <ExpandedMenu>} — AnimatePresence 없음.
// CONSTITUTION §6: useLocation 변화 → closeMegaMenu (stable callback, no loop).
// CONSTITUTION §7: hashchange → closeMegaMenu.
// CONSTITUTION §9: pointerdown outside → 즉시 closeMegaMenu (no setTimeout).
// CONSTITUTION §10: menuOpen=false cleanup → 모든 listener/timer 제거.
// ─────────────────────────────────────────────────────────────────────────────
export default function SiteHeader() {
  const [location, navigate] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const isDesktop  = useIsDesktopNav();
  const moreRef    = useRef<HTMLButtonElement>(null);
  const headerRef  = useRef<HTMLElement>(null);
  const panelRef   = useRef<HTMLDivElement>(null);
  const timerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── SINGLE close function — all dismiss triggers use only this ────────────
  const closeMegaMenu = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setMenuOpen(false);
  }, []);

  const toggleMenu = useCallback(() => {
    setMenuOpen(v => !v);
  }, []);

  // ── CONSTITUTION §6: Route change → immediate close ──────────────────────
  // closeMegaMenu is stable (useCallback, no deps), so this effect does NOT
  // re-subscribe on every render — only when location changes.
  useEffect(() => {
    closeMegaMenu();
  }, [location, closeMegaMenu]);

  // ── CONSTITUTION §7: Hash navigation → close ─────────────────────────────
  useEffect(() => {
    if (!menuOpen) return;
    window.addEventListener("hashchange", closeMegaMenu);
    return () => window.removeEventListener("hashchange", closeMegaMenu);
  }, [menuOpen, closeMegaMenu]);

  // ── Browser back/forward → close ─────────────────────────────────────────
  useEffect(() => {
    if (!menuOpen) return;
    window.addEventListener("popstate", closeMegaMenu);
    return () => window.removeEventListener("popstate", closeMegaMenu);
  }, [menuOpen, closeMegaMenu]);

  // ── CONSTITUTION §9: Global pointerdown → immediate close if outside ─────
  // No setTimeout delay — body mousedown must close instantly.
  useEffect(() => {
    if (!menuOpen) return;

    const handleDown = (e: PointerEvent) => {
      const x = e.clientX;
      const y = e.clientY;
      const headerRect = headerRef.current?.getBoundingClientRect();
      const panelRect  = panelRef.current?.getBoundingClientRect();

      const inHeader = headerRect ? pointInRect(headerRect, x, y) : false;
      const inPanel  = panelRect  ? pointInRect(panelRect,  x, y) : false;

      if (!inHeader && !inPanel) {
        closeMegaMenu();
      }
    };

    document.addEventListener("pointerdown", handleDown, { capture: true });
    return () => document.removeEventListener("pointerdown", handleDown, { capture: true });
  }, [menuOpen, closeMegaMenu]);

  // ── Desktop: pointermove coord-based hover-leave (100ms delay) ───────────
  // Schedules close when pointer is outside both header and panel rects.
  // idempotent: once timer is running, successive moves don't reset it.
  useEffect(() => {
    if (!menuOpen || !isDesktop) return;

    const handleMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;

      const x = e.clientX;
      const y = e.clientY;
      const headerRect = headerRef.current?.getBoundingClientRect();
      const panelRect  = panelRef.current?.getBoundingClientRect();

      const inHeader = headerRect ? pointInRect(headerRect, x, y) : false;
      const inPanel  = panelRect  ? pointInRect(panelRect,  x, y) : false;

      if (inHeader || inPanel) {
        // Back inside — cancel any pending close
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
      } else {
        // Outside — schedule close (idempotent)
        if (!timerRef.current) {
          timerRef.current = setTimeout(() => {
            timerRef.current = null;
            setMenuOpen(false);
          }, 100);
        }
      }
    };

    document.addEventListener("pointermove", handleMove, { passive: true });
    return () => {
      document.removeEventListener("pointermove", handleMove);
      // Clean up timer on effect teardown (menuOpen→false or isDesktop change)
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [menuOpen, isDesktop]);

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const isActive = (href: string) => location === href || location.startsWith(href + "/");

  const tabActive   = "var(--ds-n-900)";
  const tabInactive = "var(--ds-n-400)";

  return (
    <>
      <header
        ref={headerRef}
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
          {/* ── Logo ──────────────────────────────────────────────── */}
          <a
            href="/"
            onClick={e => { e.preventDefault(); navigate("/"); }}
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
          </a>

          {/* ── Product tabs ──────────────────────────────────────── */}
          <nav
            aria-label="제품 메뉴"
            style={{
              flex: 1,
              minWidth: 0,          /* ← 필수: flex child가 right 영역 침범 방지 */
              display: "flex",
              alignItems: "center",
              justifyContent: isDesktop ? "center" : "flex-start",
              overflowX: isDesktop ? "visible" : "auto",
              overflowY: "hidden",
              scrollbarWidth: "none",
              msOverflowStyle: "none",
              WebkitOverflowScrolling: "touch",
              gap: 0,
              maskImage: isDesktop
                ? "none"
                : "linear-gradient(to right, transparent 0px, black 8px, black calc(100% - 8px), transparent 100%)",
              WebkitMaskImage: isDesktop
                ? "none"
                : "linear-gradient(to right, transparent 0px, black 8px, black calc(100% - 8px), transparent 100%)",
              padding: isDesktop ? "0 20px" : "0 4px",
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
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  height: 30,
                  padding: "0 13px",
                  borderRadius: "var(--ds-radius-pill)",
                  background: "var(--ds-n-200)",
                  color: "var(--ds-n-500)",
                  fontSize: 12,
                  fontWeight: "var(--ds-fw-medium)",
                  whiteSpace: "nowrap",
                  letterSpacing: "-0.005em",
                  cursor: "default",
                  userSelect: "none",
                }}
                aria-disabled="true"
              >
                {isDesktop ? "PC 대시보드" : "PC"}
              </span>
              <span style={{ fontSize: 9, color: "var(--ds-n-400)", letterSpacing: "0.02em", lineHeight: 1 }}>
                준비 중
              </span>
            </div>

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

      {/* ── CONSTITUTION §3: {menuOpen && ...} — AnimatePresence 없음 ──────── */}
      {/* menuOpen=false → 즉시 unmount → DOM 즉시 제거. Exit animation 없음. */}
      {menuOpen && (
        <ExpandedMenu
          onClose={closeMegaMenu}
          isDesktop={isDesktop}
          triggerRef={moreRef}
          panelRef={panelRef}
        />
      )}

      {/* ── Mobile scrim — Desktop에서는 절대 렌더링 안 됨 ─────────── */}
      {menuOpen && !isDesktop && (
        <div
          onClick={closeMegaMenu}
          aria-hidden="true"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 48,
            background: "rgba(0,0,0,0.18)",
          }}
        />
      )}
    </>
  );
}
