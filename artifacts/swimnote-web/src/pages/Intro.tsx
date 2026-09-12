import { useRef } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import { Link } from "wouter";

// ── 팔레트 ───────────────────────────────────────────────────────────────────
const NAVY = "#0A1628";
const BLUE = "#01B2F1";
const DARK = "#1d1d1f";
const GRAY = "#6e6e73";

// ── 인뷰 헬퍼 ────────────────────────────────────────────────────────────────
const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 32 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.78, delay, ease: [0.22, 1, 0.36, 1] },
});

export default function Intro() {
  const heroRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ["start start", "end start"] });
  const textY  = useTransform(scrollYProgress, [0, 1], [0, -50]);
  const textOp = useTransform(scrollYProgress, [0, 0.5], [1, 0]);
  const imgY   = useTransform(scrollYProgress, [0, 1], [0, 60]);
  const imgOp  = useTransform(scrollYProgress, [0, 0.7], [1, 0]);

  return (
    <div style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Pretendard', sans-serif", overflowX: "hidden" }}>

      {/* ────────────────── HERO ────────────────── */}
      <section
        ref={heroRef}
        style={{ position: "relative", minHeight: "100svh", background: "#000", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", overflow: "hidden" }}
      >
        {/* 배경 광원 */}
        <div style={{
          position: "absolute", inset: 0, pointerEvents: "none",
          background: "radial-gradient(ellipse 70% 50% at 50% 35%, rgba(1,178,241,0.10) 0%, transparent 70%)",
        }} />

        {/* 헤드라인 블록 */}
        <motion.div
          style={{ y: textY, opacity: textOp, position: "relative", zIndex: 10, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: "0 24px" }}
        >
          <motion.p
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
            style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", color: BLUE, marginBottom: 20 }}
            translate="no"
          >
            SWIMNOTE
          </motion.p>

          <motion.h1
            initial={{ opacity: 0, y: 28 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
            style={{ fontSize: "clamp(48px, 10vw, 96px)", fontWeight: 700, letterSpacing: "-0.025em", lineHeight: 1.05, color: "#fff", margin: "0 0 20px" }}
          >
            수영 교육의<br />새로운 기준.
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.85, delay: 0.35, ease: [0.22, 1, 0.36, 1] }}
            style={{ fontSize: "clamp(16px, 2.5vw, 21px)", fontWeight: 300, lineHeight: 1.65, color: "rgba(245,245,247,0.68)", maxWidth: 480, margin: "0 0 40px" }}
          >
            수업부터 성장기록까지.<br />하나의 시스템으로 연결합니다.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.5, ease: [0.22, 1, 0.36, 1] }}
            style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}
          >
            <Link href="/app">
              <span style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                padding: "0 22px", height: 42, borderRadius: 21,
                fontSize: 14, fontWeight: 500, cursor: "pointer",
                background: BLUE, color: "#fff",
                transition: "opacity 0.2s",
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = "0.85"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}
              >
                스윔노트 앱 알아보기
              </span>
            </Link>
            <Link href="/support">
              <span style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                padding: "0 22px", height: 42, borderRadius: 21,
                fontSize: 14, fontWeight: 500, cursor: "pointer",
                background: "rgba(255,255,255,0.08)",
                color: "rgba(255,255,255,0.86)",
                border: "1px solid rgba(255,255,255,0.14)",
                transition: "background 0.2s",
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.14)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.08)"; }}
              >
                도입 문의
              </span>
            </Link>
          </motion.div>
        </motion.div>

        {/* 앱 목업 */}
        <motion.div
          style={{ y: imgY, opacity: imgOp, position: "relative", zIndex: 10, marginTop: 56, width: "100%", maxWidth: 760, padding: "0 24px" }}
          initial={{ opacity: 0, y: 48, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 1.1, delay: 0.55, ease: [0.22, 1, 0.36, 1] }}
        >
          <div style={{ borderRadius: 28, overflow: "hidden", boxShadow: "0 40px 80px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.06)" }}>
            <img
              src={`${import.meta.env.BASE_URL}app-teacher.jpeg`}
              alt="스윔노트 앱 화면"
              style={{ width: "100%", maxHeight: 400, objectFit: "cover", objectPosition: "top", display: "block" }}
            />
          </div>
          {/* 하단 페이드아웃 */}
          <div style={{ position: "absolute", bottom: 0, left: 24, right: 24, height: 120, background: "linear-gradient(transparent, #000)", pointerEvents: "none" }} />
        </motion.div>

        {/* 스크롤 힌트 */}
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          transition={{ delay: 1.4, duration: 0.8 }}
          style={{ position: "absolute", bottom: 28, left: "50%", transform: "translateX(-50%)", display: "flex", flexDirection: "column", alignItems: "center", gap: 6, color: "rgba(255,255,255,0.25)" }}
        >
          <span style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: 500 }}>Scroll</span>
          <motion.div animate={{ y: [0, 5, 0] }} transition={{ repeat: Infinity, duration: 1.6, ease: "easeInOut" }}>
            <svg width="16" height="10" viewBox="0 0 16 10" fill="none"><path d="M1 1L8 8L15 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </motion.div>
        </motion.div>
      </section>

      {/* ────────────────── 철학 스트립 ────────────────── */}
      <section style={{ background: "#fff", padding: "96px 24px", textAlign: "center" }}>
        <div style={{ maxWidth: 680, margin: "0 auto" }}>
          <motion.p {...fadeUp(0)} style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: BLUE, marginBottom: 20 }}>
            Why SWIMNOTE
          </motion.p>
          <motion.h2 {...fadeUp(0.08)} style={{ fontSize: "clamp(32px, 6vw, 60px)", fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.08, color: DARK, margin: "0 0 24px" }}>
            수영은 감각으로<br />설명하지 않습니다.
          </motion.h2>
          <motion.p {...fadeUp(0.16)} style={{ fontSize: "clamp(16px, 2vw, 20px)", fontWeight: 300, lineHeight: 1.7, color: GRAY }}>
            스윔노트는 수영을 <strong style={{ fontWeight: 600, color: DARK }}>과정</strong>으로 설명합니다.<br />
            Direction · Timing · Advance — DTA 프레임워크로<br />
            모든 수업을 구조화합니다.
          </motion.p>
        </div>
      </section>

      {/* ────────────────── 스윔노트 앱 ────────────────── */}
      <section style={{ background: "#f5f5f7", padding: "80px 24px" }}>
        <div style={{ maxWidth: 980, margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "48px 64px", alignItems: "center" }}>
          {/* 텍스트 */}
          <motion.div {...fadeUp(0)} style={{ minWidth: 0 }}>
            <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: BLUE, marginBottom: 18 }}>스윔노트 앱</p>
            <h2 style={{ fontSize: "clamp(28px, 4vw, 48px)", fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.1, color: DARK, margin: "0 0 18px" }}>
              수업 관리의<br />모든 것.
            </h2>
            <p style={{ fontSize: 16, lineHeight: 1.75, color: GRAY, margin: "0 0 28px" }}>
              출결, 일지, 학부모 소통, 보강 배정까지.<br />
              수영장 운영에 필요한 모든 기능을<br />
              하나의 앱에서 처리합니다.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 32 }}>
              {["출결 · 보강 자동 관리", "수업 일지 & 학부모 공유", "반 편성 · 수강생 이력", "수익 · 정산 분석"].map((f) => (
                <div key={f} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 18, height: 18, borderRadius: "50%", background: `rgba(1,178,241,0.12)`, border: "1px solid rgba(1,178,241,0.3)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: BLUE }} />
                  </div>
                  <span style={{ fontSize: 14, color: DARK }}>{f}</span>
                </div>
              ))}
            </div>
            <Link href="/app">
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 14, fontWeight: 500, color: BLUE, cursor: "pointer", transition: "opacity 0.2s" }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = "0.7"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}
              >
                앱 자세히 보기
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 7H11M8 4L11 7L8 10" stroke={BLUE} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </span>
            </Link>
          </motion.div>

          {/* 이미지 */}
          <motion.div
            initial={{ opacity: 0, x: 32 }} whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.9, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
          >
            <div style={{ borderRadius: 24, overflow: "hidden", boxShadow: "0 20px 60px rgba(10,22,40,0.12)" }}>
              <img src={`${import.meta.env.BASE_URL}app-teacher.jpeg`} alt="스윔노트 앱" style={{ width: "100%", display: "block" }} />
            </div>
          </motion.div>
        </div>
      </section>

      {/* ────────────────── 학부모 앱 ────────────────── */}
      <section style={{ background: "#fff", padding: "80px 24px" }}>
        <div style={{ maxWidth: 980, margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "48px 64px", alignItems: "center" }}>
          {/* 이미지 (왼쪽) */}
          <motion.div
            initial={{ opacity: 0, x: -32 }} whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.9, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
          >
            <div style={{ borderRadius: 24, overflow: "hidden", boxShadow: "0 20px 60px rgba(10,22,40,0.08)" }}>
              <img src={`${import.meta.env.BASE_URL}app-parent.png`} alt="학부모 앱" style={{ width: "100%", display: "block" }} />
            </div>
          </motion.div>

          {/* 텍스트 (오른쪽) */}
          <motion.div {...fadeUp(0.1)}>
            <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: BLUE, marginBottom: 18 }}>학부모 앱</p>
            <h2 style={{ fontSize: "clamp(28px, 4vw, 48px)", fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.1, color: DARK, margin: "0 0 18px" }}>
              부모가 함께<br />성장을 봅니다.
            </h2>
            <p style={{ fontSize: 16, lineHeight: 1.75, color: GRAY, margin: "0 0 28px" }}>
              수업 일지, 출석 현황, AI 성장 리포트를<br />
              학부모 앱으로 실시간 공유합니다.<br />
              수영장과 가정을 연결하는 소통 채널.
            </p>
            <Link href="/app">
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 14, fontWeight: 500, color: BLUE, cursor: "pointer", transition: "opacity 0.2s" }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = "0.7"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}
              >
                더 알아보기
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 7H11M8 4L11 7L8 10" stroke={BLUE} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </span>
            </Link>
          </motion.div>
        </div>
      </section>

      {/* ────────────────── SWIMNOTE X ────────────────── */}
      <section style={{ background: NAVY, padding: "96px 24px", overflow: "hidden" }}>
        <div style={{ maxWidth: 980, margin: "0 auto" }}>
          {/* 상단 레이블 + 헤드라인 (중앙) */}
          <div style={{ textAlign: "center", marginBottom: 64 }}>
            <motion.p {...fadeUp(0)} style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", color: BLUE, marginBottom: 16 }} translate="no">
              SWIMNOTE X
            </motion.p>
            <motion.h2 {...fadeUp(0.08)} style={{ fontSize: "clamp(36px, 6vw, 64px)", fontWeight: 700, letterSpacing: "-0.025em", lineHeight: 1.08, color: "#f5f5f7", margin: "0 0 18px" }}>
              더 나은 수영장을<br />위한 프리미엄.
            </motion.h2>
            <motion.p {...fadeUp(0.14)} style={{ fontSize: 18, fontWeight: 300, lineHeight: 1.65, color: "rgba(245,245,247,0.58)", maxWidth: 520, margin: "0 auto 40px" }}>
              AI 성장 리포트, 심층 운영 분석, 커리큘럼 관리까지.<br />
              SWIMNOTE X가 수영장의 가치를 높입니다.
            </motion.p>
            <motion.div {...fadeUp(0.2)}>
              <Link href="/app">
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  fontSize: 14, fontWeight: 500, color: BLUE, cursor: "pointer",
                  transition: "opacity 0.2s",
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = "0.7"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}
                >
                  SWIMNOTE X 알아보기
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 7H11M8 4L11 7L8 10" stroke={BLUE} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </span>
              </Link>
            </motion.div>
          </div>

          {/* 기능 4종 그리드 */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
            {[
              { icon: "✦", title: "AI 성장 리포트", desc: "매달 학생 한 명 한 명의 성장을 AI가 분석하고 리포트를 생성합니다." },
              { icon: "◎", title: "커리큘럼 게이지", desc: "학생별 과정 이수 현황과 레벨 관리를 한 화면에서 확인합니다." },
              { icon: "▣", title: "월간 운영 KPI", desc: "수익, 수강생 동향, 출석률을 데이터 기반으로 분석합니다." },
              { icon: "◈", title: "학부모 X 경험", desc: "학부모 앱에서 전용 X 성장 리포트와 커리큘럼을 공유합니다." },
            ].map((item, i) => (
              <motion.div
                key={i}
                {...fadeUp(0.1 + i * 0.07)}
                style={{
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(1,178,241,0.12)",
                  borderRadius: 20,
                  padding: "28px 24px",
                }}
              >
                <div style={{ fontSize: 22, color: BLUE, marginBottom: 14 }} translate="no">{item.icon}</div>
                <h3 style={{ fontSize: 16, fontWeight: 600, color: "#f5f5f7", margin: "0 0 10px", letterSpacing: "-0.01em" }}>{item.title}</h3>
                <p style={{ fontSize: 13, lineHeight: 1.65, color: "rgba(245,245,247,0.52)", margin: 0 }}>{item.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ────────────────── 교육시스템 ────────────────── */}
      <section style={{ background: "#f5f5f7", padding: "80px 24px" }}>
        <div style={{ maxWidth: 980, margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "48px 64px", alignItems: "center" }}>
          {/* 텍스트 */}
          <motion.div {...fadeUp(0)}>
            <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: BLUE, marginBottom: 18 }} translate="no">DTA Framework</p>
            <h2 style={{ fontSize: "clamp(28px, 4vw, 48px)", fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.1, color: DARK, margin: "0 0 18px" }}>
              DTA 기반<br />수영 교육.
            </h2>
            <p style={{ fontSize: 16, lineHeight: 1.75, color: GRAY, margin: "0 0 28px" }}>
              Direction · Timing · Advance.<br />
              수영 영법을 과정으로 설명하는<br />
              SWIMNOTE의 교육 프레임워크입니다.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 32 }}>
              {[
                { l: "D", w: "DIRECTION", d: "수영 영법이 어떤 방향으로 움직여야 하는지 구조화합니다." },
                { l: "T", w: "TIMING",    d: "힘을 언제, 어떤 순서로 사용해야 하는지 설명합니다." },
                { l: "A", w: "ADVANCE",   d: "저항을 줄이고 앞으로 이동하는 과정을 설명합니다." },
              ].map((item, i) => (
                <motion.div key={i} {...fadeUp(0.1 + i * 0.09)} style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, background: NAVY, color: BLUE, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 700, flexShrink: 0 }} translate="no">
                    {item.l}
                  </div>
                  <div>
                    <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", color: DARK, margin: "0 0 4px" }} translate="no">{item.w}</p>
                    <p style={{ fontSize: 13, lineHeight: 1.65, color: GRAY, margin: 0 }}>{item.d}</p>
                  </div>
                </motion.div>
              ))}
            </div>
            <Link href="/education">
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 14, fontWeight: 500, color: BLUE, cursor: "pointer", transition: "opacity 0.2s" }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = "0.7"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}
              >
                교육시스템 보기
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 7H11M8 4L11 7L8 10" stroke={BLUE} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </span>
            </Link>
          </motion.div>

          {/* 이미지 */}
          <motion.div
            initial={{ opacity: 0, x: 32 }} whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.9, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
          >
            <div style={{ borderRadius: 24, overflow: "hidden", boxShadow: "0 20px 60px rgba(10,22,40,0.10)" }}>
              <img src={`${import.meta.env.BASE_URL}education-level.png`} alt="DTA 교육시스템" style={{ width: "100%", display: "block" }} />
            </div>
          </motion.div>
        </div>
      </section>

      {/* ────────────────── CTA ────────────────── */}
      <section style={{ background: "#000", padding: "120px 24px", textAlign: "center" }}>
        <div style={{ maxWidth: 600, margin: "0 auto" }}>
          <motion.p {...fadeUp(0)} style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: BLUE, marginBottom: 20 }}>
            Get Started
          </motion.p>
          <motion.h2 {...fadeUp(0.08)} style={{ fontSize: "clamp(36px, 6vw, 64px)", fontWeight: 700, letterSpacing: "-0.025em", lineHeight: 1.08, color: "#fff", margin: "0 0 20px" }}>
            지금 스윔노트를<br />시작하세요.
          </motion.h2>
          <motion.p {...fadeUp(0.14)} style={{ fontSize: 18, fontWeight: 300, lineHeight: 1.65, color: "rgba(245,245,247,0.55)", margin: "0 0 44px" }}>
            수영장 관리의 새로운 기준.<br />도입 문의부터 시작합니다.
          </motion.p>
          <motion.div {...fadeUp(0.2)} style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <Link href="/support">
              <span style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                padding: "0 28px", height: 46, borderRadius: 23,
                fontSize: 15, fontWeight: 500, cursor: "pointer",
                background: BLUE, color: "#fff",
                transition: "opacity 0.2s",
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = "0.85"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}
              >
                도입 문의하기
              </span>
            </Link>
            <Link href="/education">
              <span style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                padding: "0 28px", height: 46, borderRadius: 23,
                fontSize: 15, fontWeight: 500, cursor: "pointer",
                background: "rgba(255,255,255,0.08)",
                color: "rgba(255,255,255,0.86)",
                border: "1px solid rgba(255,255,255,0.14)",
                transition: "background 0.2s",
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.14)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.08)"; }}
              >
                교육시스템 보기
              </span>
            </Link>
          </motion.div>
        </div>
      </section>

    </div>
  );
}
