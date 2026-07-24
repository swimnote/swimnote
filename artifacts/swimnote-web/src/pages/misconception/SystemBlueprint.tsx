import { useState } from "react";
import { PageHeader, SectionCard, FeatureBadge } from "../../components/ui";
import { BookOpen, ArrowRight, Save } from "lucide-react";

const ENGINES = [
  { num: 1, name: "Verified Swimming Knowledge Engine", desc: "검증된 수영 지식을 구조화하고 AI 답변의 근거로 사용합니다.", status: "LIVE" as const, color: "border-emerald-200 bg-emerald-50" },
  { num: 2, name: "Misconception & Diagnostic Intelligence Engine", desc: "오개념을 감지·분류하고 진단 규칙으로 변환합니다.", status: "PROTOTYPE" as const, color: "border-blue-200 bg-blue-50" },
  { num: 3, name: "Autonomous Hunter & Crawler", desc: "외부 소스에서 비근거 주장을 자동으로 수집합니다.", status: "PLANNED" as const, color: "border-amber-200 bg-amber-50" },
  { num: 4, name: "DTA Scientific Verification Engine", desc: "Direction, Timing, Advance 및 물리법칙으로 주장을 자동 검증합니다.", status: "PLANNED" as const, color: "border-purple-200 bg-purple-50" },
  { num: 5, name: "Video Motion Analysis Engine", desc: "영상에서 신체 동작을 추적하고 DTA를 자동 계산합니다.", status: "LOCKED" as const, color: "border-gray-200 bg-gray-50" },
  { num: 6, name: "Correction Outcome Learning Engine", desc: "교정 결과를 수집하고 Knowledge DB와 진단 규칙을 자동 개선합니다.", status: "LOCKED" as const, color: "border-gray-200 bg-gray-50" },
];

const FLOW = ["질문", "주장 수집", "검색", "검증", "판정", "진단 규칙", "영상분석", "교정", "결과 측정", "학습", "재검증"];

const IMPLEMENTATION_PHASES = [
  { phase: "현재 구현", color: "bg-emerald-100 text-emerald-700", items: ["사이드바 및 전체 라우팅", "오개념 주장 수집 및 등록", "상태·메모·설정 저장", "검증 워크벤치 (수동)", "DTA 검증실 (수동 입력)", "출처 인텔리전스 (목업)", "진단 연결 매핑", "자동사냥 설정값 저장", "시스템 설계도", "예시 데이터 12개"] },
  { phase: "다음 구현", color: "bg-blue-100 text-blue-700", items: ["외부 검색 API 연결 (GPT/Perplexity)", "출처 신뢰도 자동 계산", "DTA 반자동 계산", "Knowledge DB 연동", "AI 답변 필터 연결", "검증 요약 자동 생성"] },
  { phase: "장기 목표", color: "bg-amber-100 text-amber-700", items: ["자동 크롤링 (웹·유튜브·커뮤니티)", "완전 자동 DTA 계산", "영상 모션 캡처 연동", "교정 결과 학습 루프", "자율 성장 시스템", "다국어 지원"] },
];

const SAFETY_PRINCIPLES = [
  "기존 Knowledge Factory 기능을 수정하지 않는다",
  "기존 API를 깨뜨리지 않는다",
  "기존 DB 마이그레이션은 안전하게 추가한다",
  "기존 데이터 삭제 금지",
  "기존 인증과 관리자 권한 사용",
  "일반 사용자에게 관리자 메뉴 노출 금지",
  "목업 버튼이 실제 외부 요청을 발생시키지 않게 한다",
  "자동승격 기능은 비활성 상태로 유지한다",
  "기존 SWIMNOTE 판정을 자동 변경하지 않는다",
];

