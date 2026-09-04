/**
 * SuperKnowledgeCandidates.tsx — WP-CS24: Learning Loop Review Console
 *
 * 목적: support_knowledge_candidates 관리 (Super Admin 전용)
 *
 * §0 절대원칙:
 *   - AUTO_ACTIVATE 절대 금지 (approve → pending KI 생성, CS16 governance 필요)
 *   - DYNAMIC/POLICY candidate approve → API에서 403
 *   - PII raw text 표시 금지
 *   - 최종 권한 검증은 서버 담당
 */

import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";

// ── Types ──────────────────────────────────────────────────────────────────────

type CandidateType = "UTTERANCE_EXTENSION" | "NEW_CANONICAL";
type Classification =
  | "NORMAL" | "DYNAMIC_DATA_REQUIRED" | "POLICY_REQUIRED"
  | "AMBIGUOUS" | "HUMAN_JUDGMENT_REQUIRED";
type SourceType = "NO_MATCH" | "GPT_FALLBACK" | "HUMAN" | "ADMIN_CREATED";
type CandidateStatus = "PENDING" | "APPROVED" | "REJECTED" | "MERGED";
type SortMode = "priority" | "recent" | "count";

interface Candidate {
  id: string;
  candidate_type: CandidateType;
  classification: Classification;
  source_type: SourceType;
  representative_query: string;
  normalized_query: string;
  suggested_intent_id: string | null;
  suggested_knowledge_id: string | null;
  suggested_ki_title?: string | null;
  suggested_ki_answer?: string | null;
  suggested_answer: string | null;
  occurrence_count: number;
  gpt_fallback_count: number;
  human_request_count: number;
  first_seen_at: string;
  last_seen_at: string;
  affected_roles: string[];
  affected_modes: string[];
  risk: "LOW" | "MEDIUM" | "HIGH";
  status: CandidateStatus;
}

interface LearningMetrics {
  support_queries_total: number;
  direct_db_total: number;
  direct_db_rate: number;
  gpt_fallback_total: number;
  gpt_fallback_rate: number;
  human_request_total: number;
  human_request_rate: number;
  no_match_total: number;
  candidates_created: number;
  utterance_extension_candidates: number;
  new_canonical_candidates: number;
  dynamic_data_candidates: number;
  policy_required_candidates: number;
  candidates_approved: number;
  candidates_rejected: number;
  candidates_merged: number;
  utterances_added: number;
  canonicals_added: number;
}

// ── Badge helpers ─────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<CandidateType, string> = {
  UTTERANCE_EXTENSION: "표현 추가",
  NEW_CANONICAL: "신규 정답",
};
const TYPE_COLORS: Record<CandidateType, string> = {
  UTTERANCE_EXTENSION: "bg-blue-100 text-blue-700",
  NEW_CANONICAL:       "bg-purple-100 text-purple-700",
};

const CLASS_LABELS: Record<Classification, string> = {
  NORMAL:                   "일반",
  DYNAMIC_DATA_REQUIRED:    "⚠ Dynamic",
  POLICY_REQUIRED:          "⚠ Policy",
  AMBIGUOUS:                "⚠ 모호",
  HUMAN_JUDGMENT_REQUIRED:  "👤 Human 판단",
};
const CLASS_COLORS: Record<Classification, string> = {
  NORMAL:                   "bg-gray-100 text-gray-600",
  DYNAMIC_DATA_REQUIRED:    "bg-orange-100 text-orange-700",
  POLICY_REQUIRED:          "bg-red-100 text-red-700",
  AMBIGUOUS:                "bg-yellow-100 text-yellow-700",
  HUMAN_JUDGMENT_REQUIRED:  "bg-pink-100 text-pink-700",
};

const SRC_LABELS: Record<SourceType, string> = {
  NO_MATCH:      "NO_MATCH",
  GPT_FALLBACK:  "GPT 폴백",
  HUMAN:         "Human 문의",
  ADMIN_CREATED: "관리자 등록",
};

const RISK_COLORS: Record<"LOW" | "MEDIUM" | "HIGH", string> = {
  LOW:    "text-green-600",
  MEDIUM: "text-yellow-600",
  HIGH:   "text-red-600",
};

// ── Metrics panel ─────────────────────────────────────────────────────────────

