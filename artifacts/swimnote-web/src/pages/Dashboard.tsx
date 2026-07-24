import { Link } from "wouter";
import { PageHeader, StatCard, SectionCard, FeatureBadge } from "../components/ui";
import { ScanSearch, ArrowRight, CheckCircle2, Zap, Clock, AlertTriangle } from "lucide-react";

const FLOW_STEPS = [
  { label: "질문 입력", kind: "LIVE" as const },
  { label: "내부 DB 검색", kind: "LIVE" as const },
  { label: "확장검색", kind: "PROTOTYPE" as const },
  { label: "주장 추출", kind: "PROTOTYPE" as const },
  { label: "출처 분석", kind: "PLANNED" as const },
  { label: "과학·DTA 검증", kind: "PLANNED" as const },
  { label: "관리자 승인", kind: "LIVE" as const },
  { label: "AI 답변 반영", kind: "PLANNED" as const },
  { label: "영상·교정 결과 학습", kind: "LOCKED" as const },
];

export default function Dashboard() {
  return (
    <div className="p-6">
      <PageHeader
        title="SWIMNOTE AI 관리자 대시보드"
        subtitle="지식 팩토리 및 오개념 헌터 시스템 현황"
        badge={<FeatureBadge kind="PROTOTYPE" />}
      />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="전체 지식 문서" value="247" sub="Knowledge DB" color="blue" />
        <StatCard label="오개념 후보" value="128" sub="수집된 주장" color="slate" />
        <StatCard label="검토 필요" value="26" sub="즉시 검토 필요" color="amber" />
        <StatCard label="검증 완료" value="54" sub="승인된 판정" color="green" />
      </div>

      {/* System Flow */}
      <SectionCard title="시스템 흐름" className="mb-6">
        <div className="p-4">
          <p className="text-xs text-slate-500 mb-4">각 단계의 현재 구현 상태를 확인합니다.</p>
          <div className="flex flex-wrap items-center gap-2">
            {FLOW_STEPS.map((step, i) => (
              <div key={step.label} className="flex items-center gap-2">
                <div className="flex flex-col items-center gap-1">
                  <div className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs font-medium text-slate-700 text-center whitespace-nowrap">
                    {step.label}
                  </div>
                  <FeatureBadge kind={step.kind} />
                </div>
                {i < FLOW_STEPS.length - 1 && (
                  <ArrowRight size={14} className="text-slate-300 shrink-0" />
                )}
              </div>
            ))}
          </div>
        </div>
      </SectionCard>

      {/* Quick Links */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SectionCard title="오개념 헌터 빠른 이동">
          <div className="p-4 space-y-2">
            {[
              { label: "주장 수집함", sub: "신규 주장 17개 검토 대기", path: "/ai-admin/misconception/claim-inbox", icon: <AlertTriangle size={14} className="text-amber-500" /> },
              { label: "검증 워크벤치", sub: "10단계 검증 프로세스", path: "/ai-admin/misconception/verification-workbench", icon: <CheckCircle2 size={14} className="text-blue-500" /> },
              { label: "DTA 검증실", sub: "Direction · Timing · Advance", path: "/ai-admin/misconception/dta-lab", icon: <Zap size={14} className="text-purple-500" /> },
              { label: "자동사냥 설정", sub: "자동 크롤링 설정 관리", path: "/ai-admin/misconception/hunter-automation", icon: <ScanSearch size={14} className="text-slate-500" /> },
            ].map(item => (
              <Link key={item.path} href={item.path} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer">
                {item.icon}
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-slate-700">{item.label}</div>
                  <div className="text-[11px] text-slate-400">{item.sub}</div>
                </div>
                <ArrowRight size={12} className="text-slate-300" />
              </Link>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="시스템 상태">
          <div className="p-4 space-y-3">
            {[
              { label: "오개념 수집 구조", status: "PROTOTYPE", note: "주장 등록·수정 가능" },
              { label: "자동 크롤링", status: "LOCKED", note: "향후 연결 예정" },
              { label: "DTA 자동 계산", status: "PLANNED", note: "수동 입력 가능" },
              { label: "관리자 승인 흐름", status: "PROTOTYPE", note: "상태·메모 수정 가능" },
              { label: "영상 모션 캡처", status: "LOCKED", note: "ENGINE 5 연결 예정" },
            ].map(item => (
              <div key={item.label} className="flex items-center gap-2">
                <FeatureBadge kind={item.status as any} />
                <span className="text-xs font-medium text-slate-700 flex-1">{item.label}</span>
                <span className="text-[11px] text-slate-400">{item.note}</span>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
