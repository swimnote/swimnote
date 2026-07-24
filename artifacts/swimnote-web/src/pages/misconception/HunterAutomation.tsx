import { useState, useEffect } from "react";
import { PageHeader, SectionCard, Button, FeatureBadge, ComingSoonModal } from "../../components/ui";
import { Bot, Save, AlertCircle } from "lucide-react";

const API = "/api";

const SOURCE_OPTIONS = ["웹 문서", "검색엔진", "공식기관", "연구자료", "블로그", "유튜브", "커뮤니티", "SNS", "전자책·문서", "사용자 질문 로그"];
const LANG_OPTIONS = ["한국어", "영어", "일본어", "중국어", "스페인어", "프랑스어", "독일어", "기타"];
const STROKE_OPTIONS = ["자유형", "배영", "평영", "접영", "스타트", "턴", "수중", "체력훈련", "지도법", "어린이 수영", "안전"];
const SCHEDULE_OPTIONS = [{ v: "manual", l: "수동" }, { v: "daily", l: "매일" }, { v: "weekly", l: "매주" }, { v: "monthly", l: "매월" }];
const CRITERIA_OPTIONS = ["신규 주장", "반복 확산 주장", "SWIMNOTE 충돌 주장", "공식 자료와 충돌", "질문 빈도 상승", "영상 콘텐츠 확산", "지역별 신규 용어"];
const POLICY_OPTIONS = [
  { v: "save_only", l: "자동 저장만" },
  { v: "auto_verdict", l: "자동 임시판정" },
  { v: "require_admin", l: "관리자 승인 필수" },
  { v: "strong_evidence_only", l: "강한 근거만 자동승격" },
  { v: "review_on_change", l: "기존 판정 변경 시 무조건 검토" },
];

