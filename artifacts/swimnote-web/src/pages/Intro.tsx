import { motion } from "framer-motion";
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { usePoolMode } from "@/contexts/PoolModeContext";

const fadeUp = (_delay = 0) => ({
  initial: { opacity: 1, y: 0 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0 },
});

const inView = (delay = 0) => ({
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-60px" },
  transition: { duration: 0.65, delay, ease: [0.22, 1, 0.36, 1] },
});

const PRIMARY = "#002F5F";
const SECONDARY = "#01B2F1";
const ACCENT = "#67F2F2";

const identity = [
  "수영 교육 브랜드",
  "수영 교육 시스템",
  "수영장 운영 플랫폼",
  "수영 연구기관",
  "공인 민간자격증 운영기관",
];

const researchRoles = [
  "WA(World Aquatics)의 수영 규칙과 영법을 지속적으로 연구합니다.",
  "전 세계 수영 기술 자료를 수집합니다.",
  "새로운 수영 이론을 검토합니다.",
  "교육 시스템을 지속적으로 업데이트합니다.",
  "민간 자격증 교육과 평가 기준을 개발합니다.",
];

const qualifications = [
  "수영영법분석사 2급",
  "수영영법분석사 1급",
  "수영영법기술평가사",
];

const dtaItems = [
  {
    letter: "D",
    word: "DIRECTION",
    desc: "수영 영법이 어떤 방향으로 움직여야 하는지를 구조화합니다.",
  },
  {
    letter: "T",
    word: "TIMING",
    desc: "힘을 언제, 어떤 순서로 사용해야 하는지를 설명합니다.",
  },
  {
    letter: "A",
    word: "ADVANCE",
    desc: "저항을 줄이고 앞으로 이동하는 과정을 설명합니다.",
  },
];

