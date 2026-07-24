import { PageHeader, SectionCard, FeatureBadge, Button } from "../components/ui";
import { Save } from "lucide-react";

export default function Settings() {
  return (
    <div className="p-6 max-w-2xl">
      <PageHeader title="설정" subtitle="Settings — SWIMNOTE AI 관리자 시스템 설정입니다." badge={<FeatureBadge kind="LIVE" />} />
      <div className="space-y-4">
        <SectionCard title="시스템 설정">
          <div className="p-4 space-y-3">
            {[{ label: "시스템 이름", value: "SWIMNOTE AI 관리자" }, { label: "버전", value: "v0.1-prototype" }, { label: "관리자 이메일", value: "admin@swimnote.kr" }].map(item => (
              <div key={item.label}>
                <label className="text-xs font-semibold text-slate-600 block mb-1">{item.label}</label>
                <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none" defaultValue={item.value} />
              </div>
            ))}
            <Button variant="primary"><Save size={12} /> 저장</Button>
          </div>
        </SectionCard>
        <SectionCard title="오개념 헌터 글로벌 설정">
          <div className="p-4 space-y-3">
            {[{ label: "기본 확신도 임계값 (%)", value: "70" }, { label: "반복 횟수 임계값", value: "3" }, { label: "자동 검토 태그 임계값", value: "5" }].map(item => (
              <div key={item.label}>
                <label className="text-xs font-semibold text-slate-600 block mb-1">{item.label}</label>
                <input type="number" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none" defaultValue={item.value} />
              </div>
            ))}
            <Button variant="primary"><Save size={12} /> 저장</Button>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
