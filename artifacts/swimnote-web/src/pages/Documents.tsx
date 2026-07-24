import { PageHeader, SectionCard, StatCard, FeatureBadge, Button } from "../components/ui";
import { FileText, Plus, Upload } from "lucide-react";

export default function Documents() {
  return (
    <div className="p-6">
      <PageHeader title="문서" subtitle="Documents — 수영 관련 문서·자료를 관리합니다." badge={<FeatureBadge kind="LIVE" />}
        actions={<div className="flex gap-2"><Button variant="primary"><Plus size={12} /> 문서 추가</Button><Button variant="secondary"><Upload size={12} /> 업로드</Button></div>} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="전체 문서" value="84" color="slate" />
        <StatCard label="공식 자료" value="23" color="blue" />
        <StatCard label="연구 논문" value="31" color="purple" />
        <StatCard label="코칭 자료" value="30" color="teal" />
      </div>
      <SectionCard title="최근 문서">
        <div className="p-4 space-y-3">
          {["FINA 수영 기술 규정 2024", "수영 생체역학 연구 리뷰", "접영 DTA 분석 보고서", "자유형 캐치 연구", "평영킥 최적화 연구"].map(doc => (
            <div key={doc} className="flex items-center gap-3 py-2 border-b border-slate-50 last:border-0">
              <FileText size={14} className="text-slate-400 shrink-0" />
              <div className="flex-1 text-sm font-medium text-slate-700">{doc}</div>
              <Button variant="ghost" size="xs">보기</Button>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
