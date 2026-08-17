/**
 * SuperAI — AI 운영
 * 기존 GlobalTemplateSets + GrowthReviewStats 재사용 (MOVED).
 * Usage/Errors는 SA0-B에서 연결.
 */
import { useState } from "react";
import GlobalTemplateSets from "@/pages/super/GlobalTemplateSets";
import GrowthReviewStats from "@/pages/super/GrowthReviewStats";

type AiTab = "templates" | "growth-stats" | "usage" | "errors";

const TABS: { id: AiTab; label: string; ready: boolean }[] = [
  { id: "templates",    label: "글로벌 템플릿",  ready: true },
  { id: "growth-stats", label: "검토 통계",      ready: true },
  { id: "usage",        label: "Usage",           ready: false },
  { id: "errors",       label: "Errors",          ready: false },
];

function PlaceholderSection({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="p-6">
      <h2 className="text-[16px] font-bold text-[#111] mb-2">{title}</h2>
      <div className="bg-white border border-[#e5e5e5] rounded-lg p-8 text-center">
        <p className="text-[13px] text-[#888]">{desc}</p>
        <span className="inline-block mt-3 text-[11px] text-[#bbb] bg-[#f5f5f5] px-3 py-1 rounded-full">SA0-B에서 구현</span>
      </div>
    </div>
  );
}

export default function SuperAI() {
  const [tab, setTab] = useState<AiTab>("templates");

  return (
    <div>
      {/* Sub-nav */}
      <div className="bg-white border-b border-[#e5e5e5] px-6 py-3 flex gap-1">
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
        {tab === "templates"    && <GlobalTemplateSets />}
        {tab === "growth-stats" && <GrowthReviewStats />}
        {tab === "usage"        && <PlaceholderSection title="AI Usage" desc="AI 기능별 사용량 · 모델 · 비용 메트릭" />}
        {tab === "errors"       && <PlaceholderSection title="AI Errors" desc="최근 AI 호출 오류 · 재시도 현황" />}
      </div>
    </div>
  );
}
