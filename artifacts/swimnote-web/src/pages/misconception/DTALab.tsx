import { useState } from "react";
import { PageHeader, SectionCard, Button, FeatureBadge } from "../../components/ui";
import { SAMPLE_CLAIMS } from "../../data/mockData";
import { Zap, Save } from "lucide-react";

type Verdict = "PASS" | "CONDITIONAL" | "FAIL" | "NOT_ENOUGH_DATA" | "";

const VERDICT_COLORS: Record<string, string> = {
  PASS: "bg-emerald-100 text-emerald-700 border-emerald-300",
  CONDITIONAL: "bg-yellow-100 text-yellow-700 border-yellow-300",
  FAIL: "bg-red-100 text-red-700 border-red-300",
  NOT_ENOUGH_DATA: "bg-gray-100 text-gray-500 border-gray-300",
  "": "bg-white text-slate-600 border-slate-200",
};

interface DtaItem { verdict: Verdict; basis: string; measurable: boolean; method: string; confidence: number; note: string; }
type Category = "direction" | "timing" | "advance" | "physics";

const DIRECTION_ITEMS = ["힘의 방향", "전진 방향 정렬", "상하 손실", "좌우 손실", "정면 면적 변화", "자세 정렬"];
const TIMING_ITEMS = ["추진 발생 시점", "팔·킥 연결", "호흡 개입", "추진 공백", "추진 중첩", "속도변동"];
const ADVANCE_ITEMS = ["스트로크당 거리", "주기당 순전진", "평균속도", "감속 구간", "저항 대비 이득", "에너지 대비 이동거리"];
const PHYSICS_ITEMS = ["F = ma", "작용·반작용", "운동량", "충격량", "저항", "부력", "중력", "신체 중심", "주기 내 속도변동", "에너지 효율"];

const defaultItem = (): DtaItem => ({ verdict: "", basis: "", measurable: false, method: "", confidence: 50, note: "" });

