import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { PageHeader, SectionCard, StatusBadge, Button, FeatureBadge, ComingSoonModal } from "../../components/ui";
import { SAMPLE_CLAIMS, CLAIM_TYPE_LABELS, STROKE_LABELS, STATUS_KO } from "../../data/mockData";
import { ArrowLeft, Save, AlertTriangle } from "lucide-react";

const API = "/api";
const STATUSES = ["new", "review_required", "conditional", "verified", "supported", "rejected", "harmful", "pending", "disputed", "terminology_only"];

export default function ClaimDetail() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const [claim, setClaim] = useState<any>(null);
  const [memo, setMemo] = useState("");
  const [status, setStatus] = useState("new");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [comingSoon, setComingSoon] = useState<any>(null);

  useEffect(() => {
    fetch(`${API}/misconception/candidates/${id}`)
      .then(r => r.json())
      .then(d => {
        if (d.success && d.item) {
          setClaim(d.item);
          setMemo(d.item.admin_memo ?? "");
          setStatus(d.item.status ?? "new");
          return;
        }
        throw new Error("not found");
      })
      .catch(() => {
        const sample = SAMPLE_CLAIMS.find(c => c.id === id);
        if (sample) { setClaim(sample); setMemo(sample.admin_memo ?? ""); setStatus(sample.status ?? "new"); }
      });
  }, [id]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch(`${API}/misconception/candidates/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, admin_memo: memo }),
      });
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    } catch {}
    setClaim((prev: any) => prev ? { ...prev, status, admin_memo: memo } : prev);
    setSaving(false);
  };

  const planned = (name: string, purpose: string, inputs: string[], process: string[], outputs: string[], engine: string) =>
    setComingSoon({ name, purpose, inputs, process, outputs, engine });

  if (!claim) return <div className="p-6 text-slate-500">로딩 중...</div>;

  const dta = claim.dta_json ?? {};
  const diag = claim.diagnosis_json ?? {};
  const pos = claim.swimnote_position ?? {};

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center gap-2 mb-4">
        <button onClick={() => navigate("/ai-admin/misconception/claim-inbox")} className="text-slate-400 hover:text-slate-600 transition-colors">
          <ArrowLeft size={18} />
        </button>
        <span className="text-xs text-slate-400">주장 수집함 / 상세</span>
      </div>

      {/* Header */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 mb-4">
        <div className="flex items-start justify-between gap-4 mb-3">
          <h1 className="text-lg font-bold text-[#0a2540]">{claim.core_claim}</h1>
          <div className="flex gap-2 shrink-0 flex-wrap">
            <StatusBadge status={claim.status} />
            <StatusBadge status={claim.priority} label={`우선순위: ${claim.priority}`} />
          </div>
        </div>
        {claim.original_expression && (
          <p className="text-sm text-slate-500 mb-3 italic">원문: "{claim.original_expression}"</p>
        )}
        <div className="flex flex-wrap gap-4 text-xs text-slate-500">
          <span>영법: <strong className="text-slate-700">{STROKE_LABELS[claim.stroke ?? ""] ?? claim.stroke ?? "-"}</strong></span>
          <span>유형: <strong className="text-slate-700">{CLAIM_TYPE_LABELS[claim.claim_type] ?? claim.claim_type}</strong></span>
          <span>확신도: <strong className="text-slate-700">{claim.confidence_score}%</strong></span>
          <span>반복: <strong className="text-slate-700">{claim.repeat_count}회</strong></span>
          {claim.review_needed && <span className="text-orange-600 font-bold flex items-center gap-1"><AlertTriangle size={12} />검토 필요</span>}
        </div>
        {claim.tags && (
          <div className="flex flex-wrap gap-1 mt-3">
            {claim.tags.split(",").map((t: string) => (
              <span key={t} className="text-[11px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded">{t.trim()}</span>
            ))}
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex flex-wrap gap-2 mb-4">
        <Button variant="primary" onClick={() => navigate("/ai-admin/misconception/verification-workbench")}>검증 시작</Button>
        <Button variant="planned" onClick={() => planned("외부 확장검색", "이 주장과 관련된 외부 소스를 자동 검색합니다.", ["주장 텍스트", "검색 언어 설정", "검색 엔진 API"], ["키워드 추출", "검색 실행", "결과 파싱", "출처 기록"], ["출처 목록", "관련 주장", "원문 링크"], "ENGINE 3 — Autonomous Hunter & Crawler")}>외부 확장검색</Button>
        <Button variant="secondary" onClick={() => navigate("/ai-admin/misconception/dta-lab")}>DTA 검증</Button>
        <Button variant="planned" onClick={() => planned("물리 검증", "F=ma, 작용·반작용 등 기본 물리법칙으로 주장을 검증합니다.", ["주장 내용", "관련 신체 동작 데이터", "유체역학 기준값"], ["물리법칙 적용", "충돌 여부 판정", "검증 요약 생성"], ["물리 충돌 여부", "검증 요약", "SWIMNOTE 대체 설명"], "ENGINE 4 — DTA Scientific Verification Engine")}>물리 검증</Button>
        <Button variant="secondary" onClick={handleSave} disabled={saving}><Save size={12} />{saving ? "저장 중..." : saved ? "저장 완료!" : "메모 저장"}</Button>
        <Button variant="planned" onClick={() => planned("Knowledge 후보로 승격", "이 판정을 Knowledge DB에 반영하는 공식 프로세스를 시작합니다.", ["최종 판정", "SWIMNOTE 입장", "승인된 대체 설명", "금지 표현"], ["중복 검사", "Knowledge DB 등록", "AI 답변 규칙 업데이트"], ["Knowledge DB 항목", "AI 답변 필터", "검증 이력"], "ENGINE 1 — Verified Swimming Knowledge Engine")}>Knowledge 승격</Button>
        <Button variant="planned" onClick={() => planned("영상분석 항목 생성", "이 오개념과 연관된 영상 분석 검사항목을 생성합니다.", ["오개념 내용", "예상 신체 오류", "DTA 연결 포인트"], ["분석 항목 정의", "측정 기준 설정", "영상 AI 연결"], ["영상 분석 체크리스트", "DTA 측정 기준", "교정 전후 비교 설정"], "ENGINE 5 — Video Motion Analysis Engine")}>영상분석 항목 생성</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 상태 수정 */}
        <SectionCard title="D. 임시 판정 수정">
          <div className="p-4 space-y-3">
            <div>
              <label className="text-xs font-semibold text-slate-600 block mb-1">상태</label>
              <select
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                value={status}
                onChange={e => setStatus(e.target.value)}
              >
                {STATUSES.map(s => <option key={s} value={s}>{STATUS_KO[s] ?? s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600 block mb-1">관리자 메모</label>
              <textarea
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 resize-none"
                rows={5}
                value={memo}
                onChange={e => setMemo(e.target.value)}
                placeholder="검증 근거, 참고 자료, 판정 이유를 입력하세요..."
              />
            </div>
            <Button variant="primary" onClick={handleSave} disabled={saving} className="w-full justify-center">
              <Save size={12} />{saving ? "저장 중..." : "저장"}
            </Button>
          </div>
        </SectionCard>

        {/* DTA */}
        <SectionCard title="DTA 검증 요약">
          <div className="p-4 space-y-2">
            {["direction", "timing", "advance"].map(axis => {
              const val = dta[axis];
              const styleMap: Record<string, string> = { PASS: "text-emerald-600", FAIL: "text-red-600", CONDITIONAL: "text-amber-600" };
              return (
                <div key={axis} className="flex items-center justify-between py-1.5 border-b border-slate-50 last:border-0">
                  <span className="text-xs font-semibold text-slate-700 capitalize">{axis}</span>
                  {val ? (
                    <span className={`text-xs font-bold ${styleMap[val] ?? "text-slate-500"}`}>{val}</span>
                  ) : (
                    <span className="text-xs text-slate-300">미입력</span>
                  )}
                </div>
              );
            })}
            <Button variant="secondary" className="w-full mt-2 justify-center" onClick={() => navigate("/ai-admin/misconception/dta-lab")}>
              DTA 검증실 열기
            </Button>
          </div>
        </SectionCard>

        {/* SWIMNOTE 입장 */}
        {pos.official_stance && (
          <SectionCard title="E. SWIMNOTE 공식 입장">
            <div className="p-4 space-y-2 text-xs text-slate-600">
              <div><span className="font-semibold text-slate-700">공식 입장:</span> {pos.official_stance}</div>
              {pos.forbidden_expression && (
                <div className="bg-red-50 border border-red-100 rounded-lg p-2">
                  <span className="font-semibold text-red-600">금지 표현:</span> {pos.forbidden_expression}
                </div>
              )}
              {pos.conditional && (
                <div className="bg-yellow-50 border border-yellow-100 rounded-lg p-2">
                  <span className="font-semibold text-yellow-700">조건부 허용:</span> {pos.conditional}
                </div>
              )}
            </div>
          </SectionCard>
        )}

        {/* 진단 연결 */}
        {(diag.expected_errors || diag.corrections) && (
          <SectionCard title="F. 진단 연결">
            <div className="p-4 space-y-3 text-xs">
              {diag.expected_errors && (
                <div>
                  <div className="font-semibold text-slate-700 mb-1">예상 오류</div>
                  <ul className="list-disc list-inside text-slate-500 space-y-0.5">
                    {diag.expected_errors.map((e: string) => <li key={e}>{e}</li>)}
                  </ul>
                </div>
              )}
              {diag.corrections && (
                <div>
                  <div className="font-semibold text-slate-700 mb-1">교정 방법</div>
                  <ul className="list-disc list-inside text-slate-500 space-y-0.5">
                    {diag.corrections.map((c: string) => <li key={c}>{c}</li>)}
                  </ul>
                </div>
              )}
            </div>
          </SectionCard>
        )}
      </div>

      <ComingSoonModal isOpen={!!comingSoon} onClose={() => setComingSoon(null)} feature={comingSoon ?? { name: "", purpose: "", inputs: [], process: [], outputs: [], engine: "" }} />
    </div>
  );
}
