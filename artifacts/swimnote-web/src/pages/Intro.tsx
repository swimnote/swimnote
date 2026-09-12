import { useRef } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import { Link } from "wouter";

// ── 색상 ─────────────────────────────────────────────────────────────────────
const NAVY  = "#0A1628";   // SwimNote X 네이비
const BLUE  = "#01B2F1";   // 시안 액센트
const DARK  = "#1d1d1f";   // Apple 다크
const GRAY  = "#6e6e73";   // Apple 그레이
const LIGHT = "#f5f5f7";   // Apple 카드 배경

// ── 인뷰 애니메이션 ──────────────────────────────────────────────────────────
const inView = (delay = 0, y = 28) => ({
  initial: { opacity: 0, y },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-60px" },
  transition: { duration: 0.75, delay, ease: [0.22, 1, 0.36, 1] },
});

// ── 제품 카드 데이터 ─────────────────────────────────────────────────────────
const products = [
  {
    label: "스윔노트 앱",
    title: "수영장 관리의\n모든 것.",
    sub: "출결, 일지, 학부모 소통까지 하나의 앱으로.",
    img: "app-teacher.jpeg",
    cta: [{ text: "앱 소개", href: "/app" }],
    dark: false,
    wide: true,
  },
  {
    label: "SWIMNOTE X",
    title: "프리미엄\n수영장 경험.",
    sub: "AI 분석과 성장 리포트로 차별화된 가치를 제공합니다.",
    img: "app-admin.jpeg",
    cta: [{ text: "X 소개", href: "/app" }],
    dark: true,
    wide: false,
  },
  {
    label: "성장 리포트",
    title: "AI가 쓰는\n성장 이야기.",
    sub: "매달 학생 한 명 한 명의 성장을 AI가 분석하고 기록합니다.",
    img: "education-growth.png",
    cta: [{ text: "더 알아보기", href: "/app" }],
    dark: false,
    wide: false,
  },
  {
    label: "교육시스템",
    title: "DTA 기반\n수영 교육.",
    sub: "Direction · Timing · Advance. 수영을 과정으로 설명합니다.",
    img: "education-overview.png",
    cta: [{ text: "교육시스템", href: "/education" }],
    dark: true,
    wide: false,
  },
  {
    label: "수업 관리",
    title: "수업, 출결,\n보강까지.",
    sub: "반 편성부터 보강 배정까지 클릭 몇 번으로 해결합니다.",
    img: "education-field.png",
    cta: [{ text: "앱 보기", href: "/app" }],
    dark: false,
    wide: false,
  },
  {
    label: "학부모 앱",
    title: "부모가 함께\n성장을 봅니다.",
    sub: "수업 일지, 출석, 성장 리포트를 학부모 앱으로 공유합니다.",
    img: "app-parent.png",
    cta: [{ text: "앱 소개", href: "/app" }],
    dark: true,
    wide: false,
  },
];

