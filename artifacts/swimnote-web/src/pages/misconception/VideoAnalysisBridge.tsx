import { useState } from "react";
import { PageHeader, SectionCard, Button, FeatureBadge, ComingSoonModal } from "../../components/ui";
import { Video, Upload, Zap, Play } from "lucide-react";

const RESULT_CARDS = [
  { label: "골반 상하 변위", value: "±8.2cm", method: "ESTIMATED", note: "접영 기준 권장 ±4cm" },
  { label: "머리 상승 높이", value: "12.5cm", method: "ESTIMATED", note: "권장 5cm 이하" },
  { label: "주기 시간", value: "1.42s", method: "DERIVED", note: "고급자 평균 1.1s" },
  { label: "스트로크당 거리", value: "1.8m", method: "DERIVED", note: "목표: 2.2m+" },
  { label: "킥-입수 시간차", value: "0.18s", method: "ESTIMATED", note: "최적 0.05s 이하" },
  { label: "속도변동", value: "±0.42 m/s", method: "INFERRED", note: "낮을수록 효율적" },
  { label: "Direction 점수", value: "52 / 100", method: "DERIVED", note: "개선 필요" },
  { label: "Timing 점수", value: "68 / 100", method: "DERIVED", note: "양호" },
  { label: "Advance 점수", value: "47 / 100", method: "DERIVED", note: "개선 필요" },
];

const METHOD_COLORS: Record<string, string> = {
  DIRECT_MEASURED: "bg-emerald-100 text-emerald-700",
  DERIVED: "bg-blue-100 text-blue-700",
  ESTIMATED: "bg-amber-100 text-amber-700",
  INFERRED: "bg-purple-100 text-purple-700",
};

export default function VideoAnalysisBridge() {
  const [comingSoon, setComingSoon] = useState<any>(null);
  const cs = (name: string, purpose: string, inputs: string[], process: string[], outputs: string[]) =>
    setComingSoon({ name, purpose, inputs, process, outputs, engine: "ENGINE 5 — Video Motion Analysis Engine" });

  return (
    <div className="p-6">
      <PageHeader
        title="영상분석 연결"
        subtitle="Video Analysis Bridge — Motion Capture + DTA Verification. 향후 영상 AI 연결을 위한 인터페이스."
        badge={<FeatureBadge kind="PLANNED" />}
        actions={
          <div className="flex gap-2">
            <Button variant="planned" onClick={() => cs("영상 분석 시작", "업로드된 영상에서 신체 관절을 추적하고 DTA를 자동 계산합니다.",
              ["영상 파일", "영법 설정", "촬영 방향", "프레임레이트"],
              ["영상 디코딩", "관절 추적", "스트로크 분리", "DTA 계산"],
              ["관절 좌표 시계열", "DTA 점수", "교정 제안"])}>
              <Play size={12} /> 분석 시작
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        {/* Upload */}
        <SectionCard title="영상 입력 설정">
          <div className="p-4 space-y-3">
            <div
              className="border-2 border-dashed border-slate-200 rounded-xl p-8 text-center cursor-pointer hover:border-blue-300 hover:bg-blue-50/30 transition-all"
              onClick={() => cs("영상 업로드", "분석할 수영 영상을 업로드합니다.",
                ["영상 파일 (MP4, MOV)", "프레임레이트", "촬영 각도"],
                ["파일 검증", "영상 디코딩", "프레임 추출"],
                ["영상 ID", "메타데이터", "첫 프레임 미리보기"])}
            >
              <Upload size={24} className="mx-auto mb-2 text-slate-300" />
              <div className="text-xs text-slate-400 mb-1">영상 파일을 드래그하거나 클릭하여 업로드</div>
              <div className="text-[10px] text-slate-300">MP4, MOV · 최대 500MB</div>
              <div className="mt-2">
                <FeatureBadge kind="PLANNED" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {[["영법", ["자유형", "배영", "평영", "접영"]], ["촬영 방향", ["정면", "측면", "후면", "위"]]].map(([label, opts]) => (
                <div key={label as string}>
                  <label className="text-[11px] font-semibold text-slate-600 block mb-1">{label as string}</label>
                  <select className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none">
                    {(opts as string[]).map(o => <option key={o}>{o}</option>)}
                  </select>
                </div>
              ))}
              {[["레인 길이 (m)", "25"], ["프레임레이트", "30"], ["수영자 키 (cm)", "170"], ["수영자 레벨", ""]].map(([label, def]) => (
                <div key={label as string}>
                  <label className="text-[11px] font-semibold text-slate-600 block mb-1">{label as string}</label>
                  <input defaultValue={def as string} className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none" />
                </div>
              ))}
            </div>
          </div>
        </SectionCard>

        {/* Feature Cards */}
        <SectionCard title="분석 기능 (향후 연결)">
          <div className="p-4 grid grid-cols-2 gap-2">
            {[
              ["수면 기준선 설정", "PLANNED"],
              ["신체 관절 추적", "PLANNED"],
              ["스트로크 주기 분리", "PLANNED"],
              ["입수·캐치·풀·푸시 감지", "PLANNED"],
              ["킥 타이밍 감지", "PLANNED"],
              ["호흡 시점 감지", "PLANNED"],
              ["DTA 자동 계산", "LOCKED"],
              ["교정 전후 비교", "PLANNED"],
              ["오개념 연관 분석", "PLANNED"],
            ].map(([label, kind]) => (
              <div key={label} className="flex items-center justify-between p-2 rounded-lg bg-slate-50 border border-slate-100">
                <span className="text-[11px] text-slate-600">{label}</span>
                <FeatureBadge kind={kind as any} />
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      {/* Mock Results */}
      <SectionCard title="예시 분석 결과 (목업 데이터)">
        <div className="p-4">
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700 mb-4 flex items-center gap-2">
            <Video size={12} /> 아래는 예시 데이터입니다. 실제 영상 분석 후 자동으로 채워집니다.
          </div>
          <div className="grid grid-cols-3 gap-3">
            {RESULT_CARDS.map(card => (
              <div key={card.label} className="bg-white rounded-xl border border-slate-200 p-3">
                <div className="text-[11px] text-slate-500 mb-1">{card.label}</div>
                <div className="text-lg font-bold text-[#0a2540] mb-1">{card.value}</div>
                <div className="flex items-center justify-between">
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${METHOD_COLORS[card.method] ?? "bg-gray-100 text-gray-500"}`}>
                    {card.method}
                  </span>
                </div>
                <div className="text-[10px] text-slate-400 mt-1">{card.note}</div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 mt-4">
            {["DTA 계산", "전후 비교", "오개념 연결", "교정안 생성", "수업일지 생성"].map(btn => (
              <Button key={btn} variant="planned" onClick={() => cs(btn, `${btn} 기능은 영상 AI 연결 후 자동으로 실행됩니다.`,
                ["영상 분석 결과", "DTA 데이터", "오개념 DB"],
                ["데이터 처리", "AI 분석", "결과 생성"],
                ["분석 리포트", "교정 제안", "수업 자료"])}>
                <Zap size={11} /> {btn}
              </Button>
            ))}
          </div>
        </div>
      </SectionCard>

      <ComingSoonModal isOpen={!!comingSoon} onClose={() => setComingSoon(null)} feature={comingSoon ?? { name: "", purpose: "", inputs: [], process: [], outputs: [], engine: "" }} />
    </div>
  );
}
