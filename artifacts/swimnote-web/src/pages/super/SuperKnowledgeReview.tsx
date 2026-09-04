/**
 * SuperKnowledgeReview — WP-CS17: Super Admin Knowledge Review Console
 *
 * 목적: CS16 Governance API를 통한 Knowledge Candidate 인간 검토 UI
 *
 * §0: 절대원칙
 *   - 새 OpenAI 호출 없음
 *   - CS16 API 재사용 (별도 승인 규칙 금지)
 *   - 최종 권한 검증은 서버 담당
 *   - PII/secret/raw prompt 노출 금지
 *   - REVIEW_REQUIRED Candidate를 승인 가능 상태처럼 표시 금지
 *
 * §1 대상: super_admin, platform_admin (client guard + server authorization 둘 다)
 * §24: 모든 action은 CS16 server API 경유
 */
import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";

// ── Types ──────────────────────────────────────────────────────────────────────

type TabId = "pending" | "edit_required" | "active" | "rejected" | "archived" | "audit";

interface CandidateListItem {
  id: string;
  item_type: string;
  title: string;
  feature: string | null;
  scope: string;
  pool_id: string | null;
  status: string;
  revision: number;
  source_ref: string | null;
  reject_reason: string | null;
  edit_note: string | null;
  readiness: "READY_FOR_HUMAN_REVIEW" | "REVIEW_REQUIRED" | "BLOCKED";
  blockers: number;
  created_at: string;
}

interface ChecklistItem {
  dimension: string;
  outcome: "PASS" | "WARN" | "FAIL" | "UNKNOWN";
  is_blocker: boolean;
  message: string;
}

interface ChecklistResult {
  readiness: "READY_FOR_HUMAN_REVIEW" | "REVIEW_REQUIRED" | "BLOCKED";
  items: ChecklistItem[];
  blockers: ChecklistItem[];
  warnings: ChecklistItem[];
}

interface CandidateDetail {
  id: string;
  item_type: string;
  title: string;
  content: string | null;
  question: string | null;
  answer: string | null;
  solution_steps: string | null;
  scope: string;
  category: string | null;
  feature: string | null;
  pool_id: string | null;
  affected_roles: string[] | null;
  affected_modes: string[] | null;
  source_type: string | null;
  source_ref: string | null;
  status: string;
  revision: number;
  reject_reason: string | null;
  edit_note: string | null;
  freshness_state: string | null;
  created_at: string;
  updated_at: string | null;
}

interface AuditRecord {
  id: string;
  candidate_id: string;
  previous_status: string;
  new_status: string;
  reviewer_id: string; // opaque — 상세 PII 표시 금지
  reviewer_role: string;
  reviewed_at: string;
  decision: string;
  review_notes: string | null;
  reject_reason: string | null;
  request_id: string | null;
  candidate_revision: number;
  resulting_knowledge_id: string | null;
}

interface Cs12Summary {
  total: number;
  ready_for_human_review: number;
  review_required: number;
  blocked: number;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const PRIMARY = "#002F5F";

const TABS: { id: TabId; label: string; apiStatus: string }[] = [
  { id: "pending",       label: "검토 대기",     apiStatus: "pending" },
  { id: "edit_required", label: "수정 요청",     apiStatus: "edit_required" },
  { id: "active",        label: "활성",          apiStatus: "active" },
  { id: "rejected",      label: "거절됨",        apiStatus: "rejected" },
  { id: "archived",      label: "아카이브",       apiStatus: "archived" },
  { id: "audit",         label: "감사 이력",      apiStatus: "" },
];

const REJECT_REASONS = [
  "UNSUPPORTED_SOURCE",
  "NOT_IMPLEMENTED",
  "WRONG_ROLE",
  "WRONG_MODE",
  "POLICY_UNVERIFIED",
  "DUPLICATE",
  "CONFLICT",
  "OUTDATED",
  "SECURITY_RISK",
  "OTHER",
] as const;

const FRESHNESS_COLORS: Record<string, string> = {
  CURRENT:     "bg-green-50 text-green-700 border-green-200",
  REVIEW_DUE:  "bg-amber-50 text-amber-700 border-amber-200",
  STALE:       "bg-red-50 text-red-600 border-red-200",
  SUPERSEDED:  "bg-purple-50 text-purple-700 border-purple-200",
  UNKNOWN:     "bg-gray-50 text-gray-500 border-gray-200",
};

const READINESS_COLORS: Record<string, string> = {
  READY_FOR_HUMAN_REVIEW: "bg-green-50 text-green-700 border border-green-200",
  REVIEW_REQUIRED:        "bg-amber-50 text-amber-700 border border-amber-200",
  BLOCKED:                "bg-red-50 text-red-600 border border-red-200",
};

const READINESS_LABELS: Record<string, string> = {
  READY_FOR_HUMAN_REVIEW: "검토 준비",
  REVIEW_REQUIRED:        "추가 검토 필요",
  BLOCKED:                "차단됨",
};

const CHECKLIST_LABELS: Record<string, string> = {
  SOURCE:         "출처",
  IMPLEMENTATION: "구현 여부",
  ROLE:           "역할",
  MODE:           "모드",
  POOL:           "스코프",
  ACTION:         "실행 가능성",
  POLICY:         "정책",
  SECURITY:       "보안",
  GROUNDING:      "근거",
  CONFLICT:       "충돌",
  FRESHNESS:      "최신성",
};

const OUTCOME_STYLES: Record<string, string> = {
  PASS:    "text-green-600",
  WARN:    "text-amber-600",
  FAIL:    "text-red-600",
  UNKNOWN: "text-gray-400",
};

const OUTCOME_ICONS: Record<string, string> = {
  PASS:    "✓",
  WARN:    "△",
  FAIL:    "✕",
  UNKNOWN: "?",
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtDate(raw: string | null | undefined) {
  if (!raw) return "—";
  return raw.slice(0, 10);
}

function fmtDateTime(raw: string | null | undefined) {
  if (!raw) return "—";
  return raw.slice(0, 16).replace("T", " ");
}

// §6 Source Safe Display: allowed metadata만; raw prompt/secret/PII 금지
function safeSourceRef(ref: string | null | undefined): string {
  if (!ref) return "SOURCE MISSING";
  // Truncate to 60 chars for display; show as opaque reference
  return ref.length > 60 ? ref.slice(0, 57) + "..." : ref;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending:       "bg-amber-50 text-amber-700 border-amber-200",
    edit_required: "bg-orange-50 text-orange-700 border-orange-200",
    active:        "bg-green-50 text-green-700 border-green-200",
    rejected:      "bg-red-50 text-red-600 border-red-200",
    archived:      "bg-gray-100 text-gray-500 border-gray-200",
    superseded:    "bg-purple-50 text-purple-600 border-purple-200",
  };
  const label: Record<string, string> = {
    pending:       "검토 대기",
    edit_required: "수정 요청",
    active:        "활성",
    rejected:      "거절됨",
    archived:      "아카이브",
    superseded:    "대체됨",
  };
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${map[status] ?? "bg-gray-50 text-gray-500 border-gray-200"}`}>
      {label[status] ?? status}
    </span>
  );
}

function ReadinessBadge({ readiness }: { readiness: string }) {
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${READINESS_COLORS[readiness] ?? READINESS_COLORS.BLOCKED}`}>
      {READINESS_LABELS[readiness] ?? readiness}
    </span>
  );
}

