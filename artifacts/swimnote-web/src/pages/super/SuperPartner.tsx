/**
 * SuperPartner — Partner Analytics
 * SA0-A: 기존 AnalyticsDashboard + AdCreativeManager 재배치 (MOVED).
 * Partner Evidence / AI Usage 등은 향후 WP에서 구현.
 */
import { useState } from "react";
import AnalyticsDashboard from "@/pages/super/AnalyticsDashboard";
import AdCreativeManager from "@/pages/super/AdCreativeManager";

type PartnerTab = "overview" | "ad-creatives" | "adoption" | "usage" | "business" | "evidence";

const TABS: { id: PartnerTab; label: string; ready: boolean }[] = [
  { id: "overview",      label: "광고 개요",        ready: true },
  { id: "ad-creatives",  label: "Creative 관리",    ready: true },
  { id: "adoption",      label: "Adoption",         ready: false },
  { id: "usage",         label: "Usage",            ready: false },
  { id: "business",      label: "Business Impact",  ready: false },
  { id: "evidence",      label: "Evidence",         ready: false },
];

function PlaceholderSection({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="p-6">
      <h2 className="text-[16px] font-bold text-[#111] mb-2">{title}</h2>
      <div className="bg-white border border-[#e5e5e5] rounded-lg p-8 text-center">
        <p className="text-[13px] text-[#888]">{desc}</p>
        <span className="inline-block mt-3 text-[11px] text-[#bbb] bg-[#f5f5f5] px-3 py-1 rounded-full">계측 준비중</span>
      </div>
    </div>
  );
}

export default function SuperPartner() {
  const [tab, setTab] = useState<PartnerTab>("overview");

  return (
    <div>
      {/* Sub-nav */}
      <div className="bg-white border-b border-[#e5e5e5] px-6 py-3 flex gap-1 flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            disabled={!t.ready}
            className={`px-4 py-1.5 rounded-full text-[12px] font-medium transition-all ${
              tab === t.id
                ? "bg-[#002F5F] text-white"
                : t.ready
                  ? "text-[#555] hover:bg-[#f5f5f5]"
                  : "text-[#ccc] cursor-not-allowed"
            }`}
          >
            {t.label}
            {!t.ready && <span className="ml-1 text-[10px]">(준비중)</span>}
          </button>
        ))}
      </div>

      {/* Content */}
      <div>
        {tab === "overview"     && <AnalyticsDashboard />}
        {tab === "ad-creatives" && <AdCreativeManager />}
        {tab === "adoption"     && <PlaceholderSection title="Adoption" desc="수영장별 기능 채택율 · X Mode 활성화율" />}
        {tab === "usage"        && <PlaceholderSection title="Usage" desc="AI 기능별 사용량 · 세션 · DAU/MAU" />}
        {tab === "business"     && <PlaceholderSection title="Business Impact" desc="구독 전환 · 유지율 · 수익 기여" />}
        {tab === "evidence"     && <PlaceholderSection title="Evidence Export" desc="파트너 리포트 · 데이터 내보내기" />}
      </div>
    </div>
  );
}
