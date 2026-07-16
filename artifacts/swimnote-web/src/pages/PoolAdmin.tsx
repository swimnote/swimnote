import { useState, useEffect, useCallback } from "react";
import { useRoute, useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";

const PRIMARY = "#002F5F";
const SECONDARY = "#01B2F1";

// ─── Types ────────────────────────────────────────────────────────────────────
interface PoolDetail {
  id: string;
  name: string;
  address: string;
  phone: string;
  owner_name: string;
  owner_email: string;
  english_name?: string | null;
  pool_type?: string | null;
  approval_status: "pending" | "approved" | "rejected";
  rejection_reason?: string | null;
  subscription_status: "trial" | "active" | "expired" | "suspended" | "cancelled";
  subscription_tier?: string | null;
  subscription_start_at?: string | null;
  subscription_end_at?: string | null;
  member_limit?: number | null;
  storage_mb?: number | null;
  storage_gb?: number | null;
  extra_storage_gb?: number | null;
  created_at: string;
  updated_at?: string | null;
  // Stats from API
  student_count?: number;
  teacher_count?: number;
  class_count?: number;
  // Policy
  refund_policy_agreed?: boolean;
  privacy_policy_agreed?: boolean;
  terms_agreed?: boolean;
  canEdit?: boolean;
}

type TabId = "info" | "subscription" | "storage" | "policy" | "logs" | "actions" | "homepage";

const TABS: { id: TabId; label: string }[] = [
  { id: "info", label: "기본정보" },
  { id: "subscription", label: "구독·결제" },
  { id: "storage", label: "저장공간" },
  { id: "policy", label: "정책·동의" },
  { id: "logs", label: "로그" },
  { id: "actions", label: "강제조치" },
  { id: "homepage", label: "🌐 홈페이지" },
];

const subLabel: Record<string, string> = {
  trial: "트라이얼", active: "구독 중", expired: "만료",
  suspended: "일시 정지", cancelled: "해지",
};
const subColor: Record<string, string> = {
  trial: "bg-blue-50 text-blue-700 border-blue-200",
  active: "bg-green-50 text-green-700 border-green-200",
  expired: "bg-gray-100 text-gray-500 border-gray-200",
  suspended: "bg-orange-50 text-orange-700 border-orange-200",
  cancelled: "bg-red-50 text-red-600 border-red-200",
};
const approvalLabel: Record<string, string> = {
  pending: "승인 대기", approved: "운영 중", rejected: "반려됨",
};
const approvalColor: Record<string, string> = {
  pending: "bg-yellow-50 text-yellow-700 border-yellow-200",
  approved: "bg-green-50 text-green-700 border-green-200",
  rejected: "bg-red-50 text-red-600 border-red-200",
};

// ─── Shared UI ────────────────────────────────────────────────────────────────
function Badge({ label, cls }: { label: string; cls: string }) {
  return <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold border ${cls}`}>{label}</span>;
}
function InfoRow({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="flex items-start justify-between py-3 border-b border-[#f5f5f5] last:border-0 gap-4">
      <span className="text-[12px] text-[#999] shrink-0 w-28">{label}</span>
      <span className="text-[13px] text-[#0a0a0a] text-right font-medium">{value || "—"}</span>
    </div>
  );
}
function StatBox({ label, value, color = "#0a0a0a" }: { label: string; value: number | string; color?: string }) {
  return (
    <div className="bg-white rounded-2xl border border-[#ebebeb] p-5 text-center">
      <p className="text-[24px] font-bold mb-1" style={{ color }}>{value}</p>
      <p className="text-[11px] text-[#aaa]">{label}</p>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function PoolAdmin() {
  const [, params] = useRoute("/pool/:id/admin");
  const [, navigate] = useLocation();
  const { user, logout, loading: authLoading } = useAuth();
  const poolId = params?.id;

  const [tab, setTab] = useState<TabId>("info");
  const [pool, setPool] = useState<PoolDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState<any[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  // Subscription modal
  const [showSubModal, setShowSubModal] = useState(false);
  const [subStatus, setSubStatus] = useState("");
  const [subStart, setSubStart] = useState("");
  const [subEnd, setSubEnd] = useState("");
  const [subNote, setSubNote] = useState("");
  const [subLoading, setSubLoading] = useState(false);
  const [subMsg, setSubMsg] = useState("");

  // Reject modal
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  // Delete confirm
  const [deleteConfirm, setDeleteConfirm] = useState("");

  // Homepage settings
  const [hpSlug, setHpSlug] = useState("");
  const [hpEnabled, setHpEnabled] = useState(false);
  const [hpSlugInput, setHpSlugInput] = useState("");
  const [hpCheckMsg, setHpCheckMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [hpSaving, setHpSaving] = useState(false);
  const [hpMsg, setHpMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [hpLoaded, setHpLoaded] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { navigate("/login", { replace: true }); return; }
    // pool_admin은 자신의 수영장만 접근 가능
    if (user.role === "pool_admin") {
      if ((user as any).swimming_pool_id && (user as any).swimming_pool_id !== poolId) {
        navigate(`/pool/${(user as any).swimming_pool_id}/admin`, { replace: true });
      }
      return;
    }
    // 그 외 비super_admin은 로그인 페이지로
    if (user.role !== "super_admin") {
      navigate("/login", { replace: true });
    }
  }, [user, authLoading, navigate, poolId]);

  const fetchPool = useCallback(async () => {
    if (!poolId) return;
    setLoading(true);
    try {
      const res = await api.get<{ success: boolean; data: PoolDetail }>(`/admin/pools/${poolId}/detail`);
      setPool(res.data);
    } catch {
      setPool(null);
    } finally {
      setLoading(false);
    }
  }, [poolId]);

  useEffect(() => {
    if (!authLoading && user) fetchPool();
  }, [authLoading, user, fetchPool]);

  const fetchLogs = useCallback(async () => {
    if (!poolId || tab !== "logs") return;
    setLogsLoading(true);
    try {
      const data = await api.get<any[]>(`/admin/activity-logs?pool_id=${poolId}&limit=50`).catch(() => []);
      setLogs(data);
    } finally {
      setLogsLoading(false);
    }
  }, [poolId, tab]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  useEffect(() => {
    if (tab !== "homepage" || hpLoaded) return;
    (async () => {
      try {
        const data = await api.get<any>("/pools/homepage/settings");
        setHpSlug(data.homepage_slug ?? "");
        setHpSlugInput(data.homepage_slug ?? "");
        setHpEnabled(data.homepage_enabled ?? false);
        setHpLoaded(true);
      } catch { /* ignore */ }
    })();
  }, [tab, hpLoaded]);

  const openSubModal = () => {
    if (!pool) return;
    setSubStatus(pool.subscription_status);
    setSubStart(pool.subscription_start_at?.slice(0, 10) || "");
    setSubEnd(pool.subscription_end_at?.slice(0, 10) || "");
    setSubNote("");
    setSubMsg("");
    setShowSubModal(true);
  };

  const updateSubscription = async () => {
    if (!poolId || !subStatus) return;
    setSubLoading(true);
    setSubMsg("");
    try {
      await api.patch(`/admin/pools/${poolId}/subscription`, {
        subscription_status: subStatus,
        subscription_start_at: subStart || null,
        subscription_end_at: subEnd || null,
        note: subNote || null,
      });
      setSubMsg("구독 정보가 업데이트되었습니다.");
      fetchPool();
      setTimeout(() => setShowSubModal(false), 1000);
    } catch (err: any) {
      setSubMsg(err?.data?.error || "업데이트 실패");
    } finally {
      setSubLoading(false);
    }
  };

  const approve = async () => {
    if (!poolId) return;
    setActionLoading(true);
    try {
      await api.patch(`/admin/pools/${poolId}/approve`, {});
      fetchPool();
    } finally {
      setActionLoading(false);
    }
  };

  const reject = async () => {
    if (!poolId || !rejectReason.trim()) return;
    setActionLoading(true);
    try {
      await api.patch(`/admin/pools/${poolId}/reject`, { reason: rejectReason });
      setShowRejectModal(false);
      setRejectReason("");
      fetchPool();
    } finally {
      setActionLoading(false);
    }
  };

  if (authLoading || loading) {
    return <div className="min-h-screen flex items-center justify-center"><span className="text-[#aaa] text-[14px]">불러오는 중...</span></div>;
  }
  if (!user || (user.role !== "super_admin" && user.role !== "pool_admin")) return null;
  const isSuperAdmin = user.role === "super_admin";
  const visibleTabs = isSuperAdmin
    ? TABS
    : TABS.filter(t => t.id !== "actions" && t.id !== "subscription" && t.id !== "storage" && t.id !== "policy" && t.id !== "logs");
  if (!pool) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-[15px] font-semibold text-[#333] mb-2">수영장을 찾을 수 없습니다.</p>
          <button onClick={() => navigate("/super-admin")} className="text-[13px] text-[#01B2F1] hover:underline">← 슈퍼관리자로 돌아가기</button>
        </div>
      </div>
    );
  }

  // ── Tab renderers ──────────────────────────────────────────────────────────

  const renderInfo = () => (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <StatBox label="활성 회원" value={pool.student_count ?? 0} color={SECONDARY} />
        <StatBox label="선생님" value={pool.teacher_count ?? 0} />
        <StatBox label="수업 반" value={pool.class_count ?? 0} />
      </div>

      {/* Pool basic info */}
      <div className="bg-white rounded-2xl border border-[#ebebeb] p-6">
        <p className="text-[12px] font-bold text-[#888] uppercase tracking-wide mb-4">수영장 정보</p>
        <InfoRow label="수영장 이름" value={pool.name} />
        {pool.english_name && <InfoRow label="영문명" value={pool.english_name} />}
        {pool.pool_type && <InfoRow label="수영장 유형" value={pool.pool_type} />}
        <InfoRow label="주소" value={pool.address} />
        <InfoRow label="대표 전화" value={pool.phone} />
        <InfoRow label="등록일" value={pool.created_at?.slice(0, 10)} />
        <InfoRow label="최근 업데이트" value={pool.updated_at?.slice(0, 10) || "—"} />
      </div>

      {/* Operator info */}
      <div className="bg-white rounded-2xl border border-[#ebebeb] p-6">
        <p className="text-[12px] font-bold text-[#888] uppercase tracking-wide mb-4">운영자 정보</p>
        <InfoRow label="대표자명" value={pool.owner_name} />
        <InfoRow label="이메일" value={pool.owner_email} />
      </div>

      {/* Rejection reason if any */}
      {pool.approval_status === "rejected" && pool.rejection_reason && (
        <div className="bg-red-50 rounded-2xl border border-red-200 p-5">
          <p className="text-[12px] font-bold text-red-600 mb-1">반려 사유</p>
          <p className="text-[13px] text-red-700">{pool.rejection_reason}</p>
        </div>
      )}
    </div>
  );

  const renderSubscription = () => (
    <div className="space-y-5">
      <div className="bg-white rounded-2xl border border-[#ebebeb] p-6">
        <div className="flex items-center justify-between mb-4">
          <p className="text-[12px] font-bold text-[#888] uppercase tracking-wide">구독 현황</p>
          <button
            onClick={openSubModal}
            className="px-4 py-2 rounded-xl text-white text-[12px] font-semibold transition-opacity hover:opacity-85"
            style={{ background: PRIMARY }}
          >
            구독 직접 조정
          </button>
        </div>
        <InfoRow label="구독 상태" value={subLabel[pool.subscription_status] || pool.subscription_status} />
        <InfoRow label="구독 플랜" value={pool.subscription_tier || "기본 플랜"} />
        <InfoRow label="회원 한도" value={pool.member_limit ? `${pool.member_limit}명` : "—"} />
        <InfoRow label="저장 용량" value={pool.storage_gb ? `${pool.storage_gb}GB` : pool.storage_mb ? `${pool.storage_mb}MB` : "—"} />
        <InfoRow label="추가 저장" value={pool.extra_storage_gb ? `${pool.extra_storage_gb}GB` : "없음"} />
        <InfoRow label="구독 시작" value={pool.subscription_start_at?.slice(0, 10) || "—"} />
        <InfoRow label="구독 종료" value={pool.subscription_end_at?.slice(0, 10) || "—"} />
      </div>

      {/* Status display */}
      <div className="bg-white rounded-2xl border border-[#ebebeb] p-6">
        <p className="text-[12px] font-bold text-[#888] uppercase tracking-wide mb-4">승인 상태</p>
        <div className="flex gap-3 flex-wrap">
          <Badge label={approvalLabel[pool.approval_status] || pool.approval_status} cls={approvalColor[pool.approval_status]} />
          <Badge label={subLabel[pool.subscription_status] || pool.subscription_status} cls={subColor[pool.subscription_status]} />
        </div>
      </div>
    </div>
  );

  const renderStorage = () => {
    const totalMb = pool.storage_mb ?? (pool.storage_gb ? pool.storage_gb * 1024 : 102);
    const extraMb = (pool.extra_storage_gb ?? 0) * 1024;
    const allMb = totalMb + extraMb;

    return (
      <div className="space-y-5">
        <div className="bg-white rounded-2xl border border-[#ebebeb] p-6">
          <p className="text-[12px] font-bold text-[#888] uppercase tracking-wide mb-5">저장공간 현황</p>
          <div className="mb-5">
            <div className="flex justify-between text-[12px] text-[#888] mb-2">
              <span>플랜 기본 용량</span>
              <span className="font-semibold text-[#0a0a0a]">
                {allMb >= 1024 ? `${(allMb / 1024).toFixed(1)}GB` : `${allMb}MB`}
              </span>
            </div>
            {(pool.extra_storage_gb ?? 0) > 0 && (
              <div className="flex justify-between text-[12px] text-[#888] mb-2">
                <span>추가 구매 용량</span>
                <span className="font-semibold text-green-600">{pool.extra_storage_gb}GB 추가</span>
              </div>
            )}
          </div>
          <InfoRow label="구독 플랜" value={pool.subscription_tier || "free"} />
          <InfoRow label="회원 한도" value={pool.member_limit ? `${pool.member_limit}명` : "—"} />
        </div>

        <div className="bg-[#f0f9ff] rounded-2xl border border-[#bae6fd] p-5">
          <p className="text-[12px] font-semibold text-[#0369a1] mb-1">저장공간 상세 조회</p>
          <p className="text-[12px] text-[#0284c7]">실제 사용량은 앱 슈퍼관리자 → 저장공간 메뉴에서 확인하세요.</p>
        </div>
      </div>
    );
  };

  const renderPolicy = () => (
    <div className="bg-white rounded-2xl border border-[#ebebeb] p-6">
      <p className="text-[12px] font-bold text-[#888] uppercase tracking-wide mb-5">정책 동의 현황</p>
      {[
        { label: "환불 정책", key: "refund_policy_agreed", value: pool.refund_policy_agreed },
        { label: "개인정보 처리방침", key: "privacy_policy_agreed", value: pool.privacy_policy_agreed },
        { label: "이용약관", key: "terms_agreed", value: pool.terms_agreed },
      ].map(({ label, value }) => (
        <div key={label} className="flex items-center justify-between py-3.5 border-b border-[#f5f5f5] last:border-0">
          <span className="text-[13px] text-[#333]">{label}</span>
          {value === true ? (
            <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-green-600">
              <span className="w-4 h-4 rounded-full bg-green-500 flex items-center justify-center text-white text-[10px]">✓</span>
              동의함
            </span>
          ) : value === false ? (
            <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-red-500">
              <span className="w-4 h-4 rounded-full bg-red-400 flex items-center justify-center text-white text-[10px]">✗</span>
              미동의
            </span>
          ) : (
            <span className="text-[12px] text-[#bbb]">정보 없음</span>
          )}
        </div>
      ))}
    </div>
  );

  const renderLogs = () => (
    <div>
      {logsLoading ? (
        <div className="py-16 text-center text-[#aaa] text-[13px]">로그 불러오는 중...</div>
      ) : logs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-4xl mb-3">📋</p>
          <p className="text-[14px] font-semibold text-[#333] mb-1">로그 없음</p>
          <p className="text-[12px] text-[#aaa]">기록된 활동 로그가 없습니다.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-[#ebebeb] bg-white">
          <table className="w-full text-[12px]">
            <thead>
              <tr>
                <th className="text-left px-4 py-3 text-[11px] text-[#aaa] font-semibold bg-[#fafafa] border-b border-[#f0f0f0]">일시</th>
                <th className="text-left px-4 py-3 text-[11px] text-[#aaa] font-semibold bg-[#fafafa] border-b border-[#f0f0f0]">유형</th>
                <th className="text-left px-4 py-3 text-[11px] text-[#aaa] font-semibold bg-[#fafafa] border-b border-[#f0f0f0]">내용</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log, i) => (
                <tr key={log.id || i} className="hover:bg-[#fafafa]">
                  <td className="px-4 py-3 border-b border-[#f8f8f8] text-[#aaa] whitespace-nowrap">{log.created_at?.slice(0, 16)?.replace("T", " ")}</td>
                  <td className="px-4 py-3 border-b border-[#f8f8f8]">
                    <span className="px-2 py-0.5 rounded bg-[#f0f0f0] text-[10px] font-semibold text-[#666]">{log.event_type || log.action_type || "—"}</span>
                  </td>
                  <td className="px-4 py-3 border-b border-[#f8f8f8] text-[#555]">{log.description || log.content || JSON.stringify(log.payload || {}).slice(0, 80)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  const renderActions = () => (
    <div className="space-y-4 max-w-2xl">
      {/* Re-approve */}
      {pool.approval_status !== "approved" && (
        <div className="bg-white rounded-2xl border border-[#ebebeb] p-6">
          <p className="text-[14px] font-bold text-[#0a0a0a] mb-1">운영 승인</p>
          <p className="text-[12px] text-[#888] mb-4">이 수영장의 플랫폼 사용을 승인합니다.</p>
          <button
            onClick={approve}
            disabled={actionLoading}
            className="px-6 py-2.5 rounded-xl text-white text-[13px] font-semibold transition-opacity hover:opacity-85 disabled:opacity-50"
            style={{ background: "#16a34a" }}
          >
            {actionLoading ? "처리 중..." : "승인하기"}
          </button>
        </div>
      )}

      {/* Reject */}
      <div className="bg-white rounded-2xl border border-[#ebebeb] p-6">
        <p className="text-[14px] font-bold text-[#0a0a0a] mb-1">운영 반려</p>
        <p className="text-[12px] text-[#888] mb-4">운영 자격을 박탈하고 반려 처리합니다.</p>
        <button
          onClick={() => setShowRejectModal(true)}
          className="px-6 py-2.5 rounded-xl text-white text-[13px] font-semibold bg-orange-500 hover:opacity-85 transition-opacity"
        >
          반려 처리
        </button>
      </div>

      {/* Restrict subscription */}
      <div className="bg-white rounded-2xl border border-[#ebebeb] p-6">
        <p className="text-[14px] font-bold text-[#0a0a0a] mb-1">구독 일시 정지</p>
        <p className="text-[12px] text-[#888] mb-4">구독 상태를 정지로 변경합니다.</p>
        <button
          onClick={async () => {
            if (!confirm("구독을 일시 정지하시겠습니까?")) return;
            setActionLoading(true);
            try {
              await api.patch(`/admin/pools/${poolId}/subscription`, { subscription_status: "suspended" });
              fetchPool();
            } finally { setActionLoading(false); }
          }}
          disabled={actionLoading || pool.subscription_status === "suspended"}
          className="px-6 py-2.5 rounded-xl text-[13px] font-semibold border border-orange-300 text-orange-600 hover:bg-orange-50 disabled:opacity-40 transition-colors"
        >
          일시 정지
        </button>
      </div>

      {/* Danger zone */}
      <div className="bg-red-50 rounded-2xl border border-red-200 p-6">
        <p className="text-[14px] font-bold text-red-600 mb-1">⚠️ 위험 구역</p>
        <p className="text-[12px] text-red-500 mb-4">수영장을 완전 삭제하면 모든 데이터가 영구적으로 제거되며 복구할 수 없습니다.</p>
        <div className="mb-3">
          <label className="block text-[11px] font-semibold text-red-600 mb-1.5">확인을 위해 수영장 이름을 입력하세요</label>
          <input
            type="text"
            value={deleteConfirm}
            onChange={e => setDeleteConfirm(e.target.value)}
            placeholder={pool.name}
            className="w-full px-3.5 py-2.5 rounded-xl border border-red-200 text-[13px] focus:outline-none focus:border-red-400 bg-white"
          />
        </div>
        <button
          disabled={deleteConfirm !== pool.name || actionLoading}
          className="px-6 py-2.5 rounded-xl text-white text-[13px] font-semibold bg-red-500 hover:opacity-85 disabled:opacity-30 transition-opacity"
          onClick={() => alert("삭제 기능은 앱 슈퍼관리자 킬스위치에서 실행하세요.")}
        >
          수영장 완전 삭제
        </button>
      </div>
    </div>
  );

  const checkSlug = async () => {
    if (!hpSlugInput) return;
    setHpCheckMsg(null);
    try {
      const data = await api.get<any>(`/pools/homepage/check-slug?slug=${encodeURIComponent(hpSlugInput)}`);
      setHpCheckMsg({ text: data.message, ok: data.available });
    } catch { setHpCheckMsg({ text: "확인 중 오류가 발생했습니다.", ok: false }); }
  };

  const saveHomepage = async () => {
    setHpSaving(true); setHpMsg(null);
    try {
      const payload: any = { homepage_slug: hpSlugInput || null, homepage_enabled: hpEnabled };
      const data = await api.patch<any>("/pools/homepage/settings", payload);
      if (data.success !== false) {
        setHpSlug(data.homepage_slug ?? "");
        setHpSlugInput(data.homepage_slug ?? "");
        setHpEnabled(data.homepage_enabled ?? false);
        setHpMsg({ text: "저장되었습니다.", ok: true });
      }
    } catch (e: any) {
      setHpMsg({ text: e?.data?.error || "저장 중 오류가 발생했습니다.", ok: false });
    } finally { setHpSaving(false); }
  };

  const BASE_URL = window.location.origin;

  const renderHomepage = () => (
    <div className="space-y-6 max-w-2xl">
      {/* Status Card */}
      <div className="bg-white rounded-2xl border border-[#ebebeb] p-6">
        <p className="text-[12px] font-bold text-[#888] uppercase tracking-wide mb-5">홈페이지 현황</p>
        <div className="flex items-center justify-between py-3 border-b border-[#f5f5f5]">
          <span className="text-[13px] text-[#333]">현재 주소</span>
          {hpSlug ? (
            <a
              href={`${BASE_URL}/${hpSlug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[13px] font-semibold text-[#0369A1] hover:underline truncate max-w-[240px]"
            >
              swimnote.kr/{hpSlug}
            </a>
          ) : (
            <span className="text-[13px] text-[#bbb]">주소 미설정</span>
          )}
        </div>
        <div className="flex items-center justify-between py-3">
          <span className="text-[13px] text-[#333]">공개 상태</span>
          <span className={`px-3 py-1 rounded-full text-[11px] font-semibold ${
            hpEnabled && hpSlug ? "bg-green-50 text-green-600" : "bg-gray-100 text-[#888]"
          }`}>
            {hpEnabled && hpSlug ? "공개 중" : "비공개"}
          </span>
        </div>
      </div>

      {/* URL Setup */}
      <div className="bg-white rounded-2xl border border-[#ebebeb] p-6 space-y-5">
        <p className="text-[12px] font-bold text-[#888] uppercase tracking-wide">홈페이지 주소 설정</p>

        <div>
          <label className="block text-[12px] font-semibold text-[#555] mb-2">홈페이지 주소</label>
          <div className="flex gap-2">
            <div className="flex items-center border border-[#e5e5e5] rounded-xl overflow-hidden flex-1">
              <span className="px-3 py-3 text-[12px] text-[#aaa] bg-[#fafafa] border-r border-[#e5e5e5] whitespace-nowrap">swimnote.kr/</span>
              <input
                type="text"
                value={hpSlugInput}
                onChange={e => { setHpSlugInput(e.target.value); setHpCheckMsg(null); }}
                placeholder="수영장주소"
                className="flex-1 px-3 py-3 text-[14px] focus:outline-none"
              />
            </div>
            <button
              onClick={checkSlug}
              className="px-4 py-3 rounded-xl border border-[#e5e5e5] text-[12px] font-semibold text-[#555] hover:bg-[#f5f5f5] transition-colors whitespace-nowrap"
            >
              중복확인
            </button>
          </div>
          <p className="text-[11px] text-[#aaa] mt-1.5">한글, 영문, 숫자, 하이픈(-)만 사용 가능합니다.</p>
          {hpCheckMsg && (
            <p className={`text-[12px] font-medium mt-1.5 ${hpCheckMsg.ok ? "text-green-600" : "text-red-500"}`}>
              {hpCheckMsg.ok ? "✓ " : "✗ "}{hpCheckMsg.text}
            </p>
          )}
        </div>

        {/* Toggle */}
        <div className="flex items-center justify-between py-3 border-t border-[#f5f5f5]">
          <div>
            <p className="text-[13px] font-semibold text-[#0a0a0a]">홈페이지 공개</p>
            <p className="text-[11px] text-[#aaa] mt-0.5">주소를 설정한 후 공개할 수 있습니다.</p>
          </div>
          <button
            onClick={() => setHpEnabled(v => !v)}
            disabled={!hpSlugInput}
            className={`relative w-12 h-6 rounded-full transition-colors ${
              hpEnabled && hpSlugInput ? "bg-[#002F5F]" : "bg-[#e0e0e0]"
            } disabled:opacity-40`}
          >
            <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${
              hpEnabled && hpSlugInput ? "translate-x-7" : "translate-x-1"
            }`} />
          </button>
        </div>

        {hpMsg && (
          <div className={`rounded-xl px-4 py-3 text-[12px] font-medium ${hpMsg.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
            {hpMsg.text}
          </div>
        )}

        <button
          onClick={saveHomepage}
          disabled={hpSaving}
          className="w-full py-3 rounded-xl text-white text-[13px] font-semibold disabled:opacity-60 transition-opacity"
          style={{ background: PRIMARY }}
        >
          {hpSaving ? "저장 중..." : "저장하기"}
        </button>
      </div>

      {/* Preview link */}
      {hpSlug && hpEnabled && (
        <div className="bg-[#f0f9ff] rounded-2xl border border-[#bae6fd] p-5 flex items-center justify-between gap-4">
          <div>
            <p className="text-[12px] font-bold text-[#0369A1] mb-1">홈페이지 공개 중 🎉</p>
            <p className="text-[12px] text-[#0284c7]">고객들이 아래 주소로 수영장 정보를 볼 수 있습니다.</p>
          </div>
          <a
            href={`/${hpSlug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 rounded-xl text-white text-[12px] font-semibold whitespace-nowrap"
            style={{ background: "#0369A1" }}
          >
            미리보기
          </a>
        </div>
      )}

      {/* Content note */}
      <div className="bg-[#fffbeb] rounded-2xl border border-[#fde68a] p-5">
        <p className="text-[12px] font-semibold text-[#92400e] mb-1">💡 홈페이지 내용 편집</p>
        <p className="text-[12px] text-[#a16207]">
          수영장 소개, 수강료, 레벨테스트 정보 등 홈페이지에 표시될 내용은 앱의 <strong>설정 → 수영장 정보</strong>에서 수정할 수 있습니다.
        </p>
      </div>
    </div>
  );

  const renderContent = () => {
    if (tab === "info") return renderInfo();
    if (tab === "subscription") return renderSubscription();
    if (tab === "storage") return renderStorage();
    if (tab === "policy") return renderPolicy();
    if (tab === "logs") return renderLogs();
    if (tab === "actions") return renderActions();
    if (tab === "homepage") return renderHomepage();
    return null;
  };

  return (
    <div className="min-h-screen bg-[#f8f9fb]">
      {/* Header */}
      <header className="bg-white border-b border-[#ebebeb] sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={() => isSuperAdmin ? navigate("/super-admin") : navigate("/")}
              className="flex items-center gap-2 hover:opacity-70 transition-opacity"
            >
              <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: PRIMARY }}>
                <span className="text-white text-[12px] font-black" translate="no">S</span>
              </div>
              <span className="text-[14px] font-bold text-[#0a0a0a]" translate="no">SWIMNOTE</span>
            </button>
            {isSuperAdmin && (
              <>
                <span className="text-[#ddd]">/</span>
                <span className="text-[13px] text-[#888]">슈퍼관리자</span>
              </>
            )}
            <span className="text-[#ddd]">/</span>
            <span className="text-[13px] font-semibold text-[#0a0a0a] truncate max-w-[200px]">{pool.name}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className={`hidden sm:inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold ${
              isSuperAdmin ? "bg-blue-50 text-blue-600" : "bg-green-50 text-green-600"
            }`}>
              {isSuperAdmin ? "슈퍼관리자" : "수영장 관리자"}
            </span>
            <button onClick={() => { logout(); navigate("/login"); }} className="text-[12px] text-[#888] hover:text-[#0a0a0a]">로그아웃</button>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* Pool banner */}
        <div className="bg-white rounded-2xl border border-[#ebebeb] p-6 mb-6">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div>
              <h1 className="text-[22px] font-bold text-[#0a0a0a] mb-1">{pool.name}</h1>
              <p className="text-[13px] text-[#888] mb-3">{pool.owner_name} 대표 · {pool.created_at?.slice(0, 10)} 등록</p>
              <div className="flex gap-2 flex-wrap">
                <Badge label={approvalLabel[pool.approval_status] || pool.approval_status} cls={approvalColor[pool.approval_status]} />
                <Badge label={subLabel[pool.subscription_status] || pool.subscription_status} cls={subColor[pool.subscription_status]} />
              </div>
            </div>
            <div className="text-right text-[12px] text-[#aaa]">
              <p>수영장 ID</p>
              <p className="font-mono text-[11px] text-[#bbb]">{pool.id}</p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-white rounded-2xl border border-[#ebebeb] p-1.5 overflow-x-auto">
          {visibleTabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 rounded-xl text-[13px] font-semibold whitespace-nowrap transition-all flex-shrink-0 ${
                tab === t.id ? "text-white shadow-sm" : "text-[#888] hover:bg-[#f5f5f5]"
              } ${t.id === "actions" && tab === t.id ? "" : ""}`}
              style={tab === t.id ? { background: t.id === "actions" ? "#dc2626" : PRIMARY } : {}}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        {renderContent()}
      </div>

      {/* Subscription modal */}
      {showSubModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl p-8 w-full max-w-md shadow-xl">
            <h3 className="text-[17px] font-bold text-[#0a0a0a] mb-1">구독 직접 조정</h3>
            <p className="text-[12px] text-[#888] mb-6">{pool.name}</p>
            <div className="space-y-4">
              <div>
                <label className="block text-[11px] font-semibold text-[#555] mb-1.5">구독 상태</label>
                <select value={subStatus} onChange={e => setSubStatus(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-[#e5e5e5] text-[13px] focus:outline-none focus:border-[#01B2F1]">
                  {Object.entries(subLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[#555] mb-1.5">시작일</label>
                <input type="date" value={subStart} onChange={e => setSubStart(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-[#e5e5e5] text-[13px] focus:outline-none focus:border-[#01B2F1]" />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[#555] mb-1.5">종료일</label>
                <input type="date" value={subEnd} onChange={e => setSubEnd(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-[#e5e5e5] text-[13px] focus:outline-none focus:border-[#01B2F1]" />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[#555] mb-1.5">메모 (선택)</label>
                <input type="text" value={subNote} onChange={e => setSubNote(e.target.value)} placeholder="조정 사유 입력" className="w-full px-4 py-3 rounded-xl border border-[#e5e5e5] text-[13px] focus:outline-none focus:border-[#01B2F1]" />
              </div>
            </div>
            {subMsg && <p className={`mt-3 text-[12px] ${subMsg.includes("업데이트") ? "text-green-600" : "text-red-500"}`}>{subMsg}</p>}
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowSubModal(false)} className="flex-1 py-3 rounded-xl border border-[#ebebeb] text-[13px] font-semibold text-[#555] hover:bg-[#f5f5f5]">취소</button>
              <button onClick={updateSubscription} disabled={subLoading} className="flex-1 py-3 rounded-xl text-white text-[13px] font-semibold transition-opacity hover:opacity-85 disabled:opacity-50" style={{ background: PRIMARY }}>
                {subLoading ? "저장 중..." : "저장"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject modal */}
      {showRejectModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl p-8 w-full max-w-md shadow-xl">
            <h3 className="text-[17px] font-bold text-[#0a0a0a] mb-4">반려 사유 입력</h3>
            <textarea
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              placeholder="반려 사유를 입력하세요"
              rows={3}
              className="w-full px-4 py-3 rounded-xl border border-[#e5e5e5] text-[13px] placeholder:text-[#ccc] focus:outline-none focus:border-[#01B2F1] resize-none mb-4"
            />
            <div className="flex gap-3">
              <button onClick={() => { setShowRejectModal(false); setRejectReason(""); }} className="flex-1 py-3 rounded-xl border border-[#ebebeb] text-[13px] font-semibold text-[#555] hover:bg-[#f5f5f5]">취소</button>
              <button onClick={reject} disabled={actionLoading || !rejectReason.trim()} className="flex-1 py-3 rounded-xl text-white text-[13px] font-semibold bg-red-500 hover:opacity-80 disabled:opacity-50">
                {actionLoading ? "처리 중..." : "반려"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
