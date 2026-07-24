import { useState } from "react";
import { PageHeader, SectionCard, Button, FeatureBadge } from "../../components/ui";
import { Plus, Trash2, ArrowRight } from "lucide-react";

interface FlowNode { id: string; text: string; }
interface DiagMapping {
  misconception: string;
  coachingBehavior: FlowNode[];
  observedErrors: FlowNode[];
  causes: FlowNode[];
  dtaLoss: FlowNode[];
  corrections: FlowNode[];
  drills: FlowNode[];
  outcomes: FlowNode[];
}

const EXAMPLE: DiagMapping = {
  misconception: "접영은 큰 웨이브를 만들어야 한다",
  coachingBehavior: [{ id: "cb1", text: "몸 전체를 크게 흔들도록 지도" }, { id: "cb2", text: "큰 파동을 강조하는 큐 사용" }],
  observedErrors: [{ id: "oe1", text: "상하 진폭 과다" }, { id: "oe2", text: "머리 복귀 지연" }, { id: "oe3", text: "킥 타이밍 분리" }],
  causes: [{ id: "ca1", text: "과장된 웨이브 큐" }, { id: "ca2", text: "호흡 시 과상승" }, { id: "ca3", text: "입수와 킥 타이밍 오류" }],
  dtaLoss: [{ id: "dt1", text: "Direction 손실" }, { id: "dt2", text: "Timing 분리" }, { id: "dt3", text: "Advance 감소" }],
  corrections: [{ id: "co1", text: "웨이브 진폭 최소화" }, { id: "co2", text: "머리 복귀 교정" }, { id: "co3", text: "킥과 입수 연결" }],
  drills: [{ id: "dr1", text: "작은 진폭 돌핀킥" }, { id: "dr2", text: "머리 선행 복귀 드릴" }, { id: "dr3", text: "팔 입수-킥 연결 드릴" }],
  outcomes: [{ id: "ou1", text: "Direction 개선 확인" }, { id: "ou2", text: "주기 속도 측정" }, { id: "ou3", text: "영상 비교" }],
};

const FlowColumn = ({
  title, nodes, color, onAdd, onRemove, onEdit
}: {
  title: string; nodes: FlowNode[]; color: string;
  onAdd: () => void; onRemove: (id: string) => void; onEdit: (id: string, text: string) => void;
}) => (
  <div className="flex flex-col min-w-[160px]">
    <div className={`text-center text-xs font-bold px-2 py-1.5 rounded-t-lg ${color}`}>{title}</div>
    <div className="flex-1 border border-slate-200 rounded-b-lg bg-white p-2 space-y-1 min-h-[160px]">
      {nodes.map(node => (
        <div key={node.id} className="flex items-start gap-1 group">
          <textarea
            className="flex-1 text-[11px] border border-slate-100 rounded px-1.5 py-1 resize-none focus:outline-none focus:ring-1 focus:ring-blue-300 bg-slate-50"
            rows={2}
            value={node.text}
            onChange={e => onEdit(node.id, e.target.value)}
          />
          <button onClick={() => onRemove(node.id)} className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 mt-0.5">
            <Trash2 size={10} />
          </button>
        </div>
      ))}
      <button onClick={onAdd} className="w-full text-[10px] text-slate-400 hover:text-blue-500 flex items-center justify-center gap-1 py-1 border border-dashed border-slate-200 rounded hover:border-blue-300 transition-colors">
        <Plus size={10} /> 추가
      </button>
    </div>
  </div>
);

export default function DiagnosticMapping() {
  const [mapping, setMapping] = useState<DiagMapping>(EXAMPLE);

  const makeOps = (field: keyof DiagMapping) => {
    if (field === "misconception") return { onAdd: () => {}, onRemove: () => {}, onEdit: () => {} };
    const prefix = field.slice(0, 3);
    return {
      onAdd: () => setMapping(prev => ({
        ...prev,
        [field]: [...(prev[field] as FlowNode[]), { id: `${prefix}_${Date.now()}`, text: "" }]
      })),
      onRemove: (id: string) => setMapping(prev => ({
        ...prev,
        [field]: (prev[field] as FlowNode[]).filter(n => n.id !== id)
      })),
      onEdit: (id: string, text: string) => setMapping(prev => ({
        ...prev,
        [field]: (prev[field] as FlowNode[]).map(n => n.id === id ? { ...n, text } : n)
      })),
    };
  };

  const COLUMNS: { field: keyof DiagMapping; title: string; color: string }[] = [
    { field: "coachingBehavior", title: "지도 행동", color: "bg-slate-100 text-slate-700" },
    { field: "observedErrors", title: "관찰 오류", color: "bg-orange-100 text-orange-700" },
    { field: "causes", title: "가능한 원인", color: "bg-amber-100 text-amber-700" },
    { field: "dtaLoss", title: "DTA 손실", color: "bg-red-100 text-red-700" },
    { field: "corrections", title: "교정", color: "bg-blue-100 text-blue-700" },
    { field: "drills", title: "추천 드릴", color: "bg-teal-100 text-teal-700" },
    { field: "outcomes", title: "결과 확인", color: "bg-emerald-100 text-emerald-700" },
  ];

  return (
    <div className="p-6">
      <PageHeader
        title="오류·원인 연결"
        subtitle="Diagnostic Mapping — 수집된 오개념을 실제 진단 데이터로 변환합니다."
        badge={<FeatureBadge kind="PROTOTYPE" />}
      />

      {/* Misconception Header */}
      <SectionCard className="mb-4">
        <div className="p-4 flex items-center gap-3">
          <div className="text-xs font-semibold text-slate-600 shrink-0">오개념</div>
          <input
            className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-1 focus:ring-blue-400 text-[#0a2540]"
            value={mapping.misconception}
            onChange={e => setMapping(prev => ({ ...prev, misconception: e.target.value }))}
            placeholder="오개념 주장을 입력하세요..."
          />
          <Button variant="secondary" onClick={() => setMapping(EXAMPLE)}>예시 불러오기</Button>
        </div>
      </SectionCard>

      {/* Flow */}
      <SectionCard title="진단 흐름 (오개념 → 교정 → 결과)">
        <div className="p-4 overflow-x-auto">
          <div className="flex gap-2 min-w-max items-start">
            {COLUMNS.map((col, i) => (
              <div key={col.field} className="flex items-start">
                <FlowColumn
                  title={col.title}
                  nodes={(mapping[col.field] as FlowNode[])}
                  color={col.color}
                  {...makeOps(col.field)}
                />
                {i < COLUMNS.length - 1 && (
                  <div className="flex items-center px-1 pt-8">
                    <ArrowRight size={14} className="text-slate-300" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
