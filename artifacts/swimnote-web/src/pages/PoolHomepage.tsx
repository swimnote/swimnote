import { useState, useEffect, useRef, useCallback } from "react";
import { useRoute } from "wouter";
import { PoolModeContext } from "@/contexts/PoolModeContext";
import Intro from "./Intro";
import Education from "./Education";
import AppPage from "./AppPage";

interface PoolData {
  id: string;
  name: string;
  theme_color: string | null;
  logo_url: string | null;
}

const SWIMNOTE_PRIMARY = "#002F5F";
const SWIMNOTE_SECONDARY = "#01B2F1";

type TabId = "intro" | "education" | "app";

const tabs: { id: TabId; label: string; highlight?: boolean }[] = [
  { id: "intro", label: "소개" },
  { id: "education", label: "교육시스템" },
  { id: "app", label: "스윔노트 앱", highlight: true },
];

export default function PoolHomepage() {
  const [, params] = useRoute("/:slug");
  const slug = params?.slug ?? "";

  const [pool, setPool] = useState<PoolData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("intro");
  const contentRef = useRef<HTMLDivElement>(null);

  const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  useEffect(() => {
    if (!slug) return;
    (async () => {
      try {
        const res = await fetch(`/api/pools/by-slug/${slug}`);
        if (res.status === 404) { setNotFound(true); setLoading(false); return; }
        if (!res.ok) { setNotFound(true); setLoading(false); return; }
        const data = await res.json();
        setPool(data);
      } catch { setNotFound(true); }
      finally { setLoading(false); }
    })();
  }, [slug]);

  const handleTabChange = useCallback((id: TabId) => {
    setActiveTab(id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  // 모든 내부 링크 차단 + 탭 전환 처리
  useEffect(() => {
    const intercept = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest("a");
      if (!a) return;
      if (a.target === "_blank") return;
      const href = a.href ?? "";
      if (href.startsWith("tel:") || href.startsWith("mailto:")) return;
      e.preventDefault();
      e.stopPropagation();
      try {
        const path = new URL(href).pathname;
        if (path.endsWith("/education")) handleTabChange("education");
        else if (path.endsWith("/app")) handleTabChange("app");
      } catch { /* 무시 */ }
    };
    document.addEventListener("click", intercept, true);
    return () => document.removeEventListener("click", intercept, true);
  }, [handleTabChange]);

  // 뒤로가기 차단
  useEffect(() => {
    window.history.pushState(null, "", window.location.href);
    const preventBack = () => window.history.pushState(null, "", window.location.href);
    window.addEventListener("popstate", preventBack);
    return () => window.removeEventListener("popstate", preventBack);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-full border-2 border-[#002F5F] border-t-transparent animate-spin" />
          <span className="text-[13px] text-[#aaa]">불러오는 중...</span>
        </div>
      </div>
    );
  }

  if (notFound || !pool) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-white px-4">
        <div className="text-center">
          <div className="text-7xl mb-6">🏊</div>
          <h1 className="text-[22px] font-bold text-[#0a0a0a] mb-2">홈페이지를 찾을 수 없습니다</h1>
          <p className="text-[14px] text-[#888] mb-8">주소를 다시 확인하거나 수영장에 문의해주세요.</p>
          <a
            href={BASE + "/"}
            className="px-6 py-3 rounded-xl text-white text-[13px] font-semibold hover:opacity-85 transition-opacity inline-block"
            style={{ background: SWIMNOTE_PRIMARY }}
          >
            SWIMNOTE 홈으로
          </a>
        </div>
      </div>
    );
  }

  const primary = pool.theme_color || SWIMNOTE_PRIMARY;

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* ── Nav ──────────────────────────────────────────────── */}
      <header
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
          scrolled ? "bg-white/96 backdrop-blur-md border-b border-[#e8e8e8]" : "bg-white"
        }`}
      >
        <div className="max-w-6xl mx-auto px-3 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-2">
          {/* Logo */}
          <button
            onClick={() => { setActiveTab("intro"); window.scrollTo({ top: 0, behavior: "smooth" }); }}
            className="shrink-0 flex items-center"
          >
            <img
              src={`${BASE}/logo.png`}
              alt="SWIMNOTE"
              className="h-8 sm:h-10 w-auto object-contain"
              onError={e => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
                (e.currentTarget.nextSibling as HTMLElement | null)?.setAttribute("style", "display:block");
              }}
            />
            <span
              className="hidden text-[18px] font-black tracking-tight"
              style={{ color: SWIMNOTE_PRIMARY }}
              translate="no"
            >
              SWIMNOTE
            </span>
          </button>

          {/* Nav tabs */}
          <nav className="flex items-center gap-0.5 sm:gap-1 overflow-x-auto scrollbar-none">
            {/* Pool name tab — always first, always highlighted */}
            <button
              onClick={() => handleTabChange("intro")}
              className="px-2 sm:px-4 py-1.5 sm:py-2 rounded-full text-[11px] sm:text-[13.5px] font-semibold whitespace-nowrap transition-all duration-150"
              style={{ background: primary, color: "#fff" }}
            >
              {pool.name}
            </button>

            {/* 소개 / 교육시스템 / 스윔노트 앱 */}
            {tabs.map(t => {
              const active = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => handleTabChange(t.id)}
                  className={`px-2 sm:px-4 py-1.5 sm:py-2 rounded-full text-[11px] sm:text-[13.5px] font-medium whitespace-nowrap transition-all duration-150 ${
                    active ? "text-white" : "text-[#555] hover:text-[#0a0a0a] hover:bg-[#f4f4f4]"
                  }`}
                  style={
                    active
                      ? { background: t.highlight ? SWIMNOTE_SECONDARY : SWIMNOTE_PRIMARY }
                      : t.highlight
                      ? { color: SWIMNOTE_SECONDARY }
                      : {}
                  }
                >
                  {t.label}
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      {/* ── Page content ─────────────────────────────────────── */}
      <PoolModeContext.Provider value={true}>
        <main ref={contentRef} className="flex-1 pt-14 sm:pt-16">
          {activeTab === "intro" && <Intro />}
          {activeTab === "education" && <Education />}
          {activeTab === "app" && <AppPage />}
        </main>
      </PoolModeContext.Provider>
    </div>
  );
}
