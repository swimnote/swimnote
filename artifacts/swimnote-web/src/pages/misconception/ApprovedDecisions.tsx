import { useState } from "react";
import { PageHeader, SectionCard, StatusBadge, Table, Tr, Td, Button, FeatureBadge, ComingSoonModal } from "../../components/ui";
import { SAMPLE_CLAIMS, STROKE_LABELS } from "../../data/mockData";
import { CheckCircle2, Eye } from "lucide-react";

const APPROVED = SAMPLE_CLAIMS.filter(c => ["verified", "supported", "conditional", "rejected", "terminology_only"].includes(c.status));
const FILTER_STATUSES = ["전체", "verified", "supported", "conditional", "terminology_only", "rejected", "harmful"];

export default function ApprovedDecisions() {
  const [filterStatus, setFilterStatus] = useState("전체");
  const [comingSoon, setComingSoon] = useState<any>(null);
  const cs = (name: string) => setComingSoon({
    name,
    purpose: `${name} 기능으로 검증 완료된 판정을 활용합니다.`,
    inputs: ["판정 데이터", "SWIMNOTE 입장", "검증 근거"],
    process: ["데이터 검증", "Knowledge DB 매핑", "AI 규칙 업데이트"],
    outputs: ["Knowledge DB 항목", "AI 답변 필터", "검증 리포트"],
    engine: "ENGINE 1 — Verified Swimming Knowledge Engine",
  });

  const filtered = APPROVED.filter(c => filterStatus === "전체" || c.status === filterStatus);

  const VERDICT_LABELS: Record<string, string> = {
    verified: "VERIFIED", supported: "SUPPORTED", conditional: "CONDITIONAL",
    terminology_only: "TERMINOLOGY ONLY", rejected: "REJECTED", harmful: "HARMFUL",
  };

  return (
    <div className="p-6">
      <PageHeader
        title="검증 완료 판정"
        subtitle="Approved Decisions — 관리자가 승인한 주장의 최종 판정 목록입니다."
        badge={<FeatureBadge kind="PROTOTYPE" />}
        actions={
          <div className="flex gap-2">
            <Button variant="planned" onClick={() => cs("공개용 검증 보고서 생성")}>보고서 생성</Button>
          </div>
        }
      />

      {/* Filter */}
      <div className="flex gap-2 flex-wrap mb-4">
        {FILTER_STATUSES.map(s => (
          <button key={s} onClick={() => setFilterStatus(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${filterStatus === s ? "bg-[#0a2540] text-white border-[#0a2540]" : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"}`}>
            {s === "전체" ? "전체" : VERDICT_LABELS[s] ?? s}
          </button>
        ))}
        <span className="text-xs text-slate-400 self-center ml-2">{filtered.length}건</span>
      </div>

      <SectionCard>
        <Table headers={["주장", "최종 판정", "SWIMNOTE 입장 요약", "확신도", "Knowledge DB", "액션"]}>
          {filtered.map(c => (
            <Tr key={c.id}>
              <Td>
                <div className="font-medium text-slate-800 max-w-[200px]">{c.core_claim}</div>
                <div className="text-[10px] text-slate-400">{STROKE_LABELS[c.stroke ?? ""] ?? c.stroke ?? "-"}</div>
              </Td>
              <Td><StatusBadge status={c.final_verdict ?? c.status} label={VERDICT_LABELS[c.status]} /></Td>
              <Td className="max-w-[200px]">
                <span className="text-[11px] text-slate-600 line-clamp-2">
                  {c.swimnote_position?.official_stance ?? "-"}
                </span>
              </Td>
              <Td>
                <div className="flex items-center gap-1.5">
                  <div className="w-12 bg-slate-100 rounded-full h-1.5">
                    <div className="h-1.5 rounded-full bg-blue-500" style={{ width: `${c.confidence_score}%` }} />
                  </div>
                  <span className="text-[11px]">{c.confidence_score}%</span>
                </div>
              </Td>
              <Td>
                {c.knowledge_db_synced ? (
                  <span className="flex items-center gap-1 text-emerald-600 text-[11px]"><CheckCircle2 size={11} /> 반영됨</span>
                ) : (
                  <span className="text-slate-400 text-[11px]">미반영</span>
                )}
              </Td>
              <Td>
                <div className="flex gap-1">
                  <Button variant="ghost" size="xs" onClick={() => cs("AI 답변 미리보기")}><Eye size={10} /></Button>
                  <Button variant="ghost" size="xs" onClick={() => cs("Knowledge DB 승격")}>DB 승격</Button>
                  <Button variant="ghost" size="xs" onClick={() => cs("판정 재검토")}>재검토</Button>
                </div>
              </Td>
            </Tr>
          ))}
        </Table>
        {filtered.length === 0 && (
          <div className="py-10 text-center text-slate-400 text-sm">해당 상태의 판정이 없습니다.</div>
        )}
      </SectionCard>

      <ComingSoonModal isOpen={!!comingSoon} onClose={() => setComingSoon(null)} feature={comingSoon ?? { name: "", purpose: "", inputs: [], process: [], outputs: [], engine: "" }} />
    </div>
  );
}
