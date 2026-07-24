import { useState } from "react";
import { PageHeader, SectionCard, StatusBadge, Button, FeatureBadge } from "../../components/ui";
import { SAMPLE_CLAIMS } from "../../data/mockData";
import { CheckSquare, Square, ChevronRight, ChevronLeft, Sparkles } from "lucide-react";

const STEPS = [
  { label: "주장 분해", desc: "핵심 주장을 세부 명제로 분해합니다.", checks: ["단일 주장인가?", "측정 가능한 주장인가?", "검증 가능한 주장인가?", "범위가 명확한가?"] },
  { label: "내부 DB 비교", desc: "Knowledge DB에서 관련 지식을 검색합니다.", checks: ["Knowledge DB에서 관련 항목 발견", "내부 근거 충분", "내부 공백 확인", "기존 판정과 충돌"] },
  { label: "공식 자료 확인", desc: "공식 기관 자료(FINA, 스포츠 협회 등)에서 확인합니다.", checks: ["공식 자료에서 확인됨", "공식 자료와 충돌", "공식 자료 없음", "공식 자료 모호"] },
  { label: "연구·전문서적 확인", desc: "학술 연구 및 전문서적에서 근거를 확인합니다.", checks: ["연구자료에서 확인됨", "전문서적에서 확인됨", "일반 웹에서만 반복됨", "연구 간 충돌"] },
  { label: "출처 독립성 확인", desc: "출처가 독립적인지, 재인용인지 확인합니다.", checks: ["독립된 원출처 확인", "동일 출처 반복 인용", "상업적 출처 주의", "출처 불명"] },
  { label: "용어 검증", desc: "주장에 사용된 용어가 올바른지 확인합니다.", checks: ["용어 혼동 있음", "비공식 용어 사용", "번역 오류", "용어만의 문제"] },
  { label: "물리·생체역학 검증", desc: "물리법칙 및 생체역학으로 검증합니다.", checks: ["물리법칙 충돌", "생체역학적 불가능", "에너지 비효율", "자세 정렬 문제"] },
  { label: "DTA 검증", desc: "Direction, Timing, Advance 기준으로 검증합니다.", checks: ["Direction 손실 발생", "Timing 분리 발생", "Advance 감소 발생", "DTA 종합 손실"] },
  { label: "적용 범위 검증", desc: "주장의 적용 범위가 적절한지 확인합니다.", checks: ["특정 대상에만 적용 가능", "레벨 혼동", "과일반화", "조건부 적용"] },
  { label: "최종 판정", desc: "모든 단계를 종합하여 최종 판정을 내립니다.", checks: [] },
];

const VERDICTS = ["VERIFIED", "SUPPORTED", "CONDITIONAL", "TERMINOLOGY_ONLY", "UNSUPPORTED", "DISPUTED", "REJECTED", "HARMFUL", "PENDING", "REVIEW_REQUIRED"];
const VERDICT_STYLES: Record<string, string> = {
  VERIFIED: "border-emerald-400 bg-emerald-50 text-emerald-700",
  SUPPORTED: "border-teal-400 bg-teal-50 text-teal-700",
  CONDITIONAL: "border-yellow-400 bg-yellow-50 text-yellow-700",
  TERMINOLOGY_ONLY: "border-indigo-400 bg-indigo-50 text-indigo-700",
  UNSUPPORTED: "border-orange-400 bg-orange-50 text-orange-700",
  DISPUTED: "border-purple-400 bg-purple-50 text-purple-700",
  REJECTED: "border-red-400 bg-red-50 text-red-700",
  HARMFUL: "border-rose-500 bg-rose-50 text-rose-800",
  PENDING: "border-slate-300 bg-slate-50 text-slate-600",
  REVIEW_REQUIRED: "border-blue-400 bg-blue-50 text-blue-700",
};

