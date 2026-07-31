import { motion, HTMLMotionProps } from "framer-motion";
import { Smartphone, Mail, AlertTriangle, ChevronRight } from "lucide-react";

const inView = (delay = 0): HTMLMotionProps<"div"> => ({
  initial: { opacity: 0, y: 20 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true },
  transition: { duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] },
});

const PRIMARY = "#002F5F";
const SECONDARY = "#01B2F1";

export default function DeleteAccount() {
  return (
    <div className="min-h-screen bg-white">
      {/* Hero */}
      <section className="pt-28 pb-16 px-6" style={{ background: "linear-gradient(135deg, #f8faff 0%, #eef4ff 100%)" }}>
        <div className="max-w-2xl mx-auto text-center">
          <motion.div {...inView(0)}>
            <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-[12px] font-semibold mb-6"
              style={{ background: "#e8f0fe", color: PRIMARY }}>
              계정 삭제 안내
            </span>
          </motion.div>
          <motion.h1 {...inView(0.1)} className="text-[32px] md:text-[40px] font-bold text-[#0a0a0a] leading-tight mb-4">
            SwimNote 계정 삭제
          </motion.h1>
          <motion.p {...inView(0.2)} className="text-[16px] text-[#666] leading-relaxed">
            계정 삭제 시 모든 데이터가 영구적으로 삭제되며 복구할 수 없습니다.<br />
            아래 방법 중 하나를 이용해주세요.
          </motion.p>
        </div>
      </section>

      {/* Warning */}
      <section className="px-6 py-8">
        <div className="max-w-2xl mx-auto">
          <motion.div {...inView(0)} className="flex gap-4 p-5 rounded-2xl border"
            style={{ background: "#fff8f0", borderColor: "#ffd6a5" }}>
            <AlertTriangle size={20} color="#f07000" className="shrink-0 mt-0.5" />
            <div>
              <p className="text-[14px] font-semibold text-[#b85000] mb-1">삭제 전 반드시 확인하세요</p>
              <ul className="text-[13px] text-[#b85000] space-y-1 list-disc list-inside">
                <li>수업 기록, 일지, 출결 데이터가 모두 삭제됩니다</li>
                <li>삭제된 데이터는 복구할 수 없습니다</li>
                <li>연결된 수영장 서비스도 이용 불가합니다</li>
              </ul>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Methods */}
      <section className="px-6 pb-16">
        <div className="max-w-2xl mx-auto space-y-6">

          {/* Method 1: App */}
          <motion.div {...inView(0.05)} className="p-8 rounded-2xl border border-[#ebebeb] bg-white shadow-sm">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: "#eef4ff" }}>
                <Smartphone size={20} color={PRIMARY} />
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: SECONDARY }}>방법 1 — 권장</p>
                <h2 className="text-[18px] font-bold text-[#0a0a0a]">앱에서 직접 삭제</h2>
              </div>
            </div>
            <ol className="space-y-3">
              {[
                "SwimNote 앱을 실행합니다",
                "하단 탭에서 '내 정보' 또는 '설정'을 탭합니다",
                "화면 아래 '계정 탈퇴'를 탭합니다",
                "탈퇴 사유를 선택하고 '탈퇴하기'를 탭합니다",
                "확인 후 즉시 탈퇴가 완료됩니다",
              ].map((step, i) => (
                <li key={i} className="flex gap-3 items-start">
                  <span className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-[12px] font-bold text-white mt-0.5"
                    style={{ background: PRIMARY }}>{i + 1}</span>
                  <span className="text-[14px] text-[#444] leading-snug pt-0.5">{step}</span>
                </li>
              ))}
            </ol>
            <a href="https://apps.apple.com/kr/app/swimnote/id6761360360"
              target="_blank" rel="noopener noreferrer"
              className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-white text-[13px] font-semibold hover:opacity-85 transition-opacity"
              style={{ background: PRIMARY }}>
              App Store에서 앱 열기 <ChevronRight size={14} />
            </a>
          </motion.div>

          {/* Method 2: Email */}
          <motion.div {...inView(0.1)} className="p-8 rounded-2xl border border-[#ebebeb] bg-white shadow-sm">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: "#eef4ff" }}>
                <Mail size={20} color={PRIMARY} />
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: SECONDARY }}>방법 2</p>
                <h2 className="text-[18px] font-bold text-[#0a0a0a]">이메일로 삭제 요청</h2>
              </div>
            </div>
            <p className="text-[14px] text-[#555] mb-4 leading-relaxed">
              앱에 접근할 수 없거나 삭제에 어려움이 있는 경우 이메일로 요청하시면 <strong>영업일 기준 3일 이내</strong>에 처리해드립니다.
            </p>
            <div className="p-4 rounded-xl text-[13px] space-y-1.5" style={{ background: "#f8faff" }}>
              <p><span className="text-[#999]">이메일</span> <span className="font-medium text-[#0a0a0a]">swimnote.admin@gmail.com</span></p>
              <p><span className="text-[#999]">제목</span> <span className="font-medium text-[#0a0a0a]">[계정 삭제 요청] 가입 시 이름 또는 아이디</span></p>
              <p><span className="text-[#999]">내용</span> <span className="text-[#555]">가입 이름, 연락처, 삭제 요청 사유 (간단히)</span></p>
            </div>
            <a href="mailto:swimnote.admin@gmail.com?subject=[계정 삭제 요청]"
              className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-[13px] font-semibold border hover:opacity-75 transition-opacity"
              style={{ borderColor: PRIMARY, color: PRIMARY }}>
              이메일 보내기 <ChevronRight size={14} />
            </a>
          </motion.div>
        </div>
      </section>

      {/* Footer note */}
      <section className="px-6 pb-20">
        <div className="max-w-2xl mx-auto">
          <motion.p {...inView(0)} className="text-[12px] text-center text-[#bbb]">
            개인정보 처리에 관한 자세한 내용은{" "}
            <a href="https://swimnote.kr/api/privacy-policy" target="_blank" rel="noopener noreferrer"
              className="underline hover:text-[#888] transition-colors">개인정보처리방침</a>을 참고해주세요.
          </motion.p>
        </div>
      </section>
    </div>
  );
}
