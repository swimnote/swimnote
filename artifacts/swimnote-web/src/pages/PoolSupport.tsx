import { Mail, Phone, LayoutDashboard } from "lucide-react";
import { useLocation } from "wouter";

const SECONDARY = "#01B2F1";
const PRIMARY = "#002F5F";

export default function PoolSupport() {
  const [, navigate] = useLocation();

  return (
    <section className="py-20 px-6">
      <div className="max-w-xl mx-auto flex flex-col gap-4">
        <a
          href="mailto:swimnote.admin@gmail.com"
          className="flex items-center gap-5 px-6 py-5 rounded-2xl border border-[#ebebeb] bg-white hover:border-[#d0d0d0] transition-colors"
        >
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "#e8f7fd" }}>
            <Mail className="w-5 h-5" style={{ color: SECONDARY }} />
          </div>
          <div>
            <p className="text-[12px] text-[#888] mb-0.5">이메일</p>
            <p className="text-[15px] font-semibold text-[#0a0a0a]">swimnote.admin@gmail.com</p>
          </div>
        </a>

        <a
          href="tel:010-7787-1507"
          className="flex items-center gap-5 px-6 py-5 rounded-2xl border border-[#ebebeb] bg-white hover:border-[#d0d0d0] transition-colors"
        >
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "#e8f7fd" }}>
            <Phone className="w-5 h-5" style={{ color: SECONDARY }} />
          </div>
          <div>
            <p className="text-[12px] text-[#888] mb-0.5">전화 / 문자</p>
            <p className="text-[15px] font-semibold text-[#0a0a0a]">010-7787-1507</p>
            <p className="text-[12px] text-[#aaa] mt-0.5">문자 가능</p>
          </div>
        </a>

        <button
          onClick={() => navigate("/login")}
          className="flex items-center gap-5 px-6 py-5 rounded-2xl border border-[#ebebeb] bg-white hover:border-[#d0d0d0] transition-colors text-left w-full"
        >
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "#eef2f8" }}>
            <LayoutDashboard className="w-5 h-5" style={{ color: PRIMARY }} />
          </div>
          <div>
            <p className="text-[12px] text-[#888] mb-0.5">관리자</p>
            <p className="text-[15px] font-semibold text-[#0a0a0a]">스윔노트 웹 관리자</p>
          </div>
        </button>
      </div>
    </section>
  );
}
