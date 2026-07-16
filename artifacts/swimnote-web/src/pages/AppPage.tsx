import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";

const inView = (delay = 0) => ({
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-40px" },
  transition: { duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] },
});

const PRIMARY = "#002F5F";
const SECONDARY = "#01B2F1";
const ACCENT = "#67F2F2";

const keyFeatures = [
  { label: "국내 최초·유일", desc: "어린이 수영장 전용 관리 앱" },
  { label: "선생님 전용 스케줄러", desc: "수업 일정 자동 관리" },
  { label: "자동 피드백 전송", desc: "수업 후 학부모에게 자동 전달" },
  { label: "사진·영상 앨범 자동화", desc: "촬영부터 정리까지 자동 시스템" },
];

const adminFeatures = [
  "회원관리", "반관리", "선생님관리", "레벨관리",
  "출결관리", "보강관리", "앨범관리", "공지관리",
  "통계", "성장기록", "저장공간 관리",
];
const teacherFeatures = [
  "출석", "수업일지", "사진", "영상",
  "자동피드백", "보강", "회원정보", "반관리",
  "수영레슨 전용 스케줄러",
];
const parentFeatures = [
  "출석알림", "출석확인", "사진앨범", "영상앨범",
  "레벨확인", "공지사항", "보강알림",
];
const upcoming = [
  "수영 졸업앨범 제작",
  "AI 성장 리포트",
  "AI 영법 분석",
  "공인 민간자격증 관리",
  "온라인 레벨 테스트",
  "교육 통계",
];
const flowSteps = [
  "회원 등록", "반 배정", "출석", "수업일지", "사진", "피드백", "성장기록", "학부모 확인",
];

