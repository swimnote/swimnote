import { useState, useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import { Phone, MapPin } from "lucide-react";
import { motion } from "framer-motion";

interface PoolData {
  id: string;
  name: string;
  address: string;
  phone: string;
  owner_name: string;
  theme_color: string | null;
  logo_url: string | null;
  logo_emoji: string | null;
  introduction: string | null;
  tuition_info: string | null;
  level_test_info: string | null;
  event_info: string | null;
  equipment_info: string | null;
}

const SWIMNOTE_PRIMARY = "#002F5F";
const SWIMNOTE_SECONDARY = "#01B2F1";

const inView = (delay = 0) => ({
  initial: { opacity: 0, y: 20 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-40px" },
  transition: { duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] },
});

function InfoCard({ icon, title, content, color }: { icon: string; title: string; content: string; color: string }) {
  return (
    <motion.div {...inView(0.1)} className="bg-white rounded-2xl border border-[#ebebeb] p-7">
      <div className="flex items-center gap-3 mb-5">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center text-[20px]"
          style={{ background: color + "18" }}
        >
          {icon}
        </div>
        <h3 className="text-[16px] font-bold text-[#0a0a0a]">{title}</h3>
      </div>
      <p className="text-[14px] text-[#444] leading-relaxed whitespace-pre-wrap">{content}</p>
    </motion.div>
  );
}

export default function PoolHomepage() {
  const [, params] = useRoute("/:slug");
  const [, navigate] = useLocation();
  const slug = params?.slug ?? "";

  const [pool, setPool] = useState<PoolData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [scrolled, setScrolled] = useState(false);

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
        setPool(await res.json());
      } catch { setNotFound(true); }
      finally { setLoading(false); }
    })();
  }, [slug, BASE]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f8f9fb]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-full border-2 border-[#002F5F] border-t-transparent animate-spin" />
          <span className="text-[13px] text-[#aaa]">불러오는 중...</span>
        </div>
      </div>
    );
  }

  if (notFound || !pool) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#f8f9fb] px-4">
        <div className="text-center">
          <div className="text-7xl mb-6">🏊</div>
          <h1 className="text-[22px] font-bold text-[#0a0a0a] mb-2">홈페이지를 찾을 수 없습니다</h1>
          <p className="text-[14px] text-[#888] mb-8">주소를 다시 확인하거나 수영장에 문의해주세요.</p>
          <button
            onClick={() => navigate("/")}
            className="px-6 py-3 rounded-xl text-white text-[13px] font-semibold hover:opacity-85 transition-opacity"
            style={{ background: SWIMNOTE_PRIMARY }}
          >
            SWIMNOTE 홈으로
          </button>
        </div>
      </div>
    );
  }

  const primary = pool.theme_color || SWIMNOTE_PRIMARY;

  const sections = [
    { key: "introduction", icon: "🏊", title: "수영장 소개", content: pool.introduction },
    { key: "tuition_info", icon: "💰", title: "수강료 안내", content: pool.tuition_info },
    { key: "level_test_info", icon: "🏅", title: "레벨 테스트", content: pool.level_test_info },
    { key: "event_info", icon: "🎉", title: "이벤트 안내", content: pool.event_info },
    { key: "equipment_info", icon: "🩱", title: "준비물 안내", content: pool.equipment_info },
  ].filter(s => !!s.content);

  const mainNavLinks = [
    { label: "소개", href: "/" },
    { label: "교육시스템", href: "/education" },
    { label: "스윔노트 앱", href: "/app", highlight: true },
  ];

  return (
    <div className="min-h-screen bg-[#f8f9fb]">
      {/* ── Nav ─────────────────────────────────────────────── */}
      <header className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${scrolled ? "bg-white/96 backdrop-blur-md border-b border-[#e8e8e8]" : "bg-white"}`}>
        <div className="max-w-6xl mx-auto px-3 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-2">
          {/* Logo */}
          <button onClick={() => navigate("/")} className="shrink-0 flex items-center">
            <img
              src={`${BASE}/logo.png`}
              alt="SWIMNOTE"
              className="h-8 sm:h-10 w-auto object-contain"
              onError={e => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
                (e.currentTarget.nextSibling as HTMLElement | null)?.style && ((e.currentTarget.nextSibling as HTMLElement).style.display = "block");
              }}
            />
            <span className="hidden text-[18px] font-black tracking-tight" style={{ color: SWIMNOTE_PRIMARY }} translate="no">SWIMNOTE</span>
          </button>

          {/* Nav links */}
          <nav className="flex items-center gap-0.5 sm:gap-1 overflow-x-auto scrollbar-none">
            {/* Pool name tab — first, active */}
            <button
              className="px-2 sm:px-4 py-1.5 sm:py-2 rounded-full text-[11px] sm:text-[13.5px] font-medium whitespace-nowrap text-white"
              style={{ background: primary }}
            >
              {pool.name}
            </button>

            {/* Main site tabs */}
            {mainNavLinks.map(l => (
              <button
                key={l.label}
                onClick={() => navigate(l.href)}
                className="px-2 sm:px-4 py-1.5 sm:py-2 rounded-full text-[11px] sm:text-[13.5px] font-medium whitespace-nowrap text-[#555] hover:text-[#0a0a0a] hover:bg-[#f4f4f4] transition-all duration-150"
                style={l.highlight ? { color: SWIMNOTE_SECONDARY } : {}}
              >
                {l.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      {/* ── Hero ────────────────────────────────────────────── */}
      <div
        className="relative overflow-hidden pt-14 sm:pt-16"
        style={{ background: `linear-gradient(135deg, ${primary} 0%, ${primary}bb 100%)` }}
      >
        {/* Subtle radial glow */}
        <div
          className="absolute inset-0 opacity-15 pointer-events-none"
          style={{ backgroundImage: "radial-gradient(ellipse at 70% 40%, white 0%, transparent 65%)" }}
        />
        {/* Wave bottom */}
        <div className="absolute bottom-0 left-0 right-0">
          <svg viewBox="0 0 1440 60" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full">
            <path d="M0 60L60 50C120 40 240 20 360 15C480 10 600 20 720 30C840 40 960 50 1080 50C1200 50 1320 40 1380 35L1440 30V60H0Z" fill="#f8f9fb" />
          </svg>
        </div>

        <div className="relative max-w-4xl mx-auto px-6 py-16 sm:py-20 text-white">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-8">
            <div>
              {/* Logo / Emoji */}
              <div className="mb-6">
                {pool.logo_emoji ? (
                  <span className="text-6xl">{pool.logo_emoji}</span>
                ) : pool.logo_url ? (
                  <img src={pool.logo_url} alt="로고" className="w-20 h-20 rounded-2xl object-cover shadow-lg" />
                ) : (
                  <div
                    className="w-20 h-20 rounded-2xl flex items-center justify-center text-[36px]"
                    style={{ background: "rgba(255,255,255,0.2)", backdropFilter: "blur(8px)" }}
                  >
                    🏊
                  </div>
                )}
              </div>
              <h1 className="text-[32px] sm:text-[40px] font-black mb-3 tracking-tight leading-tight">{pool.name}</h1>
              <div className="flex flex-col gap-2 text-[13px] opacity-90">
                <div className="flex items-center gap-2">
                  <MapPin size={13} className="opacity-70 flex-shrink-0" />
                  <span>{pool.address}</span>
                </div>
                {pool.phone && (
                  <div className="flex items-center gap-2">
                    <Phone size={13} className="opacity-70 flex-shrink-0" />
                    <a href={`tel:${pool.phone}`} className="hover:underline">{pool.phone}</a>
                  </div>
                )}
              </div>
            </div>

            {/* Contact CTA */}
            {pool.phone && (
              <a
                href={`tel:${pool.phone}`}
                className="inline-flex items-center gap-2 px-6 py-3.5 rounded-2xl text-[14px] font-bold shadow-lg transition-opacity hover:opacity-85 self-start sm:self-auto shrink-0"
                style={{ background: "rgba(255,255,255,0.2)", border: "1.5px solid rgba(255,255,255,0.4)" }}
              >
                <Phone size={15} />
                전화 문의
              </a>
            )}
          </div>
        </div>
      </div>

      {/* ── Sticky mini-bar ──────────────────────────────────── */}
      <div className="bg-white border-b border-[#ebebeb]">
        <div className="max-w-4xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
          <p className="text-[12px] font-semibold text-[#888] truncate">
            SWIMNOTE 제휴 수영장
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
            <span className="text-[11px] text-[#888]">운영 중</span>
          </div>
        </div>
      </div>

      {/* ── Content sections ─────────────────────────────────── */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12 space-y-4">
        {sections.length === 0 ? (
          <div className="bg-white rounded-2xl border border-[#ebebeb] p-16 text-center">
            <p className="text-5xl mb-4">🏊</p>
            <p className="text-[15px] font-semibold text-[#555] mb-2">준비 중입니다</p>
            <p className="text-[13px] text-[#aaa]">수영장 정보가 곧 업데이트될 예정입니다.</p>
          </div>
        ) : (
          sections.map((s, i) => (
            <motion.div key={s.key} {...inView(i * 0.08)}>
              <InfoCard icon={s.icon} title={s.title} content={s.content!} color={primary} />
            </motion.div>
          ))
        )}
      </div>

      {/* ── SWIMNOTE badge ───────────────────────────────────── */}
      <div className="max-w-4xl mx-auto px-6 pb-4">
        <div
          className="rounded-2xl p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
          style={{ background: `${SWIMNOTE_PRIMARY}08`, border: `1px solid ${SWIMNOTE_PRIMARY}18` }}
        >
          <div>
            <p className="text-[12px] font-bold text-[#002F5F] mb-1">SWIMNOTE 교육 시스템 도입 수영장</p>
            <p className="text-[12px] text-[#555]">체계적인 수영 교육 시스템과 앱으로 학습 과정을 투명하게 공유합니다.</p>
          </div>
          <button
            onClick={() => navigate("/education")}
            className="px-5 py-2.5 rounded-xl text-white text-[12px] font-bold whitespace-nowrap hover:opacity-85 transition-opacity shrink-0"
            style={{ background: SWIMNOTE_PRIMARY }}
          >
            교육시스템 보기
          </button>
        </div>
      </div>

      {/* ── Footer ──────────────────────────────────────────── */}
      <footer className="max-w-4xl mx-auto px-6 py-8 flex items-center justify-between gap-4 border-t border-[#ebebeb] mt-4">
        <button onClick={() => navigate("/")} className="flex items-center gap-2 hover:opacity-70 transition-opacity">
          <img
            src={`${BASE}/logo.png`}
            alt="SWIMNOTE"
            className="h-6 w-auto object-contain"
            onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
          <span className="text-[11px] font-bold text-[#aaa]" translate="no">SWIMNOTE</span>
        </button>
        <p className="text-[11px] text-[#ccc]">Powered by SWIMNOTE</p>
      </footer>
    </div>
  );
}