export default function Intro() {
  return (
    <div className="pt-16">

      {/* ── Hero ── */}
      <section className="min-h-[90vh] flex flex-col items-center justify-center px-6 text-center border-b border-[#f0f0f0]">
        <motion.div {...fadeUp(0)} className="mb-3" style={{ width: 80, flexShrink: 0 }}>
          <img
            src={`${import.meta.env.BASE_URL}logo.png`}
            alt="SWIMNOTE 아이콘"
            style={{ width: 80, height: "auto", display: "block" }}
          />
        </motion.div>

        <motion.p {...fadeUp(0.1)} className="text-[12px] font-semibold tracking-[0.2em] uppercase mb-6" style={{ color: SECONDARY }}>
          DTA 기반 수영교육시스템
        </motion.p>
        <motion.h1 {...fadeUp(0.2)} className="text-[72px] md:text-[112px] lg:text-[136px] font-bold tracking-[-0.04em] text-[#0a0a0a] leading-none mb-8" translate="no">
          SWIMNOTE
        </motion.h1>
        <motion.p {...fadeUp(0.35)} className="text-[18px] md:text-[22px] text-[#666] max-w-lg leading-relaxed mb-14 font-light">
          수영을 배우는 과정부터 성장기록까지<br />하나의 시스템으로 연결합니다.
        </motion.p>
        {!usePoolMode() && (
          <motion.div {...fadeUp(0.45)} className="flex flex-col sm:flex-row gap-3">
            <Link href="/education">
              <span
                data-testid="hero-btn-education"
                className="inline-flex items-center gap-2 px-7 py-3.5 rounded-full text-white text-[14px] font-semibold cursor-pointer transition-opacity hover:opacity-85"
                style={{ background: PRIMARY }}
              >
                교육시스템 <ArrowRight className="w-4 h-4" />
              </span>
            </Link>
            <Link href="/app">
              <span
                data-testid="hero-btn-app"
                className="inline-flex items-center gap-2 px-7 py-3.5 rounded-full text-white text-[14px] font-semibold cursor-pointer transition-opacity hover:opacity-85"
                style={{ background: SECONDARY }}
                translate="no"
              >
                SWIMNOTE APP
              </span>
            </Link>
            <Link href="/support">
              <span
                data-testid="hero-btn-inquiry"
                className="inline-block px-7 py-3.5 rounded-full border border-[#d5d5d5] text-[#0a0a0a] text-[14px] font-semibold cursor-pointer hover:bg-[#f5f5f5] transition-colors"
              >
                제휴문의
              </span>
            </Link>
          </motion.div>
        )}
      </section>

      {/* ── SWIMNOTE는 ── */}
      <section className="py-28 px-6 border-b border-[#f0f0f0]">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-start">
            <motion.div {...inView(0)}>
              <p className="text-[12px] font-semibold tracking-[0.15em] uppercase mb-5" style={{ color: SECONDARY }}>SWIMNOTE란</p>
              <h2 className="text-[32px] md:text-[42px] font-bold tracking-tight text-[#0a0a0a] leading-[1.2] mb-4">
                SWIMNOTE는
              </h2>
              <div className="space-y-3 mt-6">
                {identity.map((item, i) => (
                  <motion.div key={i} {...inView(i * 0.08)} className="flex items-center gap-3">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: SECONDARY }} />
                    <span className="text-[18px] font-semibold text-[#0a0a0a]">{item}</span>
                  </motion.div>
                ))}
                <motion.p {...inView(0.5)} className="pt-2 text-[15px] text-[#888] font-light">
                  을 하나로 연결하는 브랜드입니다.
                </motion.p>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 40, scale: 0.96 }}
              whileInView={{ opacity: 1, y: 0, scale: 1 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 1, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
              className="relative"
            >
              {/* 뒤편 글로우 */}
              <div
                className="absolute -inset-6 rounded-[48px] blur-3xl -z-10"
                style={{ background: "linear-gradient(135deg, rgba(1,178,241,0.28) 0%, rgba(103,242,242,0.16) 100%)" }}
              />
              {/* 브랜드 개요 이미지 */}
              <motion.div
                whileHover={{ scale: 1.015, transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] } }}
                className="rounded-3xl overflow-hidden cursor-default"
                style={{ boxShadow: "0 28px 64px rgba(1,178,241,0.18), 0 8px 24px rgba(0,47,95,0.10)" }}
              >
                <img src={`${import.meta.env.BASE_URL}intro-overview.png`} alt="SWIMNOTE 브랜드 개요" className="w-full h-auto" />
              </motion.div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ── 브랜드 철학 ── */}
      <section className="py-28 px-6 border-b border-[#f0f0f0] bg-[#fafafa]">
        <div className="max-w-5xl mx-auto text-center">
          <motion.p {...inView(0)} className="text-[12px] font-semibold tracking-[0.15em] uppercase mb-8" style={{ color: SECONDARY }}>
            브랜드 철학
          </motion.p>
          <motion.h2 {...inView(0.1)} className="text-[32px] md:text-[52px] font-bold tracking-tight text-[#0a0a0a] leading-[1.25] mb-6">
            <span className="block">수영은 감각으로</span>
            <span className="block">설명하지 않습니다.</span>
          </motion.h2>
          <motion.p {...inView(0.2)} className="text-[20px] md:text-[26px] text-[#aaa] font-light">
            수영을 <span className="text-[#0a0a0a] font-semibold">과정</span>으로 설명합니다.
          </motion.p>
        </div>
      </section>

      {/* ── DTA ── */}
      <section className="py-28 px-6 border-b border-[#f0f0f0]">
        <div className="max-w-5xl mx-auto">
          <motion.p {...inView(0)} className="text-[12px] font-semibold tracking-[0.15em] uppercase mb-6" style={{ color: SECONDARY }}>
            SWIMNOTE의 기반 프레임워크
          </motion.p>
          <motion.h2 {...inView(0.05)} className="text-[44px] md:text-[60px] font-bold tracking-tight text-[#0a0a0a] leading-none mb-4">
            DTA
          </motion.h2>
          <motion.p {...inView(0.1)} className="text-[15.5px] text-[#777] font-light mb-12 max-w-xl leading-[1.85]">
            DTA는 수영 영법을 설명하고 구조화하기 위한 기준입니다.
          </motion.p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {dtaItems.map((item, i) => (
              <motion.div
                key={i}
                {...inView(0.1 + i * 0.1)}
                className="border border-[#ebebeb] rounded-2xl p-8"
              >
                <p
                  className="text-[48px] font-bold leading-none mb-2"
                  style={{ color: PRIMARY }}
                  translate="no"
                >
                  {item.letter}
                </p>
                <p className="text-[14px] font-bold tracking-widest mb-4 text-[#0a0a0a]" translate="no">{item.word}</p>
                <p className="text-[14px] text-[#777] leading-[1.85] font-light">{item.desc}</p>
              </motion.div>
            ))}
          </div>

          <motion.div {...inView(0.4)} className="mt-8 p-6 rounded-2xl border-l-4" style={{ borderColor: ACCENT, background: "#f8feff" }}>
            <p className="text-[14px] text-[#555] font-light leading-relaxed">
              DTA는 수영 영법을 <strong className="text-[#0a0a0a] font-semibold">설명하고, 구조화하고, 이해하기</strong> 위한 분석 방법입니다.<br />
              영법을 만드는 기술이 아니라, 교육의 기준을 제공하는 프레임워크입니다.
            </p>
          </motion.div>
        </div>
      </section>

      {/* ── 대한수영영법연구원 ── */}
      <section id="research" className="py-28 px-6 border-b border-[#f0f0f0]">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-start">
            <div>
              <motion.p {...inView(0)} className="text-[12px] font-semibold tracking-[0.15em] uppercase mb-6" style={{ color: SECONDARY }}>Research</motion.p>
              <motion.h2 {...inView(0.05)} className="text-[28px] md:text-[38px] font-bold tracking-tight text-[#0a0a0a] leading-[1.25] mb-4">
                대한수영영법연구원
              </motion.h2>
              <motion.p {...inView(0.1)} className="text-[14px] text-[#aaa] mb-8 font-light">SWIMNOTE에서 운영합니다.</motion.p>
            </div>
            <div className="space-y-4">
              {researchRoles.map((role, i) => (
                <motion.div key={i} {...inView(i * 0.07)} className="flex items-start gap-3">
                  <span className="w-1.5 h-1.5 rounded-full mt-2 shrink-0" style={{ background: SECONDARY }} />
                  <p className="text-[15px] text-[#555] leading-[1.8] font-light">{role}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── 민간자격 ── */}
      <section className="py-28 px-6">
        <div className="max-w-5xl mx-auto">
          <motion.p {...inView(0)} className="text-[12px] font-semibold tracking-[0.15em] uppercase mb-6" style={{ color: SECONDARY }}>
            Qualification
          </motion.p>
          <motion.h2 {...inView(0.05)} className="text-[28px] md:text-[38px] font-bold tracking-tight text-[#0a0a0a] leading-[1.25] mb-3">
            공인 민간자격
          </motion.h2>
          <motion.p {...inView(0.1)} className="text-[15px] text-[#666] font-medium mb-8">
            SWIMNOTE 교육시스템 기반 수영 지도자 공인 민간자격 체계
          </motion.p>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
            <motion.div {...inView(0.15)} className="space-y-5">
              <p className="text-[15px] text-[#555] leading-[1.9] font-light">
                SWIMNOTE 교육시스템을 기반으로 운영되는 수영 지도자 자격체계를 개발하고 있습니다.
              </p>
              <p className="text-[15px] text-[#555] leading-[1.9] font-light">
                대한수영영법연구원에서는 수영 영법과 교육 기준, 평가 기준을 연구하며 SWIMNOTE 교육시스템과 연계된 자격체계를 개발하고 있습니다.
              </p>
            </motion.div>

            <motion.div {...inView(0.2)} className="space-y-3">
              <p className="text-[12px] font-semibold tracking-widest text-[#aaa] uppercase mb-5">개발 중인 자격체계</p>
              {qualifications.map((q, i) => (
                <motion.div
                  key={i}
                  {...inView(0.1 + i * 0.07)}
                  className="flex items-center gap-4 p-5 border border-[#ebebeb] rounded-2xl"
                >
                  <span
                    className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0"
                    style={{ background: PRIMARY }}
                  >
                    {i + 1}
                  </span>
                  <span className="text-[15px] font-semibold text-[#0a0a0a]">{q}</span>
                </motion.div>
              ))}

              <motion.div {...inView(0.4)} className="mt-4 flex items-center gap-2 px-5 py-3.5 rounded-xl" style={{ background: "#f0f6ff" }}>
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: SECONDARY }} />
                <span className="text-[13px] font-medium" style={{ color: PRIMARY }}>국가공인 민간자격 추진</span>
              </motion.div>
            </motion.div>
          </div>
        </div>
      </section>
    </div>
  );
}