function PhoneMockup({ label, image }: { label: string; image?: string }) {
  return (
    <div className="relative mx-auto w-[180px] md:w-[200px]">
      <div className="relative bg-[#0a0a0a] rounded-[32px] p-[8px] shadow-xl">
        <div className="bg-white rounded-[26px] overflow-hidden aspect-[9/19.5] relative">
          {image ? (
            <img src={image} alt={label} className="w-full h-full object-cover object-top" />
          ) : (
            <>
              <div className="h-8 bg-white flex items-center justify-center pt-2">
                <div className="w-12 h-1.5 bg-[#e8e8e8] rounded-full" />
              </div>
              <div className="px-4 py-3 border-b border-[#f5f5f5]">
                <div className="w-20 h-2.5 rounded-full mb-1" style={{ background: SECONDARY, opacity: 0.3 }} />
                <div className="w-14 h-2 bg-[#f0f0f0] rounded-full" />
              </div>
              <div className="px-3 py-3 space-y-2.5">
                {[80, 65, 72, 55, 68, 60].map((w, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <div className="w-7 h-7 rounded-lg bg-[#f5f5f5] shrink-0" />
                    <div className="flex-1 space-y-1">
                      <div className="h-2 bg-[#ebebeb] rounded-full" style={{ width: `${w}%` }} />
                      <div className="h-1.5 bg-[#f5f5f5] rounded-full w-2/5" />
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="absolute top-[8px] left-1/2 -translate-x-1/2 w-14 h-3.5 bg-[#0a0a0a] rounded-full" />
      </div>
      <p className="text-center text-[11px] text-[#bbb] mt-3">{label}</p>
    </div>
  );
}

function FeatureGrid({ items }: { items: string[] }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
      {items.map((item, i) => (
        <motion.div key={i} {...inView(i * 0.04)}
          className="px-4 py-3 rounded-xl border border-[#ebebeb] bg-white transition-colors text-center"
          style={{ borderColor: "#ebebeb" }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = SECONDARY; (e.currentTarget as HTMLElement).style.background = "#f0fbff"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "#ebebeb"; (e.currentTarget as HTMLElement).style.background = "white"; }}>
          <span className="text-[13.5px] font-medium text-[#333]">{item}</span>
        </motion.div>
      ))}
    </div>
  );
}

const tabs = [
  {
    id: "admin",
    label: "운영자",
    subtitle: "운영자 기능",
    desc: "수영장 운영 전반을 하나의 앱에서 관리합니다.",
    image: "/app-admin.jpeg",
    features: adminFeatures,
    extra: null,
  },
  {
    id: "teacher",
    label: "선생님",
    subtitle: "선생님 기능",
    desc: "수업에 집중할 수 있도록 필요한 기능만 담았습니다.",
    image: "/app-teacher.jpeg",
    features: teacherFeatures,
    extra: (
      <div className="space-y-4 mt-6">
        <div className="rounded-2xl border border-[#e0e0e0] bg-white p-6">
          <span className="inline-block text-[11px] font-bold tracking-widest uppercase px-2.5 py-1 rounded-full mb-3" style={{ background: "#f0fbff", color: SECONDARY }}>수영레슨 전용 스케줄러</span>
          <p className="text-[14px] text-[#444] leading-[1.8] font-light">
            수업관리와 연동되는 전용 스케줄러입니다.<br />
            출석 · 결석 · 보강 · 퇴원 등을 한번에 관리할 수 있습니다.
          </p>
        </div>
        <div className="rounded-2xl border border-[#e0e0e0] bg-white p-6">
          <span className="inline-block text-[11px] font-bold tracking-widest uppercase px-2.5 py-1 rounded-full mb-3" style={{ background: "#f0fbff", color: SECONDARY }}>자동피드백 시스템</span>
          <p className="text-[14px] text-[#444] leading-[1.8] font-light mb-4">
            수업 내용을 미리 템플릿에 저장하고, 수업 종료 시 저장된 일지 템플릿을 불러와 추가 작성 없이 수업 내용을 바로 전송할 수 있는 시스템입니다.
          </p>
          <div className="flex gap-3 flex-wrap">
            <span className="text-[12px] font-medium px-3 py-1.5 rounded-lg border" style={{ color: PRIMARY, borderColor: "#c8d8eb", background: "#f5f8fc" }}>반별 작성 가능</span>
            <span className="text-[12px] font-medium px-3 py-1.5 rounded-lg border" style={{ color: PRIMARY, borderColor: "#c8d8eb", background: "#f5f8fc" }}>개인별 작성 가능</span>
          </div>
        </div>
      </div>
    ),
  },
  {
    id: "parent",
    label: "학부모",
    subtitle: "학부모 기능",
    desc: "아이의 수업 내용과 성장 과정을 실시간으로 확인합니다.",
    image: "/app-parent.png",
    features: parentFeatures,
    extra: (
      <div className="mt-6">
        <div className="rounded-2xl border border-[#e0e0e0] bg-white p-6">
          <span className="inline-block text-[11px] font-bold tracking-widest uppercase px-2.5 py-1 rounded-full mb-3" style={{ background: "#f0fbff", color: SECONDARY }}>피드백 일지 통합 조회</span>
          <p className="text-[14px] text-[#444] leading-[1.8] font-light">
            수업일지 · 사진앨범 · 영상앨범을 카카오톡 없이 앱 안에서 한번에 확인할 수 있습니다.<br />
            피드백 일지와 함께 조회되어 아이의 수업 내용을 더 풍부하게 파악할 수 있습니다.
          </p>
        </div>
      </div>
    ),
  },
];

function TabSection() {
  const [active, setActive] = useState(0);
  const tab = tabs[active];

  return (
    <section className="py-24 px-6 border-b border-[#f0f0f0]">
      <div className="max-w-5xl mx-auto">
        {/* Tab bar */}
        <div className="flex gap-2 mb-12 p-1.5 rounded-2xl bg-[#f5f5f5] w-fit">
          {tabs.map((t, i) => (
            <button
              key={t.id}
              onClick={() => setActive(i)}
              className="relative px-6 py-2.5 rounded-xl text-[14px] font-semibold transition-colors duration-200"
              style={{
                color: active === i ? "white" : "#888",
                background: "transparent",
              }}
            >
              {active === i && (
                <motion.div
                  layoutId="tab-pill"
                  className="absolute inset-0 rounded-xl"
                  style={{ background: PRIMARY }}
                  transition={{ type: "spring", stiffness: 400, damping: 35 }}
                />
              )}
              <span className="relative z-10">{t.label}</span>
            </button>
          ))}
        </div>

        {/* Tab content */}
        <AnimatePresence mode="wait">
          <motion.div
            key={active}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-12 items-start">
              {/* Left: image */}
              <div>
                <p className="text-[12px] font-semibold tracking-[0.2em] uppercase mb-4" style={{ color: SECONDARY }}>{tab.label}</p>
                <h2 className="text-[28px] md:text-[34px] font-bold tracking-tight text-[#0a0a0a] mb-3">{tab.subtitle}</h2>
                <p className="text-[14px] text-[#888] font-light leading-relaxed mb-6">{tab.desc}</p>
                <div className="rounded-2xl aspect-[3/4] overflow-hidden">
                  <img src={tab.image} alt={tab.label} className="w-full h-full object-cover object-top" />
                </div>
              </div>
              {/* Right: features + extra */}
              <div>
                <FeatureGrid items={tab.features} />
                {tab.extra}
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  );
}

export default function AppPage() {
  return (
    <div className="pt-16">

      {/* ── Hero ── */}
      <section className="py-24 md:py-32 px-6 border-b border-[#f0f0f0]">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <div>
              <div className="mb-6" style={{ width: 80, height: 50, overflow: "hidden", borderRadius: 16 }}>
                <img src={`${import.meta.env.BASE_URL}logo.png`} alt="SWIMNOTE 아이콘" style={{ width: 80, height: "auto", display: "block" }} />
              </div>

              <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}
                className="text-[12px] font-semibold tracking-[0.2em] uppercase mb-5" style={{ color: SECONDARY }}>
                SWIMNOTE 전용 어플리케이션
              </motion.p>
              <motion.h1 initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
                className="text-[40px] md:text-[56px] font-bold tracking-tight text-[#0a0a0a] leading-[1.15] mb-6" translate="no">
                SWIMNOTE<br />APP
              </motion.h1>
              <motion.p initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
                className="text-[15.5px] text-[#666] leading-[1.85] font-light mb-8">
                수영장 운영과 학부모 피드백을 하나로 연결합니다.<br />
                전화, 카카오톡, 종이출석으로 운영되던 수영장을<br className="hidden sm:block" />하나의 시스템으로 연결합니다.
              </motion.p>

              {/* Key features */}
              <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.25, ease: [0.22, 1, 0.36, 1] }}
                className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-10">
                {keyFeatures.map((f, i) => (
                  <div key={i} className="flex items-start gap-3 p-4 rounded-2xl border border-[#ebebeb] bg-[#fafafa]">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0 mt-1.5" style={{ background: SECONDARY }} />
                    <div>
                      <p className="text-[13px] font-bold text-[#0a0a0a] mb-0.5">{f.label}</p>
                      <p className="text-[12px] text-[#999] font-light">{f.desc}</p>
                    </div>
                  </div>
                ))}
              </motion.div>

              {/* Download buttons */}
              <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.3, ease: [0.22, 1, 0.36, 1] }}
                className="flex flex-col sm:flex-row gap-3">
                <a href="https://apps.apple.com/app/id6761360360" target="_blank" rel="noopener noreferrer" data-testid="btn-appstore"
                  className="flex items-center gap-3 px-5 py-3.5 rounded-2xl text-white w-fit transition-opacity hover:opacity-90 active:opacity-80"
                  style={{ background: PRIMARY }}>
                  <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white shrink-0"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98l-.09.06c-.22.13-2.2 1.28-2.18 3.81.03 3.02 2.65 4.03 2.68 4.04l-.05.22zM13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" /></svg>
                  <div className="text-left">
                    <p className="text-[10px] leading-none opacity-80">Download on the</p>
                    <p className="text-[13px] font-semibold">App Store</p>
                  </div>
                </a>
                <a href="https://play.google.com/store/apps/details?id=com.swimnote.app" target="_blank" rel="noopener noreferrer" data-testid="btn-googleplay"
                  className="flex items-center gap-3 px-5 py-3.5 rounded-2xl border border-[#d0d0d0] text-[#0a0a0a] w-fit transition-opacity hover:opacity-80 active:opacity-60">
                  <svg viewBox="0 0 24 24" className="w-5 h-5 fill-[#0a0a0a] shrink-0"><path d="M3.18 23.76c.3.17.63.24.97.21l12.38-7.19-2.61-2.61-10.74 9.59zm-1.81-21.1v18.68c0 .53.15 1 .43 1.37L13.45 11.5 1.8 1.29c-.28.37-.43.84-.43 1.37zm20.23 7.91l-2.88-1.67-3.03 3.03 3.03 3.03 2.9-1.68c.83-.48.83-1.23-.02-1.71zM4.15.24l12.38 7.19-2.61 2.61L3.18.45C3.48.28 3.86.07 4.15.24z" /></svg>
                  <div className="text-left">
                    <p className="text-[10px] leading-none opacity-80">Get it on</p>
                    <p className="text-[13px] font-semibold">Google Play</p>
                  </div>
                </a>
              </motion.div>
            </div>

            {/* Phone mockups */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.25, ease: [0.22, 1, 0.36, 1] }}
              className="flex justify-center items-end gap-6">
              <div className="mb-10"><PhoneMockup label="운영자" image="/app-admin.jpeg" /></div>
              <PhoneMockup label="선생님" image="/app-teacher.jpeg" />
              <div className="mb-10"><PhoneMockup label="학부모" image="/app-parent.png" /></div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ── 운영 흐름 ── */}
      <section className="py-24 px-6 bg-[#fafafa] border-b border-[#f0f0f0]">
        <div className="max-w-5xl mx-auto">
          <motion.p {...inView(0)} className="text-[12px] font-semibold tracking-[0.2em] uppercase mb-4" style={{ color: SECONDARY }}>수업관리 자동화시스템</motion.p>
          <motion.h2 {...inView(0.05)} className="text-[28px] md:text-[38px] font-bold tracking-tight text-[#0a0a0a] mb-12">
            한번의 흐름으로 수업관리 OK
          </motion.h2>
          <div className="flex flex-wrap items-center gap-0">
            {flowSteps.map((step, i) => (
              <motion.div key={i} {...inView(i * 0.06)} className="flex items-center">
                <div className="flex flex-col items-center">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[11px] font-bold mb-2" style={{ background: PRIMARY }}>
                    {i + 1}
                  </div>
                  <span className="text-[13px] font-medium text-[#333]">{step}</span>
                </div>
                {i < flowSteps.length - 1 && (
                  <div className="w-8 md:w-12 h-px bg-[#e0e0e0] mx-1 mb-4 shrink-0" />
                )}
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 기능 탭 ── */}
      <TabSection />

      {/* ── 향후 서비스 ── */}
      <section className="py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <motion.p {...inView(0)} className="text-[12px] font-semibold tracking-[0.2em] uppercase mb-4" style={{ color: SECONDARY }}>향후 서비스</motion.p>
          <motion.h2 {...inView(0.05)} className="text-[28px] md:text-[36px] font-bold tracking-tight text-[#0a0a0a] mb-3">앞으로 추가될 기능</motion.h2>
          <motion.p {...inView(0.1)} className="text-[14px] text-[#aaa] mb-10 font-light">서비스 준비 중입니다.</motion.p>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {upcoming.map((item, i) => (
              <motion.div key={i} {...inView(i * 0.06)}
                className="px-5 py-4 rounded-2xl border border-dashed border-[#d8d8d8] flex items-center gap-3">
                <span className="w-2 h-2 rounded-full shrink-0 bg-[#d8d8d8]" />
                <span className="text-[14px] text-[#aaa] font-medium">{item}</span>
              </motion.div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}