export default function VerificationWorkbench() {
  const [selectedClaim, setSelectedClaim] = useState(SAMPLE_CLAIMS[0]);
  const [step, setStep] = useState(0);
  const [checks, setChecks] = useState<Record<number, Record<number, boolean>>>({});
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [verdict, setVerdict] = useState("");
  const [summary, setSummary] = useState("");

  const toggleCheck = (stepIdx: number, checkIdx: number) => {
    setChecks(prev => ({
      ...prev,
      [stepIdx]: { ...(prev[stepIdx] ?? {}), [checkIdx]: !(prev[stepIdx]?.[checkIdx]) }
    }));
  };

  const generateSummary = () => {
    setSummary(`[자동 생성된 검증 요약 — ${new Date().toLocaleDateString("ko-KR")}]\n\n주장: "${selectedClaim.core_claim}"\n\n검증된 단계: ${step + 1}/${STEPS.length}\n\n현재 판정: ${verdict || "미결정"}\n\n이 주장은 ${selectedClaim.claim_type} 유형으로 분류되며, 수영 현장에서 ${selectedClaim.repeat_count}회 반복 등장했습니다. SWIMNOTE 공식 데이터와의 비교 결과, 해당 주장은 DTA 기준에서 Direction 손실을 유발할 가능성이 높습니다. 추가 물리 검증 및 관리자 최종 승인이 권장됩니다.`);
  };

  const currentStep = STEPS[step];

  return (
    <div className="p-6">
      <PageHeader
        title="검증 워크벤치"
        subtitle="Verification Workbench — 하나의 주장을 10단계로 단계별 검증합니다."
        badge={<FeatureBadge kind="PROTOTYPE" />}
      />

      <div className="grid grid-cols-12 gap-4">
        {/* Left: Claim List */}
        <div className="col-span-12 md:col-span-3">
          <SectionCard title="검증 대상 목록">
            <div className="p-2 space-y-1 max-h-96 overflow-y-auto">
              {SAMPLE_CLAIMS.filter(c => ["review_required", "new"].includes(c.status)).map(c => (
                <button
                  key={c.id}
                  onClick={() => { setSelectedClaim(c); setStep(0); }}
                  className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors ${selectedClaim.id === c.id ? "bg-[#0a2540] text-white" : "hover:bg-slate-50 text-slate-600"}`}
                >
                  <div className="font-medium truncate">{c.core_claim}</div>
                  <div className={`text-[10px] mt-0.5 ${selectedClaim.id === c.id ? "text-blue-200" : "text-slate-400"}`}>
                    <StatusBadge status={c.status} />
                  </div>
                </button>
              ))}
            </div>
          </SectionCard>
        </div>

        {/* Center: Steps */}
        <div className="col-span-12 md:col-span-6">
          <SectionCard>
            {/* Step indicator */}
            <div className="p-4 border-b border-slate-100">
              <div className="flex gap-1">
                {STEPS.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => setStep(i)}
                    className={`flex-1 h-1.5 rounded-full transition-colors ${i <= step ? "bg-[#0a2540]" : "bg-slate-200"}`}
                    title={s.label}
                  />
                ))}
              </div>
              <div className="mt-2 text-xs text-slate-500">STEP {step + 1} / {STEPS.length}</div>
            </div>

            <div className="p-4">
              <h3 className="text-sm font-bold text-[#0a2540] mb-1">{currentStep.label}</h3>
              <p className="text-xs text-slate-500 mb-4">{currentStep.desc}</p>

              {step < STEPS.length - 1 ? (
                <div className="space-y-2">
                  {currentStep.checks.map((check, ci) => (
                    <button
                      key={ci}
                      onClick={() => toggleCheck(step, ci)}
                      className="w-full flex items-center gap-2.5 text-left px-3 py-2.5 rounded-lg border border-slate-100 hover:border-blue-200 hover:bg-blue-50/50 transition-all"
                    >
                      {checks[step]?.[ci] ? (
                        <CheckSquare size={15} className="text-blue-500 shrink-0" />
                      ) : (
                        <Square size={15} className="text-slate-300 shrink-0" />
                      )}
                      <span className="text-xs text-slate-700">{check}</span>
                    </button>
                  ))}
                  <textarea
                    className="w-full mt-3 border border-slate-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 resize-none"
                    rows={3}
                    placeholder="이 단계의 검증 노트..."
                    value={notes[step] ?? ""}
                    onChange={e => setNotes(prev => ({ ...prev, [step]: e.target.value }))}
                  />
                </div>
              ) : (
                /* Final step */
                <div className="space-y-4">
                  <div>
                    <div className="text-xs font-semibold text-slate-700 mb-2">최종 판정 선택</div>
                    <div className="grid grid-cols-2 gap-2">
                      {VERDICTS.map(v => (
                        <button
                          key={v}
                          onClick={() => setVerdict(v)}
                          className={`px-3 py-2 rounded-lg border-2 text-xs font-bold transition-all ${verdict === v ? VERDICT_STYLES[v] : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"}`}
                        >
                          {v}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-700 mb-2">검증 요약</div>
                    <textarea
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 resize-none"
                      rows={6}
                      value={summary}
                      onChange={e => setSummary(e.target.value)}
                      placeholder="검증 요약을 입력하거나 자동 생성하세요..."
                    />
                    <Button variant="secondary" onClick={generateSummary} className="mt-2">
                      <Sparkles size={12} /> 요약 자동 생성
                    </Button>
                  </div>
                </div>
              )}

              <div className="flex justify-between mt-4">
                <Button variant="secondary" onClick={() => setStep(s => Math.max(0, s - 1))} disabled={step === 0}>
                  <ChevronLeft size={12} /> 이전
                </Button>
                {step < STEPS.length - 1 ? (
                  <Button variant="primary" onClick={() => setStep(s => s + 1)}>
                    다음 <ChevronRight size={12} />
                  </Button>
                ) : (
                  <Button variant="primary" disabled={!verdict}>
                    판정 저장
                  </Button>
                )}
              </div>
            </div>
          </SectionCard>
        </div>

        {/* Right: Summary */}
        <div className="col-span-12 md:col-span-3">
          <SectionCard title="검증 현황">
            <div className="p-4 space-y-2">
              <div className="text-xs font-medium text-slate-700 truncate">{selectedClaim.core_claim}</div>
              <StatusBadge status={selectedClaim.status} />
              <div className="border-t border-slate-100 pt-3 space-y-1">
                {STEPS.map((s, i) => (
                  <div key={i} className={`flex items-center gap-2 text-xs py-0.5 ${i === step ? "font-semibold text-[#0a2540]" : i < step ? "text-emerald-600" : "text-slate-400"}`}>
                    <div className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0
                      ${i < step ? "bg-emerald-100" : i === step ? "bg-[#0a2540] text-white" : "bg-slate-100"}`}>
                      {i + 1}
                    </div>
                    <span className="truncate">{s.label}</span>
                  </div>
                ))}
              </div>
              {verdict && (
                <div className={`mt-3 p-2 rounded-lg border-2 text-center text-xs font-bold ${VERDICT_STYLES[verdict]}`}>
                  {verdict}
                </div>
              )}
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
