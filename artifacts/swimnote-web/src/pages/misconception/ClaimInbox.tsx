import { useState, useEffect } from "react";
import { Link } from "wouter";
import { PageHeader, SectionCard, StatusBadge, Table, Tr, Td, Button, FeatureBadge, ComingSoonModal } from "../../components/ui";
import { SAMPLE_CLAIMS, CLAIM_TYPE_LABELS, STROKE_LABELS, STATUS_KO, type MisconceptionClaim } from "../../data/mockData";
import { Search, Plus, Download, Upload, RefreshCw, Filter, ChevronRight } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API = "/api";

const STROKES = ["전체", "freestyle", "backstroke", "breaststroke", "butterfly", "general"];
const CLAIM_TYPES = ["전체", ...Object.keys(CLAIM_TYPE_LABELS)];
const STATUSES = ["전체", "new", "review_required", "conditional", "verified", "rejected", "pending", "harmful"];
const PRIORITIES = ["전체", "high", "medium", "low"];

export default function ClaimInbox() {
  const [claims, setClaims] = useState<MisconceptionClaim[]>(SAMPLE_CLAIMS);
  const [search, setSearch] = useState("");
  const [filterStroke, setFilterStroke] = useState("전체");
  const [filterType, setFilterType] = useState("전체");
  const [filterStatus, setFilterStatus] = useState("전체");
  const [filterPriority, setFilterPriority] = useState("전체");
  const [filterReview, setFilterReview] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newClaim, setNewClaim] = useState("");
  const [comingSoon, setComingSoon] = useState<null | { name: string; purpose: string; inputs: string[]; process: string[]; outputs: string[]; engine: string }>(null);

  // Try to fetch from API, fall back to sample data
  useEffect(() => {
    fetch(`${API}/misconception/candidates?limit=100`)
      .then(r => r.json())
      .then(d => { if (d.success && d.items?.length) setClaims(d.items); })
      .catch(() => {});
  }, []);

  const filtered = claims.filter(c => {
    if (search && !c.core_claim.includes(search) && !(c.original_expression ?? "").includes(search)) return false;
    if (filterStroke !== "전체" && c.stroke !== filterStroke) return false;
    if (filterType !== "전체" && c.claim_type !== filterType) return false;
    if (filterStatus !== "전체" && c.status !== filterStatus) return false;
    if (filterPriority !== "전체" && c.priority !== filterPriority) return false;
    if (filterReview && !c.review_needed) return false;
    return true;
  });

  const handleAddClaim = async () => {
    if (!newClaim.trim()) return;
    const item: MisconceptionClaim = {
      id: `mc_${Date.now()}`,
      core_claim: newClaim.trim(),
      claim_type: "MISCONCEPTION", status: "new",
      priority: "medium", confidence_score: 50, repeat_count: 1, review_needed: false,
      created_at: new Date().toISOString(),
    };
    try {
      const res = await fetch(`${API}/misconception/candidates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ core_claim: newClaim.trim() }),
      });
      if (res.ok) {
        const d = await res.json();
        if (d.item) { setClaims(prev => [d.item, ...prev]); setNewClaim(""); setShowAdd(false); return; }
      }
    } catch {}
    setClaims(prev => [item, ...prev]);
    setNewClaim(""); setShowAdd(false);
  };

  return (
    <div className="p-6">
      <PageHeader
        title="주장 수집함"
        subtitle="Claim Inbox — 비근거·미신·오개념 후보를 한곳에서 관리합니다."
        badge={<FeatureBadge kind="PROTOTYPE" />}
        actions={
          <div className="flex gap-2 flex-wrap">
            <Button variant="primary" onClick={() => setShowAdd(true)}><Plus size={12} /> 주장 등록</Button>
            <Button variant="secondary" onClick={() => setComingSoon({ name: "질문에서 주장 추출", purpose: "사용자 질문 로그에서 비근거 주장을 자동으로 감지·추출합니다.", inputs: ["사용자 질문 로그", "AI 답변 이력", "빈도 임계값"], process: ["질문 텍스트 분석", "의미론적 군집화", "오개념 패턴 매칭", "중복 병합"], outputs: ["주장 후보 목록", "빈도 데이터", "원문 표현"], engine: "ENGINE 2 — Misconception & Diagnostic Intelligence Engine" })}><Filter size={12} /> 질문 추출</Button>
            <Button variant="secondary" onClick={() => setComingSoon({ name: "검색 결과에서 주장 가져오기", purpose: "외부 검색 결과에서 비근거 주장을 자동 수집합니다.", inputs: ["검색 쿼리", "검색 엔진 결과", "출처 URL"], process: ["웹 크롤링", "본문 추출", "주장 감지", "출처 기록"], outputs: ["주장 후보", "출처 메타데이터", "신뢰도 점수"], engine: "ENGINE 3 — Autonomous Hunter & Crawler" })}><Search size={12} /> 검색 가져오기</Button>
            <Button variant="secondary" onClick={() => {}}><Download size={12} /> CSV</Button>
            <Button variant="secondary" onClick={() => {}}><RefreshCw size={12} /></Button>
          </div>
        }
      />

      {/* Add Claim Inline */}
      {showAdd && (
        <div className="mb-4 bg-blue-50 border border-blue-200 rounded-xl p-4 flex gap-2">
          <input
            className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            placeholder="핵심 주장을 입력하세요..."
            value={newClaim}
            onChange={e => setNewClaim(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleAddClaim()}
            autoFocus
          />
          <Button variant="primary" onClick={handleAddClaim}>등록</Button>
          <Button variant="secondary" onClick={() => { setShowAdd(false); setNewClaim(""); }}>취소</Button>
        </div>
      )}

      {/* Filters */}
      <SectionCard className="mb-4">
        <div className="p-3 flex flex-wrap gap-3 items-center">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              className="pl-8 pr-3 py-1.5 border border-slate-200 rounded-lg text-xs w-48 focus:outline-none focus:ring-1 focus:ring-blue-400"
              placeholder="주장 검색..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <select className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none" value={filterStroke} onChange={e => setFilterStroke(e.target.value)}>
            {STROKES.map(s => <option key={s} value={s}>{s === "전체" ? "전체 영법" : STROKE_LABELS[s] ?? s}</option>)}
          </select>
          <select className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none" value={filterType} onChange={e => setFilterType(e.target.value)}>
            {CLAIM_TYPES.map(t => <option key={t} value={t}>{t === "전체" ? "전체 유형" : CLAIM_TYPE_LABELS[t] ?? t}</option>)}
          </select>
          <select className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            {STATUSES.map(s => <option key={s} value={s}>{s === "전체" ? "전체 상태" : STATUS_KO[s] ?? s}</option>)}
          </select>
          <select className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none" value={filterPriority} onChange={e => setFilterPriority(e.target.value)}>
            {PRIORITIES.map(p => <option key={p} value={p}>{p === "전체" ? "전체 우선순위" : p}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
            <input type="checkbox" className="rounded" checked={filterReview} onChange={e => setFilterReview(e.target.checked)} />
            검토 필요만
          </label>
          <span className="text-xs text-slate-400 ml-auto">{filtered.length}건</span>
        </div>
      </SectionCard>

      {/* Table */}
      <SectionCard>
        <Table headers={["ID", "핵심 주장", "영법", "유형", "상태", "우선순위", "반복", "확신도", "검토"]}>
          {filtered.map(c => (
            <Tr key={c.id} onClick={() => {}}>
              <Td className="font-mono text-[10px] text-slate-400">{c.id.slice(-6)}</Td>
              <Td>
                <Link href={`/ai-admin/misconception/claim-inbox/${c.id}`} className="font-medium text-slate-800 hover:text-blue-600 transition-colors">
                  {c.core_claim}
                </Link>
                {c.original_expression && (
                  <div className="text-[10px] text-slate-400 mt-0.5 truncate max-w-[250px]">{c.original_expression}</div>
                )}
              </Td>
              <Td>{STROKE_LABELS[c.stroke ?? ""] ?? c.stroke ?? "-"}</Td>
              <Td>
                <span className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-600">
                  {CLAIM_TYPE_LABELS[c.claim_type] ?? c.claim_type}
                </span>
              </Td>
              <Td><StatusBadge status={c.status} /></Td>
              <Td><StatusBadge status={c.priority} /></Td>
              <Td className="text-center font-semibold">{c.repeat_count}</Td>
              <Td>
                <div className="flex items-center gap-1">
                  <div className="w-16 bg-slate-100 rounded-full h-1.5">
                    <div className="h-1.5 rounded-full bg-blue-500" style={{ width: `${c.confidence_score}%` }} />
                  </div>
                  <span>{c.confidence_score}%</span>
                </div>
              </Td>
              <Td>
                {c.review_needed && (
                  <span className="text-[10px] bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded font-semibold">필요</span>
                )}
              </Td>
            </Tr>
          ))}
        </Table>
        {filtered.length === 0 && (
          <div className="py-12 text-center text-slate-400 text-sm">검색 조건에 맞는 주장이 없습니다.</div>
        )}
      </SectionCard>

      <ComingSoonModal isOpen={!!comingSoon} onClose={() => setComingSoon(null)} feature={comingSoon ?? { name: "", purpose: "", inputs: [], process: [], outputs: [], engine: "" }} />
    </div>
  );
}
