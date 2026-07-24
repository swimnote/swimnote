import { PageHeader, SectionCard, StatCard, FeatureBadge, Button } from "../components/ui";
import { Database, Search } from "lucide-react";

export default function KnowledgeDB() {
  return (
    <div className="p-6">
      <PageHeader title="지식 DB" subtitle="Knowledge DB — 검증된 수영 지식의 최종 저장소입니다." badge={<FeatureBadge kind="LIVE" />}
        actions={<Button variant="secondary"><Search size={12} /> 검색</Button>} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="전체 항목" value="1,247" color="blue" />
        <StatCard label="자유형" value="423" color="slate" />
        <StatCard label="DTA 연결됨" value="312" color="green" />
        <StatCard label="오개념 금지 표현" value="89" color="red" />
      </div>
      <SectionCard title="최근 등록 항목">
        <div className="p-4 space-y-3">
          {["High Elbow Catch 원리", "접영 돌핀킥 타이밍", "평영킥 추진 메커니즘", "배영 롤링 효과", "자유형 호흡 타이밍"].map(item => (
            <div key={item} className="flex items-center gap-3 py-2 border-b border-slate-50 last:border-0">
              <Database size={14} className="text-blue-400 shrink-0" />
              <div className="flex-1 text-sm font-medium text-slate-700">{item}</div>
              <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded">검증 완료</span>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
