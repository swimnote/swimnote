import { useState, useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import { Phone, MapPin, ChevronDown, ChevronUp } from "lucide-react";

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

function Section({ title, content, color }: { title: string; content: string; color: string }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="bg-white rounded-2xl border border-[#ebebeb] overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-6 py-4 text-left"
      >
        <span className="text-[14px] font-bold text-[#0a0a0a]">{title}</span>
        {open
          ? <ChevronUp size={16} className="text-[#aaa]" />
          : <ChevronDown size={16} className="text-[#aaa]" />}
      </button>
      {open && (
        <div className="px-6 pb-6">
          <div
            className="w-8 h-0.5 rounded mb-4"
            style={{ background: color }}
          />
          <p className="text-[14px] text-[#333] leading-relaxed whitespace-pre-wrap">{content}</p>
        </div>
      )}
    </div>
  );
}

export default function PoolHomepage() {
  const [, params] = useRoute("/:slug");
  const [, navigate] = useLocation();
  const slug = params?.slug ?? "";

  const [pool, setPool] = useState<PoolData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

  useEffect(() => {
    if (!slug) return;
    (async () => {
      try {
        const res = await fetch(`${BASE}/api/pools/by-slug/${encodeURIComponent(slug)}`);
        if (res.status === 404) { setNotFound(true); return; }
        if (!res.ok) { setNotFound(true); return; }
        setPool(await res.json());
      } catch { setNotFound(true); }
      finally { setLoading(false); }
    })();
  }, [slug, BASE]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f8f9fb]">
        <span className="text-[#aaa] text-[14px]">불러오는 중...</span>
      </div>
    );
  }

  if (notFound || !pool) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#f8f9fb] px-4">
        <div className="text-center">
          <div className="text-6xl mb-6">🏊</div>
          <h1 className="text-[20px] font-bold text-[#0a0a0a] mb-2">홈페이지를 찾을 수 없습니다</h1>
          <p className="text-[14px] text-[#888] mb-8">주소를 다시 확인하거나 수영장에 문의해주세요.</p>
          <button
            onClick={() => navigate("/")}
            className="px-6 py-3 rounded-xl bg-[#002F5F] text-white text-[13px] font-semibold hover:opacity-85 transition-opacity"
          >
            SWIMNOTE 홈으로
          </button>
        </div>
      </div>
    );
  }

  const primaryColor = pool.theme_color || "#002F5F";
  const sections = [
    { key: "introduction", title: "수영장 소개", content: pool.introduction },
    { key: "tuition_info", title: "수강료 안내", content: pool.tuition_info },
    { key: "level_test_info", title: "레벨 테스트", content: pool.level_test_info },
    { key: "event_info", title: "이벤트 안내", content: pool.event_info },
    { key: "equipment_info", title: "준비물 안내", content: pool.equipment_info },
  ].filter(s => !!s.content);

  return (
    <div className="min-h-screen bg-[#f8f9fb]">
      {/* Hero Header */}
      <div
        className="relative overflow-hidden"
        style={{ background: `linear-gradient(135deg, ${primaryColor} 0%, ${primaryColor}cc 100%)` }}
      >
        <div className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: "radial-gradient(circle at 70% 50%, white 0%, transparent 60%)"
          }}
        />
        <div className="relative max-w-2xl mx-auto px-6 py-14 text-white">
          {/* Logo / Emoji */}
          <div className="mb-5">
            {pool.logo_emoji ? (
              <span className="text-5xl">{pool.logo_emoji}</span>
            ) : pool.logo_url ? (
              <img src={pool.logo_url} alt="로고" className="w-16 h-16 rounded-2xl object-cover" />
            ) : (
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center text-[28px] font-black"
                style={{ background: "rgba(255,255,255,0.2)" }}
              >
                🏊
              </div>
            )}
          </div>
          <h1 className="text-[28px] font-black mb-2 tracking-tight">{pool.name}</h1>
          <div className="flex flex-col gap-1.5 opacity-90">
            <div className="flex items-center gap-2 text-[13px]">
              <MapPin size={13} className="flex-shrink-0 opacity-80" />
              <span>{pool.address}</span>
            </div>
            {pool.phone && (
              <div className="flex items-center gap-2 text-[13px]">
                <Phone size={13} className="flex-shrink-0 opacity-80" />
                <a href={`tel:${pool.phone}`} className="hover:underline">{pool.phone}</a>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Quick Contact Bar */}
      {pool.phone && (
        <div className="bg-white border-b border-[#ebebeb] sticky top-0 z-10">
          <div className="max-w-2xl mx-auto px-6 py-3 flex items-center justify-between">
            <span className="text-[13px] font-bold text-[#0a0a0a] truncate">{pool.name}</span>
            <a
              href={`tel:${pool.phone}`}
              className="flex items-center gap-2 px-4 py-2 rounded-full text-white text-[12px] font-semibold"
              style={{ background: primaryColor }}
            >
              <Phone size={12} />
              전화하기
            </a>
          </div>
        </div>
      )}

      {/* Content Sections */}
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-3">
        {sections.length === 0 ? (
          <div className="bg-white rounded-2xl border border-[#ebebeb] p-10 text-center">
            <p className="text-[14px] text-[#aaa]">아직 등록된 정보가 없습니다.</p>
          </div>
        ) : (
          sections.map(s => (
            <Section key={s.key} title={s.title} content={s.content!} color={primaryColor} />
          ))
        )}
      </div>

      {/* Footer */}
      <div className="max-w-2xl mx-auto px-6 pb-12 text-center">
        <p className="text-[11px] text-[#ccc]">
          Powered by{" "}
          <a href="/" className="font-semibold text-[#aaa] hover:text-[#555] transition-colors">
            SWIMNOTE
          </a>
        </p>
      </div>
    </div>
  );
}
