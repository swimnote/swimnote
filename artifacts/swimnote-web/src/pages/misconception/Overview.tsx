import { Link } from "wouter";
import { PageHeader, StatCard, SectionCard, FeatureBadge } from "../../components/ui";
import { ScanSearch, ArrowRight } from "lucide-react";

const FLOW_STEPS = [
  { label: "질문 입력", kind: "LIVE" as const, desc: "사용자 질문 수집" },
  { label: "내부 DB 검색", kind: "LIVE" as const, desc: "Knowledge DB 조회" },
  { label: "확장검색", kind: "PROTOTYPE" as const, desc: "외부 소스 탐색" },
  { label: "주장 추출", kind: "PROTOTYPE" as const, desc: "비근거 주장 감지" },
  { label: "출처 분석", kind: "PLANNED" as const, desc: "출처 신뢰도 분석" },
  { label: "과학·DTA 검증", kind: "PLANNED" as const, desc: "물리·DTA 검증" },
  { label: "관리자 승인", kind: "LIVE" as const, desc: "최종 판정 승인" },
  { label: "AI 답변 반영", kind: "PLANNED" as const, desc: "Knowledge DB 업데이트" },
  { label: "영상·교정 학습", kind: "LOCKED" as const, desc: "교정 결과 학습" },
];

const SUB_MENUS = [
  { label: "주장 수집함", en: "Claim Inbox", path: "/ai-admin/misconception/claim-inbox", desc: "비근거·오개념 후보 관리", badge: "PROTOTYPE" },
  { label: "검증 워크벤치", en: "Verification Workbench", path: "/ai-admin/misconception/verification-workbench", desc: "10단계 검증 프로세스", badge: "PROTOTYPE" },
  { label: "출처 인텔리전스", en: "Source Intelligence", path: "/ai-admin/misconception/source-intelligence", desc: "출처별 주장 분석", badge: "PROTOTYPE" },
  { label: "DTA 검증실", en: "DTA Lab", path: "/ai-admin/misconception/dta-lab", desc: "Direction · Timing · Advance", badge: "PROTOTYPE" },
  { label: "자동사냥 설정", en: "Hunter Automation", path: "/ai-admin/misconception/hunter-automation", desc: "자동 크롤링 설정", badge: "PLANNED" },
  { label: "오류·원인 연결", en: "Diagnostic Mapping", path: "/ai-admin/misconception/diagnostic-mapping", desc: "오개념→진단 변환", badge: "PROTOTYPE" },
  { label: "영상분석 연결", en: "Video Analysis Bridge", path: "/ai-admin/misconception/video-analysis-bridge", desc: "영상 AI 연결 준비", badge: "PLANNED" },
  { label: "검증 완료 판정", en: "Approved Decisions", path: "/ai-admin/misconception/approved-decisions", desc: "승인된 판정 목록", badge: "PROTOTYPE" },
  { label: "시스템 설계도", en: "System Blueprint", path: "/ai-admin/misconception/system-blueprint", desc: "전체 엔진 구조", badge: "PROTOTYPE" },
];

export default function Overview() {
  return (
    <div className="p-6">
      <PageHeader
        title="비근거·미신 수영 데이터 수집장치"
        subtitle="수영 현장의 오개념, 비공식 용어, 과장된 지도법, 근거가 부족한 주장과 잘못된 인과관계를 수집하고 검증합니다."
        badge={<FeatureBadge kind="PROTOTYPE" />}
      />

      {/* Status Banner */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6 flex items-start gap-3">
        <ScanSearch size={18} className="text-blue-600 mt-0.5 shrink-0" />
        <div>
          <div className="text-sm font-semibold text-blue-800 mb-0.5">Prototype Mode</div>
          <p className="text-xs text-blue-600">
            수집 및 검증 구조가 준비되었습니다. 자동 크롤링과 DTA 자동판정은 단계적으로 연결됩니다.
            현재는 주장 등록, 상태 변경, 메모 입력, 검증 기준 설정이 가능합니다.
          </p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="전체 주장 후보" value="128" color="slate" />
        <StatCard label="신규 주장" value="17" sub="최근 7일" color="blue" />
        <StatCard label="반복 등장" value="43" sub="3회 이상" color="purple" />
        <StatCard label="검토 필요" value="26" color="amber" />
        <StatCard label="반려 주장" value="31" color="red" />
        <StatCard label="검증 완료" value="54" color="green" />
        <StatCard label="외부 검색 횟수" value="87" sub="Prototype" color="slate" />
        <StatCard label="자동사냥 준비" value="35%" sub="설정 완료율" color="slate" />
      </div>

      {/* Flow Visualization */}
      <SectionCard title="시스템 처리 흐름" className="mb-6">
        <div className="p-4 overflow-x-auto">
          <div className="flex items-start gap-2 min-w-max">
            {FLOW_STEPS.map((step, i) => (
              <div key={step.label} className="flex items-center gap-2">
                <div className="flex flex-col items-center gap-1 min-w-[90px]">
                  <div className="w-full bg-white border border-slate-200 rounded-lg px-2 py-2 text-center">
                    <div className="text-[11px] font-semibold text-slate-700 mb-1">{step.label}</div>
                    <div className="text-[10px] text-slate-400">{step.desc}</div>
                  </div>
                  <FeatureBadge kind={step.kind} />
                </div>
                {i < FLOW_STEPS.length - 1 && (
                  <ArrowRight size={14} className="text-slate-300 shrink-0 mt-[-12px]" />
                )}
              </div>
            ))}
          </div>
        </div>
      </SectionCard>

      {/* Sub-menu Grid */}
      <SectionCard title="하위 메뉴">
        <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          {SUB_MENUS.map(menu => (
            <Link key={menu.path} href={menu.path}>
              <a className="group flex flex-col gap-1 p-3 rounded-lg border border-slate-100 hover:border-blue-200 hover:bg-blue-50/50 transition-all cursor-pointer">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-slate-700 group-hover:text-[#0a2540]">{menu.label}</div>
                  <FeatureBadge kind={menu.badge as any} />
                </div>
                <div className="text-[11px] text-slate-400">{menu.en}</div>
                <div className="text-xs text-slate-500">{menu.desc}</div>
              </a>
            </Link>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