export default function SystemBlueprint() {
  const [adminMemo, setAdminMemo] = useState("이 문서는 SWIMNOTE AI 오개념 헌터 시스템의 전체 설계도입니다.\n\n향후 연결할 엔진 구조와 데이터 흐름을 명문화하여 아이디어가 사라지지 않도록 합니다.\n\n관리자 메모:\n- ENGINE 4 (DTA 자동 계산)는 물리 공식 라이브러리 연구 중\n- ENGINE 5 (영상 분석)는 MediaPipe 또는 OpenPose 검토 예정");
  const [savedMemo, setSavedMemo] = useState(false);

  return (
    <div className="p-6">
      <PageHeader
        title="시스템 설계도"
        subtitle="System Blueprint — 전체 시스템의 장기 설계를 명문화합니다. 아이디어가 사라지지 않도록 유지합니다."
        badge={<FeatureBadge kind="PROTOTYPE" />}
      />

      {/* Engine Structure */}
      <SectionCard title="엔진 구조" className="mb-4">
        <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          {ENGINES.map(eng => (
            <div key={eng.num} className={`rounded-xl border p-4 ${eng.color}`}>
              <div className="flex items-start justify-between mb-2">
                <div className="text-xs font-bold text-slate-500">ENGINE {eng.num}</div>
                <FeatureBadge kind={eng.status} />
              </div>
              <div className="text-sm font-bold text-[#0a2540] mb-1">{eng.name}</div>
              <p className="text-xs text-slate-600">{eng.desc}</p>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* Full Cycle Flow */}
      <SectionCard title="전체 순환 흐름" className="mb-4">
        <div className="p-4 overflow-x-auto">
          <div className="flex items-center gap-2 min-w-max">
            {FLOW.map((step, i) => (
              <div key={step} className="flex items-center gap-2">
                <div className="bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-700 whitespace-nowrap">
                  {step}
                </div>
                {i < FLOW.length - 1 && <ArrowRight size={12} className="text-slate-300" />}
              </div>
            ))}
          </div>
        </div>
      </SectionCard>

      {/* Implementation Phases */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        {IMPLEMENTATION_PHASES.map(phase => (
          <SectionCard key={phase.phase} title={phase.phase}>
            <div className="p-4">
              <ul className="space-y-1.5">
                {phase.items.map(item => (
                  <li key={item} className="flex items-start gap-2 text-xs text-slate-600">
                    <span className={`mt-0.5 shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded ${phase.color}`}>✓</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </SectionCard>
        ))}
      </div>

      {/* Safety Principles */}
      <SectionCard title="안전 원칙" className="mb-4">
        <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-2">
          {SAFETY_PRINCIPLES.map(p => (
            <div key={p} className="flex items-start gap-2 text-xs text-slate-600">
              <span className="text-red-500 shrink-0 mt-0.5">⚠</span>
              {p}
            </div>
          ))}
        </div>
      </SectionCard>

      {/* Admin Memo */}
      <SectionCard title="관리자 메모 (편집 가능)" actions={
        <button onClick={() => { setSavedMemo(true); setTimeout(() => setSavedMemo(false), 2000); }}
          className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800">
          <Save size={12} />{savedMemo ? "저장됨!" : "저장"}
        </button>
      }>
        <div className="p-4">
          <textarea
            className="w-full border border-slate-200 rounded-xl px-4 py-3 text-xs text-slate-700 resize-none focus:outline-none focus:ring-1 focus:ring-blue-400 font-mono leading-relaxed"
            rows={12}
            value={adminMemo}
            onChange={e => setAdminMemo(e.target.value)}
          />
        </div>
      </SectionCard>

      {/* Data Flow */}
      <SectionCard title="데이터 흐름 구조" className="mt-4">
        <div className="p-4 space-y-2 text-xs text-slate-600 font-mono">
          <div>사용자 질문 → <span className="text-blue-600">ENGINE 1</span> 내부 DB 검색 → 결과 부족 시 FLAG</div>
          <div>FLAG → <span className="text-amber-600">ENGINE 3</span> 자동 크롤링 → 비근거 주장 후보 수집</div>
          <div>후보 → <span className="text-blue-600">ENGINE 2</span> 분류·임시판정 → 관리자 검토 큐</div>
          <div>관리자 검토 → <span className="text-purple-600">ENGINE 4</span> DTA·물리 검증 → 최종 판정</div>
          <div>최종 판정 → <span className="text-emerald-600">ENGINE 1</span> Knowledge DB 반영 → AI 답변 업데이트</div>
          <div>AI 답변 → <span className="text-slate-400">ENGINE 5</span> 영상 분석 교정 → <span className="text-slate-400">ENGINE 6</span> 결과 학습</div>
        </div>
      </SectionCard>
    </div>
  );
}