export default function DTALab() {
  const [selectedClaim, setSelectedClaim] = useState(SAMPLE_CLAIMS[0]);
  const [dirItems, setDirItems] = useState<Record<number, DtaItem>>({});
  const [timItems, setTimItems] = useState<Record<number, DtaItem>>({});
  const [advItems, setAdvItems] = useState<Record<number, DtaItem>>({});
  const [phyItems, setPhyItems] = useState<Record<number, DtaItem>>({});
  const [overallSummary, setOverallSummary] = useState("");
  const [savedMsg, setSavedMsg] = useState(false);

  const updateItem = (
    setter: React.Dispatch<React.SetStateAction<Record<number, DtaItem>>>,
    idx: number, field: keyof DtaItem, value: any
  ) => {
    setter(prev => ({ ...prev, [idx]: { ...(prev[idx] ?? defaultItem()), [field]: value } }));
  };

  const DtaSection = ({
    title, items, state, setter, color
  }: {
    title: string; items: string[];
    state: Record<number, DtaItem>;
    setter: React.Dispatch<React.SetStateAction<Record<number, DtaItem>>>;
    color: string;
  }) => (
    <SectionCard title={title} className="mb-4">
      <div className="p-4 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="text-left py-2 pr-4 font-semibold text-slate-600 whitespace-nowrap">항목</th>
              <th className="text-left py-2 pr-3 font-semibold text-slate-600">판정</th>
              <th className="text-left py-2 pr-3 font-semibold text-slate-600 min-w-[120px]">근거</th>
              <th className="text-left py-2 pr-3 font-semibold text-slate-600">측정</th>
              <th className="text-left py-2 pr-3 font-semibold text-slate-600">방법</th>
              <th className="text-left py-2 font-semibold text-slate-600">신뢰도</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => {
              const d = state[i] ?? defaultItem();
              return (
                <tr key={i} className="border-b border-slate-50">
                  <td className="py-2 pr-4 font-medium text-slate-700 whitespace-nowrap">{item}</td>
                  <td className="py-2 pr-3">
                    <select
                      className={`border rounded px-1.5 py-1 text-[11px] font-semibold ${VERDICT_COLORS[d.verdict]}`}
                      value={d.verdict}
                      onChange={e => updateItem(setter, i, "verdict", e.target.value as Verdict)}
                    >
                      <option value="">-</option>
                      <option value="PASS">PASS</option>
                      <option value="CONDITIONAL">COND.</option>
                      <option value="FAIL">FAIL</option>
                      <option value="NOT_ENOUGH_DATA">N/A</option>
                    </select>
                  </td>
                  <td className="py-2 pr-3">
                    <input
                      className="border border-slate-200 rounded px-2 py-1 w-full focus:outline-none focus:ring-1 focus:ring-blue-400"
                      value={d.basis}
                      onChange={e => updateItem(setter, i, "basis", e.target.value)}
                      placeholder="근거 입력..."
                    />
                  </td>
                  <td className="py-2 pr-3">
                    <input
                      type="checkbox"
                      checked={d.measurable}
                      onChange={e => updateItem(setter, i, "measurable", e.target.checked)}
                      className="rounded"
                    />
                  </td>
                  <td className="py-2 pr-3">
                    <select
                      className="border border-slate-200 rounded px-1.5 py-1 text-[11px] focus:outline-none"
                      value={d.method}
                      onChange={e => updateItem(setter, i, "method", e.target.value)}
                    >
                      <option value="">-</option>
                      <option value="direct">직접측정</option>
                      <option value="calc">계산</option>
                      <option value="estimate">추정</option>
                      <option value="infer">추론</option>
                    </select>
                  </td>
                  <td className="py-2">
                    <div className="flex items-center gap-1.5">
                      <input type="range" min="0" max="100" value={d.confidence}
                        onChange={e => updateItem(setter, i, "confidence", Number(e.target.value))}
                        className="w-16" />
                      <span className="text-[10px] text-slate-500 w-6">{d.confidence}</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );

  const handleSave = () => {
    setSavedMsg(true);
    setTimeout(() => setSavedMsg(false), 2000);
  };

  return (
    <div className="p-6">
      <PageHeader
        title="DTA 검증실"
        subtitle="DTA Claim Verification Lab — Direction · Timing · Advance 및 기본 물리법칙으로 주장의 효율성을 검증합니다."
        badge={<FeatureBadge kind="PROTOTYPE" />}
        actions={
          <Button variant="primary" onClick={handleSave}>
            <Save size={12} />{savedMsg ? "저장 완료!" : "저장"}
          </Button>
        }
      />

      {/* Claim Selector */}
      <div className="mb-4 flex items-center gap-3">
        <label className="text-xs font-semibold text-slate-600">검증 주장 선택:</label>
        <select
          className="flex-1 max-w-sm border border-slate-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
          value={selectedClaim.id}
          onChange={e => { const c = SAMPLE_CLAIMS.find(c => c.id === e.target.value); if (c) setSelectedClaim(c); }}
        >
          {SAMPLE_CLAIMS.map(c => <option key={c.id} value={c.id}>{c.core_claim}</option>)}
        </select>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 mb-4 flex items-center gap-2">
        <Zap size={14} className="text-blue-600 shrink-0" />
        <p className="text-xs text-blue-700">
          <strong>"{selectedClaim.core_claim}"</strong> — 아래 DTA 항목별 판정을 입력하고 저장하세요. 자동 계산은 향후 ENGINE 4와 연결됩니다.
        </p>
      </div>

      <DtaSection title="Direction 검증" items={DIRECTION_ITEMS} state={dirItems} setter={setDirItems} color="blue" />
      <DtaSection title="Timing 검증" items={TIMING_ITEMS} state={timItems} setter={setTimItems} color="purple" />
      <DtaSection title="Advance 검증" items={ADVANCE_ITEMS} state={advItems} setter={setAdvItems} color="teal" />
      <DtaSection title="물리 검증" items={PHYSICS_ITEMS} state={phyItems} setter={setPhyItems} color="red" />

      {/* Summary */}
      <SectionCard title="DTA 종합 판정 및 요약">
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            {["Direction", "Timing", "Advance"].map(axis => {
              const preload = selectedClaim.dta_json?.[axis.toLowerCase()];
              const color = preload === "FAIL" ? "bg-red-100 text-red-700" : preload === "PASS" ? "bg-emerald-100 text-emerald-700" : preload === "CONDITIONAL" ? "bg-yellow-100 text-yellow-700" : "bg-slate-100 text-slate-500";
              return (
                <div key={axis} className={`rounded-xl p-4 text-center ${color}`}>
                  <div className="text-xs font-semibold mb-1">{axis}</div>
                  <div className="text-lg font-bold">{preload ?? "미입력"}</div>
                </div>
              );
            })}
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-700 block mb-1">과학적 반증 요약</label>
            <textarea className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:outline-none resize-none" rows={3} placeholder="이 주장의 과학적 문제점 요약..." />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-700 block mb-1">SWIMNOTE 대체 설명</label>
            <textarea className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:outline-none resize-none" rows={3} placeholder="올바른 메커니즘 설명..." value={selectedClaim.swimnote_position?.official_stance ?? ""} readOnly />
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