function MetricsPanel({ metrics }: { metrics: LearningMetrics | null }) {
  if (!metrics) {
    return <div className="text-[12px] text-[#aaa] p-4">메트릭 로딩 중...</div>;
  }
  const tiles = [
    { label: "전체 쿼리",     value: metrics.support_queries_total },
    { label: "DIRECT_DB",     value: `${metrics.direct_db_total} (${metrics.direct_db_rate}%)` },
    { label: "GPT 폴백",      value: `${metrics.gpt_fallback_total} (${metrics.gpt_fallback_rate}%)` },
    { label: "Human 문의",    value: `${metrics.human_request_total} (${metrics.human_request_rate}%)` },
    { label: "NO_MATCH",      value: metrics.no_match_total },
    { label: "Candidate 총",  value: metrics.candidates_created },
    { label: "표현 추가 후보", value: metrics.utterance_extension_candidates },
    { label: "신규 정답 후보", value: metrics.new_canonical_candidates },
    { label: "Dynamic",       value: metrics.dynamic_data_candidates },
    { label: "Policy",        value: metrics.policy_required_candidates },
    { label: "승인됨",        value: metrics.candidates_approved },
    { label: "거부됨",        value: metrics.candidates_rejected },
    { label: "병합됨",        value: metrics.candidates_merged },
    { label: "Utterance 추가", value: metrics.utterances_added },
    { label: "Canonical 추가", value: metrics.canonicals_added },
  ];
  return (
    <div className="grid grid-cols-5 gap-2 p-4 bg-[#f9f9fb] border-b border-[#eee]">
      {tiles.map(t => (
        <div key={t.label} className="bg-white rounded-lg border border-[#eee] p-2.5 text-center">
          <div className="text-[10px] text-[#888] mb-1">{t.label}</div>
          <div className="text-[14px] font-bold text-[#002F5F]">{t.value}</div>
        </div>
      ))}
    </div>
  );
}

// ── Candidate card ────────────────────────────────────────────────────────────

