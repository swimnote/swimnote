import { useState } from "react";
import { PageHeader, SectionCard, StatCard, FeatureBadge, Button } from "../components/ui";
import { MessageSquare, Send } from "lucide-react";

const SAMPLE_QA = [
  { q: "접영할 때 몸을 크게 흔들어야 하나요?", a: "아니요. 큰 웨이브는 DTA Direction 손실을 유발합니다. 엉덩이 주도의 작고 효율적인 돌핀킥이 올바른 메커니즘입니다.", verdict: "오개념 감지" },
  { q: "자유형 팔 힘이 강하면 빨라지나요?", a: "팔 힘보다는 캐치 각도와 타이밍이 추진력의 핵심입니다. 하이엘보 캐치로 유효 면적을 최대화하세요.", verdict: "오개념 감지" },
];

export default function AIQuestionTest() {
  const [input, setInput] = useState("");
  const [results, setResults] = useState(SAMPLE_QA);

  const handleTest = () => {
    if (!input.trim()) return;
    setResults(prev => [{ q: input.trim(), a: "[AI 답변 생성 중... 현재 연결 준비 단계입니다]", verdict: "처리 중" }, ...prev]);
    setInput("");
  };

  return (
    <div className="p-6">
      <PageHeader title="AI 질문 테스트" subtitle="AI Question Test — AI 답변에 오개념 포함 여부를 테스트합니다." badge={<FeatureBadge kind="LIVE" />} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="총 테스트" value="342" color="slate" />
        <StatCard label="오개념 감지" value="78" color="red" />
        <StatCard label="정상 답변" value="264" color="green" />
        <StatCard label="평균 신뢰도" value="87%" color="blue" />
      </div>
      <SectionCard title="질문 테스트">
        <div className="p-4">
          <div className="flex gap-2 mb-4">
            <input className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" placeholder="수영 관련 질문을 입력하세요..." value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && handleTest()} />
            <Button variant="primary" onClick={handleTest}><Send size={12} /> 테스트</Button>
          </div>
          <div className="space-y-3">
            {results.map((item, i) => (
              <div key={i} className="border border-slate-100 rounded-xl p-4">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2"><MessageSquare size={13} className="text-blue-400 shrink-0" /><span className="text-sm font-medium text-slate-700">{item.q}</span></div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded shrink-0 ${item.verdict === "오개념 감지" ? "bg-red-100 text-red-700" : item.verdict === "처리 중" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>{item.verdict}</span>
                </div>
                <p className="text-xs text-slate-600 pl-5">{item.a}</p>
              </div>
            ))}
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