export default function HunterAutomation() {
  const [sources, setSources] = useState<string[]>(["사용자 질문 로그"]);
  const [langs, setLangs] = useState<string[]>(["한국어", "영어"]);
  const [strokes, setStrokes] = useState<string[]>(["자유형", "배영", "평영", "접영"]);
  const [schedule, setSchedule] = useState("manual");
  const [criteria, setCriteria] = useState<string[]>(["신규 주장", "반복 확산 주장"]);
  const [policy, setPolicy] = useState("require_admin");
  const [saved, setSaved] = useState(false);
  const [comingSoon, setComingSoon] = useState<any>(null);

  const toggle = (arr: string[], setArr: (v: string[]) => void, val: string) => {
    setArr(arr.includes(val) ? arr.filter(v => v !== val) : [...arr, val]);
  };

  useEffect(() => {
    fetch(`${API}/misconception/hunter-settings`)
      .then(r => r.json())
      .then(d => {
        if (d.success && d.settings) {
          const s = d.settings;
          if (s.target_sources) setSources(JSON.parse(s.target_sources));
          if (s.target_languages) setLangs(JSON.parse(s.target_languages));
          if (s.target_strokes) setStrokes(JSON.parse(s.target_strokes));
          if (s.run_schedule) setSchedule(s.run_schedule);
          if (s.collection_criteria) setCriteria(JSON.parse(s.collection_criteria));
          if (s.approval_policy) setPolicy(s.approval_policy);
        }
      }).catch(() => {});
  }, []);

  const handleSave = async () => {
    try {
      await fetch(`${API}/misconception/hunter-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_sources: sources, target_languages: langs, target_strokes: strokes, run_schedule: schedule, collection_criteria: criteria, approval_policy: policy }),
      });
    } catch {}
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const cs = (name: string, purpose: string) => setComingSoon({
    name, purpose,
    inputs: ["설정값", "대상 URL 목록", "API 키"],
    process: ["크롤러 초기화", "대상 접근", "콘텐츠 파싱", "주장 감지"],
    outputs: ["주장 후보 목록", "출처 메타데이터", "수집 리포트"],
    engine: "ENGINE 3 — Autonomous Hunter & Crawler",
  });

  const CheckGroup = ({ label, options, selected, setSelected }: { label: string; options: string[]; selected: string[]; setSelected: (v: string[]) => void }) => (
    <div>
      <div className="text-xs font-semibold text-slate-700 mb-2">{label}</div>
      <div className="flex flex-wrap gap-2">
        {options.map(opt => (
          <button
            key={opt}
            onClick={() => toggle(selected, setSelected, opt)}
            className={`px-2.5 py-1 rounded-lg text-xs border transition-all ${selected.includes(opt) ? "bg-[#0a2540] text-white border-[#0a2540]" : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"}`}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="p-6">
      <PageHeader
        title="자동사냥 설정"
        subtitle="Autonomous Misconception Hunter — 자동 크롤링 및 수집 기준을 설정합니다."
        badge={<FeatureBadge kind="PLANNED" />}
        actions={
          <Button variant="primary" onClick={handleSave}><Save size={12} />{saved ? "저장 완료!" : "설정 저장"}</Button>
        }
      />

      {/* Status Banner */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 flex items-start gap-3">
        <AlertCircle size={16} className="text-amber-600 mt-0.5 shrink-0" />
        <div className="text-xs text-amber-700 space-y-1">
          <div className="font-semibold">현재 상태: Prototype</div>
          <div>자동 크롤링: <strong>비활성</strong> · 자동 검증: <strong>비활성</strong> · 관리자 승인: <strong>활성</strong></div>
          <div>설정값은 저장되며, 자동 실행 기능 연결 시 즉시 적용됩니다.</div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <SectionCard title="A. 탐색 대상">
          <div className="p-4">
            <CheckGroup label="" options={SOURCE_OPTIONS} selected={sources} setSelected={setSources} />
          </div>
        </SectionCard>
        <SectionCard title="B. 탐색 언어">
          <div className="p-4">
            <CheckGroup label="" options={LANG_OPTIONS} selected={langs} setSelected={setLangs} />
          </div>
        </SectionCard>
        <SectionCard title="C. 탐색 범위 (영법·기술)">
          <div className="p-4">
            <CheckGroup label="" options={STROKE_OPTIONS} selected={strokes} setSelected={setStrokes} />
          </div>
        </SectionCard>
        <SectionCard title="D. 자동 실행 주기">
          <div className="p-4">
            <div className="flex gap-2 flex-wrap">
              {SCHEDULE_OPTIONS.map(opt => (
                <button key={opt.v} onClick={() => setSchedule(opt.v)}
                  className={`px-4 py-2 rounded-lg text-xs font-semibold border transition-all ${schedule === opt.v ? "bg-[#0a2540] text-white border-[#0a2540]" : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"}`}>
                  {opt.l}
                </button>
              ))}
            </div>
          </div>
        </SectionCard>
        <SectionCard title="E. 자동 수집 기준">
          <div className="p-4">
            <CheckGroup label="" options={CRITERIA_OPTIONS} selected={criteria} setSelected={setCriteria} />
          </div>
        </SectionCard>
        <SectionCard title="F. 승인 정책">
          <div className="p-4 space-y-2">
            {POLICY_OPTIONS.map(opt => (
              <button key={opt.v} onClick={() => setPolicy(opt.v)}
                className={`w-full text-left px-3 py-2 rounded-lg border text-xs transition-all ${policy === opt.v ? "bg-[#0a2540] text-white border-[#0a2540]" : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"}`}>
                {opt.l}
              </button>
            ))}
          </div>
        </SectionCard>
      </div>

      {/* Action Buttons */}
      <SectionCard title="자동사냥 실행 (준비중)">
        <div className="p-4 flex flex-wrap gap-2">
          {[
            ["자동사냥 시작", "자동 크롤링 전체를 시작합니다."],
            ["테스트 사냥 실행", "소규모 테스트 크롤링을 실행합니다."],
            ["크롤러 연결", "웹 크롤러 엔진을 API에 연결합니다."],
            ["검색 API 연결", "외부 검색 API를 연결합니다."],
            ["YouTube 연결", "YouTube Data API를 연결합니다."],
            ["스케줄 설정", "cron 스케줄을 설정합니다."],
            ["안전장치 설정", "자동 실행 안전 임계값을 설정합니다."],
          ].map(([label, purpose]) => (
            <Button key={label} variant="planned" onClick={() => cs(label, purpose)}>
              <Bot size={12} />{label}
            </Button>
          ))}
        </div>
      </SectionCard>

      <ComingSoonModal isOpen={!!comingSoon} onClose={() => setComingSoon(null)} feature={comingSoon ?? { name: "", purpose: "", inputs: [], process: [], outputs: [], engine: "" }} />
    </div>
  );
}