function FreshnessBadge({ state }: { state: string | null | undefined }) {
  const s = state ?? "UNKNOWN";
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${FRESHNESS_COLORS[s] ?? FRESHNESS_COLORS.UNKNOWN}`}>
      {s}
    </span>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-bold text-[#999] uppercase tracking-wider mb-2">
      {children}
    </p>
  );
}

// ── Approve Confirmation Dialog ────────────────────────────────────────────────

interface ApproveDialogProps {
  candidate: CandidateDetail;
  checklist: ChecklistResult;
  onConfirm: (note: string) => void;
  onCancel: () => void;
  loading: boolean;
}

function ApproveDialog({ candidate, checklist, onConfirm, onCancel, loading }: ApproveDialogProps) {
  const [note, setNote] = useState("");
  const hasBlockers = checklist.blockers.length > 0;
  const isReviewRequired = checklist.readiness === "REVIEW_REQUIRED";

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
        <h3 className="text-[16px] font-bold text-[#111]">Knowledge 승인</h3>
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 space-y-1">
          <p className="text-[12px] font-semibold text-blue-700">{candidate.title}</p>
          <p className="text-[11px] text-blue-500">{candidate.item_type} · v{candidate.revision} · {candidate.scope.toUpperCase()}</p>
        </div>

        {hasBlockers && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3">
            <p className="text-[12px] text-red-600 font-semibold mb-1">⚠ Blocker가 있습니다 — 서버에서 거절됩니다</p>
            {checklist.blockers.map(b => (
              <p key={b.dimension} className="text-[11px] text-red-500">· {CHECKLIST_LABELS[b.dimension] ?? b.dimension}: {b.message}</p>
            ))}
          </div>
        )}

        {!hasBlockers && isReviewRequired && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
            <p className="text-[12px] text-amber-700 font-semibold">추가 검토가 권고됩니다</p>
            <p className="text-[11px] text-amber-600 mt-1">Warning 항목이 있습니다. 최종 판단은 검토자가 합니다.</p>
            {checklist.warnings.slice(0, 3).map(w => (
              <p key={w.dimension} className="text-[11px] text-amber-500 mt-0.5">△ {CHECKLIST_LABELS[w.dimension] ?? w.dimension}: {w.message}</p>
            ))}
          </div>
        )}

        <div>
          <label className="block text-[11px] font-semibold text-[#555] mb-1">검토 메모 (선택)</label>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="승인 근거 또는 특이사항 메모..."
            rows={3}
            className="w-full border border-[#e5e5e5] rounded-xl px-3 py-2 text-[12px] resize-none focus:outline-none focus:border-[#002F5F]"
          />
        </div>

        <p className="text-[11px] text-[#999]">
          이 Candidate를 ACTIVE Knowledge로 승인합니다. 서버에서 최종 검증 후 처리됩니다.
        </p>

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 py-2.5 border border-[#e5e5e5] rounded-xl text-[13px] text-[#555] hover:bg-[#f5f5f5] disabled:opacity-50"
          >
            취소
          </button>
          <button
            onClick={() => onConfirm(note)}
            disabled={loading}
            style={{ backgroundColor: PRIMARY }}
            className="flex-1 py-2.5 rounded-xl text-[13px] text-white font-semibold disabled:opacity-50"
          >
            {loading ? "처리 중..." : "✓ 승인 (Approve)"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Reject Dialog ──────────────────────────────────────────────────────────────

interface RejectDialogProps {
  onConfirm: (reason: string, note: string) => void;
  onCancel: () => void;
  loading: boolean;
}

function RejectDialog({ onConfirm, onCancel, loading }: RejectDialogProps) {
  const [reason, setReason] = useState<string>(REJECT_REASONS[0]);
  const [note, setNote]     = useState("");
  const needsNote = reason === "OTHER";

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
        <h3 className="text-[16px] font-bold text-[#111]">거절 — Reject</h3>
        <div>
          <label className="block text-[11px] font-semibold text-[#555] mb-1">거절 사유 *</label>
          <select
            value={reason}
            onChange={e => setReason(e.target.value)}
            className="w-full border border-[#e5e5e5] rounded-xl px-3 py-2 text-[13px]"
          >
            {REJECT_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-[#555] mb-1">
            상세 메모 {needsNote ? "*" : "(선택)"}
          </label>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder={needsNote ? "OTHER 선택 시 사유를 입력해 주세요..." : "추가 메모 (선택)..."}
            rows={3}
            className="w-full border border-[#e5e5e5] rounded-xl px-3 py-2 text-[12px] resize-none focus:outline-none focus:border-[#002F5F]"
          />
        </div>
        <div className="flex gap-3">
          <button onClick={onCancel} disabled={loading}
            className="flex-1 py-2.5 border border-[#e5e5e5] rounded-xl text-[13px] text-[#555] hover:bg-[#f5f5f5] disabled:opacity-50">
            취소
          </button>
          <button
            onClick={() => onConfirm(reason, note)}
            disabled={loading || (needsNote && !note.trim())}
            className="flex-1 py-2.5 rounded-xl text-[13px] text-white font-semibold bg-red-500 disabled:opacity-50"
          >
            {loading ? "처리 중..." : "✕ 거절 (Reject)"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Request-Edit Dialog ────────────────────────────────────────────────────────

interface EditDialogProps {
  onConfirm: (note: string) => void;
  onCancel: () => void;
  loading: boolean;
}

function EditRequestDialog({ onConfirm, onCancel, loading }: EditDialogProps) {
  const [note, setNote] = useState("");
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
        <h3 className="text-[16px] font-bold text-[#111]">수정 요청 — Request Edit</h3>
        <p className="text-[12px] text-[#555]">
          상태가 <strong>pending → edit_required</strong>로 변경됩니다.
          수정 후 다시 pending으로 재진입하며 재검토가 필요합니다.
          수정 직후 자동 승인은 없습니다.
        </p>
        <div>
          <label className="block text-[11px] font-semibold text-[#555] mb-1">수정 사유 *</label>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="수정이 필요한 이유와 구체적인 내용을 입력해 주세요..."
            rows={4}
            className="w-full border border-[#e5e5e5] rounded-xl px-3 py-2 text-[12px] resize-none focus:outline-none focus:border-[#002F5F]"
          />
        </div>
        <div className="flex gap-3">
          <button onClick={onCancel} disabled={loading}
            className="flex-1 py-2.5 border border-[#e5e5e5] rounded-xl text-[13px] text-[#555] hover:bg-[#f5f5f5] disabled:opacity-50">
            취소
          </button>
          <button
            onClick={() => onConfirm(note)}
            disabled={loading || !note.trim()}
            className="flex-1 py-2.5 rounded-xl text-[13px] text-white font-semibold bg-orange-500 disabled:opacity-50"
          >
            {loading ? "처리 중..." : "↩ 수정 요청"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Rollback Dialog ────────────────────────────────────────────────────────────

interface RollbackDialogProps {
  onConfirm: (note: string) => void;
  onCancel: () => void;
  loading: boolean;
}

function RollbackDialog({ onConfirm, onCancel, loading }: RollbackDialogProps) {
  const [note, setNote] = useState("");
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
        <h3 className="text-[16px] font-bold text-[#111]">롤백 — Rollback to Archived</h3>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
          <p className="text-[12px] text-amber-700 font-semibold">⚠ 주의</p>
          <p className="text-[12px] text-amber-600 mt-1">
            이 Knowledge는 즉시 AI 답변에서 제외됩니다. (status → archived)
            일반 사용자에게 노출되지 않으며, 이 작업은 Production에서 실행하지 마세요.
          </p>
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-[#555] mb-1">롤백 사유 (선택)</label>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="롤백 사유 메모..."
            rows={3}
            className="w-full border border-[#e5e5e5] rounded-xl px-3 py-2 text-[12px] resize-none focus:outline-none focus:border-[#002F5F]"
          />
        </div>
        <div className="flex gap-3">
          <button onClick={onCancel} disabled={loading}
            className="flex-1 py-2.5 border border-[#e5e5e5] rounded-xl text-[13px] text-[#555] hover:bg-[#f5f5f5] disabled:opacity-50">
            취소
          </button>
          <button
            onClick={() => onConfirm(note)}
            disabled={loading}
            className="flex-1 py-2.5 rounded-xl text-[13px] text-white font-semibold bg-red-600 disabled:opacity-50"
          >
            {loading ? "처리 중..." : "아카이브로 롤백"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Checklist Panel ────────────────────────────────────────────────────────────

function ChecklistPanel({ checklist }: { checklist: ChecklistResult }) {
  return (
    <div className="space-y-1.5">
      {checklist.items.map(item => (
        <div key={item.dimension} className="flex items-start gap-2.5">
          <span className={`text-[13px] font-bold shrink-0 mt-0.5 ${OUTCOME_STYLES[item.outcome] ?? "text-gray-400"}`}>
            {OUTCOME_ICONS[item.outcome] ?? "?"}
          </span>
          <div className="flex-1 min-w-0">
            <span className="text-[11px] font-semibold text-[#555]">
              {CHECKLIST_LABELS[item.dimension] ?? item.dimension}
            </span>
            {item.is_blocker && (
              <span className="ml-1.5 text-[9px] font-bold text-red-500 bg-red-50 px-1 py-0.5 rounded">BLOCKER</span>
            )}
            <p className="text-[11px] text-[#777] mt-0.5 leading-relaxed">{item.message}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Detail Panel ───────────────────────────────────────────────────────────────

interface DetailPanelProps {
  candidateId: string;
  tab: TabId;
  onBack: () => void;
  onActionSuccess: () => void;
}

function DetailPanel({ candidateId, tab, onBack, onActionSuccess }: DetailPanelProps) {
  const [candidate, setCandidate] = useState<CandidateDetail | null>(null);
  const [checklist, setChecklist] = useState<ChecklistResult | null>(null);
  const [cs12Audit, setCs12Audit] = useState<any>(null);
  const [approvalTrace, setApprovalTrace] = useState<any>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Dialogs
  const [showApprove,  setShowApprove]  = useState(false);
  const [showReject,   setShowReject]   = useState(false);
  const [showEdit,     setShowEdit]     = useState(false);
  const [showRollback, setShowRollback] = useState(false);

  // Concurrent conflict message
  const [concurrentMsg, setConcurrentMsg] = useState<string | null>(null);

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<{
        ok: boolean;
        candidate: CandidateDetail;
        checklist: ChecklistResult;
        cs12_audit: any;
        approval_trace: any;
      }>(`/super/support/candidates/${candidateId}`);
      setCandidate(data.candidate);
      setChecklist(data.checklist);
      setCs12Audit(data.cs12_audit);
      setApprovalTrace(data.approval_trace);
    } catch (e: any) {
      setError(e?.message ?? "불러오기 실패");
    } finally {
      setLoading(false);
    }
  }, [candidateId]);

  useEffect(() => { fetchDetail(); }, [fetchDetail]);

  // ── Actions ──────────────────────────────────────────────────────────────────

  const doApprove = async (note: string) => {
    if (!candidate) return;
    setActionLoading(true);
    setConcurrentMsg(null);
    try {
      await api.post(`/super/support/candidates/${candidateId}/approve`, {
        review_notes: note || undefined,
      });
      setShowApprove(false);
      onActionSuccess();
    } catch (e: any) {
      setShowApprove(false);
      // §20 concurrent conflict
      if (e?.data?.code === "CONCURRENT_APPROVAL_CONFLICT" || e?.message?.includes("CONCURRENT")) {
        setConcurrentMsg("이미 다른 검토자가 상태를 변경했습니다. 최신 상태를 다시 불러옵니다.");
        await fetchDetail();
      } else {
        alert(`승인 실패: ${e?.message ?? "서버 오류"}`);
      }
    } finally {
      setActionLoading(false);
    }
  };

  const doReject = async (reason: string, note: string) => {
    setActionLoading(true);
    setConcurrentMsg(null);
    try {
      await api.post(`/super/support/candidates/${candidateId}/reject`, {
        reject_reason: reason,
        review_notes: note || undefined,
      });
      setShowReject(false);
      onActionSuccess();
    } catch (e: any) {
      setShowReject(false);
      if (e?.data?.code === "CONCURRENT_APPROVAL_CONFLICT") {
        setConcurrentMsg("이미 다른 검토자가 상태를 변경했습니다. 최신 상태를 다시 불러옵니다.");
        await fetchDetail();
      } else {
        alert(`거절 실패: ${e?.message ?? "서버 오류"}`);
      }
    } finally {
      setActionLoading(false);
    }
  };

  const doEditRequest = async (note: string) => {
    setActionLoading(true);
    try {
      await api.post(`/super/support/candidates/${candidateId}/request-edit`, {
        review_notes: note,
      });
      setShowEdit(false);
      onActionSuccess();
    } catch (e: any) {
      setShowEdit(false);
      alert(`수정 요청 실패: ${e?.message ?? "서버 오류"}`);
    } finally {
      setActionLoading(false);
    }
  };

  const doRollback = async (note: string) => {
    setActionLoading(true);
    try {
      await api.post(`/super/support/knowledge/${candidateId}/rollback`, {
        review_notes: note || undefined,
      });
      setShowRollback(false);
      onActionSuccess();
    } catch (e: any) {
      setShowRollback(false);
      alert(`롤백 실패: ${e?.message ?? "서버 오류"}`);
    } finally {
      setActionLoading(false);
    }
  };

  // ── Render states ─────────────────────────────────────────────────────────────

  if (loading) return (
    <div className="flex flex-col h-full">
      <div className="px-6 pt-4 pb-3 border-b border-[#eee]">
        <button onClick={onBack} className="text-[12px] text-[#888] hover:text-[#111] border border-[#e5e5e5] px-3 py-1.5 rounded-lg">
          ← 목록
        </button>
      </div>
      <div className="flex-1 flex items-center justify-center text-[12px] text-[#bbb]">불러오는 중...</div>
    </div>
  );

  if (error || !candidate || !checklist) return (
    <div className="flex flex-col h-full">
      <div className="px-6 pt-4 pb-3 border-b border-[#eee]">
        <button onClick={onBack} className="text-[12px] text-[#888] hover:text-[#111] border border-[#e5e5e5] px-3 py-1.5 rounded-lg">
          ← 목록
        </button>
      </div>
      <div className="flex-1 flex items-center justify-center text-[12px] text-red-400">{error ?? "데이터 없음"}</div>
    </div>
  );

  const isPending      = candidate.status === "pending";
  const isEditRequired = candidate.status === "edit_required";
  const isActive       = candidate.status === "active";
  const canApprove     = (isPending || isEditRequired) && checklist.blockers.length === 0;
  const canReject      = isPending || isEditRequired;
  const canRequestEdit = isPending;
  const canRollback    = isActive;

  // §17: REVIEW_REQUIRED warning
  const isKnownIssueTriage = cs12Audit?.readiness === "REVIEW_REQUIRED";

  // Freshness warning
  const freshnessBlock = candidate.freshness_state === "STALE" || candidate.freshness_state === "SUPERSEDED";

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-4 pb-3 shrink-0 border-b border-[#eee]">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-[12px] text-[#888] hover:text-[#111] border border-[#e5e5e5] px-3 py-1.5 rounded-lg">
            ← 목록
          </button>
          <StatusBadge status={candidate.status} />
          <ReadinessBadge readiness={checklist.readiness} />
        </div>
        <div className="flex gap-2">
          {canApprove && (
            <button
              onClick={() => setShowApprove(true)}
              disabled={actionLoading || freshnessBlock}
              title={freshnessBlock ? "STALE/SUPERSEDED — 승인 전 freshness 확인 필요" : "Approve"}
              style={{ backgroundColor: freshnessBlock ? undefined : PRIMARY }}
              className="px-3 py-1.5 rounded-lg text-[12px] text-white font-semibold disabled:opacity-50 disabled:bg-gray-300"
            >
              ✓ 승인
            </button>
          )}
          {!canApprove && (isPending || isEditRequired) && (
            <button disabled
              title={`승인 불가 — ${checklist.blockers.map(b => b.dimension).join(", ")} blocker`}
              className="px-3 py-1.5 rounded-lg text-[12px] text-white font-semibold bg-gray-300 cursor-not-allowed opacity-60"
            >
              승인 불가
            </button>
          )}
          {canRequestEdit && (
            <button onClick={() => setShowEdit(true)} disabled={actionLoading}
              className="px-3 py-1.5 rounded-lg border border-orange-200 text-orange-600 text-[12px] disabled:opacity-50">
              ↩ 수정 요청
            </button>
          )}
          {canReject && (
            <button onClick={() => setShowReject(true)} disabled={actionLoading}
              className="px-3 py-1.5 rounded-lg border border-red-200 text-red-500 text-[12px] disabled:opacity-50">
              ✕ 거절
            </button>
          )}
          {canRollback && (
            <button onClick={() => setShowRollback(true)} disabled={actionLoading}
              className="px-3 py-1.5 rounded-lg border border-red-300 text-red-600 text-[12px] disabled:opacity-50">
              ↩ 롤백
            </button>
          )}
        </div>
      </div>

      {/* Concurrent conflict message */}
      {concurrentMsg && (
        <div className="mx-6 mt-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-[12px] text-amber-700 shrink-0">
          ⚠ {concurrentMsg}
        </div>
      )}

      {/* KNOWN_ISSUE Warning — §17: 트리아지 knowledge와 실제 incident 구분 */}
      {isKnownIssueTriage && (
        <div className="mx-6 mt-3 bg-orange-50 border border-orange-200 rounded-xl px-4 py-3 shrink-0">
          <p className="text-[12px] font-semibold text-orange-700">⚠ KNOWN ISSUE Triage Candidate</p>
          <p className="text-[12px] text-orange-600 mt-1">
            General triage knowledge와 actual operational incident를 구분하여 검토 필요.
            이 항목이 현재 장애를 서술하는 것처럼 표시되어서는 안 됩니다.
          </p>
          {cs12Audit?.note && (
            <p className="text-[11px] text-orange-500 mt-1.5 bg-orange-100 rounded px-2 py-1">{cs12Audit.note}</p>
          )}
        </div>
      )}

      {/* Fresness warning */}
      {freshnessBlock && (
        <div className="mx-6 mt-3 bg-red-50 border border-red-200 rounded-xl px-4 py-2 text-[12px] text-red-600 shrink-0">
          ⚠ freshness: {candidate.freshness_state} — 승인 전 최신성 확인이 권고됩니다.
        </div>
      )}

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">

        {/* Title + Type */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] font-bold text-[#888] bg-[#f5f5f5] px-1.5 py-0.5 rounded">{candidate.item_type}</span>
            <span className="text-[10px] text-[#bbb] font-mono">{candidate.id}</span>
          </div>
          <h2 className="text-[18px] font-bold text-[#111] leading-snug">{candidate.title}</h2>
          {candidate.category && (
            <p className="text-[11px] text-[#999] mt-1">{candidate.category}</p>
          )}
        </div>

        {/* Content */}
        {candidate.question && (
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
            <p className="text-[10px] font-bold text-blue-400 mb-1">Q (질문)</p>
            <p className="text-[14px] text-[#111] font-semibold">{candidate.question}</p>
          </div>
        )}
        {candidate.answer && (
          <div className="bg-[#f9fafb] border border-[#eee] rounded-xl p-4">
            <p className="text-[10px] font-bold text-[#aaa] mb-1">A (답변)</p>
            <p className="text-[13px] text-[#333] leading-relaxed whitespace-pre-wrap">{candidate.answer}</p>
          </div>
        )}
        {candidate.content && !candidate.question && (
          <div className="bg-[#f9fafb] rounded-xl p-4">
            <p className="text-[10px] font-bold text-[#aaa] mb-1">본문</p>
            <p className="text-[13px] text-[#333] leading-relaxed whitespace-pre-wrap">{candidate.content}</p>
          </div>
        )}

        {/* Metadata grid */}
        <div>
          <SectionLabel>메타데이터</SectionLabel>
          <div className="grid grid-cols-2 gap-3 text-[12px]">
            <div>
              <span className="text-[#aaa]">Feature</span>
              <p className="text-[#333] font-medium">{candidate.feature ?? "—"}</p>
            </div>
            <div>
              <span className="text-[#aaa]">스코프</span>
              <p className="text-[#333] font-medium">{candidate.scope.toUpperCase()}{candidate.pool_id ? ` (${candidate.pool_id})` : ""}</p>
            </div>
            <div>
              <span className="text-[#aaa]">역할</span>
              <p className="text-[#333] font-medium">{(candidate.affected_roles ?? []).join(", ") || "—"}</p>
            </div>
            <div>
              <span className="text-[#aaa]">모드</span>
              <p className="text-[#333] font-medium">{(candidate.affected_modes ?? []).join(", ") || "—"}</p>
            </div>
            <div>
              <span className="text-[#aaa]">리비전</span>
              <p className="text-[#333] font-medium">v{candidate.revision}</p>
            </div>
            <div>
              <span className="text-[#aaa]">생성일</span>
              <p className="text-[#333] font-medium">{fmtDate(candidate.created_at)}</p>
            </div>
            <div>
              <span className="text-[#aaa]">수정일</span>
              <p className="text-[#333] font-medium">{fmtDate(candidate.updated_at)}</p>
            </div>
            <div>
              <span className="text-[#aaa]">Freshness</span>
              <div className="mt-0.5"><FreshnessBadge state={candidate.freshness_state} /></div>
            </div>
          </div>
        </div>

        {/* Source — §6 Safe Display */}
        <div>
          <SectionLabel>출처 (Source Provenance)</SectionLabel>
          {candidate.source_ref ? (
            <div className="bg-[#f9fafb] border border-[#e5e5e5] rounded-xl p-4 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-[#aaa]">출처 유형</span>
                <span className="text-[11px] font-semibold text-[#555] bg-white border border-[#e5e5e5] px-2 py-0.5 rounded">
                  {candidate.source_type ?? "UNKNOWN"}
                </span>
              </div>
              {/* §6: safe reference display — truncated, no raw server paths or secrets */}
              <div>
                <span className="text-[10px] font-bold text-[#aaa]">참조</span>
                <p className="text-[11px] font-mono text-[#666] mt-0.5 bg-white border border-[#e5e5e5] rounded px-2 py-1 break-all">
                  {safeSourceRef(candidate.source_ref)}
                </p>
              </div>
              <p className="text-[10px] text-[#bbb]">
                · 파일 경로·DB 인증정보·API 키·raw prompt는 이 화면에 표시되지 않습니다.
              </p>
            </div>
          ) : (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4">
              <p className="text-[13px] font-semibold text-red-600">⚠ SOURCE MISSING</p>
              <p className="text-[12px] text-red-400 mt-1">출처가 없는 Candidate는 승인 불가 (서버에서 거절됩니다)</p>
            </div>
          )}
        </div>

        {/* Approval Checklist */}
        <div>
          <SectionLabel>승인 체크리스트 (Approval Checklist)</SectionLabel>
          <div className="bg-[#f9fafb] border border-[#e5e5e5] rounded-xl p-4">
            <ChecklistPanel checklist={checklist} />
          </div>
          <div className="mt-2 flex items-center gap-3 text-[11px]">
            <span className="text-[#999]">전체 {checklist.items.length}개</span>
            {checklist.blockers.length > 0 && (
              <span className="text-red-600 font-semibold">✕ Blocker {checklist.blockers.length}개</span>
            )}
            {checklist.warnings.length > 0 && (
              <span className="text-amber-600">△ Warning {checklist.warnings.length}개</span>
            )}
          </div>
        </div>

        {/* CS12 Audit Info */}
        {cs12Audit && (
          <div>
            <SectionLabel>CS12 정적 감사 (Static Readiness)</SectionLabel>
            <div className="bg-[#f9fafb] border border-[#e5e5e5] rounded-xl p-4 space-y-1.5">
              <div className="flex items-center gap-2">
                <ReadinessBadge readiness={cs12Audit.readiness} />
                <span className="text-[11px] text-[#777]">CS12 정적 분류 기준</span>
              </div>
              {cs12Audit.note && (
                <p className="text-[11px] text-[#555] mt-1 leading-relaxed">{cs12Audit.note}</p>
              )}
            </div>
          </div>
        )}

        {/* Approval Trace (§25: request_id 포함) */}
        {approvalTrace && (
          <div>
            <SectionLabel>승인 이력 (Approval Trace)</SectionLabel>
            <div className="bg-[#f9fafb] border border-[#e5e5e5] rounded-xl p-4 space-y-1.5 text-[12px]">
              <div className="flex gap-2 items-center">
                <span className="text-[#aaa]">상태</span>
                <StatusBadge status={approvalTrace.status} />
              </div>
              <div><span className="text-[#aaa]">리비전</span> <span className="text-[#555] font-medium">v{approvalTrace.revision}</span></div>
              {approvalTrace.reviewed_at && (
                <div><span className="text-[#aaa]">검토일</span> <span className="text-[#555] font-medium">{fmtDateTime(approvalTrace.reviewed_at)}</span></div>
              )}
              {/* §20: reviewer personal info 미노출 */}
              {approvalTrace.reviewer_role && (
                <div><span className="text-[#aaa]">검토자 역할</span> <span className="text-[#555] font-medium">{approvalTrace.reviewer_role}</span></div>
              )}
            </div>
          </div>
        )}

        {/* Reject/Edit notes if present */}
        {(candidate.reject_reason || candidate.edit_note) && (
          <div>
            <SectionLabel>검토 메모</SectionLabel>
            <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 space-y-1.5 text-[12px]">
              {candidate.reject_reason && (
                <div><span className="text-[#aaa]">거절 사유</span> <span className="text-amber-700 font-semibold">{candidate.reject_reason}</span></div>
              )}
              {candidate.edit_note && (
                <div><span className="text-[#aaa]">수정 요청</span> <p className="text-[#555] mt-0.5">{candidate.edit_note}</p></div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Dialogs */}
      {showApprove && candidate && checklist && (
        <ApproveDialog
          candidate={candidate}
          checklist={checklist}
          onConfirm={doApprove}
          onCancel={() => setShowApprove(false)}
          loading={actionLoading}
        />
      )}
      {showReject && (
        <RejectDialog
          onConfirm={doReject}
          onCancel={() => setShowReject(false)}
          loading={actionLoading}
        />
      )}
      {showEdit && (
        <EditRequestDialog
          onConfirm={doEditRequest}
          onCancel={() => setShowEdit(false)}
          loading={actionLoading}
        />
      )}
      {showRollback && (
        <RollbackDialog
          onConfirm={doRollback}
          onCancel={() => setShowRollback(false)}
          loading={actionLoading}
        />
      )}
    </div>
  );
}

// ── Audit Tab ──────────────────────────────────────────────────────────────────

function AuditTab() {
  const [records, setRecords] = useState<AuditRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterCandidate, setFilterCandidate] = useState("");

  const fetchAudit = useCallback(async () => {
    setLoading(true);
    try {
      const qs = filterCandidate.trim() ? `?candidate_id=${encodeURIComponent(filterCandidate.trim())}` : "";
      const data = await api.get<{ ok: boolean; total: number; records: AuditRecord[] }>(
        `/super/support/approval-audit${qs}`
      );
      setRecords(data.records ?? []);
    } catch { setRecords([]); }
    finally { setLoading(false); }
  }, [filterCandidate]);

  useEffect(() => { fetchAudit(); }, [fetchAudit]);

  const DECISION_COLORS: Record<string, string> = {
    APPROVE:      "text-green-600",
    REJECT:       "text-red-600",
    REQUEST_EDIT: "text-orange-600",
    ROLLBACK:     "text-purple-600",
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-6 pt-4 pb-3 border-b border-[#eee] shrink-0 flex items-center gap-3">
        <input
          value={filterCandidate}
          onChange={e => setFilterCandidate(e.target.value)}
          placeholder="Candidate ID 필터..."
          className="text-[11px] border border-[#e5e5e5] rounded-lg px-3 py-1.5 w-64 focus:outline-none"
        />
        <button onClick={fetchAudit}
          className="text-[11px] border border-[#e5e5e5] rounded-lg px-3 py-1.5 text-[#888] hover:bg-[#f5f5f5]">
          새로고침
        </button>
        <span className="text-[11px] text-[#bbb]">총 {records.length}건</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="py-12 text-center text-[#bbb] text-[12px]">불러오는 중...</div>
        ) : records.length === 0 ? (
          <div className="py-12 text-center text-[#bbb] text-[12px]">감사 이력이 없습니다</div>
        ) : (
          records.map(r => (
            <div key={r.id} className="px-6 py-3.5 border-b border-[#f0f0f0]">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className={`text-[11px] font-bold ${DECISION_COLORS[r.decision] ?? "text-gray-500"}`}>
                      {r.decision}
                    </span>
                    <span className="text-[10px] text-[#aaa]">{r.previous_status} → {r.new_status}</span>
                    {r.reject_reason && (
                      <span className="text-[10px] bg-red-50 text-red-500 border border-red-100 px-1.5 py-0.5 rounded">{r.reject_reason}</span>
                    )}
                  </div>
                  <p className="text-[11px] text-[#888] font-mono truncate">candidate: {r.candidate_id}</p>
                  {r.review_notes && (
                    <p className="text-[11px] text-[#777] mt-1 truncate">{r.review_notes}</p>
                  )}
                  <div className="flex items-center gap-3 mt-1 text-[10px] text-[#bbb]">
                    {/* §15: reviewer PII 미노출 — reviewer_role만 표시 */}
                    <span>by {r.reviewer_role}</span>
                    <span>v{r.candidate_revision}</span>
                    {r.request_id && <span className="font-mono">req: {r.request_id.slice(0, 8)}...</span>}
                  </div>
                </div>
                <span className="text-[10px] text-[#bbb] shrink-0">{fmtDateTime(r.reviewed_at)}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── CS12 Readiness Summary ─────────────────────────────────────────────────────

function Cs12SummaryCard({ summary }: { summary: Cs12Summary | null }) {
  if (!summary) return null;
  return (
    <div className="mx-6 mt-4 p-4 border border-[#e5e5e5] rounded-xl bg-[#f9fafb] shrink-0">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-bold text-[#555]">CS12 Candidate 정적 심사 ({summary.total}개)</p>
        <span className="text-[10px] text-[#bbb]">auto-activation=0</span>
      </div>
      <div className="flex gap-4 mt-2">
        <div className="text-center">
          <p className="text-[18px] font-bold text-green-600">{summary.ready_for_human_review}</p>
          <p className="text-[9px] text-[#aaa] mt-0.5">READY</p>
        </div>
        <div className="text-center">
          <p className="text-[18px] font-bold text-amber-600">{summary.review_required}</p>
          <p className="text-[9px] text-[#aaa] mt-0.5">REVIEW REQ.</p>
        </div>
        <div className="text-center">
          <p className="text-[18px] font-bold text-red-600">{summary.blocked}</p>
          <p className="text-[9px] text-[#aaa] mt-0.5">BLOCKED</p>
        </div>
      </div>
    </div>
  );
}

// ── Candidate List ─────────────────────────────────────────────────────────────

interface ListProps {
  tab: TabId;
  apiStatus: string;
  onSelect: (id: string) => void;
  cs12Summary: Cs12Summary | null;
}

function CandidateList({ tab, apiStatus, onSelect, cs12Summary }: ListProps) {
  const [candidates, setCandidates] = useState<CandidateListItem[]>([]);
  const [loading, setLoading]       = useState(false);
  const [filterType, setFilterType] = useState("");
  const [filterReadiness, setFilterReadiness] = useState("");
  const [searchQ, setSearchQ] = useState("");

  const fetchList = useCallback(async () => {
    if (!apiStatus) return;
    setLoading(true);
    try {
      const data = await api.get<{ ok: boolean; candidates: CandidateListItem[]; cs12_readiness_summary?: Cs12Summary }>(
        `/super/support/candidates?status=${apiStatus}`
      );
      setCandidates(data.candidates ?? []);
    } catch { setCandidates([]); }
    finally { setLoading(false); }
  }, [apiStatus]);

  useEffect(() => { fetchList(); }, [fetchList]);

  const displayed = candidates
    .filter(c => !filterType     || c.item_type === filterType)
    .filter(c => !filterReadiness|| c.readiness === filterReadiness)
    .filter(c => !searchQ.trim() || c.title.toLowerCase().includes(searchQ.toLowerCase())
                                 || c.id.toLowerCase().includes(searchQ.toLowerCase())
                                 || (c.feature ?? "").toLowerCase().includes(searchQ.toLowerCase()));

  const pending = candidates.length;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* CS12 summary — only on pending tab */}
      {tab === "pending" && <Cs12SummaryCard summary={cs12Summary} />}

      {/* Toolbar */}
      <div className="px-6 pt-4 pb-3 border-b border-[#eee] shrink-0 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <select value={filterType} onChange={e => setFilterType(e.target.value)}
            className="text-[11px] border border-[#e5e5e5] rounded-lg px-2 py-1 bg-white text-[#555]">
            <option value="">전체 유형</option>
            {["FAQ", "RULE", "KNOWN_ISSUE", "SOLUTION"].map(t => <option key={t}>{t}</option>)}
          </select>
          {(tab === "pending" || tab === "edit_required") && (
            <select value={filterReadiness} onChange={e => setFilterReadiness(e.target.value)}
              className="text-[11px] border border-[#e5e5e5] rounded-lg px-2 py-1 bg-white text-[#555]">
              <option value="">전체 Readiness</option>
              <option value="READY_FOR_HUMAN_REVIEW">검토 준비</option>
              <option value="REVIEW_REQUIRED">추가 검토 필요</option>
              <option value="BLOCKED">차단됨</option>
            </select>
          )}
          <input value={searchQ} onChange={e => setSearchQ(e.target.value)}
            placeholder="제목·ID·Feature 검색..."
            className="text-[11px] border border-[#e5e5e5] rounded-lg px-3 py-1 flex-1 min-w-[160px] focus:outline-none" />
          <button onClick={fetchList}
            className="text-[11px] border border-[#e5e5e5] rounded-lg px-3 py-1 text-[#888] hover:bg-[#f5f5f5] whitespace-nowrap">
            새로고침
          </button>
        </div>
        <p className="text-[11px] text-[#aaa]">
          {displayed.length}개 표시 / 전체 {pending}개
        </p>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="py-12 text-center text-[#bbb] text-[12px]">불러오는 중...</div>
        ) : displayed.length === 0 ? (
          <div className="py-12 text-center text-[#bbb] text-[12px]">항목이 없습니다</div>
        ) : (
          displayed.map(c => {
            const isKnownIssue = c.item_type === "KNOWN_ISSUE" && c.readiness === "REVIEW_REQUIRED";
            return (
              <div key={c.id}
                onClick={() => onSelect(c.id)}
                className="px-5 py-3.5 border-b border-[#f0f0f0] cursor-pointer hover:bg-[#fafafa] transition-colors">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                      <span className="text-[10px] font-bold text-[#888] bg-[#f5f5f5] px-1.5 py-0.5 rounded">{c.item_type}</span>
                      {c.feature && <span className="text-[10px] text-[#aaa]">{c.feature}</span>}
                      {c.scope === "pool" && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-500 font-bold border border-purple-100">POOL</span>
                      )}
                      {/* §11: REVIEW_REQUIRED를 승인 가능한 것처럼 표시 금지 */}
                      {isKnownIssue && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-orange-50 text-orange-600 font-bold border border-orange-100">KNOWN ISSUE TRIAGE</span>
                      )}
                    </div>
                    <p className="text-[13px] font-semibold text-[#111] truncate">{c.title}</p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className="text-[10px] text-[#bbb]">v{c.revision}</span>
                      {c.source_ref ? (
                        <span className="text-[10px] text-green-500">출처 있음</span>
                      ) : (
                        <span className="text-[10px] text-red-400 font-semibold">출처 없음</span>
                      )}
                      {c.blockers > 0 && (
                        <span className="text-[10px] text-red-500 font-semibold">Blocker {c.blockers}개</span>
                      )}
                      <span className="text-[10px] text-[#ccc]">{fmtDate(c.created_at)}</span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <StatusBadge status={c.status} />
                    {(tab === "pending" || tab === "edit_required") && (
                      <ReadinessBadge readiness={c.readiness} />
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function SuperKnowledgeReview() {
  const [activeTab, setActiveTab] = useState<TabId>("pending");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cs12Summary, setCs12Summary] = useState<Cs12Summary | null>(null);
  // revision key to force list re-mount on action success
  const [listKey, setListKey] = useState(0);

  // Fetch CS12 readiness summary once on mount
  useEffect(() => {
    api.get<{ ok: boolean; summary: Cs12Summary }>("/super/support/cs12-readiness")
      .then(d => setCs12Summary(d.summary))
      .catch(() => {});
  }, []);

  const currentTab = TABS.find(t => t.id === activeTab)!;

  const handleActionSuccess = () => {
    setSelectedId(null);
    setListKey(k => k + 1);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-white">
      {/* Page Header */}
      <div className="px-6 pt-5 pb-3 border-b border-[#eee] shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[18px] font-bold text-[#111]">Knowledge Review Console</h1>
            <p className="text-[11px] text-[#999] mt-0.5">
              AI-generated Knowledge Candidate 인간 검토 · 승인 거버넌스 (WP-CS16/17)
            </p>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-[#bbb]">
            <span className="bg-[#f0f0f0] px-2 py-1 rounded text-[#555] font-mono text-[10px]">
              super_admin / platform_admin 전용
            </span>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mt-4">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id); setSelectedId(null); }}
              className={`px-4 py-2 text-[12px] rounded-t-lg font-medium transition-colors ${
                activeTab === tab.id
                  ? "bg-[#002F5F] text-white"
                  : "text-[#666] hover:text-[#111] hover:bg-[#f5f5f5]"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === "audit" ? (
          <AuditTab />
        ) : selectedId ? (
          <DetailPanel
            key={selectedId}
            candidateId={selectedId}
            tab={activeTab}
            onBack={() => setSelectedId(null)}
            onActionSuccess={handleActionSuccess}
          />
        ) : (
          <CandidateList
            key={`${activeTab}-${listKey}`}
            tab={activeTab}
            apiStatus={currentTab.apiStatus}
            onSelect={setSelectedId}
            cs12Summary={cs12Summary}
          />
        )}
      </div>
    </div>
  );
}
