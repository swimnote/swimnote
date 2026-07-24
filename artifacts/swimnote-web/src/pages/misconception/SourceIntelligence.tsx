import { useState } from "react";
import { PageHeader, SectionCard, StatCard, Table, Tr, Td, Button, FeatureBadge, ComingSoonModal } from "../../components/ui";
import { Globe, FileText, BookOpen, Video, HelpCircle, Building2 } from "lucide-react";

const SOURCES = [
  { name: "FINA Technical Rules", type: "공식기관", country: "국제", lang: "EN", authority: "A+", claims: 8, support: 6, oppose: 2, independence: "독립", trust: 98, lastCheck: "2026-07-01" },
  { name: "Swimming Science Research", type: "연구자료", country: "미국", lang: "EN", authority: "A", claims: 23, support: 14, oppose: 9, independence: "독립", trust: 91, lastCheck: "2026-07-05" },
  { name: "네이버 수영 카페", type: "커뮤니티", country: "한국", lang: "KO", authority: "D", claims: 47, support: 20, oppose: 27, independence: "재인용", trust: 31, lastCheck: "2026-07-10" },
  { name: "유튜브 수영 채널 A", type: "영상", country: "한국", lang: "KO", authority: "C", claims: 31, support: 15, oppose: 16, independence: "불명", trust: 45, lastCheck: "2026-07-08" },
  { name: "일본수영연맹 지도서", type: "전문서적", country: "일본", lang: "JA", authority: "A", claims: 12, support: 10, oppose: 2, independence: "독립", trust: 89, lastCheck: "2026-06-28" },
  { name: "Swim Smooth Blog", type: "코칭자료", country: "호주", lang: "EN", authority: "B", claims: 18, support: 11, oppose: 7, independence: "독립", trust: 74, lastCheck: "2026-07-03" },
  { name: "출처 불명 블로그", type: "일반 웹", country: "한국", lang: "KO", authority: "F", claims: 15, support: 3, oppose: 12, independence: "불명", trust: 12, lastCheck: "2026-07-09" },
];

const TYPE_ICONS: Record<string, React.ReactNode> = {
  "공식기관": <Building2 size={12} className="text-blue-500" />,
  "연구자료": <FileText size={12} className="text-purple-500" />,
  "전문서적": <BookOpen size={12} className="text-green-500" />,
  "코칭자료": <FileText size={12} className="text-teal-500" />,
  "커뮤니티": <Globe size={12} className="text-amber-500" />,
  "영상": <Video size={12} className="text-red-500" />,
  "일반 웹": <Globe size={12} className="text-slate-400" />,
  "출처 불명": <HelpCircle size={12} className="text-gray-400" />,
};

const TRUST_COLOR = (t: number) =>
  t >= 80 ? "text-emerald-600" : t >= 50 ? "text-amber-600" : "text-red-600";

export default function SourceIntelligence() {
  const [comingSoon, setComingSoon] = useState<any>(null);
  const cs = (name: string, purpose: string, inputs: string[], process: string[], outputs: string[], engine: string) =>
    setComingSoon({ name, purpose, inputs, process, outputs, engine });

  return (
    <div className="p-6">
      <PageHeader
        title="출처 인텔리전스"
        subtitle="Source Intelligence — 어떤 출처에서 어떤 수영 주장이 반복되고 있는지 분석합니다."
        badge={<FeatureBadge kind="PROTOTYPE" />}
        actions={
          <div className="flex gap-2">
            <Button variant="planned" onClick={() => cs("출처 계보 보기", "이 출처가 어떤 원출처에서 파생되었는지 시각화합니다.", ["출처 URL", "인용 관계 데이터", "원출처 추정 알고리즘"], ["인용 체인 분석", "원출처 추적", "파생 관계 시각화"], ["출처 계보 트리", "원출처 신뢰도", "재인용 횟수"], "ENGINE 3 — Autonomous Hunter & Crawler")}>출처 계보</Button>
            <Button variant="planned" onClick={() => cs("반복 인용 감지", "동일 내용을 여러 출처가 반복 인용하는 패턴을 감지합니다.", ["출처 텍스트", "인용 패턴 DB", "유사도 임계값"], ["텍스트 유사도 분석", "인용 관계 매핑", "원출처 특정"], ["반복 인용 목록", "원출처 추정", "신뢰도 조정"], "ENGINE 3 — Autonomous Hunter & Crawler")}>반복 감지</Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="전체 출처" value={SOURCES.length} color="slate" />
        <StatCard label="공식기관" value="1" color="blue" />
        <StatCard label="연구자료" value="1" color="green" />
        <StatCard label="신뢰도 50 미만" value="2" sub="주의 필요" color="red" />
      </div>

      <SectionCard title="출처 목록">
        <Table headers={["출처명", "유형", "국가", "권위", "연결 주장", "찬성", "반대", "독립성", "신뢰도", "최근 확인"]}>
          {SOURCES.map(src => (
            <Tr key={src.name}>
              <Td>
                <div className="flex items-center gap-1.5">
                  {TYPE_ICONS[src.type]}
                  <span className="font-medium text-slate-800">{src.name}</span>
                </div>
              </Td>
              <Td><span className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded">{src.type}</span></Td>
              <Td>{src.country}</Td>
              <Td>
                <span className={`font-bold text-sm ${src.authority === "A+" || src.authority === "A" ? "text-emerald-600" : src.authority === "B" ? "text-blue-600" : src.authority === "C" ? "text-amber-600" : "text-red-600"}`}>
                  {src.authority}
                </span>
              </Td>
              <Td className="text-center font-semibold">{src.claims}</Td>
              <Td className="text-center text-emerald-600 font-semibold">{src.support}</Td>
              <Td className="text-center text-red-500 font-semibold">{src.oppose}</Td>
              <Td>
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold
                  ${src.independence === "독립" ? "bg-emerald-100 text-emerald-700" : src.independence === "재인용" ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-500"}`}>
                  {src.independence}
                </span>
              </Td>
              <Td>
                <div className="flex items-center gap-1.5">
                  <div className="w-16 bg-slate-100 rounded-full h-1.5">
                    <div className="h-1.5 rounded-full" style={{ width: `${src.trust}%`, backgroundColor: src.trust >= 80 ? "#10b981" : src.trust >= 50 ? "#f59e0b" : "#ef4444" }} />
                  </div>
                  <span className={`font-semibold ${TRUST_COLOR(src.trust)}`}>{src.trust}</span>
                </div>
              </Td>
              <Td>{src.lastCheck}</Td>
            </Tr>
          ))}
        </Table>
      </SectionCard>

      <ComingSoonModal isOpen={!!comingSoon} onClose={() => setComingSoon(null)} feature={comingSoon ?? { name: "", purpose: "", inputs: [], process: [], outputs: [], engine: "" }} />
    </div>
  );
}