function CandidateCard({
  c,
  onApproveUtterance,
  onApproveCanonical,
  onReject,
  onMerge,
  onReclassify,
}: {
  c: Candidate;
  onApproveUtterance: (c: Candidate) => void;
  onApproveCanonical: (c: Candidate) => void;
  onReject: (c: Candidate) => void;
  onMerge: (c: Candidate) => void;
  onReclassify: (c: Candidate) => void;
}) {
  const isBlocked = c.classification === "DYNAMIC_DATA_REQUIRED" || c.classification === "POLICY_REQUIRED";
  const isAmbiguous = c.classification === "AMBIGUOUS";

  const priorityScore = (c.occurrence_count * 1) + (c.human_request_count * 5) + (c.gpt_fallback_count * 2);

  return (
    <div className={`bg-white rounded-xl border ${isBlocked ? "border-red-200" : "border-[#e5e5e5]"} p-4 mb-3 shadow-sm`}>
      {/* Header */}
      <div className="flex items-start gap-2 mb-2">
        <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${TYPE_COLORS[c.candidate_type]}`}>
          {TYPE_LABELS[c.candidate_type]}
        </span>
        <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${CLASS_COLORS[c.classification]}`}>
          {CLASS_LABELS[c.classification]}
        </span>
        <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-gray-50 text-gray-500 border border-gray-200">
          {SRC_LABELS[c.source_type]}
        </span>
        <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${RISK_COLORS[c.risk]}`}>
          risk: {c.risk}
        </span>
        <div className="ml-auto text-[11px] text-[#aaa]">
          score: <span className="font-semibold text-[#444]">{priorityScore}</span>
        </div>
      </div>

      {/* 대표 질문 */}
      <div className="text-[14px] font-semibold text-[#111] mb-1">{c.representative_query}</div>
      <div className="text-[11px] text-[#888] mb-2 font-mono">{c.normalized_query}</div>

      {/* 통계 */}
      <div className="flex gap-4 mb-2 text-[12px]">
        <span>발생 <b>{c.occurrence_count}회</b></span>
        <span>GPT <b>{c.gpt_fallback_count}회</b></span>
        <span>Human 문의 <b>{c.human_request_count}회</b></span>
        <span className="text-[#bbb]">최근: {new Date(c.last_seen_at).toLocaleString("ko-KR")}</span>
      </div>

      {/* 기존 KI 후보 */}
      {c.suggested_knowledge_id && (
        <div className="text-[11px] bg-blue-50 border border-blue-100 rounded p-2 mb-2">
          <span className="font-medium text-blue-700">기존 KI: </span>
          <span className="font-mono text-[10px]">{c.suggested_knowledge_id}</span>
          {c.suggested_ki_title && (
            <span className="ml-2 text-blue-600">{c.suggested_ki_title}</span>
          )}
        </div>
      )}

      {/* 제안 답변 */}
      {c.suggested_answer && (
        <div className="text-[11px] bg-gray-50 border border-gray-200 rounded p-2 mb-2 max-h-20 overflow-y-auto">
          <div className="font-medium text-[#555] mb-1">제안 답변</div>
          <div className="text-[#444] whitespace-pre-wrap">{c.suggested_answer}</div>
        </div>
      )}

      {/* Role/Mode */}
      <div className="flex gap-2 text-[10px] text-[#888] mb-3">
        <span>roles: {Array.isArray(c.affected_roles) ? c.affected_roles.join(", ") : String(c.affected_roles)}</span>
        <span>modes: {Array.isArray(c.affected_modes) ? c.affected_modes.join(", ") : String(c.affected_modes)}</span>
      </div>

      {/* 차단 경고 */}
      {isBlocked && (
        <div className="text-[11px] text-red-600 bg-red-50 border border-red-200 rounded p-2 mb-3">
          ⚠ {c.classification === "DYNAMIC_DATA_REQUIRED"
            ? "Dynamic 데이터 질문 — Static Knowledge로 승격 불가"
            : "Policy 질문 — 공식 정책 Source 없이 승급 불가"}
        </div>
      )}
      {isAmbiguous && (
        <div className="text-[11px] text-yellow-700 bg-yellow-50 border border-yellow-200 rounded p-2 mb-3">
          ⚠ 모호한 질문 — 특정 Intent로 자동 승격 불가 (clarification UX 후보)
        </div>
      )}

      {/* Actions */}
      {c.status === "PENDING" && (
        <div className="flex gap-2 flex-wrap">
          {c.candidate_type === "UTTERANCE_EXTENSION" && !isBlocked && !isAmbiguous && (
            <button
              onClick={() => onApproveUtterance(c)}
              className="px-3 py-1.5 text-[11px] bg-[#002F5F] text-white rounded-lg hover:bg-[#00234A] transition"
            >
              Utterance 추가
            </button>
          )}
          {c.candidate_type === "NEW_CANONICAL" && !isBlocked && (
            <button
              onClick={() => onApproveCanonical(c)}
              className="px-3 py-1.5 text-[11px] bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition"
            >
              새 Canonical 생성
            </button>
          )}
          <button
            onClick={() => onMerge(c)}
            className="px-3 py-1.5 text-[11px] bg-white border border-[#ccc] text-[#555] rounded-lg hover:bg-[#f5f5f7] transition"
          >
            병합
          </button>
          <button
            onClick={() => onReclassify(c)}
            className="px-3 py-1.5 text-[11px] bg-white border border-[#ccc] text-[#555] rounded-lg hover:bg-[#f5f5f7] transition"
          >
            재분류
          </button>
          <button
            onClick={() => onReject(c)}
            className="px-3 py-1.5 text-[11px] bg-white border border-red-200 text-red-600 rounded-lg hover:bg-red-50 transition"
          >
            거부
          </button>
        </div>
      )}
    </div>
  );
}

// ── Dialogs ───────────────────────────────────────────────────────────────────

function ApproveUtteranceDialog({
  candidate,
  onClose,
  onDone,
}: {
  candidate: Candidate;
  onClose: () => void;
  onDone: () => void;
}) {
  const [knowledgeId, setKnowledgeId] = useState(candidate.suggested_knowledge_id ?? "");
  const [utterance, setUtterance]     = useState(candidate.representative_query);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState<string | null>(null);

  const submit = async () => {
    if (!knowledgeId || !utterance) { setError("필수 필드를 입력하세요"); return; }
    setLoading(true); setError(null);
    try {
      await api.patch(`/super/support/knowledge-candidates/${candidate.id}/approve-utterance`, {
        knowledge_id: knowledgeId, utterance,
      });
      onDone();
    } catch (e: any) {
      setError(e?.response?.data?.error ?? e.message ?? "오류 발생");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-5" onClick={e => e.stopPropagation()}>
        <h3 className="text-[14px] font-bold text-[#111] mb-3">Utterance 추가 (기존 KI에 표현 연결)</h3>
        <div className="text-[11px] text-red-600 bg-red-50 border border-red-100 rounded p-2 mb-3">
          ⚠ 기존 KI의 affected_roles/modes를 자동 상속합니다. 권한 범위 확대 불가.
        </div>
        <div className="mb-3">
          <label className="text-[11px] font-medium text-[#555] block mb-1">Knowledge ID</label>
          <input
            value={knowledgeId}
            onChange={e => setKnowledgeId(e.target.value)}
            placeholder="ki_xxx"
            className="w-full h-8 px-2 text-[12px] border border-[#ddd] rounded focus:outline-none focus:border-[#002F5F]"
          />
        </div>
        <div className="mb-3">
          <label className="text-[11px] font-medium text-[#555] block mb-1">utterance (새 질문 표현)</label>
          <input
            value={utterance}
            onChange={e => setUtterance(e.target.value)}
            className="w-full h-8 px-2 text-[12px] border border-[#ddd] rounded focus:outline-none focus:border-[#002F5F]"
          />
        </div>
        {error && <div className="text-[11px] text-red-600 mb-2">{error}</div>}
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-3 py-1.5 text-[12px] text-[#555] border border-[#ddd] rounded-lg">취소</button>
          <button onClick={submit} disabled={loading} className="px-3 py-1.5 text-[12px] bg-[#002F5F] text-white rounded-lg disabled:opacity-50">
            {loading ? "처리 중..." : "Utterance 추가"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ApproveCanonicalDialog({
  candidate,
  onClose,
  onDone,
}: {
  candidate: Candidate;
  onClose: () => void;
  onDone: () => void;
}) {
  const [title, setTitle]     = useState("");
  const [question, setQ]      = useState(candidate.representative_query);
  const [answer, setAnswer]   = useState(candidate.suggested_answer ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const submit = async () => {
    if (!title || !question || !answer) { setError("필수 필드를 입력하세요"); return; }
    setLoading(true); setError(null);
    try {
      await api.patch(`/super/support/knowledge-candidates/${candidate.id}/approve-canonical`, {
        title, question, answer, item_type: "FAQ", scope: "global",
        roles: candidate.affected_roles, modes: candidate.affected_modes,
      });
      onDone();
    } catch (e: any) {
      setError(e?.response?.data?.error ?? e.message ?? "오류 발생");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 p-5" onClick={e => e.stopPropagation()}>
        <h3 className="text-[14px] font-bold text-[#111] mb-1">새 Canonical 생성</h3>
        <div className="text-[11px] text-[#888] mb-3">status=pending 으로 생성 → CS16 governance 검토 후 active</div>
        <div className="text-[11px] text-orange-600 bg-orange-50 border border-orange-100 rounded p-2 mb-3">
          ⚠ PII(학생명/전화/이메일) 포함 금지. 범용 문구로 작성.
        </div>
        <div className="mb-2">
          <label className="text-[11px] font-medium text-[#555] block mb-1">제목</label>
          <input value={title} onChange={e => setTitle(e.target.value)}
            className="w-full h-8 px-2 text-[12px] border border-[#ddd] rounded focus:outline-none focus:border-[#002F5F]" />
        </div>
        <div className="mb-2">
          <label className="text-[11px] font-medium text-[#555] block mb-1">대표 질문</label>
          <input value={question} onChange={e => setQ(e.target.value)}
            className="w-full h-8 px-2 text-[12px] border border-[#ddd] rounded focus:outline-none focus:border-[#002F5F]" />
        </div>
        <div className="mb-3">
          <label className="text-[11px] font-medium text-[#555] block mb-1">정답 (Canonical Answer)</label>
          <textarea value={answer} onChange={e => setAnswer(e.target.value)} rows={4}
            className="w-full px-2 py-1 text-[12px] border border-[#ddd] rounded focus:outline-none focus:border-[#002F5F] resize-none" />
        </div>
        {error && <div className="text-[11px] text-red-600 mb-2">{error}</div>}
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-3 py-1.5 text-[12px] text-[#555] border border-[#ddd] rounded-lg">취소</button>
          <button onClick={submit} disabled={loading} className="px-3 py-1.5 text-[12px] bg-purple-600 text-white rounded-lg disabled:opacity-50">
            {loading ? "처리 중..." : "Canonical 생성 (pending)"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

type TabId = "PENDING" | "APPROVED" | "REJECTED" | "MERGED";

export default function SuperKnowledgeCandidates() {
  const [tab, setTab]                 = useState<TabId>("PENDING");
  const [sort, setSort]               = useState<SortMode>("priority");
  const [candidates, setCandidates]   = useState<Candidate[]>([]);
  const [total, setTotal]             = useState(0);
  const [loading, setLoading]         = useState(false);
  const [metrics, setMetrics]         = useState<LearningMetrics | null>(null);
  const [showMetrics, setShowMetrics] = useState(true);

  // Dialogs
  const [utterDialog, setUtterDialog]   = useState<Candidate | null>(null);
  const [canonDialog, setCanonDialog]   = useState<Candidate | null>(null);
  const [rejectDialog, setRejectDialog] = useState<Candidate | null>(null);
  const [mergeDialog, setMergeDialog]   = useState<Candidate | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError]     = useState<string | null>(null);

  const loadCandidates = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.get<{ candidates: Candidate[]; total: number }>(
        `/super/support/knowledge-candidates?status=${tab}&sort=${sort}&limit=50`
      );
      setCandidates(d.candidates ?? []);
      setTotal(d.total ?? 0);
    } catch {
      setCandidates([]); setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [tab, sort]);

  const loadMetrics = useCallback(async () => {
    try {
      const m = await api.get<LearningMetrics>("/super/support/learning-metrics");
      setMetrics(m);
    } catch { /* best-effort */ }
  }, []);

  useEffect(() => { loadCandidates(); }, [loadCandidates]);
  useEffect(() => { loadMetrics(); }, [loadMetrics]);

  const handleReject = async () => {
    if (!rejectDialog) return;
    setActionLoading(true); setActionError(null);
    try {
      await api.patch(`/super/support/knowledge-candidates/${rejectDialog.id}/reject`, { reason: rejectReason });
      setRejectDialog(null); setRejectReason("");
      loadCandidates(); loadMetrics();
    } catch (e: any) {
      setActionError(e?.response?.data?.error ?? "오류 발생");
    } finally { setActionLoading(false); }
  };

  const handleMerge = async () => {
    if (!mergeDialog || !mergeTargetId) { setActionError("target_id 필수"); return; }
    setActionLoading(true); setActionError(null);
    try {
      await api.patch(`/super/support/knowledge-candidates/${mergeDialog.id}/merge`, { target_id: mergeTargetId });
      setMergeDialog(null); setMergeTargetId("");
      loadCandidates(); loadMetrics();
    } catch (e: any) {
      setActionError(e?.response?.data?.error ?? "오류 발생");
    } finally { setActionLoading(false); }
  };

  const TABS: { id: TabId; label: string }[] = [
    { id: "PENDING",  label: "검토 대기" },
    { id: "APPROVED", label: "승인됨" },
    { id: "REJECTED", label: "거부됨" },
    { id: "MERGED",   label: "병합됨" },
  ];

  return (
    <div className="h-full flex flex-col bg-[#f5f5f7]">
      {/* Header */}
      <div className="bg-white border-b border-[#e5e5e5] px-6 py-4 flex items-center gap-4 shrink-0">
        <div>
          <h1 className="text-[16px] font-bold text-[#111]">Learning Loop — Knowledge Candidates</h1>
          <div className="text-[11px] text-[#888]">
            실사용 미해결 질문 → Candidate 생성 → 검토 → Knowledge 반영
          </div>
        </div>
        <div className="ml-auto flex gap-2">
          <button
            onClick={() => setShowMetrics(v => !v)}
            className="px-3 py-1.5 text-[11px] bg-white border border-[#ddd] rounded-lg text-[#555] hover:bg-[#f5f5f7]"
          >
            {showMetrics ? "메트릭 숨기기" : "메트릭 보기"}
          </button>
          <button
            onClick={() => { loadCandidates(); loadMetrics(); }}
            className="px-3 py-1.5 text-[11px] bg-[#002F5F] text-white rounded-lg hover:bg-[#00234A]"
          >
            새로고침
          </button>
        </div>
      </div>

      {/* Metrics */}
      {showMetrics && <MetricsPanel metrics={metrics} />}

      {/* Tabs */}
      <div className="bg-white border-b border-[#e5e5e5] px-6 flex gap-1 shrink-0">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-[12px] transition-colors ${
              tab === t.id
                ? "border-b-2 border-[#002F5F] text-[#002F5F] font-semibold"
                : "text-[#888] hover:text-[#444]"
            }`}
          >
            {t.label}
          </button>
        ))}
        {/* Sort */}
        {tab === "PENDING" && (
          <div className="ml-auto flex items-center gap-1 py-2">
            <span className="text-[11px] text-[#aaa]">정렬:</span>
            {(["priority", "recent", "count"] as SortMode[]).map(s => (
              <button
                key={s}
                onClick={() => setSort(s)}
                className={`px-2 py-1 text-[10px] rounded ${sort === s ? "bg-[#002F5F] text-white" : "bg-[#f5f5f7] text-[#555]"}`}
              >
                {s === "priority" ? "우선순위" : s === "recent" ? "최근" : "횟수"}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="text-[12px] text-[#aaa] text-center py-8">로딩 중...</div>
        ) : candidates.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-[32px] mb-2">📭</div>
            <div className="text-[13px] text-[#888]">
              {tab === "PENDING" ? "검토 대기 Candidate 없음" : `${tab} 상태 Candidate 없음`}
            </div>
          </div>
        ) : (
          <>
            <div className="text-[11px] text-[#aaa] mb-3">총 {total}개</div>
            {candidates.map(c => (
              <CandidateCard
                key={c.id}
                c={c}
                onApproveUtterance={setUtterDialog}
                onApproveCanonical={setCanonDialog}
                onReject={setRejectDialog}
                onMerge={setMergeDialog}
                onReclassify={async (cand) => {
                  const cls = window.prompt(
                    "새 분류:\nNORMAL / DYNAMIC_DATA_REQUIRED / POLICY_REQUIRED / AMBIGUOUS / HUMAN_JUDGMENT_REQUIRED"
                  );
                  if (!cls) return;
                  try {
                    await api.patch(`/super/support/knowledge-candidates/${cand.id}/reclassify`, { classification: cls.trim() });
                    loadCandidates();
                  } catch (e: any) {
                    alert(e?.response?.data?.error ?? "오류 발생");
                  }
                }}
              />
            ))}
          </>
        )}
      </div>

      {/* Utterance Dialog */}
      {utterDialog && (
        <ApproveUtteranceDialog
          candidate={utterDialog}
          onClose={() => setUtterDialog(null)}
          onDone={() => { setUtterDialog(null); loadCandidates(); loadMetrics(); }}
        />
      )}

      {/* Canonical Dialog */}
      {canonDialog && (
        <ApproveCanonicalDialog
          candidate={canonDialog}
          onClose={() => setCanonDialog(null)}
          onDone={() => { setCanonDialog(null); loadCandidates(); loadMetrics(); }}
        />
      )}

      {/* Reject Dialog */}
      {rejectDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-5">
            <h3 className="text-[14px] font-bold mb-2">Candidate 거부</h3>
            <div className="text-[12px] text-[#555] mb-3">"{rejectDialog.representative_query}"</div>
            <textarea
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              placeholder="거부 이유 (선택)"
              rows={3}
              className="w-full px-2 py-1 text-[12px] border border-[#ddd] rounded mb-3 resize-none"
            />
            {actionError && <div className="text-[11px] text-red-600 mb-2">{actionError}</div>}
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setRejectDialog(null); setActionError(null); }}
                className="px-3 py-1.5 text-[12px] text-[#555] border border-[#ddd] rounded-lg">취소</button>
              <button onClick={handleReject} disabled={actionLoading}
                className="px-3 py-1.5 text-[12px] bg-red-600 text-white rounded-lg disabled:opacity-50">
                {actionLoading ? "처리 중..." : "거부"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Merge Dialog */}
      {mergeDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-5">
            <h3 className="text-[14px] font-bold mb-2">Candidate 병합</h3>
            <div className="text-[12px] text-[#555] mb-3">
              "{mergeDialog.representative_query}" → 다른 Candidate로 병합
            </div>
            <input
              value={mergeTargetId}
              onChange={e => setMergeTargetId(e.target.value)}
              placeholder="대상 Candidate ID (cand_xxx)"
              className="w-full h-8 px-2 text-[12px] border border-[#ddd] rounded mb-3"
            />
            {actionError && <div className="text-[11px] text-red-600 mb-2">{actionError}</div>}
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setMergeDialog(null); setActionError(null); }}
                className="px-3 py-1.5 text-[12px] text-[#555] border border-[#ddd] rounded-lg">취소</button>
              <button onClick={handleMerge} disabled={actionLoading}
                className="px-3 py-1.5 text-[12px] bg-[#002F5F] text-white rounded-lg disabled:opacity-50">
                {actionLoading ? "처리 중..." : "병합"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
