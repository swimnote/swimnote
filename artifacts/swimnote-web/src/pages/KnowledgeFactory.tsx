import { PageHeader, SectionCard, StatCard, FeatureBadge, Button } from "../components/ui";
import { BookOpen, Plus, Upload, Search } from "lucide-react";

export default function KnowledgeFactory() {
  return (
    <div className="p-6">
      <PageHeader
        title="지식 팩토리"
        subtitle="Knowledge Factory — 수영 지식을 생성·검토·승인하여 AI 답변의 근거로 사용합니다."
        badge={<FeatureBadge kind="LIVE" />}
        actions={
          <div className="flex gap-2">
            <Button variant="primary"><Plus size={12} /> 지식 추가</Button>
            <Button variant="secondary"><Upload size={12} /> 가져오기</Button>
          </div>
        }
      />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="전체 지식 항목" value="247" color="blue" />
        <StatCard label="검토 중" value="12" color="amber" />
        <StatCard label="승인됨" value="221" color="green" />
        <StatCard label="아카이브" value="14" color="slate" />
      </div>
      <SectionCard title="최근 지식 항목">
        <div className="p-4 space-y-3">
          {["자유형 캐치 메커니즘", "평영킥 생체역학", "접영 타이밍 원칙", "배영 머리 위치", "DTA 기본 개념"].map(item => (
            <div key={item} className="flex items-center gap-3 py-2 border-b border-slate-50 last:border-0">
              <BookOpen size={14} className="text-blue-400 shrink-0" />
              <div className="flex-1">
                <div className="text-sm font-medium text-slate-700">{item}</div>
                <div className="text-[11px] text-slate-400">Knowledge DB 항목 · 검증 완료</div>
              </div>
              <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded font-semibold">LIVE</span>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
