import { motion } from "framer-motion";

const inView = (delay = 0) => ({
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-60px" },
  transition: { duration: 0.65, delay, ease: [0.22, 1, 0.36, 1] },
});

const PRIMARY = "#002F5F";
const SECONDARY = "#01B2F1";
const ACCENT = "#67F2F2";

const steps = [
  {
    num: "01",
    title: "교육과정",
    image: undefined,
    sub: "무엇을 배우는지가 아니라, 어떤 순서로 배우는지를 설계합니다.",
    body: "수영을 감각이나 경험이 아니라 단계별 과정으로 구조화합니다. 어떤 선생님이 가르쳐도 동일한 흐름으로 수업이 진행됩니다.",
    visual: "교육과정 구조 이미지",
  },
  {
    num: "02",
    title: "교재",
    image: undefined,
    sub: "교육과정을 표준화하고, 학생·선생님·학부모가 같은 기준으로 학습 과정을 이해하도록 돕는 기준입니다.",
    body: "교재는 수영을 대신 가르치는 것이 아닙니다. 교재가 있어야 교육의 흐름이 일관되고, 현장에서 선생님의 역량이 더욱 잘 발휘됩니다. 교재는 교육의 기준을 제공하고, 실제 현장 피드백은 SWIMNOTE APP을 통해 이어집니다.",
    visual: "교재 이미지",
    visualNote: [
      { icon: "📚", text: "SWIMNOTE 제휴 시 정식 ISBN을 발급받아 출판됩니다." },
      { icon: "✏️", text: "각 수영장에 맞춰 교재를 편집하여 출판해드립니다." },
      { icon: "👤", text: "출판 저자는 해당 수영장 대표님 명의로 출간됩니다." },
    ],
    extra: (
      <div className="mt-8 space-y-5">
        <div className="bg-[#fafafa] border border-[#ebebeb] rounded-2xl p-6">
          <p className="text-[11px] font-semibold text-[#aaa] tracking-widest uppercase mb-4">PLC 학습구조</p>
          <div className="grid grid-cols-3 gap-3">
            {[
              { letter: "P", word: "Preview", desc: "배울 내용 미리 확인" },
              { letter: "L", word: "Lesson", desc: "단계별 학습 진행" },
              { letter: "C", word: "Check", desc: "습득 여부 확인" },
            ].map((p, i) => (
              <div key={i} className="text-center p-4 bg-white border border-[#ebebeb] rounded-xl">
                <p className="text-[28px] font-bold leading-none mb-1" style={{ color: PRIMARY }}>{p.letter}</p>
                <p className="text-[12px] font-semibold text-[#0a0a0a] mb-1">{p.word}</p>
                <p className="text-[11px] text-[#aaa]">{p.desc}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {["체크포인트", "레벨시스템", "퀘스트", "스티커 도감", "레벨테스트", "성장기록", "학부모 확인", "교육과정"].map((item, i) => (
            <div key={i} className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-[#f5f5f5]">
              <span className="w-1 h-1 rounded-full shrink-0" style={{ background: SECONDARY }} />
              <span className="text-[12px] font-medium text-[#555]">{item}</span>
            </div>
          ))}
        </div>
      </div>
    ),
  },
  {
    num: "03",
    title: "현장교육",
    image: undefined,
    sub: "교재에 담을 수 없는 것은 교육 현장입니다.",
    body: "선생님은 학생의 상태, 실수, 호흡, 리듬, 움직임을 직접 관찰하고 교육합니다. SWIMNOTE는 선생님을 대체하지 않습니다. 교육 시스템 안에서 선생님의 역량을 최대한 발휘할 수 있도록 설계합니다.",
    visual: "현장교육 이미지",
  },
  {
    num: "04",
    title: "APP 피드백",
    image: undefined,
    sub: "현장에서 발생한 교육 내용은 APP를 통해 학부모에게 전달됩니다.",
    body: "수업일지, 사진, 출석, 보강, 성장기록, 피드백이 연결됩니다. 수업이 끝난 후에도 교육은 이어집니다.",
    visual: "앱 피드백 화면",
  },
  {
    num: "05",
    title: "성장기록",
    image: undefined,
    sub: "하루 수업으로 끝나지 않습니다.",
    body: "배운 내용이 기록되고, 누적되고, 확인됩니다. 학부모도 함께 아이의 성장 과정을 확인할 수 있습니다.",
    visual: "성장기록 화면",
  },
  {
    num: "06",
    title: "레벨 시스템",
    image: undefined,
    sub: "단순 승급이 아닙니다.",
    body: "목표를 제시하고, 도전하게 만들며, 성취감을 제공합니다. 각 레벨에는 명확한 기준이 있으며, 달성했을 때 스티커와 기록이 남습니다.",
    visual: "레벨 시스템 / 스티커 도감",
  },
  {
    num: "07",
    title: "레벨 테스트",
    image: undefined,
    sub: "과정을 확인하는 평가입니다.",
    body: "결과보다 과정의 완성을 확인합니다. 테스트는 아이가 다음 단계로 나아갈 준비가 됐는지를 기준으로 진행됩니다.",
    visual: "레벨 테스트 이미지",
  },
  {
    num: "08",
    title: "공인 민간자격",
    image: undefined,
    sub: "SWIMNOTE 교육시스템 기반 수영 지도자 공인 민간자격 체계",
    body: "SWIMNOTE 교육시스템을 기반으로 운영되는 수영 지도자 자격체계를 개발하고 있습니다. 대한수영영법연구원에서는 수영 영법과 교육 기준, 평가 기준을 연구하며 SWIMNOTE 교육시스템과 연계된 자격체계를 개발하고 있습니다.",
    visual: "자격증 이미지",
    badge: "개발 중",
    extra: (
      <div className="mt-6 space-y-3">
        <p className="text-[12px] font-semibold tracking-widest text-[#aaa] uppercase mb-4">개발 중인 자격체계</p>
        {["수영영법분석사 2급", "수영영법분석사 1급", "수영영법기술평가사"].map((q, i) => (
          <div key={i} className="flex items-center gap-3 p-4 border border-[#ebebeb] rounded-xl bg-white">
            <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0" style={{ background: PRIMARY }}>{i + 1}</span>
            <span className="text-[14px] font-semibold text-[#0a0a0a]">{q}</span>
          </div>
        ))}
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl mt-2" style={{ background: "#f0f6ff" }}>
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: SECONDARY }} />
          <span className="text-[13px] font-medium" style={{ color: PRIMARY }}>국가공인 민간자격 추진</span>
        </div>
      </div>
    ),
  },
];

export default function Education() {
  return (
    <div className="pt-16">

      {/* Header */}
      <section className="py-24 md:py-32 px-6 border-b border-[#f0f0f0]">
        <div className="max-w-5xl mx-auto">
          <div className="mb-6" style={{ width: 56 }}>
            <img src={`${import.meta.env.BASE_URL}icon.png`} alt="SWIMNOTE 아이콘" style={{ width: 56, height: "auto", display: "block" }} />
          </div>

          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}
            className="text-[12px] font-semibold tracking-[0.2em] uppercase mb-6" style={{ color: SECONDARY }}>
            SWIMNOTE 교육시스템
          </motion.p>
          <motion.h1 initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
            className="text-[40px] md:text-[64px] font-bold tracking-tight text-[#0a0a0a] leading-[1.12] mb-8">
            SWIMNOTE<br />교육시스템
          </motion.h1>
          <motion.p initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="text-[17px] text-[#777] leading-[1.8] font-light max-w-2xl">
            교육과정, 교재, 현장교육, APP 피드백, 성장기록, 레벨 시스템, 공인 민간자격이<br className="hidden md:block" />
            하나의 흐름으로 연결됩니다.
          </motion.p>
        </div>
      </section>

      {/* Flow steps */}
      <section className="py-8 px-6">
        <div className="max-w-5xl mx-auto">
          {steps.map((s, i) => (
            <motion.div key={i} {...inView(0)} className="py-20 border-b border-[#f0f0f0] last:border-0">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">

                {/* Text – alternates sides */}
                <div className={i % 2 === 1 ? "lg:order-2" : ""}>
                  <div className="flex items-center gap-3 mb-5">
                    <span className="text-[11px] font-bold tracking-widest" style={{ color: PRIMARY }}>{s.num}</span>
                    {s.badge && (
                      <span className="text-[10px] font-semibold px-2.5 py-1 rounded-full border" style={{ color: SECONDARY, borderColor: SECONDARY }}>
                        {s.badge}
                      </span>
                    )}
                  </div>
                  <h2 className="text-[28px] md:text-[36px] font-bold tracking-tight text-[#0a0a0a] mb-4">{s.title}</h2>
                  <p className="text-[16px] font-semibold text-[#333] mb-4 leading-snug">{s.sub}</p>
                  <p className="text-[15px] text-[#777] leading-[1.85] font-light">{s.body}</p>
                  {s.extra}
                </div>

                {/* Visual */}
                <div className={`flex flex-col gap-4 ${i % 2 === 1 ? "lg:order-1" : ""}`}>
                  {(s as any).image ? (
                    <div className="relative">
                      <motion.div
                        className="absolute -inset-6 rounded-[44px] blur-3xl -z-10"
                        style={{ background: "linear-gradient(135deg, rgba(1,178,241,0.28) 0%, rgba(103,242,242,0.18) 100%)" }}
                        animate={{ opacity: [0.3, 0.58, 0.3], scale: [1, 1.03, 1] }}
                        transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut" }}
                      />
                      <motion.div
                        animate={{ y: [0, -8, 0] }}
                        transition={{ duration: 5.5, repeat: Infinity, ease: "easeInOut" }}
                        whileHover={{ scale: 1.02, transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] } }}
                        className="rounded-3xl overflow-hidden cursor-default"
                        style={{ boxShadow: "0 24px 60px rgba(1,178,241,0.16), 0 8px 24px rgba(0,47,95,0.09)" }}
                      >
                        <img src={(s as any).image} alt={s.title} className="w-full h-auto" />
                      </motion.div>
                    </div>
                  ) : (
                  <div className="rounded-3xl aspect-[4/3] relative overflow-hidden">
                    <div className="absolute inset-0" style={{ background: "linear-gradient(135deg, #002F5F 0%, #01B2F1 100%)" }} />
                    <div className="absolute -bottom-4 -right-4 w-40 h-40 rounded-full bg-white opacity-5" />
                    <div className="absolute top-4 left-4 w-20 h-20 rounded-full bg-white opacity-5" />
                    <div className="absolute bottom-3 right-4 text-[72px] font-black text-white opacity-10 leading-none select-none">{s.num}</div>
                    <div className="relative z-10 flex flex-col items-center justify-center h-full gap-5 p-6">
                      <div style={{ width: 64, height: 40, overflow: "hidden", borderRadius: 12, flexShrink: 0 }}>
                        <img src={`${import.meta.env.BASE_URL}icon.png`} alt="SWIMNOTE" style={{ width: 64, height: "auto", display: "block" }} />
                      </div>
                      <div className="text-center">
                        <p className="text-white text-[16px] font-bold mb-1">{s.title}</p>
                        <p className="text-white text-[12px] opacity-60">{s.visual}</p>
                      </div>
                    </div>
                  </div>
                  )}
                  {s.visualNote && (
                    <div className="rounded-2xl border border-[#ebebeb] bg-white p-5 space-y-3">
                      {s.visualNote.map((item: { icon: string; text: string }, idx: number) => (
                        <div key={idx} className="flex items-start gap-3">
                          <span className="text-[16px] shrink-0 mt-0.5">{item.icon}</span>
                          <p className="text-[13.5px] text-[#444] leading-[1.75] font-light">{item.text}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Arrow connector */}
              {i < steps.length - 1 && (
                <div className="mt-12 flex justify-center">
                  <div className="flex flex-col items-center gap-1">
                    <div className="w-px h-8 bg-[#e0e0e0]" />
                    <div className="w-2 h-2 rounded-full" style={{ background: SECONDARY }} />
                  </div>
                </div>
              )}
            </motion.div>
          ))}
        </div>
      </section>
    </div>
  );
}