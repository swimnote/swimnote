import { useEffect, useState } from "react";
import { useRoute, useLocation } from "wouter";
import { api } from "@/lib/api";

const PRIMARY = "#002F5F";
const SECONDARY = "#01B2F1";

interface Pool {
  id: string;
  name: string;
  address: string;
  phone: string;
  owner_name: string;
  approval_status: string;
  subscription_status: string;
}

export default function PoolPage() {
  const [match, params] = useRoute("/pool/:id");
  const [, navigate] = useLocation();
  const [pool, setPool] = useState<Pool | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!params?.id) return;
    api.get<Pool>(`/pools/${params.id}/public`)
      .then(setPool)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [params?.id]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-[#aaa] text-[14px]">로딩 중...</div>
      </div>
    );
  }

  if (error || !pool || pool.approval_status !== "approved") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
        <div className="w-16 h-16 rounded-2xl mb-6 flex items-center justify-center" style={{ background: "#f5f5f5" }}>
          <span className="text-[28px]">🏊</span>
        </div>
        <h1 className="text-[22px] font-bold text-[#0a0a0a] mb-3">수영장을 찾을 수 없습니다</h1>
        <p className="text-[14px] text-[#888] mb-8">요청하신 수영장 페이지가 존재하지 않거나 비공개 상태입니다.</p>
        <button
          onClick={() => navigate("/")}
          className="px-6 py-3 rounded-full text-white text-[14px] font-semibold transition-opacity hover:opacity-85"
          style={{ background: PRIMARY }}
        >
          홈으로
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      {/* Hero */}
      <div className="h-2 w-full" style={{ background: `linear-gradient(90deg, ${PRIMARY} 0%, ${SECONDARY} 100%)` }} />
      <div className="max-w-3xl mx-auto px-6 py-20">
        <div className="text-center mb-16">
          <div
            className="inline-flex items-center justify-center w-20 h-20 rounded-3xl mb-6"
            style={{ background: `linear-gradient(135deg, ${PRIMARY} 0%, ${SECONDARY} 100%)` }}
          >
            <span className="text-white text-[36px]">🏊</span>
          </div>
          <h1 className="text-[32px] sm:text-[40px] font-bold text-[#0a0a0a] mb-4">{pool.name}</h1>
          <p className="text-[15px] text-[#888]">{pool.address}</p>
        </div>

        {/* Info cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-12">
          <div className="p-6 rounded-2xl border border-[#ebebeb]">
            <p className="text-[11px] font-semibold text-[#aaa] tracking-widest uppercase mb-2">연락처</p>
            <a href={`tel:${pool.phone.replace(/-/g, "")}`} className="text-[18px] font-bold text-[#0a0a0a] hover:underline">{pool.phone}</a>
          </div>
          <div className="p-6 rounded-2xl border border-[#ebebeb]">
            <p className="text-[11px] font-semibold text-[#aaa] tracking-widest uppercase mb-2">원장</p>
            <p className="text-[18px] font-bold text-[#0a0a0a]">{pool.owner_name}</p>
          </div>
        </div>

        {/* SWIMNOTE promo */}
        <div className="p-8 rounded-3xl mb-8" style={{ background: `linear-gradient(135deg, ${PRIMARY} 0%, #005092 100%)` }}>
          <p className="text-[12px] font-semibold tracking-widest uppercase text-white/60 mb-3" translate="no">SWIMNOTE APP</p>
          <h2 className="text-[22px] font-bold text-white mb-3">수업 피드백을 앱으로 받아보세요</h2>
          <p className="text-[14px] text-white/70 mb-6 leading-relaxed">
            출석 알림, 수업일지, 사진 앨범, 레벨 확인까지<br />학부모님이 앱에서 바로 확인하실 수 있습니다.
          </p>
          <div className="flex flex-wrap gap-3">
            <a
              href="https://apps.apple.com/app/swimnote"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-white text-[13px] font-semibold transition-opacity hover:opacity-90"
              style={{ color: PRIMARY }}
            >
              App Store
            </a>
            <a
              href="https://play.google.com/store/apps/swimnote"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-white/20 text-white text-[13px] font-semibold transition-opacity hover:opacity-90 border border-white/30"
            >
              Google Play
            </a>
          </div>
        </div>

        <div className="text-center">
          <button
            onClick={() => navigate("/")}
            className="text-[13px] text-[#bbb] hover:text-[#888] transition-colors"
          >
            SWIMNOTE 홈페이지 →
          </button>
        </div>
      </div>
    </div>
  );
}