// ── 컴포넌트: 제품 카드 ──────────────────────────────────────────────────────
function ProductCard({ p, delay = 0 }: { p: typeof products[0]; delay?: number }) {
  return (
    <motion.div
      {...inView(delay)}
      className="relative rounded-[28px] overflow-hidden flex flex-col"
      style={{
        background: p.dark ? NAVY : "#fff",
        minHeight: p.wide ? 560 : 480,
      }}
    >
      {/* 이미지 */}
      <div className="absolute inset-0">
        <img
          src={`${import.meta.env.BASE_URL}${p.img}`}
          alt={p.title.replace("\n", " ")}
          className="w-full h-full object-cover"
          style={{ opacity: p.dark ? 0.30 : 0.18 }}
        />
        <div
          className="absolute inset-0"
          style={{
            background: p.dark
              ? `linear-gradient(180deg, ${NAVY} 0%, transparent 60%, ${NAVY} 100%)`
              : "linear-gradient(180deg, #fff 0%, transparent 55%, #fff 100%)",
          }}
        />
      </div>

      {/* 콘텐츠 */}
      <div className="relative z-10 flex flex-col justify-between h-full p-8 lg:p-10" style={{ minHeight: p.wide ? 560 : 480 }}>
        <div>
          <p
            className="text-[12px] font-semibold tracking-[0.1em] uppercase mb-4"
            style={{ color: p.dark ? BLUE : BLUE }}
          >
            {p.label}
          </p>
          <h2
            className="text-[28px] lg:text-[36px] font-bold tracking-tight leading-[1.15] mb-3 whitespace-pre-line"
            style={{ color: p.dark ? "#f5f5f7" : DARK }}
          >
            {p.title}
          </h2>
          <p
            className="text-[14px] leading-[1.75] max-w-xs"
            style={{ color: p.dark ? "rgba(245,245,247,0.65)" : GRAY }}
          >
            {p.sub}
          </p>
        </div>

        <div className="flex gap-4 mt-6">
          {p.cta.map((c) => (
            <Link key={c.text} href={c.href}>
              <span
                className="text-[13px] font-medium flex items-center gap-1 cursor-pointer transition-opacity hover:opacity-70"
                style={{ color: BLUE }}
              >
                {c.text}
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2.5 6H9.5M6.5 3.5L9.5 6L6.5 8.5" stroke={BLUE} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </span>
            </Link>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

// ── 메인 컴포넌트 ────────────────────────────────────────────────────────────
export default function Intro() {
  const heroRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ["start start", "end start"] });
  const heroImgY   = useTransform(scrollYProgress, [0, 1], [0, 80]);
  const heroImgOp  = useTransform(scrollYProgress, [0, 0.6], [1, 0]);
  const heroTextY  = useTransform(scrollYProgress, [0, 1], [0, -40]);
  const heroTextOp = useTransform(scrollYProgress, [0, 0.4], [1, 0]);

  return (
    <div style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Pretendard', sans-serif" }}>

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section
        ref={heroRef}
        className="relative flex flex-col items-center justify-center overflow-hidden"
        style={{ minHeight: "100svh", background: "#000" }}
      >
        {/* 배경 그라디언트 */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `radial-gradient(ellipse 80% 60% at 50% 40%, rgba(1,178,241,0.12) 0%, transparent 70%)`,
          }}
        />

        {/* 텍스트 블록 */}
        <motion.div
          style={{ y: heroTextY, opacity: heroTextOp }}
          className="relative z-10 flex flex-col items-center text-center px-6"
        >
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
            className="text-[13px] font-medium tracking-[0.18em] uppercase mb-6"
            style={{ color: BLUE }}
            translate="no"
          >
            SWIMNOTE
          </motion.p>

          <motion.h1
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="font-bold tracking-tight leading-[1.05] text-white mb-5"
            style={{ fontSize: "clamp(52px, 10vw, 108px)" }}
          >
            수영 교육의<br />새로운 기준.
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.85, delay: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="text-[17px] md:text-[20px] font-light mb-10 max-w-md leading-[1.65]"
            style={{ color: "rgba(245,245,247,0.72)" }}
          >
            수업부터 성장기록까지.<br />하나의 시스템으로 연결합니다.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="flex flex-col sm:flex-row gap-3"
          >
            <Link href="/app">
              <span
                className="inline-flex items-center justify-center px-6 py-2.5 rounded-full text-[14px] font-medium cursor-pointer transition-opacity hover:opacity-85"
                style={{ background: BLUE, color: "#fff" }}
                translate="no"
              >
                스윔노트 앱 알아보기
              </span>
            </Link>
            <Link href="/support">
              <span
                className="inline-flex items-center justify-center px-6 py-2.5 rounded-full text-[14px] font-medium cursor-pointer transition-colors"
                style={{
                  background: "rgba(255,255,255,0.10)",
                  color: "rgba(255,255,255,0.88)",
                  border: "1px solid rgba(255,255,255,0.16)",
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.18)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.10)"; }}
              >
                도입 문의
              </span>
            </Link>
          </motion.div>
        </motion.div>

        {/* 앱 목업 이미지 */}
        <motion.div
          style={{ y: heroImgY, opacity: heroImgOp }}
          initial={{ opacity: 0, y: 40, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 1.1, delay: 0.55, ease: [0.22, 1, 0.36, 1] }}
          className="relative z-10 mt-14 px-6 w-full max-w-3xl mx-auto"
        >
          <div
            className="rounded-[32px] overflow-hidden"
            style={{
              boxShadow: "0 40px 80px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.06)",
            }}
          >
            <img
              src={`${import.meta.env.BASE_URL}app-teacher.jpeg`}
              alt="스윔노트 앱 화면"
              className="w-full h-auto block"
              style={{ maxHeight: 420, objectFit: "cover", objectPosition: "top" }}
            />
          </div>
          {/* 하단 페이드 */}
          <div
            className="absolute bottom-0 left-0 right-0 h-32 pointer-events-none"
            style={{ background: "linear-gradient(transparent, #000)" }}
          />
        </motion.div>

        {/* 스크롤 힌트 */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.4, duration: 0.8 }}
          className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1.5"
          style={{ color: "rgba(255,255,255,0.28)" }}
        >
          <span className="text-[10px] tracking-[0.15em] uppercase font-medium">Scroll</span>
          <motion.div
            animate={{ y: [0, 5, 0] }}
            transition={{ repeat: Infinity, duration: 1.6, ease: "easeInOut" }}
          >
            <svg width="16" height="10" viewBox="0 0 16 10" fill="none">
              <path d="M1 1L8 8L15 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </motion.div>
        </motion.div>
      </section>

      {/* ── 제품 그리드 ─────────────────────────────────────────────────── */}
      <section
        className="py-4 px-4 md:px-6"
        style={{ background: LIGHT }}
      >
        <div className="max-w-[1200px] mx-auto">

          {/* 상단 와이드 카드 */}
          <div className="mb-3">
            <ProductCard p={products[0]} delay={0} />
          </div>

          {/* 2열 그리드 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            <ProductCard p={products[1]} delay={0.05} />
            <ProductCard p={products[2]} delay={0.1} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            <ProductCard p={products[3]} delay={0.05} />
            <ProductCard p={products[4]} delay={0.1} />
          </div>

          {/* 하단 와이드 카드 */}
          <div className="mb-4">
            <ProductCard p={products[5]} delay={0} />
          </div>
        </div>
      </section>

      {/* ── Feature: 브랜드 철학 ─────────────────────────────────────────── */}
      <section
        className="py-28 px-6"
        style={{ background: "#000" }}
      >
        <div className="max-w-[980px] mx-auto text-center">
          <motion.p
            {...inView(0)}
            className="text-[12px] font-semibold tracking-[0.15em] uppercase mb-6"
            style={{ color: BLUE }}
          >
            Brand Philosophy
          </motion.p>
          <motion.h2
            {...inView(0.08)}
            className="font-bold tracking-tight leading-[1.1] text-white mb-6"
            style={{ fontSize: "clamp(36px, 6vw, 72px)" }}
          >
            수영은 감각으로<br />설명하지 않습니다.
          </motion.h2>
          <motion.p
            {...inView(0.16)}
            className="text-[22px] font-light"
            style={{ color: "rgba(245,245,247,0.55)" }}
          >
            수영을{" "}
            <span style={{ color: "#f5f5f7", fontWeight: 500 }}>과정</span>
            으로 설명합니다.
          </motion.p>
        </div>
      </section>

      {/* ── Feature: DTA ──────────────────────────────────────────────────── */}
      <section
        className="py-24 px-6"
        style={{ background: LIGHT }}
      >
        <div className="max-w-[980px] mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <motion.div {...inView(0)}>
              <p
                className="text-[12px] font-semibold tracking-[0.15em] uppercase mb-5"
                style={{ color: BLUE }}
                translate="no"
              >
                DTA Framework
              </p>
              <h2
                className="font-bold tracking-tight leading-[1.1] mb-5"
                style={{ fontSize: "clamp(36px, 5vw, 56px)", color: DARK }}
                translate="no"
              >
                DTA.
              </h2>
              <p
                className="text-[16px] leading-[1.8] mb-10"
                style={{ color: GRAY }}
              >
                SWIMNOTE 교육의 기반 프레임워크입니다.<br />
                수영 영법을 설명하고 구조화하기 위한 기준으로,<br />
                교육의 방향을 제공합니다.
              </p>
              <div className="space-y-6">
                {[
                  { letter: "D", word: "DIRECTION",  desc: "수영 영법이 어떤 방향으로 움직여야 하는지를 구조화합니다." },
                  { letter: "T", word: "TIMING",     desc: "힘을 언제, 어떤 순서로 사용해야 하는지를 설명합니다." },
                  { letter: "A", word: "ADVANCE",    desc: "저항을 줄이고 앞으로 이동하는 과정을 설명합니다." },
                ].map((item, i) => (
                  <motion.div key={i} {...inView(0.1 + i * 0.09)} className="flex gap-4 items-start">
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center text-[16px] font-bold shrink-0"
                      style={{ background: NAVY, color: BLUE }}
                      translate="no"
                    >
                      {item.letter}
                    </div>
                    <div>
                      <p className="text-[12px] font-bold tracking-widest mb-1" style={{ color: DARK }} translate="no">
                        {item.word}
                      </p>
                      <p className="text-[14px] leading-[1.7]" style={{ color: GRAY }}>
                        {item.desc}
                      </p>
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, scale: 0.94 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 1, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
              className="relative"
            >
              <div
                className="absolute -inset-8 rounded-[56px] blur-3xl -z-10"
                style={{ background: "radial-gradient(circle, rgba(1,178,241,0.15) 0%, transparent 70%)" }}
              />
              <div
                className="rounded-[28px] overflow-hidden"
                style={{ boxShadow: "0 24px 60px rgba(10,22,40,0.12)" }}
              >
                <img
                  src={`${import.meta.env.BASE_URL}education-level.png`}
                  alt="DTA 교육 체계"
                  className="w-full h-auto block"
                />
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ── Feature: SWIMNOTE X 강조 ─────────────────────────────────────── */}
      <section
        className="py-28 px-6 overflow-hidden"
        style={{ background: NAVY }}
      >
        <div className="max-w-[980px] mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <motion.div
              initial={{ opacity: 0, scale: 0.94 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
              className="relative order-2 lg:order-1"
            >
              <div
                className="absolute -inset-8 rounded-[56px] blur-3xl -z-10"
                style={{ background: "radial-gradient(circle, rgba(1,178,241,0.20) 0%, transparent 70%)" }}
              />
              <div
                className="rounded-[28px] overflow-hidden"
                style={{ boxShadow: "0 24px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(1,178,241,0.12)" }}
              >
                <img
                  src={`${import.meta.env.BASE_URL}app-admin.jpeg`}
                  alt="SWIMNOTE X"
                  className="w-full h-auto block"
                />
              </div>
            </motion.div>

            <motion.div {...inView(0)} className="order-1 lg:order-2">
              <p
                className="text-[12px] font-semibold tracking-[0.15em] uppercase mb-5"
                style={{ color: BLUE }}
                translate="no"
              >
                SWIMNOTE X
              </p>
              <h2
                className="font-bold tracking-tight leading-[1.1] mb-5"
                style={{ fontSize: "clamp(32px, 5vw, 52px)", color: "#f5f5f7" }}
              >
                더 나은 수영장을<br />위한 프리미엄.
              </h2>
              <p
                className="text-[16px] leading-[1.8] mb-8"
                style={{ color: "rgba(245,245,247,0.60)" }}
              >
                AI 성장 리포트, 심층 운영 분석, 커리큘럼 관리까지.<br />
                SWIMNOTE X는 수영장의 가치를 높입니다.
              </p>
              <div className="space-y-3">
                {[
                  "AI 생성 성장 리포트",
                  "커리큘럼 게이지 & 레벨 관리",
                  "월간 운영 KPI 대시보드",
                  "학부모 앱 전용 X 경험",
                ].map((feat, i) => (
                  <motion.div
                    key={i}
                    {...inView(0.1 + i * 0.06)}
                    className="flex items-center gap-3"
                  >
                    <div
                      className="w-4 h-4 rounded-full flex items-center justify-center shrink-0"
                      style={{ background: "rgba(1,178,241,0.18)", border: "1px solid rgba(1,178,241,0.35)" }}
                    >
                      <div className="w-1.5 h-1.5 rounded-full" style={{ background: BLUE }} />
                    </div>
                    <span className="text-[14px]" style={{ color: "rgba(245,245,247,0.80)" }}>
                      {feat}
                    </span>
                  </motion.div>
                ))}
              </div>
              <div className="mt-8">
                <Link href="/app">
                  <span
                    className="inline-flex items-center gap-2 text-[14px] font-medium cursor-pointer transition-opacity hover:opacity-70"
                    style={{ color: BLUE }}
                  >
                    SWIMNOTE X 더 알아보기
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path d="M3 7H11M8 4L11 7L8 10" stroke={BLUE} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </span>
                </Link>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ── CTA 스트립 ────────────────────────────────────────────────────── */}
      <section
        className="py-24 px-6 text-center"
        style={{ background: LIGHT }}
      >
        <motion.p
          {...inView(0)}
          className="text-[12px] font-semibold tracking-[0.15em] uppercase mb-5"
          style={{ color: BLUE }}
        >
          Get Started
        </motion.p>
        <motion.h2
          {...inView(0.08)}
          className="font-bold tracking-tight leading-[1.1] mb-5"
          style={{ fontSize: "clamp(30px, 5vw, 56px)", color: DARK }}
        >
          지금 스윔노트를<br />시작하세요.
        </motion.h2>
        <motion.p
          {...inView(0.14)}
          className="text-[16px] mb-10 max-w-md mx-auto leading-[1.7]"
          style={{ color: GRAY }}
        >
          수영장 관리의 새로운 기준.<br />
          도입 문의부터 시작합니다.
        </motion.p>
        <motion.div
          {...inView(0.2)}
          className="flex flex-col sm:flex-row gap-3 justify-center"
        >
          <Link href="/support">
            <span
              className="inline-flex items-center justify-center px-7 py-3 rounded-full text-[14px] font-medium cursor-pointer transition-opacity hover:opacity-85"
              style={{ background: BLUE, color: "#fff" }}
            >
              도입 문의하기
            </span>
          </Link>
          <Link href="/education">
            <span
              className="inline-flex items-center justify-center px-7 py-3 rounded-full text-[14px] font-medium cursor-pointer transition-colors"
              style={{
                background: "transparent",
                color: BLUE,
                border: `1px solid ${BLUE}`,
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(1,178,241,0.06)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
            >
              교육시스템 보기
            </span>
          </Link>
        </motion.div>
      </section>

    </div>
  );
}
