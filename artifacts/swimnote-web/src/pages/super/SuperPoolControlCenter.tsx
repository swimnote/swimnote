/**
 * SuperPoolControlCenter — /super/pools/:poolId
 *
 * SWIMNOTE Pool Control Center: 수영장 운영 통제 콘솔
 * 13개 탭: Overview / Access-Plans / Members / Teachers / Parents /
 *          Classes / Curriculum / AI / Growth-Reports / Errors /
 *          Notifications / Storage / Audit / Support
 *
 * Phase A 포함: BASE SWIMNOTE manual entitlement grant/revoke
 * X manual grant (기존 구현) 통합
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useRoute, useLocation } from "wouter";
import { api } from "@/lib/api";

// ─────────────────── Types ────────────────────
interface Summary {
  pool_id: string; name: string; owner_name: string;
  approval_status: string; created_at: string; updated_at: string;
  health: "GREEN" | "YELLOW" | "RED"; health_issues: string[];
  base_paid: boolean; base_manual: boolean; base_effective: boolean; base_source: string;
  subscription_status: string; subscription_tier: string;
  x_paid: boolean; x_manual: boolean; x_force_disabled: boolean;
  x_effective: boolean; x_source: string; x_plan_key: string | null;
  xmode_config_status: string;
  active_members: number; total_members: number; teacher_count: number;
  parent_count: number; active_class_count: number;
  member_limit: number | null; used_storage_bytes: number; upload_blocked: boolean;
  recent_ai_diary_count: number; recent_ai_month: string | null;
  gr_ready_count: number; gr_failed_count: number; gr_total_count: number;
  recent_error_count: number; last_error_at: string | null;
  unread_notifications: number;
  recent_support: {
    id: string; ticket_id: string | null; state: string;
    actor_role: string | null; created_at: string; updated_at: string;
  } | null;
}

// X Plan display constants — fetched from /super/plan-catalog at runtime.
// Fallback used only if API call fails before catalog is loaded.
const X_PLANS_FALLBACK = [
  { key: "x300",  label: "SWIMNOTE X300",  memberLimit: 300,  priceLabel: "₩129,000/월" },
  { key: "x500",  label: "SWIMNOTE X500",  memberLimit: 500,  priceLabel: "₩199,000/월" },
  { key: "x1000", label: "SWIMNOTE X1000", memberLimit: 1000, priceLabel: "₩359,000/월" },
];
type XPlanDef = { key: string; label: string; memberLimit: number; priceMonthlyKrw?: number; priceLabel: string };

// ─────────────────── Sub-components ────────────────────
function Badge({ color, text }: { color: string; text: string }) {
  const cls = {
    green: "bg-green-100 text-green-700",
    red: "bg-red-100 text-red-600",
    yellow: "bg-amber-100 text-amber-700",
    blue: "bg-blue-100 text-blue-700",
    navy: "bg-[#002F5F] text-white",
    gray: "bg-[#f3f4f6] text-[#666]",
    purple: "bg-purple-100 text-purple-700",
  }[color] ?? "bg-[#f3f4f6] text-[#666]";
  return <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded ${cls}`}>{text}</span>;
}

function Row({ label, value, valueClass }: { label: string; value?: string | number | boolean | null; valueClass?: string }) {
  const display = value == null ? "—" : typeof value === "boolean" ? (value ? "YES" : "NO") : String(value);
  return (
    <div className="flex justify-between py-1.5 border-b border-[#f5f5f5] last:border-0">
      <span className="text-[11px] text-[#888]">{label}</span>
      <span className={`text-[11px] font-medium text-right break-all max-w-[65%] ${valueClass ?? "text-[#111]"}`}>{display}</span>
    </div>
  );
}

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-[#e5e7eb] mb-4">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#f5f5f5]">
        <span className="text-[12px] font-semibold text-[#222]">{title}</span>
        {action}
      </div>
      <div className="px-4 py-3">{children}</div>
    </div>
  );
}

function StatCard({ label, value, sub, color = "gray" }: { label: string; value: number | string; sub?: string; color?: string }) {
  const cols = { navy: "text-[#002F5F]", green: "text-green-600", red: "text-red-600", gray: "text-[#111]", amber: "text-amber-600" };
  return (
    <div className="bg-[#f9fafb] rounded-lg p-3">
      <div className={`text-[22px] font-bold ${(cols as any)[color] ?? cols.gray}`}>{value}</div>
      <div className="text-[11px] text-[#888] mt-0.5">{label}</div>
      {sub && <div className="text-[10px] text-[#aaa] mt-0.5">{sub}</div>}
    </div>
  );
}

function Spinner() { return <div className="text-[12px] text-[#aaa] py-8 text-center">불러오는 중...</div>; }
function Empty({ text }: { text: string }) { return <div className="text-[12px] text-[#bbb] py-6 text-center">{text}</div>; }
function Err({ msg }: { msg: string }) { return <div className="text-[12px] text-red-500 py-4">{msg}</div>; }

function Table({ heads, rows, render }: { heads: string[]; rows: any[]; render: (r: any, i: number) => React.ReactNode }) {
  if (!rows.length) return <Empty text="데이터 없음" />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b border-[#e5e7eb]">
            {heads.map((h) => <th key={h} className="py-2 pr-3 text-left font-semibold text-[#555]">{h}</th>)}
          </tr>
        </thead>
        <tbody>{rows.map((r, i) => render(r, i))}</tbody>
      </table>
    </div>
  );
}

function Msg({ ok, text, onClose }: { ok: boolean; text: string; onClose: () => void }) {
  return (
    <div className={`flex items-start justify-between gap-2 px-3 py-2 rounded text-[12px] mb-3 ${ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
      <span>{text}</span>
      <button onClick={onClose} className="shrink-0 font-bold">×</button>
    </div>
  );
}

// ─────────────────── Modals ────────────────────

/** 이유 입력 포함 위험 액션 확인 모달 */
function ConfirmDangerModal({
  title, description, confirmLabel, onConfirm, onClose, loading, requireReason = true,
}: {
  title: string; description: string; confirmLabel: string;
  onConfirm: (reason: string) => void; onClose: () => void; loading: boolean; requireReason?: boolean;
}) {
  const [reason, setReason] = useState("");
  const canConfirm = !requireReason || reason.trim().length > 0;
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl p-6 w-[360px]" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-[15px] font-bold mb-1 text-red-700">{title}</h3>
        <p className="text-[12px] text-[#666] mb-4 whitespace-pre-wrap">{description}</p>
        {requireReason && (
          <div className="mb-4">
            <label className="block text-[11px] font-semibold text-[#555] mb-1">사유 (필수)</label>
            <textarea
              value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
              placeholder="변경 사유를 입력하세요 (감사 기록됩니다)"
              className="w-full border border-[#e5e7eb] rounded-lg px-3 py-2 text-[12px] outline-none focus:border-red-400 resize-none"
            />
          </div>
        )}
        <div className="flex gap-2">
          <button
            onClick={() => onConfirm(reason.trim())} disabled={loading || !canConfirm}
            className="flex-1 py-2 text-[13px] font-semibold rounded-lg bg-red-600 text-white disabled:opacity-40"
          >
            {loading ? "처리 중..." : confirmLabel}
          </button>
          <button onClick={onClose} disabled={loading} className="px-4 py-2 text-[13px] rounded-lg border border-[#e5e7eb] text-[#555]">취소</button>
        </div>
      </div>
    </div>
  );
}

/** X 플랜 부여/변경 모달 (서버 catalog 기반) */
function GrantXModal({ current_plan, plans, onGrant, onClose, loading }: {
  current_plan: string | null; plans: XPlanDef[];
  onGrant: (plan: string, reason: string) => void; onClose: () => void; loading: boolean;
}) {
  const [plan, setPlan] = useState(current_plan ?? "x300");
  const [reason, setReason] = useState("");
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl p-6 w-[360px]" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-[15px] font-bold mb-1">X모드 직접 부여 / 플랜 변경</h3>
        <p className="text-[12px] text-[#888] mb-4">결제 없이 즉시 적용. 슈퍼관리자 전용.</p>
        <div className="space-y-2 mb-4">
          {plans.map((p) => (
            <label key={p.key} className={`flex items-center justify-between px-3 py-2.5 rounded-lg border cursor-pointer ${plan === p.key ? "border-[#002F5F] bg-[#f0f4ff]" : "border-[#e5e7eb]"}`}>
              <div className="flex items-center gap-2">
                <input type="radio" name="gp" value={p.key} checked={plan === p.key} onChange={() => setPlan(p.key)} className="accent-[#002F5F]" />
                <span className="text-[13px] font-semibold">{p.label}</span>
                <span className="text-[11px] text-[#888]">최대 {p.memberLimit.toLocaleString()}명</span>
              </div>
              <span className="text-[11px] text-[#6b7280]">{p.priceLabel}</span>
            </label>
          ))}
        </div>
        <div className="mb-4">
          <label className="block text-[11px] font-semibold text-[#555] mb-1">사유 (필수)</label>
          <textarea
            value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
            placeholder="직접 부여 사유 (감사 기록됩니다)"
            className="w-full border border-[#e5e7eb] rounded-lg px-3 py-2 text-[12px] outline-none focus:border-[#002F5F] resize-none"
          />
        </div>
        <p className="text-[11px] text-amber-600 mb-4">⚠ 청구 없음. 슈퍼관리자 직접부여로 감사 기록됩니다.</p>
        <div className="flex gap-2">
          <button
            onClick={() => onGrant(plan, reason.trim())} disabled={loading || !reason.trim()}
            className="flex-1 py-2 text-[13px] font-semibold rounded-lg bg-[#002F5F] text-white disabled:opacity-50"
          >
            {loading ? "처리 중..." : "확인 — 즉시 적용"}
          </button>
          <button onClick={onClose} disabled={loading} className="px-4 py-2 text-[13px] rounded-lg border border-[#e5e7eb] text-[#555]">취소</button>
        </div>
      </div>
    </div>
  );
}

/** 회원 한도 Override 모달 */
function MemberLimitModal({
  currentLimit, planLimit, onSet, onClose, loading,
}: {
  currentLimit: number | null; planLimit: number | null;
  onSet: (limit: number | null, reason: string) => void; onClose: () => void; loading: boolean;
}) {
  const [mode, setMode] = useState<"override" | "clear">(currentLimit !== null ? "override" : "override");
  const [value, setValue] = useState(String(currentLimit ?? planLimit ?? ""));
  const [reason, setReason] = useState("");
  const numVal = Number(value);
  const canSubmit = reason.trim().length > 0 && (mode === "clear" || (Number.isInteger(numVal) && numVal >= 1 && numVal <= 9998));
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl p-6 w-[360px]" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-[15px] font-bold mb-1">회원 한도 Override</h3>
        <p className="text-[12px] text-[#888] mb-3">플랜 기본 한도: {planLimit?.toLocaleString() ?? "—"}명</p>
        <div className="flex gap-2 mb-4">
          <button onClick={() => setMode("override")} className={`flex-1 py-1.5 text-[12px] rounded-lg border ${mode === "override" ? "border-[#002F5F] bg-[#f0f4ff] font-semibold" : "border-[#e5e7eb] text-[#888]"}`}>한도 설정</button>
          <button onClick={() => setMode("clear")} className={`flex-1 py-1.5 text-[12px] rounded-lg border ${mode === "clear" ? "border-orange-400 bg-orange-50 font-semibold text-orange-700" : "border-[#e5e7eb] text-[#888]"}`}>Override 해제</button>
        </div>
        {mode === "override" && (
          <div className="mb-4">
            <label className="block text-[11px] font-semibold text-[#555] mb-1">신규 한도 (1~9998)</label>
            <input
              type="number" value={value} onChange={(e) => setValue(e.target.value)} min={1} max={9998}
              className="w-full border border-[#e5e7eb] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#002F5F]"
            />
          </div>
        )}
        {mode === "clear" && (
          <p className="text-[12px] text-orange-600 mb-4">Override 해제 시 플랜 기본 한도({planLimit?.toLocaleString() ?? "—"}명)로 복원됩니다.</p>
        )}
        <div className="mb-4">
          <label className="block text-[11px] font-semibold text-[#555] mb-1">사유 (필수)</label>
          <textarea
            value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
            placeholder="변경 사유 (감사 기록됩니다)"
            className="w-full border border-[#e5e7eb] rounded-lg px-3 py-2 text-[12px] outline-none focus:border-[#002F5F] resize-none"
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => onSet(mode === "override" ? numVal : null, reason.trim())}
            disabled={loading || !canSubmit}
            className="flex-1 py-2 text-[13px] font-semibold rounded-lg bg-[#002F5F] text-white disabled:opacity-40"
          >
            {loading ? "처리 중..." : "적용"}
          </button>
          <button onClick={onClose} disabled={loading} className="px-4 py-2 text-[13px] rounded-lg border border-[#e5e7eb] text-[#555]">취소</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────── Health Issue → Tab mapping ────────────────────
// Source of truth: server-side healthIssues computation in super.ts
// Issue codes pushed: "X ENTITLEMENT CONFLICT" | "FREQUENT_ERRORS" | "GROWTH_REPORT_FAILURES" | "STORAGE_QUOTA"
const HEALTH_ISSUE_MAP: Record<string, { label: string; severity: "critical" | "warning"; tabKey: TabKey | null }> = {
  "X ENTITLEMENT CONFLICT": {
    label: "X 엔타이틀먼트 충돌 — paid 상태이나 force disabled가 켜져 있음",
    severity: "critical",
    tabKey: "access",
  },
  "FREQUENT_ERRORS": {
    label: "최근 7일 오류 10건 초과",
    severity: "warning",
    tabKey: "errors",
  },
  "GROWTH_REPORT_FAILURES": {
    label: "성장리포트 실패 3건 초과",
    severity: "warning",
    tabKey: "growth-reports",
  },
  "STORAGE_QUOTA": {
    label: "스토리지 초과 — 업로드 차단됨",
    severity: "critical",
    tabKey: "storage",
  },
};

// ─────────────────── Tab Panels ────────────────────

function OverviewTab({ s, onNavigate }: { s: Summary; onNavigate: (tab: TabKey) => void }) {
  const fmtBytes = (b: number) =>
    b > 1e9 ? `${(b / 1e9).toFixed(1)} GB`
    : b > 1e6 ? `${(b / 1e6).toFixed(0)} MB`
    : `${(b / 1e3).toFixed(0)} KB`;

  const healthLabel = { GREEN: "정상", YELLOW: "경고", RED: "심각" }[s.health] ?? s.health;
  const healthTitleCls = s.health === "RED" ? "text-red-700" : s.health === "YELLOW" ? "text-amber-700" : "text-green-700";

  return (
    <div className="space-y-4">

      {/* ── 1. Health ── */}
      <Section title={`Health — ${healthLabel}`}>
        {s.health_issues.length === 0 ? (
          <div className="text-[12px] text-green-700 py-1">✓ 현재 감지된 주요 운영 이상 없음</div>
        ) : (
          <div className="space-y-2">
            {s.health_issues.map((code) => {
              const info = HEALTH_ISSUE_MAP[code];
              const severity = info?.severity ?? "warning";
              const tabKey = info?.tabKey ?? null;
              const tabLabel = tabKey ? TABS.find((t) => t.key === tabKey)?.label : null;
              return (
                <div
                  key={code}
                  onClick={() => tabKey && onNavigate(tabKey)}
                  className={[
                    "flex items-center justify-between px-3 py-2.5 rounded-lg border",
                    severity === "critical"
                      ? "border-red-200 bg-red-50"
                      : "border-amber-200 bg-amber-50",
                    tabKey ? "cursor-pointer hover:opacity-75 transition-opacity" : "",
                  ].join(" ")}
                >
                  <div>
                    <div className={`text-[11px] font-bold ${severity === "critical" ? "text-red-700" : "text-amber-700"}`}>
                      {code}
                    </div>
                    {info && (
                      <div className="text-[10px] text-[#666] mt-0.5">{info.label}</div>
                    )}
                    {/* Show relevant count if available */}
                    {code === "FREQUENT_ERRORS" && (
                      <div className="text-[10px] text-[#888] mt-0.5">7일 오류 {s.recent_error_count}건</div>
                    )}
                    {code === "GROWTH_REPORT_FAILURES" && (
                      <div className="text-[10px] text-[#888] mt-0.5">실패 {s.gr_failed_count}건 / 전체 {s.gr_total_count}건</div>
                    )}
                  </div>
                  {tabLabel && (
                    <span className="text-[11px] text-[#aaa] shrink-0 ml-3">→ {tabLabel}</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* ── 2. Access / X / Plan ── */}
      <Section title="Access / Plan">
        <Row
          label="BASE Effective"
          value={s.base_effective ? `ON (${s.base_source})` : "OFF"}
          valueClass={s.base_effective ? "text-green-700 font-semibold" : "text-[#aaa]"}
        />
        <Row
          label="X Effective"
          value={s.x_effective
            ? `ON (${s.x_source})${s.x_plan_key ? ` · ${s.x_plan_key.toUpperCase()}` : ""}`
            : "OFF"}
          valueClass={s.x_effective ? "text-[#002F5F] font-bold" : "text-[#aaa]"}
        />
        <Row
          label="Force Disabled"
          value={s.x_force_disabled}
          valueClass={s.x_force_disabled ? "text-red-600 font-bold" : "text-[#aaa]"}
        />
        <Row label="Member Limit" value={s.member_limit ?? "무제한"} />
        <Row label="Subscription" value={`${s.subscription_status}${s.subscription_tier ? ` / ${s.subscription_tier}` : ""}`} />
        <Row label="X Config Status" value={s.xmode_config_status} />
      </Section>

      {/* ── 3. 핵심 인원 ── */}
      <div className="grid grid-cols-3 gap-2">
        <StatCard label="활성 회원" value={s.active_members} sub={`전체 ${s.total_members}명`} color="navy" />
        <StatCard label="교사" value={s.teacher_count} color="gray" />
        <StatCard label="학부모" value={s.parent_count} color="gray" />
        <StatCard label="활성반" value={s.active_class_count} color="gray" />
        <StatCard label="AI 일지 (이번달)" value={s.recent_ai_diary_count} sub={s.recent_ai_month ?? ""} color="gray" />
        <StatCard label="GR 준비" value={s.gr_ready_count} sub={`실패 ${s.gr_failed_count}`} color={s.gr_failed_count > 0 ? "amber" : "gray"} />
      </div>

      {/* ── 4. Storage ── */}
      <Section title="Storage">
        <Row label="사용량" value={fmtBytes(s.used_storage_bytes)} />
        <Row
          label="업로드 차단"
          value={s.upload_blocked ? "차단됨 ⚠" : "정상"}
          valueClass={s.upload_blocked ? "text-red-600 font-bold" : "text-green-700"}
        />
        <Row label="미읽은 알림 (7d)" value={s.unread_notifications} valueClass={s.unread_notifications > 0 ? "text-amber-600" : "text-[#aaa]"} />
        <Row label="최근 오류 (7d)" value={s.recent_error_count} valueClass={s.recent_error_count > 5 ? "text-red-600" : "text-[#aaa]"} />
      </Section>

      {/* ── 5. 최근 지원 요청 ── */}
      <Section title="최근 지원 요청">
        {s.recent_support ? (
          <div
            onClick={() => onNavigate("support")}
            className="cursor-pointer hover:bg-[#f9fafb] -mx-2 px-2 py-1 rounded-lg transition-colors"
          >
            <Row label="Ticket ID" value={s.recent_support.ticket_id ?? s.recent_support.id.slice(0, 8)} />
            <Row label="상태" value={s.recent_support.state} valueClass="font-semibold" />
            <Row label="역할" value={s.recent_support.actor_role ?? "—"} />
            <Row label="생성일시" value={s.recent_support.created_at?.slice(0, 16).replace("T", " ")} />
            <div className="text-[10px] text-[#aaa] mt-1.5 text-right">클릭 → Support 탭</div>
          </div>
        ) : (
          <Empty text="최근 지원 요청 없음" />
        )}
      </Section>

      {/* ── 6. Pool 기본 식별 정보 ── */}
      <Section title="기본 정보">
        <Row label="pool_id" value={s.pool_id} />
        <Row label="수영장명" value={s.name} />
        <Row label="운영자" value={s.owner_name} />
        <Row label="승인 상태" value={s.approval_status} />
        <Row label="생성일" value={s.created_at?.slice(0, 10)} />
        <Row label="최근 업데이트" value={s.updated_at?.slice(0, 10)} />
      </Section>

    </div>
  );
}

function AccessTab({ s, poolId, onRefresh }: { s: Summary; poolId: string; onRefresh: () => void }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [plans, setPlans] = useState<XPlanDef[]>(X_PLANS_FALLBACK);

  // Modal states
  const [grantXModal, setGrantXModal] = useState(false);
  const [baseGrantModal, setBaseGrantModal] = useState(false);
  const [baseRevokeModal, setBaseRevokeModal] = useState(false);
  const [xRevokeModal, setXRevokeModal] = useState(false);
  const [forceDisableModal, setForceDisableModal] = useState(false);
  const [forceRestoreModal, setForceRestoreModal] = useState(false);
  const [limitModal, setLimitModal] = useState(false);

  // Loading states per action
  const [loadingBase, setLoadingBase] = useState(false);
  const [loadingX, setLoadingX] = useState(false);
  const [loadingForce, setLoadingForce] = useState(false);
  const [loadingLimit, setLoadingLimit] = useState(false);

  // Fetch plan catalog from server (authoritative)
  useEffect(() => {
    api.get<{ plans: XPlanDef[] }>("/super/plan-catalog")
      .then((r) => { if (r?.plans?.length) setPlans(r.plans); })
      .catch(() => {}); // fallback to X_PLANS_FALLBACK
  }, []);

  const showMsg = (ok: boolean, text: string) => setMsg({ ok, text });

  // ── BASE actions ──────────────────────────────────────────────
  const grantBase = useCallback(async (reason: string) => {
    setLoadingBase(true); setMsg(null);
    try {
      await api.patch(`/super/operators/${poolId}/base`, { base_manual_entitlement: true, reason });
      setBaseGrantModal(false); showMsg(true, "BASE SWIMNOTE 직접 부여 완료"); onRefresh();
    } catch (e: any) { showMsg(false, e?.data?.error || "부여 실패"); }
    setLoadingBase(false);
  }, [poolId, onRefresh]);

  const revokeBase = useCallback(async (reason: string) => {
    setLoadingBase(true); setMsg(null);
    try {
      await api.patch(`/super/operators/${poolId}/base`, { base_manual_entitlement: false, reason });
      setBaseRevokeModal(false); showMsg(true, "BASE SWIMNOTE 권한 회수 완료"); onRefresh();
    } catch (e: any) { showMsg(false, e?.data?.error || "회수 실패"); }
    setLoadingBase(false);
  }, [poolId, onRefresh]);

  // ── X actions ─────────────────────────────────────────────────
  const grantX = useCallback(async (plan: string, reason: string) => {
    setLoadingX(true); setMsg(null);
    try {
      await api.patch(`/super/operators/${poolId}/xmode`, {
        xmode_entitlement: true, xmode_config_status: "READY",
        x_plan_key: plan, bypass_readiness_check: true,
        reason: reason || `Super Admin X grant — ${plan}`,
      });
      setGrantXModal(false); showMsg(true, `X모드 직접 부여 완료 (${plan.toUpperCase()})`); onRefresh();
    } catch (e: any) { showMsg(false, e?.data?.error || "X 부여 실패"); }
    setLoadingX(false);
  }, [poolId, onRefresh]);

  const revokeX = useCallback(async (reason: string) => {
    setLoadingX(true); setMsg(null);
    try {
      await api.patch(`/super/operators/${poolId}/xmode`, { xmode_entitlement: false, x_plan_key: null, reason });
      setXRevokeModal(false); showMsg(true, "X모드 회수 완료"); onRefresh();
    } catch (e: any) { showMsg(false, e?.data?.error || "회수 실패"); }
    setLoadingX(false);
  }, [poolId, onRefresh]);

  // ── Force Disable / Restore ───────────────────────────────────
  const forceDisable = useCallback(async (reason: string) => {
    setLoadingForce(true); setMsg(null);
    try {
      await api.patch(`/super/operators/${poolId}/force-disable`, { disabled: true, reason });
      setForceDisableModal(false); showMsg(true, "X모드 강제 비활성화 완료"); onRefresh();
    } catch (e: any) { showMsg(false, e?.data?.error || "강제 비활성화 실패"); }
    setLoadingForce(false);
  }, [poolId, onRefresh]);

  const forceRestore = useCallback(async (reason: string) => {
    setLoadingForce(true); setMsg(null);
    try {
      await api.patch(`/super/operators/${poolId}/force-disable`, { disabled: false, reason });
      setForceRestoreModal(false); showMsg(true, "X모드 강제 비활성화 해제 완료"); onRefresh();
    } catch (e: any) { showMsg(false, e?.data?.error || "해제 실패"); }
    setLoadingForce(false);
  }, [poolId, onRefresh]);

  // ── Member Limit Override ─────────────────────────────────────
  const setMemberLimit = useCallback(async (limit: number | null, reason: string) => {
    setLoadingLimit(true); setMsg(null);
    try {
      await api.patch(`/super/operators/${poolId}/member-limit`, { member_limit: limit, reason });
      setLimitModal(false); showMsg(true, limit === null ? "회원 한도 Override 해제 완료" : `회원 한도 ${limit}명으로 설정 완료`); onRefresh();
    } catch (e: any) { showMsg(false, e?.data?.error || "설정 실패"); }
    setLoadingLimit(false);
  }, [poolId, onRefresh]);

  // ── Plan catalog helpers ──────────────────────────────────────
  const effectivePlan = s.x_plan_key ?? s.subscription_tier ?? null;
  const planDef = plans.find((p) => p.key === effectivePlan);
  const planMemberLimit = planDef?.memberLimit ?? null;

  // ── Feature control data ──────────────────────────────────────
  const features = [
    { label: "X 모드 Setup", value: s.xmode_config_status, control: "READ_ONLY" },
    { label: "AI 일지", value: s.x_effective ? "활성 (X 모드 기반)" : "비활성", control: "READ_ONLY" },
    { label: "성장리포트", value: s.x_effective ? "활성" : "비활성", control: "READ_ONLY" },
    { label: "스토리지 업로드", value: s.upload_blocked ? "차단됨 ⛔" : "정상", control: "READ_ONLY" },
  ] as const;

  const anyLoading = loadingBase || loadingX || loadingForce || loadingLimit;

  return (
    <div className="space-y-4">
      {msg && <Msg ok={msg.ok} text={msg.text} onClose={() => setMsg(null)} />}

      {/* ── 1. BASE SWIMNOTE ───────────────────────────────────── */}
      <Section title="BASE SWIMNOTE 이용권">
        <div className="grid grid-cols-3 gap-2 mb-3">
          <div className="bg-[#f9fafb] rounded-lg p-2 text-center">
            <div className={`text-[11px] font-bold ${s.base_paid ? "text-green-700" : "text-[#ccc]"}`}>{s.base_paid ? "ON" : "OFF"}</div>
            <div className="text-[10px] text-[#999] mt-0.5">Paid</div>
          </div>
          <div className="bg-[#f9fafb] rounded-lg p-2 text-center">
            <div className={`text-[11px] font-bold ${s.base_manual ? "text-purple-700" : "text-[#ccc]"}`}>{s.base_manual ? "ON" : "OFF"}</div>
            <div className="text-[10px] text-[#999] mt-0.5">Manual</div>
          </div>
          <div className="bg-[#f9fafb] rounded-lg p-2 text-center">
            <div className={`text-[12px] font-bold ${s.base_effective ? "text-green-700" : "text-red-500"}`}>{s.base_effective ? "ON" : "OFF"}</div>
            <div className="text-[10px] text-[#999] mt-0.5">Effective</div>
          </div>
        </div>
        <Row label="구독 상태" value={s.subscription_status} />
        <Row label="구독 플랜 (Billing)" value={s.subscription_tier ?? "—"} />
        <Row label="권한 출처" value={s.base_manual ? "슈퍼관리자 직접부여" : s.base_paid ? "결제" : "없음"}
          valueClass={s.base_manual ? "text-purple-700 font-bold" : s.base_paid ? "text-green-700" : "text-[#bbb]"} />
        <div className="mt-3 flex gap-2">
          <button onClick={() => setBaseGrantModal(true)} disabled={anyLoading || s.base_manual}
            className="px-3 py-1.5 text-[12px] font-semibold rounded bg-[#002F5F] text-white disabled:opacity-40">
            BASE 직접 부여
          </button>
          <button onClick={() => setBaseRevokeModal(true)} disabled={anyLoading || !s.base_manual}
            className="px-3 py-1.5 text-[12px] font-semibold rounded border border-red-300 text-red-600 disabled:opacity-40">
            BASE 권한 회수
          </button>
        </div>
      </Section>

      {/* ── 2. SWIMNOTE X ─────────────────────────────────────── */}
      <Section title="SWIMNOTE X 이용권">
        {s.x_force_disabled && (
          <div className="mb-3 px-3 py-2 bg-red-50 rounded-lg border border-red-200 text-[11px] text-red-700 font-semibold">
            ⛔ FORCE DISABLED — paid/manual entitlement 무관하게 X 모드 OFF
          </div>
        )}
        <div className="grid grid-cols-4 gap-1.5 mb-3">
          <div className="bg-[#f9fafb] rounded-lg p-2 text-center">
            <div className={`text-[11px] font-bold ${s.x_paid ? "text-green-700" : "text-[#ccc]"}`}>{s.x_paid ? "ON" : "OFF"}</div>
            <div className="text-[10px] text-[#999] mt-0.5">Paid</div>
          </div>
          <div className="bg-[#f9fafb] rounded-lg p-2 text-center">
            <div className={`text-[11px] font-bold ${s.x_manual ? "text-purple-700" : "text-[#ccc]"}`}>{s.x_manual ? "ON" : "OFF"}</div>
            <div className="text-[10px] text-[#999] mt-0.5">Manual</div>
          </div>
          <div className="bg-[#f9fafb] rounded-lg p-2 text-center">
            <div className={`text-[11px] font-bold ${s.x_force_disabled ? "text-red-600" : "text-[#ccc]"}`}>{s.x_force_disabled ? "ON" : "OFF"}</div>
            <div className="text-[10px] text-[#999] mt-0.5">Force Off</div>
          </div>
          <div className="bg-[#f9fafb] rounded-lg p-2 text-center">
            <div className={`text-[12px] font-bold ${s.x_effective ? "text-green-700" : "text-red-500"}`}>{s.x_effective ? "ON" : "OFF"}</div>
            <div className="text-[10px] text-[#999] mt-0.5">Effective</div>
          </div>
        </div>
        <Row label="권한 출처" value={s.x_manual ? "슈퍼관리자 직접부여" : s.x_paid ? "결제" : "없음"}
          valueClass={s.x_manual ? "text-purple-700 font-bold" : s.x_paid ? "text-green-700" : "text-[#bbb]"} />
        <Row label="Setup 상태" value={s.xmode_config_status} />
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={() => setGrantXModal(true)} disabled={anyLoading}
            className="px-3 py-1.5 text-[12px] font-semibold rounded bg-[#002F5F] text-white disabled:opacity-40">
            {s.x_manual ? "플랜 변경" : "X모드 직접 부여"}
          </button>
          {s.x_manual && (
            <button onClick={() => setXRevokeModal(true)} disabled={anyLoading}
              className="px-3 py-1.5 text-[12px] font-semibold rounded border border-red-300 text-red-600 disabled:opacity-40">
              X모드 회수
            </button>
          )}
          {!s.x_force_disabled ? (
            <button onClick={() => setForceDisableModal(true)} disabled={anyLoading}
              className="px-3 py-1.5 text-[12px] font-semibold rounded border border-red-400 bg-red-50 text-red-700 disabled:opacity-40">
              강제 비활성화
            </button>
          ) : (
            <button onClick={() => setForceRestoreModal(true)} disabled={anyLoading}
              className="px-3 py-1.5 text-[12px] font-semibold rounded border border-orange-400 bg-orange-50 text-orange-700 disabled:opacity-40">
              강제 비활성화 해제
            </button>
          )}
        </div>
      </Section>

      {/* ── 3. PLAN ───────────────────────────────────────────── */}
      <Section title="플랜 (Plan)">
        <Row label="Billing/Paid Plan" value={s.subscription_tier ?? "—"} />
        <Row label="Manual Plan Override" value={s.x_plan_key ? s.x_plan_key.toUpperCase() : "없음 (Override 없음)"}
          valueClass={s.x_plan_key ? "text-purple-700 font-bold" : "text-[#bbb]"} />
        <Row label="Effective Plan" value={effectivePlan ? effectivePlan.toUpperCase() : "—"}
          valueClass={effectivePlan ? "text-green-700 font-semibold" : "text-[#bbb]"} />
        <Row label="Plan 기본 회원 한도" value={planMemberLimit ? `${planMemberLimit.toLocaleString()}명` : "—"} />
        <div className="mt-3">
          <button onClick={() => setGrantXModal(true)} disabled={anyLoading}
            className="px-3 py-1.5 text-[12px] font-semibold rounded bg-[#002F5F] text-white disabled:opacity-40">
            플랜 변경
          </button>
        </div>
        <p className="text-[10px] text-[#bbb] mt-2">※ 플랜 변경 시 회원 한도도 catalog 기준으로 자동 갱신. 결제 없음.</p>
      </Section>

      {/* ── 4. MEMBER LIMIT ────────────────────────────────────── */}
      <Section title="회원 한도">
        <Row label="Plan 기본 한도" value={planMemberLimit ? `${planMemberLimit.toLocaleString()}명` : "—"} />
        <Row label="현재 DB 값 (Effective)" value={s.member_limit ? `${Number(s.member_limit).toLocaleString()}명` : "—"}
          valueClass={s.member_limit && s.member_limit !== planMemberLimit ? "text-purple-700 font-bold" : "text-[#111]"} />
        {s.member_limit && s.member_limit !== planMemberLimit && (
          <div className="text-[10px] text-purple-600 mt-1">🔵 Plan 기본값({planMemberLimit ?? "—"}명)과 다름 — Override 적용 중</div>
        )}
        <div className="mt-3 flex gap-2">
          <button onClick={() => setLimitModal(true)} disabled={anyLoading}
            className="px-3 py-1.5 text-[12px] font-semibold rounded bg-[#002F5F] text-white disabled:opacity-40">
            한도 Override
          </button>
        </div>
        <p className="text-[10px] text-[#bbb] mt-2">※ Override는 실제 회원등록 limit guard에 반영됩니다. UI 표시만 변경 아님.</p>
      </Section>

      {/* ── 5. FEATURE CONTROL ─────────────────────────────────── */}
      <Section title="기능 상태 (Feature Control)">
        <p className="text-[10px] text-[#aaa] mb-2">현재 WP: READ ONLY 표시. 제어 가능 기능은 추후 WP에서 연결됩니다.</p>
        {features.map((f) => (
          <div key={f.label} className="flex justify-between py-1.5 border-b border-[#f5f5f5] last:border-0">
            <span className="text-[11px] text-[#888]">{f.label}</span>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-medium text-[#111]">{f.value}</span>
              <span className="text-[9px] px-1 py-0.5 rounded bg-[#f3f4f6] text-[#999]">READ ONLY</span>
            </div>
          </div>
        ))}
      </Section>

      {/* ── Modals ─────────────────────────────────────────────── */}
      {baseGrantModal && (
        <ConfirmDangerModal
          title="BASE SWIMNOTE 직접 부여"
          description={`${s.name}에 BASE SWIMNOTE를 결제 없이 직접 부여합니다.\n감사 기록됩니다.`}
          confirmLabel="부여 확인"
          onConfirm={grantBase} onClose={() => setBaseGrantModal(false)} loading={loadingBase}
        />
      )}
      {baseRevokeModal && (
        <ConfirmDangerModal
          title="BASE SWIMNOTE 권한 회수"
          description={`${s.name}의 Manual BASE 이용권을 회수합니다.\nPaid 이용권이 유효하면 Effective BASE는 유지됩니다.`}
          confirmLabel="회수 확인"
          onConfirm={revokeBase} onClose={() => setBaseRevokeModal(false)} loading={loadingBase}
        />
      )}
      {xRevokeModal && (
        <ConfirmDangerModal
          title="X모드 Manual 권한 회수"
          description={`${s.name}의 Manual X 이용권을 회수합니다.\nPaid X가 유효하면 Effective X는 유지됩니다.`}
          confirmLabel="회수 확인"
          onConfirm={revokeX} onClose={() => setXRevokeModal(false)} loading={loadingX}
        />
      )}
      {forceDisableModal && (
        <ConfirmDangerModal
          title="⛔ X모드 강제 비활성화"
          description={`${s.name}의 X 모드를 강제 비활성화합니다.\nPaid/Manual 상태 무관하게 Effective X = OFF가 됩니다.\n실제 서비스에 즉시 영향을 미칩니다.`}
          confirmLabel="강제 비활성화"
          onConfirm={forceDisable} onClose={() => setForceDisableModal(false)} loading={loadingForce}
        />
      )}
      {forceRestoreModal && (
        <ConfirmDangerModal
          title="X모드 강제 비활성화 해제"
          description={`${s.name}의 강제 비활성화를 해제합니다.\nEntitlement(Paid/Manual) 기준으로 Effective X가 재계산됩니다.`}
          confirmLabel="해제 확인"
          onConfirm={forceRestore} onClose={() => setForceRestoreModal(false)} loading={loadingForce}
        />
      )}
      {grantXModal && (
        <GrantXModal
          current_plan={s.x_plan_key} plans={plans}
          onGrant={grantX} onClose={() => setGrantXModal(false)} loading={loadingX}
        />
      )}
      {limitModal && (
        <MemberLimitModal
          currentLimit={s.member_limit} planLimit={planMemberLimit}
          onSet={setMemberLimit} onClose={() => setLimitModal(false)} loading={loadingLimit}
        />
      )}
    </div>
  );
}

// ─────────────────── Detail Drawer ─────────────────────────────
function DetailDrawer({ title, onClose, loading, children }: {
  title: string; onClose: () => void; loading: boolean; children: React.ReactNode;
}) {
  return (
    <div className="mt-3 bg-[#f9fafb] border border-[#e5e7eb] rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[13px] font-semibold text-[#222]">{title}</span>
        <button onClick={onClose} className="text-[#aaa] hover:text-[#555] text-[18px] leading-none">×</button>
      </div>
      {loading ? <Spinner /> : children}
    </div>
  );
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="text-[10px] font-bold text-[#aaa] uppercase tracking-wide mb-1.5">{title}</div>
      {children}
    </div>
  );
}

function MiniList({ items, empty = "없음" }: { items: string[]; empty?: string }) {
  if (!items.length) return <div className="text-[11px] text-[#bbb]">{empty}</div>;
  return <div className="space-y-0.5">{items.map((t, i) => <div key={i} className="text-[11px] text-[#444]">{t}</div>)}</div>;
}

// ─────────────────── Members Tab ────────────────────────────────
function MembersTab({ poolId }: { poolId: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState<any>(null);
  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get<any>(`/super/pools/${poolId}/control-center/members?q=${encodeURIComponent(q)}&status=${status}`);
      setData(r);
    } catch (_) {}
    setLoading(false);
  }, [poolId, q, status]);

  useEffect(() => { load(); }, [load]);

  const openDetail = useCallback(async (row: any) => {
    setSelected(row); setDetail(null); setDetailLoading(true);
    try {
      const d = await api.get<any>(`/super/pools/${poolId}/control-center/members/${row.id}`);
      setDetail(d);
    } catch (_) {}
    setDetailLoading(false);
  }, [poolId]);

  const closeDetail = () => { setSelected(null); setDetail(null); };

  return (
    <div>
      <div className="flex gap-2 mb-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()}
          placeholder="이름/전화번호/ID 검색" className="flex-1 border border-[#e5e7eb] rounded-lg px-3 py-1.5 text-[12px] outline-none focus:border-[#002F5F]" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="border border-[#e5e7eb] rounded-lg px-2 py-1.5 text-[12px]">
          <option value="">전체 상태</option>
          <option value="active">재원</option>
          <option value="inactive">퇴원</option>
        </select>
        <button onClick={load} className="px-3 py-1.5 text-[12px] rounded-lg bg-[#002F5F] text-white font-medium">검색</button>
      </div>
      {loading ? <Spinner /> : !data ? <Err msg="데이터 로드 실패" /> : (
        <>
          <div className="text-[11px] text-[#888] mb-2">전체 {data.total}명 · 행 클릭 → 상세</div>
          <Table
            heads={["이름", "상태", "레벨", "반", "담당교사", "학부모", "최근일지"]}
            rows={data.members ?? []}
            render={(r, i) => (
              <tr key={r.id ?? i}
                className={`border-b border-[#f5f5f5] cursor-pointer ${selected?.id === r.id ? "bg-[#f0f4ff]" : "hover:bg-[#fafafa]"}`}
                onClick={() => selected?.id === r.id ? closeDetail() : openDetail(r)}>
                <td className="py-2 pr-3">
                  <div className="font-medium text-[#111]">{r.name}</div>
                  <div className="text-[10px] text-[#bbb]">{r.id?.slice(0, 8)}</div>
                </td>
                <td className="py-2 pr-3"><Badge color={r.status === "active" ? "green" : "gray"} text={r.status === "active" ? "재원" : "퇴원"} /></td>
                <td className="py-2 pr-3 text-[#666]">{r.current_level_order != null ? `Lv.${r.current_level_order}` : "—"}</td>
                <td className="py-2 pr-3">{r.class_name ?? "—"}</td>
                <td className="py-2 pr-3">{r.teacher_name ?? "—"}</td>
                <td className="py-2 pr-3">{Number(r.parent_count ?? 0)}</td>
                <td className="py-2">{r.last_diary_at ? r.last_diary_at.slice(0, 10) : "—"}</td>
              </tr>
            )}
          />
        </>
      )}
      {selected && (
        <DetailDrawer title={`회원 상세 — ${selected.name}`} onClose={closeDetail} loading={detailLoading}>
          {detail && (
            <div className="grid grid-cols-1 gap-4">
              <DetailSection title="Identity">
                <Row label="ID" value={detail.identity?.id} />
                <Row label="이름" value={detail.identity?.name} />
                <Row label="상태" value={detail.identity?.status} />
                <Row label="레벨" value={detail.identity?.current_level_order != null ? `${detail.identity.current_level_order}${detail.identity.level_name ? ` (${detail.identity.level_name})` : ""}` : "미지정"} />
                <Row label="전화번호" value={detail.identity?.phone ?? "—"} />
                <Row label="등록일" value={detail.identity?.created_at?.slice(0, 10)} />
                <Row label="최근 수정" value={detail.identity?.updated_at?.slice(0, 10)} />
              </DetailSection>
              <DetailSection title="수업 / 교사">
                {(detail.classes ?? []).length === 0
                  ? <div className="text-[11px] text-[#bbb]">현재 배정된 반 없음</div>
                  : (detail.classes ?? []).map((c: any) => (
                    <div key={c.id} className="flex justify-between py-1 border-b border-[#f5f5f5] last:border-0 text-[11px]">
                      <span className="font-medium">{c.class_name}</span>
                      <span className="text-[#888]">{c.teacher_name ?? "—"} · <Badge color={c.active ? "green" : "gray"} text={c.active ? "활성" : "비활성"} /></span>
                    </div>
                  ))}
              </DetailSection>
              <DetailSection title="연결 학부모">
                {(detail.parents ?? []).length === 0
                  ? <div className="text-[11px] text-[#bbb]">연결된 학부모 없음</div>
                  : (detail.parents ?? []).map((p: any) => (
                    <div key={p.id} className="flex justify-between py-1 border-b border-[#f5f5f5] last:border-0 text-[11px]">
                      <span className="font-medium">{p.name}</span>
                      <span className="text-[#888]">{p.approved_at ? <Badge color="green" text="승인" /> : <Badge color="gray" text="대기" />}</span>
                    </div>
                  ))}
              </DetailSection>
              <DetailSection title="최근 일지">
                <MiniList items={(detail.recent_diaries ?? []).map((d: any) =>
                  `${d.created_at?.slice(0, 10)} ${d.ai_generated ? "🤖 AI" : "✍️"}`)
                } empty="최근 일지 없음" />
              </DetailSection>
              <DetailSection title="최근 오류 (actor 기준)">
                <MiniList items={(detail.recent_errors ?? []).map((e: any) =>
                  `[${e.level}] ${e.category} — ${e.created_at?.slice(0, 10)}`)
                } empty="관련 오류 없음" />
              </DetailSection>
              <DetailSection title="최근 알림">
                <MiniList items={(detail.recent_notifications ?? []).map((n: any) =>
                  `${n.title} ${n.is_read ? "(읽음)" : "(미읽음)"} — ${n.created_at?.slice(0, 10)}`)
                } empty="관련 알림 없음" />
              </DetailSection>
              <DetailSection title="Support Actions">
                <div className="text-[11px] text-[#aaa] italic">
                  이 WP에서 노출한 mutation: 없음 (READ ONLY)
                  <br />SAFE TO EXPOSE: 상태변경(퇴원처리) — 기존 /admin API 존재, 다음 WP 연결 예정
                  <br />DO NOT EXPOSE: 계정 삭제, JWT 리셋, 비밀번호 변경
                </div>
              </DetailSection>
            </div>
          )}
        </DetailDrawer>
      )}
    </div>
  );
}

// ─────────────────── Teachers Tab ───────────────────────────────
function TeachersTab({ poolId }: { poolId: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<any>(null);
  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await api.get<any>(`/super/pools/${poolId}/control-center/teachers?q=${encodeURIComponent(q)}`)); } catch (_) {}
    setLoading(false);
  }, [poolId, q]);

  useEffect(() => { load(); }, [load]);

  const openDetail = useCallback(async (row: any) => {
    setSelected(row); setDetail(null); setDetailLoading(true);
    try { setDetail(await api.get<any>(`/super/pools/${poolId}/control-center/teachers/${row.id}`)); } catch (_) {}
    setDetailLoading(false);
  }, [poolId]);

  const closeDetail = () => { setSelected(null); setDetail(null); };

  return (
    <div>
      <div className="flex gap-2 mb-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()}
          placeholder="이름/이메일/ID" className="flex-1 border border-[#e5e7eb] rounded-lg px-3 py-1.5 text-[12px] outline-none focus:border-[#002F5F]" />
        <button onClick={load} className="px-3 py-1.5 text-[12px] rounded-lg bg-[#002F5F] text-white font-medium">검색</button>
      </div>
      {loading ? <Spinner /> : !data ? <Err msg="데이터 로드 실패" /> : (
        <>
          <div className="text-[11px] text-[#888] mb-2">{data.teachers?.length ?? 0}명 · 행 클릭 → 상세</div>
          <Table
            heads={["이름", "역할", "이메일", "최근 로그인", "담당반", "AI(30d)"]}
            rows={data.teachers ?? []}
            render={(r, i) => (
              <tr key={r.id ?? i}
                className={`border-b border-[#f5f5f5] cursor-pointer ${selected?.id === r.id ? "bg-[#f0f4ff]" : "hover:bg-[#fafafa]"}`}
                onClick={() => selected?.id === r.id ? closeDetail() : openDetail(r)}>
                <td className="py-2 pr-3 font-medium">{r.name}</td>
                <td className="py-2 pr-3"><Badge color={r.role === "pool_admin" ? "navy" : "blue"} text={r.role === "pool_admin" ? "관리자" : "교사"} /></td>
                <td className="py-2 pr-3 text-[#555]">{r.email}</td>
                <td className="py-2 pr-3">{r.last_login_at ? r.last_login_at.slice(0, 10) : "—"}</td>
                <td className="py-2 pr-3">{Number(r.active_class_count ?? 0)}</td>
                <td className="py-2">{Number(r.recent_ai_count ?? 0)}</td>
              </tr>
            )}
          />
        </>
      )}
      {selected && (
        <DetailDrawer title={`교사/관리자 상세 — ${selected.name}`} onClose={closeDetail} loading={detailLoading}>
          {detail && (
            <div className="grid grid-cols-1 gap-4">
              <DetailSection title="Account">
                <Row label="ID" value={detail.identity?.id} />
                <Row label="이름" value={detail.identity?.name} />
                <Row label="역할" value={detail.identity?.role} />
                <Row label="이메일" value={detail.identity?.email} />
                <Row label="최근 로그인" value={detail.identity?.last_login_at?.slice(0, 16) ?? "—"} />
                <Row label="가입일" value={detail.identity?.created_at?.slice(0, 10)} />
              </DetailSection>
              <DetailSection title="담당 반">
                {(detail.classes ?? []).length === 0
                  ? <div className="text-[11px] text-[#bbb]">담당 반 없음</div>
                  : (detail.classes ?? []).map((c: any) => (
                    <div key={c.id} className="flex justify-between py-1 border-b border-[#f5f5f5] last:border-0 text-[11px]">
                      <span className="font-medium">{c.name}</span>
                      <span className="text-[#888]">학생 {Number(c.student_count ?? 0)}명 · <Badge color={c.active ? "green" : "gray"} text={c.active ? "활성" : "비활성"} /></span>
                    </div>
                  ))}
              </DetailSection>
              <DetailSection title="최근 AI 일지 (10건)">
                <MiniList items={(detail.recent_ai_traces ?? []).map((t: any) =>
                  `${t.feature} [${t.status}] ${t.total_tokens ?? 0}tok — ${t.created_at?.slice(0, 10)}`)
                } empty="AI 활동 없음" />
              </DetailSection>
              <DetailSection title="최근 오류">
                <MiniList items={(detail.recent_errors ?? []).map((e: any) =>
                  `[${e.level}] ${e.category} — ${e.created_at?.slice(0, 10)}`)
                } empty="관련 오류 없음" />
              </DetailSection>
              <DetailSection title="Support Actions">
                <div className="text-[11px] text-[#aaa] italic">
                  이 WP에서 노출한 mutation: 없음 (READ ONLY)
                  <br />DO NOT EXPOSE: 비밀번호 리셋, JWT 발급, 역할 강등
                </div>
              </DetailSection>
            </div>
          )}
        </DetailDrawer>
      )}
    </div>
  );
}

// ─────────────────── Parents Tab ────────────────────────────────
function ParentsTab({ poolId }: { poolId: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<any>(null);
  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await api.get<any>(`/super/pools/${poolId}/control-center/parents?q=${encodeURIComponent(q)}`)); } catch (_) {}
    setLoading(false);
  }, [poolId, q]);

  useEffect(() => { load(); }, [load]);

  const openDetail = useCallback(async (row: any) => {
    setSelected(row); setDetail(null); setDetailLoading(true);
    try { setDetail(await api.get<any>(`/super/pools/${poolId}/control-center/parents/${row.id}`)); } catch (_) {}
    setDetailLoading(false);
  }, [poolId]);

  const closeDetail = () => { setSelected(null); setDetail(null); };

  return (
    <div>
      <div className="flex gap-2 mb-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()}
          placeholder="이름/전화번호" className="flex-1 border border-[#e5e7eb] rounded-lg px-3 py-1.5 text-[12px] outline-none focus:border-[#002F5F]" />
        <button onClick={load} className="px-3 py-1.5 text-[12px] rounded-lg bg-[#002F5F] text-white font-medium">검색</button>
      </div>
      {loading ? <Spinner /> : !data ? <Err msg="데이터 로드 실패" /> : (
        <>
          <div className="text-[11px] text-[#888] mb-2">전체 {data.total}명 · 행 클릭 → 상세</div>
          <Table
            heads={["이름", "전화번호", "승인", "연결학생", "최근 로그인"]}
            rows={data.parents ?? []}
            render={(r, i) => (
              <tr key={r.id ?? i}
                className={`border-b border-[#f5f5f5] cursor-pointer ${selected?.id === r.id ? "bg-[#f0f4ff]" : "hover:bg-[#fafafa]"}`}
                onClick={() => selected?.id === r.id ? closeDetail() : openDetail(r)}>
                <td className="py-2 pr-3 font-medium">{r.name}</td>
                <td className="py-2 pr-3 text-[#555]">{r.phone}</td>
                <td className="py-2 pr-3"><Badge color={r.approved_at ? "green" : "gray"} text={r.approved_at ? "승인" : "대기"} /></td>
                <td className="py-2 pr-3">{Number(r.linked_student_count ?? 0)}</td>
                <td className="py-2">{r.last_login_at ? r.last_login_at.slice(0, 10) : "—"}</td>
              </tr>
            )}
          />
        </>
      )}
      {selected && (
        <DetailDrawer title={`학부모 상세 — ${selected.name}`} onClose={closeDetail} loading={detailLoading}>
          {detail && (
            <div className="grid grid-cols-1 gap-4">
              <DetailSection title="Account">
                <Row label="ID" value={detail.identity?.id} />
                <Row label="이름" value={detail.identity?.name} />
                <Row label="전화번호" value={detail.identity?.phone} />
                <Row label="승인 여부" value={detail.identity?.approved_at ? `승인됨 (${detail.identity.approved_at.slice(0, 10)})` : "미승인"} />
                <Row label="최근 로그인" value={detail.identity?.last_login_at?.slice(0, 16) ?? "—"} />
                <Row label="가입일" value={detail.identity?.created_at?.slice(0, 10)} />
              </DetailSection>
              <DetailSection title="연결 자녀 (Connection Diagnostics)">
                {(detail.children ?? []).length === 0
                  ? <div className="text-[11px] text-[#bbb]">연결된 학생 없음</div>
                  : (detail.children ?? []).map((c: any) => (
                    <div key={c.id} className="py-1.5 border-b border-[#f5f5f5] last:border-0 text-[11px]">
                      <div className="flex justify-between">
                        <span className="font-medium">{c.name}</span>
                        <Badge color={c.status === "active" ? "green" : "gray"} text={c.status === "active" ? "재원" : "퇴원"} />
                      </div>
                      <div className="text-[10px] text-[#aaa] mt-0.5">반: {c.class_name ?? "—"} · 연결일: {c.linked_at?.slice(0, 10)}</div>
                    </div>
                  ))}
                <div className="mt-1.5 text-[10px] text-[#999]">
                  Connection states: {detail.connection_states?.approved ? "APPROVED" : "PENDING"} · 
                  학생 수: {detail.connection_states?.total_linked ?? 0}
                </div>
              </DetailSection>
              <DetailSection title="최근 알림">
                <MiniList items={(detail.recent_notifications ?? []).map((n: any) =>
                  `${n.title} ${n.is_read ? "(읽음)" : "(미읽음)"} — ${n.created_at?.slice(0, 10)}`)
                } empty="최근 알림 없음" />
              </DetailSection>
              <DetailSection title="최근 오류">
                <MiniList items={(detail.recent_errors ?? []).map((e: any) =>
                  `[${e.level}] ${e.category} — ${e.created_at?.slice(0, 10)}`)
                } empty="관련 오류 없음" />
              </DetailSection>
              <DetailSection title="Support Actions">
                <div className="text-[11px] text-[#aaa] italic">
                  이 WP에서 노출한 mutation: 없음 (READ ONLY)
                  <br />SAFE (다음 WP): connection 재승인, 연결 초대 재발송
                  <br />DO NOT EXPOSE: 연결 강제 삭제(데이터 손실 위험)
                </div>
              </DetailSection>
            </div>
          )}
        </DetailDrawer>
      )}
    </div>
  );
}

// ─────────────────── Classes Tab ────────────────────────────────
function ClassesTab({ poolId }: { poolId: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<any>(null);
  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await api.get<any>(`/super/pools/${poolId}/control-center/classes?q=${encodeURIComponent(q)}`)); } catch (_) {}
    setLoading(false);
  }, [poolId, q]);

  useEffect(() => { load(); }, [load]);

  const openDetail = useCallback(async (row: any) => {
    setSelected(row); setDetail(null); setDetailLoading(true);
    try { setDetail(await api.get<any>(`/super/pools/${poolId}/control-center/classes/${row.id}`)); } catch (_) {}
    setDetailLoading(false);
  }, [poolId]);

  const closeDetail = () => { setSelected(null); setDetail(null); };

  return (
    <div>
      <div className="flex gap-2 mb-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()}
          placeholder="반 이름 검색" className="flex-1 border border-[#e5e7eb] rounded-lg px-3 py-1.5 text-[12px] outline-none focus:border-[#002F5F]" />
        <button onClick={load} className="px-3 py-1.5 text-[12px] rounded-lg bg-[#002F5F] text-white font-medium">검색</button>
      </div>
      {loading ? <Spinner /> : !data ? <Err msg="데이터 로드 실패" /> : (
        <>
          <div className="text-[11px] text-[#888] mb-2">{data.classes?.length ?? 0}개 반 · 행 클릭 → 상세</div>
          <Table
            heads={["반명", "담당교사", "학생수", "상태"]}
            rows={data.classes ?? []}
            render={(r, i) => (
              <tr key={r.id ?? i}
                className={`border-b border-[#f5f5f5] cursor-pointer ${selected?.id === r.id ? "bg-[#f0f4ff]" : "hover:bg-[#fafafa]"}`}
                onClick={() => selected?.id === r.id ? closeDetail() : openDetail(r)}>
                <td className="py-2 pr-3 font-medium">{r.name}</td>
                <td className="py-2 pr-3">{r.teacher_name ?? "—"}</td>
                <td className="py-2 pr-3">{Number(r.student_count ?? 0)}</td>
                <td className="py-2"><Badge color={r.active ? "green" : "gray"} text={r.active ? "활성" : "비활성"} /></td>
              </tr>
            )}
          />
        </>
      )}
      {selected && (
        <DetailDrawer title={`반 상세 — ${selected.name}`} onClose={closeDetail} loading={detailLoading}>
          {detail && (
            <div className="grid grid-cols-1 gap-4">
              <DetailSection title="반 정보">
                <Row label="ID" value={detail.identity?.id} />
                <Row label="반명" value={detail.identity?.name} />
                <Row label="상태" value={detail.identity?.active ? "활성" : "비활성"} />
                <Row label="담당교사" value={detail.identity?.teacher_name ?? "—"} />
                <Row label="교사 이메일" value={detail.identity?.teacher_email ?? "—"} />
                <Row label="생성일" value={detail.identity?.created_at?.slice(0, 10)} />
              </DetailSection>
              <DetailSection title={`학생 (${(detail.students ?? []).length}명)`}>
                {(detail.students ?? []).length === 0
                  ? <div className="text-[11px] text-[#bbb]">배정된 학생 없음</div>
                  : (detail.students ?? []).map((s: any) => (
                    <div key={s.id} className="flex justify-between py-1 border-b border-[#f5f5f5] last:border-0 text-[11px]">
                      <span className="font-medium">{s.name}</span>
                      <span className="text-[#888]"><Badge color={s.status === "active" ? "green" : "gray"} text={s.status === "active" ? "재원" : "퇴원"} /></span>
                    </div>
                  ))}
              </DetailSection>
              {(detail.schedules ?? []).length > 0 && (
                <DetailSection title="스케줄">
                  <MiniList items={(detail.schedules ?? []).map((s: any) =>
                    `${["일","월","화","수","목","금","토"][s.day_of_week] ?? s.day_of_week} ${s.start_time}~${s.end_time}${s.room ? ` (${s.room})` : ""}`)
                  } />
                </DetailSection>
              )}
              {detail.curriculum && (
                <DetailSection title="커리큘럼 배정">
                  <Row label="패키지명" value={detail.curriculum.package_name} />
                  <Row label="버전" value={`v${detail.curriculum.package_version}`} />
                  <Row label="상태" value={detail.curriculum.package_status} />
                </DetailSection>
              )}
              <DetailSection title="최근 일지 (5건)">
                <MiniList items={(detail.recent_diaries ?? []).map((d: any) =>
                  `${d.student_name} — ${d.created_at?.slice(0, 10)} ${d.ai_generated ? "🤖" : "✍️"}`)
                } empty="최근 일지 없음" />
              </DetailSection>
            </div>
          )}
        </DetailDrawer>
      )}
    </div>
  );
}

// ─────────────────── Curriculum Tab ─────────────────────────────
function fmtBytes(b: number): string {
  if (b === 0) return "0 B";
  const units = ["B","KB","MB","GB"];
  const i = Math.floor(Math.log(b) / Math.log(1024));
  return `${(b / Math.pow(1024, i)).toFixed(1)} ${units[Math.min(i, 3)]}`;
}

function curriculumUiStatusColor(s: string): "green" | "amber" | "red" | "blue" | "gray" {
  if (s === "ACTIVE") return "green";
  if (s === "PROCESSING") return "blue";
  if (s === "REVISION_REQUESTED") return "amber";
  if (s === "UPLOADED") return "blue";
  if (s === "FAILED") return "red";
  return "gray";
}

function CurriculumTab({ poolId }: { poolId: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [selected, setSelected] = useState<any>(null);
  const [dlError, setDlError] = useState<string | null>(null);

  useEffect(() => {
    api.get<any>(`/super/pools/${poolId}/control-center/curriculum`)
      .then(setData).catch(() => {}).finally(() => setLoading(false));
  }, [poolId]);

  // Secure download — only file_id sent to server, server resolves r2_key (§28)
  const download = async (file: any) => {
    setDownloading(file.id);
    setDlError(null);
    try {
      const r = await api.get<any>(
        `/super/pools/${poolId}/control-center/curriculum/download?file_id=${encodeURIComponent(file.id)}`
      );
      const a = document.createElement("a");
      a.href = r.url;
      a.download = r.filename ?? file.original_filename ?? "curriculum.docx";
      a.target = "_blank";
      a.click();
    } catch (e: any) {
      const errCode = e?.data?.error ?? "";
      if (errCode === "FILE_NOT_FOUND" || errCode === "SOURCE_MISSING") {
        setDlError("원본 파일을 찾을 수 없습니다.");
      } else if (errCode === "CROSS_POOL_BLOCKED" || errCode === "FILE_NOT_OWNED") {
        setDlError("접근 권한이 없습니다.");
      } else {
        setDlError("다운로드 처리 중 오류가 발생했습니다.");
      }
    }
    setDownloading(null);
  };

  if (loading) return <Spinner />;
  if (!data) return <Err msg="데이터 로드 실패" />;

  const sub = data.submission;
  const files: any[] = data.files ?? [];
  const packages: any[] = data.packages ?? [];
  const currentFiles: Record<string, any> = data.current_files ?? {};
  const assignment = data.assignment ?? {};

  // Latest vs Active
  const latestCurriculum  = files.find((f: any) => f.file_type === "curriculum" && f.is_current);
  const latestWebsite     = files.find((f: any) => f.file_type === "website" && f.is_current);
  const activePackage     = packages[0] ?? null;

  return (
    <div className="space-y-5">
      {/* §5/§6 — Status + Latest vs Active */}
      <Section title="제출 상태 / 현재 버전">
        {!sub ? (
          <Empty text="이 수영장에서 제출한 커리큘럼 자료 없음" />
        ) : (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2 items-center">
              <Badge
                color={curriculumUiStatusColor(sub.curriculum_ui_status)}
                text={`커리큘럼: ${sub.curriculum_ui_status}`}
              />
              <Badge
                color={curriculumUiStatusColor(sub.curriculum_ui_status)}
                text={`웹사이트: ${sub.website_status}`}
              />
              {sub.submitted_at && (
                <span className="text-[11px] text-[#888]">제출일: {sub.submitted_at.slice(0, 10)}</span>
              )}
            </div>
            {/* Latest vs Active — §6 */}
            <div className="grid grid-cols-2 gap-3 mt-2">
              <div className="bg-white rounded-lg border border-[#e5e7eb] p-2.5">
                <div className="text-[10px] font-bold text-[#aaa] uppercase mb-1">최신 제출 (커리큘럼)</div>
                {latestCurriculum ? (
                  <>
                    <div className="text-[11px] font-medium truncate">{latestCurriculum.original_filename}</div>
                    <div className="text-[10px] text-[#aaa]">
                      v{latestCurriculum.submission_version} · {fmtBytes(Number(latestCurriculum.file_size_bytes ?? 0))}
                      · {latestCurriculum.uploaded_at?.slice(0, 10)}
                    </div>
                  </>
                ) : <div className="text-[11px] text-[#bbb]">없음</div>}
              </div>
              <div className="bg-white rounded-lg border border-[#e5e7eb] p-2.5">
                <div className="text-[10px] font-bold text-[#aaa] uppercase mb-1">현재 패키지 (적용)</div>
                {activePackage ? (
                  <>
                    <div className="text-[11px] font-medium truncate">{activePackage.package_name}</div>
                    <div className="text-[10px] text-[#aaa]">
                      v{activePackage.package_version} · {activePackage.generated_at?.slice(0, 10)}
                    </div>
                    <div className="text-[10px] text-[#888] mt-0.5">
                      Applied: <Badge color="green" text="YES" />
                    </div>
                  </>
                ) : (
                  <div className="text-[11px] text-[#bbb]">없음 — <Badge color="gray" text="NO" /></div>
                )}
              </div>
            </div>
            {/* Assignment summary — §7 */}
            <div className="flex gap-4 mt-1 text-[11px] text-[#555]">
              <span>배정 반: <strong>{assignment.assigned_class_count ?? 0}</strong></span>
              <span>배정 학생: <strong>{assignment.assigned_student_count ?? 0}</strong></span>
            </div>
          </div>
        )}
      </Section>

      {/* §4/§21 — File version history + row-click detail */}
      <Section title={`파일 버전 이력 (${files.length}건)`}>
        {files.length === 0 ? <Empty text="업로드된 파일 없음" /> : (
          <>
            {dlError && (
              <div className="mb-2 px-3 py-2 bg-red-50 border border-red-200 rounded text-[11px] text-red-700">
                {dlError}
              </div>
            )}
            <Table
              heads={["파일명", "유형", "크기", "버전", "상태", "업로드일", "다운로드"]}
              rows={files}
              render={(f: any, i: number) => (
                <tr key={f.id ?? i}
                  className={`border-b border-[#f5f5f5] cursor-pointer ${selected?.id === f.id ? "bg-[#f0f4ff]" : "hover:bg-[#fafafa]"}`}
                  onClick={() => setSelected(selected?.id === f.id ? null : f)}>
                  <td className="py-2 pr-3">
                    <div className="text-[11px] font-medium truncate max-w-[120px]">{f.original_filename}</div>
                    <div className="text-[10px] text-[#bbb]">{f.mime_type ?? "—"}</div>
                  </td>
                  <td className="py-2 pr-3">
                    <Badge color={f.file_type === "curriculum" ? "navy" : "blue"} text={f.file_type} />
                  </td>
                  <td className="py-2 pr-3 text-[11px]">{fmtBytes(Number(f.file_size_bytes ?? 0))}</td>
                  <td className="py-2 pr-3 text-[11px]">v{f.submission_version}</td>
                  <td className="py-2 pr-3">
                    {f.is_current
                      ? <Badge color="green" text="현재" />
                      : <Badge color="gray" text="이전" />}
                  </td>
                  <td className="py-2 pr-3 text-[11px]">{f.uploaded_at?.slice(0, 10)}</td>
                  <td className="py-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); download(f); }}
                      disabled={downloading === f.id}
                      className="px-2 py-1 text-[10px] rounded border border-[#002F5F] text-[#002F5F] hover:bg-[#f0f4ff] disabled:opacity-40">
                      {downloading === f.id ? "..." : "↓ 다운"}
                    </button>
                  </td>
                </tr>
              )}
            />
          </>
        )}
        {/* §21 — File detail drawer */}
        {selected && (
          <DetailDrawer title={`파일 상세 — ${selected.original_filename}`} onClose={() => setSelected(null)} loading={false}>
            <div className="grid grid-cols-1 gap-4">
              <DetailSection title="SOURCE">
                <Row label="파일명" value={selected.original_filename} />
                <Row label="MIME" value={selected.mime_type ?? "—"} />
                <Row label="크기" value={fmtBytes(Number(selected.file_size_bytes ?? 0))} />
                <Row label="업로드일" value={selected.uploaded_at?.slice(0, 16) ?? "—"} />
                <Row label="업로드 주체" value={selected.uploaded_by ?? "—"} />
                <Row label="Object 상태" value={selected.is_current ? "현재 활성" : "이전 버전"} />
              </DetailSection>
              <DetailSection title="PROCESSING">
                <Row label="제출 상태" value={sub?.curriculum_ui_status ?? "—"} />
                <Row label="원본 상태" value={sub?.curriculum_status ?? "—"} />
                <Row label="제출일" value={sub?.submitted_at?.slice(0, 10) ?? "—"} />
                <Row label="업데이트" value={sub?.updated_at?.slice(0, 10) ?? "—"} />
                {sub?.curriculum_status === "REVISION_REQUESTED" && (
                  <div className="mt-1 text-[11px] text-amber-700 bg-amber-50 rounded px-2 py-1">
                    ⚠️ 수정 요청됨 — 수영장에 수정 안내가 전달되었습니다.
                  </div>
                )}
              </DetailSection>
              <DetailSection title="VERSION">
                <Row label="파일 버전" value={`v${selected.submission_version}`} />
                <Row label="현재 활성" value={selected.is_current ? "YES" : "NO"} />
                <Row label="최신 패키지" value={activePackage ? `v${activePackage.package_version}` : "없음"} />
                <Row label="Applied" value={activePackage ? "YES" : "NO"} />
              </DetailSection>
              <DetailSection title="ASSIGNMENT">
                <Row label="배정 반" value={`${assignment.assigned_class_count ?? 0}개`} />
                <Row label="배정 학생" value={`${assignment.assigned_student_count ?? 0}명`} />
              </DetailSection>
              <DetailSection title="FILE — Secure Download">
                <div className="text-[11px] text-[#555] mb-2">
                  서버에서 5분 만료 서명 URL 생성 · 감사 로그 기록됨
                </div>
                <button
                  onClick={() => download(selected)}
                  disabled={downloading === selected.id}
                  className="px-3 py-1.5 text-[12px] rounded-lg bg-[#002F5F] text-white hover:bg-[#003d7a] disabled:opacity-40">
                  {downloading === selected.id ? "생성 중..." : "📄 원본 파일 다운로드 (서명 URL)"}
                </button>
                {dlError && <div className="mt-1.5 text-[11px] text-red-600">{dlError}</div>}
              </DetailSection>
            </div>
          </DetailDrawer>
        )}
      </Section>

      {/* §22 — Package history */}
      <Section title="패키지 이력">
        {packages.length === 0 ? <Empty text="패키지 없음" /> : (
          <Table
            heads={["버전", "패키지명", "소스 버전", "생성일"]}
            rows={packages}
            render={(r: any, i: number) => (
              <tr key={r.id ?? i} className="border-b border-[#f5f5f5]">
                <td className="py-2 pr-3 font-medium">v{r.package_version}</td>
                <td className="py-2 pr-3 text-[#555]">{r.package_name}</td>
                <td className="py-2 pr-3 text-[#888]">v{r.source_submission_version ?? "—"}</td>
                <td className="py-2">{r.generated_at?.slice(0, 10)}</td>
              </tr>
            )}
          />
        )}
      </Section>

      {/* §17/§24 — Error / Re-upload inventory */}
      <Section title="오류 관측성 / Action Inventory">
        <div className="text-[11px] text-[#888] space-y-1">
          <div>커리큘럼 처리 오류: <span className="font-medium">DB-backed</span> (curriculum_status 필드)</div>
          <div>파일 업로드 오류: <span className="font-medium">CONSOLE-only</span> → WP6에서 보강 예정</div>
          <div>R2 object 오류: <span className="font-medium">CONSOLE-only</span> → WP6에서 보강 예정</div>
          <div>Re-upload/Retry: 기존 x-setup.ts POST 존재, Super Admin 경유 노출은 LATER</div>
          <div>파일 삭제/Purge: 이번 WP 범위 외 (§23)</div>
        </div>
      </Section>
    </div>
  );
}

// ─── WP5 helpers ─────────────────────────────────────────────────────────────

/** YYYY-MM month selector — defaults to current month, lists up to 12 months back */
function MonthSelector({ value, onChange }: { value: string; onChange: (m: string) => void }) {
  const months: string[] = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="border border-[#e5e7eb] rounded-lg px-2 py-1.5 text-[12px] font-medium"
    >
      {months.map((m) => <option key={m} value={m}>{m}</option>)}
    </select>
  );
}

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function statusBadgeColor(s: string | null | undefined) {
  if (!s) return "gray";
  const u = s.toUpperCase();
  if (u === "SUCCESS" || u === "COMPLETE" || u === "COMPLETED" || u === "PUBLISHED" || u === "APPROVED") return "green";
  if (u === "FAILED" || u === "FAIL" || u === "ERROR") return "red";
  if (u === "RUNNING" || u === "ANALYZING" || u === "PREANALYZING") return "blue";
  if (u === "PENDING" || u === "NOT_OPEN" || u === "OPEN") return "gray";
  if (u === "PARTIAL") return "amber";
  if (u === "REVIEW_REQUIRED") return "amber";
  return "gray";
}

function KpiCard({ label, value, sub }: { label: string; value: string | number | null; sub?: string }) {
  return (
    <div className="bg-white rounded-xl border border-[#e5e7eb] px-4 py-3 min-w-[110px]">
      <div className="text-[11px] text-[#6b7280] mb-0.5">{label}</div>
      <div className="text-[20px] font-bold text-[#111827]">{value ?? "—"}</div>
      {sub && <div className="text-[10px] text-[#9ca3af] mt-0.5">{sub}</div>}
    </div>
  );
}

function TraceDrawer({ trace, onClose }: { trace: any; onClose: () => void }) {
  if (!trace) return null;
  const rows: [string, string][] = [
    ["request_id",  trace.request_id ?? "—"],
    ["feature",     trace.feature ?? "—"],
    ["status",      trace.status ?? "—"],
    ["model",       trace.model ?? "—"],
    ["pool_mode",   trace.pool_mode ?? "—"],
    ["total_tokens", trace.total_tokens != null ? String(trace.total_tokens) : "—"],
    ["latency_ms",  trace.latency_ms != null ? `${trace.latency_ms}ms` : "—"],
    ["cost (USD)",  trace.total_cost_usd != null ? `$${Number(trace.total_cost_usd).toFixed(6)}` : "NOT AVAILABLE"],
    ["error_stage", trace.error_stage ?? "—"],
    ["error_code",  trace.error_code ?? "—"],
    ["actor_id",    trace.actor_id ?? "—"],
    ["created_at",  trace.created_at?.slice?.(0, 19) ?? "—"],
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <div className="relative w-[420px] h-full bg-white shadow-2xl overflow-y-auto p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[14px] font-semibold text-[#111827]">AI Trace 상세</h3>
          <button onClick={onClose} className="text-[#6b7280] text-[12px] hover:text-[#111]">✕ 닫기</button>
        </div>
        <dl className="space-y-2">
          {rows.map(([k, v]) => (
            <div key={k} className="flex gap-2 text-[12px]">
              <dt className="w-[120px] text-[#6b7280] shrink-0">{k}</dt>
              <dd className="text-[#111827] break-all font-mono">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-[10px] text-[#9ca3af]">※ prompt 원문·LLM 응답·민감 사용자 입력은 표시하지 않습니다.</p>
      </div>
    </div>
  );
}

function ReportDrawer({ report, poolId, onClose }: { report: any; poolId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<any>(null);
  const [loadingDetail, setLoadingDetail] = useState(true);
  useEffect(() => {
    setLoadingDetail(true);
    api.get<any>(`/super/pools/${poolId}/control-center/growth/reports/${report.id}`)
      .then(setDetail).catch(() => {}).finally(() => setLoadingDetail(false));
  }, [report.id, poolId]);

  const ps = report.product_status ?? "";
  const statusColor = statusBadgeColor(ps);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <div className="relative w-[480px] h-full bg-white shadow-2xl overflow-y-auto p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[14px] font-semibold text-[#111827]">리포트 상세</h3>
          <button onClick={onClose} className="text-[#6b7280] text-[12px] hover:text-[#111]">✕ 닫기</button>
        </div>
        {/* Summary */}
        <div className="bg-[#f9fafb] rounded-xl p-4 mb-4 space-y-1.5 text-[12px]">
          <div className="flex gap-2"><span className="text-[#6b7280] w-[110px]">학생</span><span className="font-medium">{report.student_name ?? report.student_id?.slice(0, 12)}</span></div>
          <div className="flex gap-2"><span className="text-[#6b7280] w-[110px]">기간</span><span className="font-medium">{report.report_period ?? "—"}</span></div>
          <div className="flex gap-2"><span className="text-[#6b7280] w-[110px]">상태</span><Badge color={statusColor} text={ps || "—"} /></div>
          <div className="flex gap-2"><span className="text-[#6b7280] w-[110px]">분석 상태</span><span>{report.analysis_status ?? "—"}</span></div>
          <div className="flex gap-2"><span className="text-[#6b7280] w-[110px]">재분석 수</span><span>{report.analysis_retry_count ?? 0}</span></div>
          <div className="flex gap-2"><span className="text-[#6b7280] w-[110px]">교사 검토</span><span>{report.teacher_review_action ?? "—"}</span></div>
          <div className="flex gap-2"><span className="text-[#6b7280] w-[110px]">발행</span><span>{report.published_at?.slice(0, 16) ?? "—"}</span></div>
          <div className="flex gap-2"><span className="text-[#6b7280] w-[110px]">폐기</span><span className={report.discarded_at ? "text-[#dc2626]" : ""}>{report.discarded_at?.slice(0, 16) ?? "—"}</span></div>
          <div className="flex gap-2"><span className="text-[#6b7280] w-[110px]">request_id</span><span className="font-mono text-[10px] break-all">{report.analysis_request_id ?? "—"}</span></div>
          <div className="flex gap-2"><span className="text-[#6b7280] w-[110px]">생성</span><span>{report.created_at?.slice(0, 16) ?? "—"}</span></div>
        </div>

        {loadingDetail ? <Spinner /> : detail && (
          <>
            {/* Version History */}
            {detail.version_history?.length > 1 && (
              <div className="mb-4">
                <p className="text-[12px] font-semibold mb-2 text-[#374151]">버전 히스토리 ({detail.version_history.length}건)</p>
                <div className="space-y-1">
                  {detail.version_history.map((v: any, i: number) => (
                    <div key={v.id} className="flex items-center gap-2 text-[11px] bg-[#f9fafb] rounded px-3 py-1.5">
                      <span className="text-[#6b7280] w-4">v{i + 1}</span>
                      <Badge color={statusBadgeColor(v.product_status)} text={v.product_status ?? "—"} />
                      <span className="text-[#6b7280]">{v.created_at?.slice(0, 10)}</span>
                      {v.published_at && <span className="text-green-600">📤 발행</span>}
                      {v.discarded_at && <span className="text-red-500">🗑 폐기</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* Cycle */}
            {detail.cycle && (
              <div className="mb-4">
                <p className="text-[12px] font-semibold mb-2 text-[#374151]">사이클</p>
                <dl className="space-y-1 text-[11px]">
                  {[
                    ["기간", detail.cycle.report_period],
                    ["상태", detail.cycle.cycle_status],
                    ["분석 마감", detail.cycle.analysis_cutoff_at?.slice(0, 10)],
                    ["학부모 입력 마감", detail.cycle.parent_input_close_at?.slice(0, 10)],
                  ].map(([k, v]) => v && (
                    <div key={k} className="flex gap-2">
                      <dt className="w-[110px] text-[#6b7280]">{k}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </>
        )}
        <p className="mt-4 text-[10px] text-[#9ca3af]">※ report_content는 표시하지 않습니다 (metadata/diagnostics only)</p>
      </div>
    </div>
  );
}

// ─── AiTab ───────────────────────────────────────────────────────────────────
function AiTab({ poolId }: { poolId: string }) {
  const [month, setMonth] = useState(currentMonth);
  const [summary, setSummary] = useState<any>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [diaryData, setDiaryData] = useState<any>(null);
  const [curriculumData, setCurriculumData] = useState<any>(null);
  const [tracesData, setTracesData] = useState<any>(null);
  const [subLoading, setSubLoading] = useState(false);
  const [selectedTrace, setSelectedTrace] = useState<any>(null);
  const [searchId, setSearchId] = useState("");
  const [searchResult, setSearchResult] = useState<any>(null);
  const [searching, setSearching] = useState(false);
  const [diaryPage, setDiaryPage] = useState(0);
  const [currPage, setCurrPage] = useState(0);
  const [tracePage, setTracePage] = useState(0);
  const PAGE = 20;

  const loadSummary = useCallback(() => {
    setSummaryLoading(true);
    api.get<any>(`/super/pools/${poolId}/control-center/ai?month=${month}`)
      .then(setSummary).catch(() => setSummary(null)).finally(() => setSummaryLoading(false));
  }, [poolId, month]);

  const loadSub = useCallback(async () => {
    setSubLoading(true);
    await Promise.all([
      api.get<any>(`/super/pools/${poolId}/control-center/ai/diary?month=${month}&limit=${PAGE}&offset=${diaryPage * PAGE}`)
        .then(setDiaryData).catch(() => setDiaryData(null)),
      api.get<any>(`/super/pools/${poolId}/control-center/ai/curriculum?month=${month}&limit=${PAGE}&offset=${currPage * PAGE}`)
        .then(setCurriculumData).catch(() => setCurriculumData(null)),
      api.get<any>(`/super/pools/${poolId}/control-center/ai/traces?month=${month}&limit=${PAGE}&offset=${tracePage * PAGE}`)
        .then(setTracesData).catch(() => setTracesData(null)),
    ]);
    setSubLoading(false);
  }, [poolId, month, diaryPage, currPage, tracePage]);

  useEffect(() => { loadSummary(); }, [loadSummary]);
  useEffect(() => { loadSub(); }, [loadSub]);

  const snap = summary?.snapshots?.find((s: any) => s.year === parseInt(month.slice(0, 4)) && s.month === parseInt(month.slice(5, 7)));
  const raw  = summary?.raw_recount;

  const handleSearch = async () => {
    if (!searchId.trim()) return;
    setSearching(true);
    try {
      const r = await api.get<any>(`/super/pools/${poolId}/control-center/ai/search?request_id=${encodeURIComponent(searchId.trim())}`);
      setSearchResult(r);
    } catch { setSearchResult({ error: true }); }
    setSearching(false);
  };

  return (
    <div className="space-y-5">
      {selectedTrace && <TraceDrawer trace={selectedTrace} onClose={() => setSelectedTrace(null)} />}

      {/* Month selector */}
      <div className="flex items-center gap-3">
        <span className="text-[12px] text-[#6b7280] font-medium">조회 월:</span>
        <MonthSelector value={month} onChange={(m) => { setMonth(m); setDiaryPage(0); setCurrPage(0); setTracePage(0); }} />
        <button onClick={() => { loadSummary(); loadSub(); }} className="px-3 py-1.5 text-[11px] rounded-lg bg-[#002F5F] text-white font-medium">새로고침</button>
      </div>

      {/* Summary KPIs */}
      {summaryLoading ? <Spinner /> : (
        <div>
          <div className="flex flex-wrap gap-3 mb-3">
            <KpiCard label="AI 일지 (Snap)" value={snap?.ai_diary_count ?? 0} sub="snapshot" />
            <KpiCard label="AI 교사 수 (Snap)" value={snap?.ai_diary_teacher_count ?? 0} sub="snapshot" />
            <KpiCard label="학부모 검색 (Snap)" value={snap?.parent_curriculum_search_count ?? 0} sub="snapshot" />
            <KpiCard label="학부모 사용자 (Snap)" value={snap?.parent_curriculum_user_count ?? 0} sub="snapshot" />
          </div>
          {raw && (
            <div className="text-[11px] text-[#6b7280] bg-[#f9fafb] rounded-lg px-3 py-2 flex flex-wrap gap-4">
              <span>▶ Raw재집계 ({raw.month}): AI일지 <b>{raw.ai_diary_count ?? "—"}</b> / 교사 <b>{raw.ai_diary_teacher_count ?? "—"}</b> / 학부모검색 <b>{raw.curriculum_search_count ?? "—"}</b> / 학부모 <b>{raw.curriculum_unique_parents ?? "—"}</b></span>
            </div>
          )}
        </div>
      )}

      {/* Request ID Search */}
      <Section title="Request ID 조회">
        <div className="flex gap-2 mb-3">
          <input
            value={searchId}
            onChange={(e) => setSearchId(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="request_id (exact)"
            className="flex-1 border border-[#e5e7eb] rounded-lg px-3 py-1.5 text-[12px] font-mono"
          />
          <button
            onClick={handleSearch}
            disabled={searching}
            className="px-3 py-1.5 text-[11px] rounded-lg bg-[#002F5F] text-white font-medium disabled:opacity-50"
          >
            {searching ? "검색중…" : "조회"}
          </button>
        </div>
        {searchResult && (
          <div className="text-[11px] space-y-2">
            {searchResult.error ? <p className="text-red-500">조회 실패</p> : (
              <>
                <p className="text-[#6b7280]">traces: {searchResult.traces?.length ?? 0}건 / 연결 일지: {searchResult.linked_diaries?.length ?? 0}건 / 연결 리포트: {searchResult.linked_reports?.length ?? 0}건</p>
                {searchResult.traces?.map((t: any) => (
                  <div key={t.id} className="bg-[#f9fafb] rounded px-3 py-2 cursor-pointer hover:bg-[#f0f0f0]" onClick={() => setSelectedTrace(t)}>
                    <span className="font-medium">{t.feature}</span>
                    <Badge color={statusBadgeColor(t.status)} text={t.status ?? "—"} />
                    <span className="text-[#6b7280] ml-2">{t.created_at?.slice(0, 16)}</span>
                    <span className="text-[#6b7280] ml-2">{t.total_tokens != null ? `${t.total_tokens} tok` : ""}</span>
                  </div>
                ))}
                {searchResult.linked_diaries?.map((d: any) => (
                  <div key={d.id} className="bg-[#f0fdf4] rounded px-3 py-2 text-[11px]">
                    📓 일지 — {d.class_name ?? "—"} / {d.teacher_name ?? "—"} / {d.created_at?.slice(0, 16)}
                  </div>
                ))}
                {searchResult.linked_reports?.map((r: any) => (
                  <div key={r.id} className="bg-[#eff6ff] rounded px-3 py-2 text-[11px]">
                    📊 리포트 — {r.student_name ?? r.student_id?.slice(0, 8)} / {r.report_period} / <Badge color={statusBadgeColor(r.product_status)} text={r.product_status ?? "—"} />
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </Section>

      {/* AI Diary Recent */}
      <Section title={`AI 일지 최근 요청 (${month})`}>
        {subLoading ? <Spinner /> : !diaryData ? <Err msg="로드 실패" /> : diaryData.rows?.length === 0 ? (
          <p className="text-[12px] text-[#6b7280] py-4 text-center">이 기간 AI 일지 없음</p>
        ) : (
          <>
            <Table
              heads={["시각", "교사", "수업", "Request ID", "상태", "모델", "토큰", "지연"]}
              rows={diaryData.rows}
              render={(r: any, i: number) => (
                <tr key={r.id ?? i} className="border-b border-[#f5f5f5] cursor-pointer hover:bg-[#f9fafb]"
                    onClick={() => r.trace_status && setSelectedTrace({ ...r, feature: "ai_diary", status: r.trace_status })}>
                  <td className="py-2 pr-2 text-[11px]">{r.created_at?.slice(0, 16)}</td>
                  <td className="py-2 pr-2 text-[11px]">{r.teacher_name ?? "—"}</td>
                  <td className="py-2 pr-2 text-[11px]">{r.class_name ?? "—"}</td>
                  <td className="py-2 pr-2 text-[10px] font-mono text-[#6b7280]">{r.request_id ? r.request_id.slice(0, 12) + "…" : "—"}</td>
                  <td className="py-2 pr-2"><Badge color={r.trace_status === "SUCCESS" ? "green" : r.trace_status ? "red" : "gray"} text={r.trace_status ?? "기록없음"} /></td>
                  <td className="py-2 pr-2 text-[11px]">{r.model ?? "—"}</td>
                  <td className="py-2 pr-2 text-[11px]">{r.total_tokens ?? "—"}</td>
                  <td className="py-2 text-[11px]">{r.latency_ms != null ? `${r.latency_ms}ms` : "—"}</td>
                </tr>
              )}
            />
            <div className="flex justify-between items-center mt-2 text-[11px] text-[#6b7280]">
              <span>총 {diaryData.total}건</span>
              <div className="flex gap-2">
                <button disabled={diaryPage === 0} onClick={() => setDiaryPage(p => p - 1)} className="px-2 py-1 rounded border disabled:opacity-40">◀</button>
                <span>p.{diaryPage + 1}</span>
                <button disabled={(diaryPage + 1) * PAGE >= diaryData.total} onClick={() => setDiaryPage(p => p + 1)} className="px-2 py-1 rounded border disabled:opacity-40">▶</button>
              </div>
            </div>
          </>
        )}
      </Section>

      {/* Parent Curriculum Recent */}
      <Section title={`학부모 커리큘럼 검색 (${month})`}>
        {subLoading ? <Spinner /> : !curriculumData ? <Err msg="로드 실패" /> : curriculumData.rows?.length === 0 ? (
          <p className="text-[12px] text-[#6b7280] py-4 text-center">이 기간 검색 기록 없음</p>
        ) : (
          <>
            <Table
              heads={["시각", "학부모 ID", "Request ID", "상태", "토큰", "지연", "오류"]}
              rows={curriculumData.rows}
              render={(r: any, i: number) => (
                <tr key={r.id ?? i} className="border-b border-[#f5f5f5] cursor-pointer hover:bg-[#f9fafb]"
                    onClick={() => setSelectedTrace({ ...r, feature: r.feature ?? "parent_curriculum_search" })}>
                  <td className="py-2 pr-2 text-[11px]">{(r.created_at ?? "").slice(0, 16)}</td>
                  <td className="py-2 pr-2 text-[10px] font-mono text-[#6b7280]">{r.actor_id ? r.actor_id.slice(0, 12) + "…" : "—"}</td>
                  <td className="py-2 pr-2 text-[10px] font-mono text-[#6b7280]">{r.request_id ? r.request_id.slice(0, 12) + "…" : "—"}</td>
                  <td className="py-2 pr-2"><Badge color={statusBadgeColor(r.status)} text={r.status ?? "—"} /></td>
                  <td className="py-2 pr-2 text-[11px]">{r.total_tokens ?? "—"}</td>
                  <td className="py-2 pr-2 text-[11px]">{r.latency_ms != null ? `${r.latency_ms}ms` : "—"}</td>
                  <td className="py-2 text-[11px] text-[#dc2626]">{r.error_code ?? ""}</td>
                </tr>
              )}
            />
            <div className="flex justify-between items-center mt-2 text-[11px] text-[#6b7280]">
              <span>총 {curriculumData.total}건 (query 원문 미표시 — PII 최소화)</span>
              <div className="flex gap-2">
                <button disabled={currPage === 0} onClick={() => setCurrPage(p => p - 1)} className="px-2 py-1 rounded border disabled:opacity-40">◀</button>
                <span>p.{currPage + 1}</span>
                <button disabled={(currPage + 1) * PAGE >= curriculumData.total} onClick={() => setCurrPage(p => p + 1)} className="px-2 py-1 rounded border disabled:opacity-40">▶</button>
              </div>
            </div>
          </>
        )}
      </Section>

      {/* All AI Traces */}
      <Section title={`AI Traces (${month}) — event_logs category=AI`}>
        {subLoading ? <Spinner /> : !tracesData ? <Err msg="로드 실패" /> : tracesData.rows?.length === 0 ? (
          <p className="text-[12px] text-[#6b7280] py-4 text-center">이 기간 AI 호출 기록 없음</p>
        ) : (
          <>
            <Table
              heads={["기능", "상태", "모델", "토큰", "지연", "오류", "시각"]}
              rows={tracesData.rows}
              render={(r: any, i: number) => (
                <tr key={r.id ?? i} className="border-b border-[#f5f5f5] cursor-pointer hover:bg-[#f9fafb]"
                    onClick={() => setSelectedTrace(r)}>
                  <td className="py-2 pr-2 text-[11px] font-medium">{r.feature ?? "—"}</td>
                  <td className="py-2 pr-2"><Badge color={statusBadgeColor(r.status)} text={r.status ?? "—"} /></td>
                  <td className="py-2 pr-2 text-[11px]">{r.model ?? "—"}</td>
                  <td className="py-2 pr-2 text-[11px]">{r.total_tokens ?? "—"}</td>
                  <td className="py-2 pr-2 text-[11px]">{r.latency_ms != null ? `${r.latency_ms}ms` : "—"}</td>
                  <td className="py-2 pr-2 text-[11px] text-[#dc2626]">{r.error_code ?? ""}</td>
                  <td className="py-2 text-[11px]">{(r.created_at ?? "").slice(0, 16)}</td>
                </tr>
              )}
            />
            <div className="flex justify-between items-center mt-2 text-[11px] text-[#6b7280]">
              <span>총 {tracesData.total}건 (prompt/응답 원문 미표시)</span>
              <div className="flex gap-2">
                <button disabled={tracePage === 0} onClick={() => setTracePage(p => p - 1)} className="px-2 py-1 rounded border disabled:opacity-40">◀</button>
                <span>p.{tracePage + 1}</span>
                <button disabled={(tracePage + 1) * PAGE >= tracesData.total} onClick={() => setTracePage(p => p + 1)} className="px-2 py-1 rounded border disabled:opacity-40">▶</button>
              </div>
            </div>
          </>
        )}
      </Section>
    </div>
  );
}

// ─── GrowthTab (replaces GrowthReportsTab) ────────────────────────────────────
function GrowthReportsTab({ poolId }: { poolId: string }) {
  const [month, setMonth] = useState(currentMonth);
  const [summaryData, setSummaryData] = useState<any>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [reportsData, setReportsData] = useState<any>(null);
  const [batchData, setBatchData] = useState<any>(null);
  const [cyclesData, setCyclesData] = useState<any>(null);
  const [subLoading, setSubLoading] = useState(false);
  const [selectedReport, setSelectedReport] = useState<any>(null);
  const [reportPage, setReportPage] = useState(0);
  const [batchPage, setBatchPage] = useState(0);
  const PAGE = 20;

  const loadSummary = useCallback(() => {
    setSummaryLoading(true);
    api.get<any>(`/super/pools/${poolId}/control-center/growth?month=${month}`)
      .then(setSummaryData).catch(() => setSummaryData(null)).finally(() => setSummaryLoading(false));
  }, [poolId, month]);

  const loadSub = useCallback(async () => {
    setSubLoading(true);
    await Promise.all([
      api.get<any>(`/super/pools/${poolId}/control-center/growth/reports?month=${month}&limit=${PAGE}&offset=${reportPage * PAGE}`)
        .then(setReportsData).catch(() => setReportsData(null)),
      api.get<any>(`/super/pools/${poolId}/control-center/growth/batch-jobs?month=${month}&limit=${PAGE}&offset=${batchPage * PAGE}`)
        .then(setBatchData).catch(() => setBatchData(null)),
      api.get<any>(`/super/pools/${poolId}/control-center/growth/cycles?limit=12`)
        .then(setCyclesData).catch(() => setCyclesData(null)),
    ]);
    setSubLoading(false);
  }, [poolId, month, reportPage, batchPage]);

  useEffect(() => { loadSummary(); }, [loadSummary]);
  useEffect(() => { loadSub(); }, [loadSub]);

  const snap = summaryData?.snapshot;
  const raw  = summaryData?.raw_count;
  const jobs = summaryData?.batch_jobs ?? [];
  const autoBatchEnabled: boolean | null = summaryData?.auto_batch_enabled ?? null;

  return (
    <div className="space-y-5">
      {selectedReport && <ReportDrawer report={selectedReport} poolId={poolId} onClose={() => setSelectedReport(null)} />}

      {/* Month selector */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-[12px] text-[#6b7280] font-medium">조회 월:</span>
        <MonthSelector value={month} onChange={(m) => { setMonth(m); setReportPage(0); setBatchPage(0); }} />
        {autoBatchEnabled != null && (
          <span className={`text-[11px] px-2 py-1 rounded font-medium ${autoBatchEnabled ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"}`}>
            Auto Batch: {autoBatchEnabled ? "ENABLED" : "DISABLED"} (Global)
          </span>
        )}
        <button onClick={() => { loadSummary(); loadSub(); }} className="px-3 py-1.5 text-[11px] rounded-lg bg-[#002F5F] text-white font-medium">새로고침</button>
      </div>

      {/* Summary KPIs */}
      {summaryLoading ? <Spinner /> : (
        <div>
          <div className="flex flex-wrap gap-3 mb-3">
            <KpiCard label="대상 (Raw)" value={raw?.total_targeted ?? snap?.growth_report_target_count ?? 0} />
            <KpiCard label="생성됨 (Raw)" value={raw?.generated_count ?? snap?.growth_report_generated_count ?? 0} />
            <KpiCard label="실패 (Raw)" value={raw?.failed_count ?? snap?.growth_report_failed_count ?? 0} />
            <KpiCard label="발행 (Raw)" value={raw?.published_count ?? 0} />
            <KpiCard label="발송 (Snap)" value={snap?.growth_report_sent_count ?? 0} sub="snapshot" />
            <KpiCard label="폐기 (Raw)" value={raw?.discarded_count ?? 0} />
            <KpiCard label="진행중 (Raw)" value={raw?.in_progress_count ?? 0} />
          </div>
          {raw && snap && (
            <div className="text-[10px] text-[#9ca3af] bg-[#f9fafb] rounded-lg px-3 py-2">
              ※ Raw재집계는 실제 DB 기준. Snapshot과 차이 발생 시 정기 UPSERT를 확인하세요.
            </div>
          )}
        </div>
      )}

      {/* Batch Job Quick Summary */}
      {jobs.length > 0 && (
        <div>
          <p className="text-[12px] font-semibold text-[#374151] mb-2">{month} 배치 작업 ({jobs.length}건)</p>
          <div className="flex flex-wrap gap-2">
            {jobs.map((j: any) => (
              <div key={j.id} className={`rounded-xl border px-3 py-2 text-[11px] min-w-[150px] ${j.is_stuck ? "border-red-400 bg-red-50" : "border-[#e5e7eb] bg-white"}`}>
                <div className="flex items-center gap-1 mb-1">
                  <Badge color={statusBadgeColor(j.status)} text={j.status} />
                  {j.is_stuck && <span className="text-[10px] text-red-600 font-bold">⚠ STUCK</span>}
                </div>
                <div className="text-[#6b7280]">{j.job_type}</div>
                <div>대상 {j.target_count ?? "—"} / 완료 {j.completed_count ?? 0} / 실패 {j.failed_count ?? 0}</div>
                <div className="text-[#9ca3af]">시도 {j.attempts ?? 0}회</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reports List */}
      <Section title={`리포트 목록 (${month}) — 행 클릭 시 상세`}>
        {subLoading ? <Spinner /> : !reportsData ? <Err msg="로드 실패" /> : reportsData.rows?.length === 0 ? (
          <p className="text-[12px] text-[#6b7280] py-4 text-center">이 기간 리포트 없음</p>
        ) : (
          <>
            <Table
              heads={["학생", "기간", "상태", "분석", "재분석", "발행", "생성일"]}
              rows={reportsData.rows}
              render={(r: any, i: number) => (
                <tr key={r.id ?? i} className="border-b border-[#f5f5f5] cursor-pointer hover:bg-[#f9fafb]"
                    onClick={() => setSelectedReport(r)}>
                  <td className="py-2 pr-2 text-[11px] font-medium">{r.student_name ?? r.student_id?.slice(0, 8)}</td>
                  <td className="py-2 pr-2 text-[11px]">{r.report_period ?? "—"}</td>
                  <td className="py-2 pr-2">
                    <Badge color={statusBadgeColor(r.product_status)} text={r.product_status ?? "—"} />
                    {r.discarded_at && <span className="ml-1 text-[10px] text-red-500">🗑</span>}
                  </td>
                  <td className="py-2 pr-2 text-[10px] text-[#6b7280]">{r.analysis_status ?? "—"}</td>
                  <td className="py-2 pr-2 text-[11px] text-center">{r.analysis_retry_count ?? 0}</td>
                  <td className="py-2 pr-2 text-[11px]">{r.published_at ? r.published_at.slice(0, 10) : "—"}</td>
                  <td className="py-2 text-[11px]">{r.created_at?.slice(0, 10)}</td>
                </tr>
              )}
            />
            <div className="flex justify-between items-center mt-2 text-[11px] text-[#6b7280]">
              <span>총 {reportsData.total}건</span>
              <div className="flex gap-2">
                <button disabled={reportPage === 0} onClick={() => setReportPage(p => p - 1)} className="px-2 py-1 rounded border disabled:opacity-40">◀</button>
                <span>p.{reportPage + 1}</span>
                <button disabled={(reportPage + 1) * PAGE >= reportsData.total} onClick={() => setReportPage(p => p + 1)} className="px-2 py-1 rounded border disabled:opacity-40">▶</button>
              </div>
            </div>
          </>
        )}
      </Section>

      {/* Batch Jobs List */}
      <Section title={`배치 작업 상세 (${month})`}>
        {subLoading ? <Spinner /> : !batchData ? <Err msg="로드 실패" /> : batchData.rows?.length === 0 ? (
          <p className="text-[12px] text-[#6b7280] py-4 text-center">이 기간 배치 작업 없음</p>
        ) : (
          <>
            <Table
              heads={["유형", "상태", "대상", "완료", "실패", "시도", "잠금", "생성"]}
              rows={batchData.rows}
              render={(r: any, i: number) => (
                <tr key={r.id ?? i} className={`border-b border-[#f5f5f5] ${r.is_stuck ? "bg-red-50" : ""}`}>
                  <td className="py-2 pr-2 text-[11px] font-medium">{r.job_type ?? "—"}</td>
                  <td className="py-2 pr-2">
                    <Badge color={statusBadgeColor(r.status)} text={r.status ?? "—"} />
                    {r.is_stuck && <span className="ml-1 text-[10px] text-red-600 font-bold">STUCK</span>}
                  </td>
                  <td className="py-2 pr-2 text-[11px]">{r.target_count ?? "—"}</td>
                  <td className="py-2 pr-2 text-[11px]">{r.completed_count ?? 0}</td>
                  <td className="py-2 pr-2 text-[11px] text-[#dc2626]">{r.failed_count ?? 0}</td>
                  <td className="py-2 pr-2 text-[11px]">{r.attempts ?? 0}</td>
                  <td className="py-2 pr-2 text-[11px]">{r.locked_at ? r.locked_at.slice(0, 16) : "—"}</td>
                  <td className="py-2 text-[11px]">{r.created_at?.slice(0, 10)}</td>
                </tr>
              )}
            />
            <div className="flex justify-between items-center mt-2 text-[11px] text-[#6b7280]">
              <span>총 {batchData.total}건 (STUCK = RUNNING 10분 초과)</span>
              <div className="flex gap-2">
                <button disabled={batchPage === 0} onClick={() => setBatchPage(p => p - 1)} className="px-2 py-1 rounded border disabled:opacity-40">◀</button>
                <span>p.{batchPage + 1}</span>
                <button disabled={(batchPage + 1) * PAGE >= batchData.total} onClick={() => setBatchPage(p => p + 1)} className="px-2 py-1 rounded border disabled:opacity-40">▶</button>
              </div>
            </div>
          </>
        )}
      </Section>

      {/* Growth Cycles */}
      <Section title="Growth 사이클">
        {subLoading ? <Spinner /> : !cyclesData ? <Err msg="로드 실패" /> : cyclesData.rows?.length === 0 ? (
          <p className="text-[12px] text-[#6b7280] py-4 text-center">사이클 없음</p>
        ) : (
          <Table
            heads={["기간", "상태", "분석기준", "분석 마감", "학부모 마감"]}
            rows={cyclesData.rows}
            render={(r: any, i: number) => (
              <tr key={r.id ?? i} className="border-b border-[#f5f5f5]">
                <td className="py-2 pr-2 text-[11px] font-medium">{r.report_period}</td>
                <td className="py-2 pr-2"><Badge color={statusBadgeColor(r.cycle_status)} text={r.cycle_status ?? "—"} /></td>
                <td className="py-2 pr-2 text-[11px]">{r.analysis_from?.slice(0, 10) ?? "—"}</td>
                <td className="py-2 pr-2 text-[11px]">{r.analysis_cutoff_at?.slice(0, 10) ?? "—"}</td>
                <td className="py-2 text-[11px]">{r.parent_input_close_at?.slice(0, 10) ?? "—"}</td>
              </tr>
            )}
          />
        )}
      </Section>
    </div>
  );
}

function ErrorsTab({ poolId }: { poolId: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [feature, setFeature] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await api.get<any>(`/super/pools/${poolId}/control-center/errors?feature=${feature}`)); } catch (_) {}
    setLoading(false);
  }, [poolId, feature]);
  useEffect(() => { load(); }, [load]);
  const FEATURES = ["AUTH", "API", "AI", "DIARY", "CURRICULUM", "GROWTH_REPORT", "PUSH", "UPLOAD", "STORAGE", "BILLING", "DB"];
  return (
    <div>
      <div className="flex gap-2 mb-3">
        <select value={feature} onChange={(e) => setFeature(e.target.value)} className="border border-[#e5e7eb] rounded-lg px-2 py-1.5 text-[12px]">
          <option value="">전체 기능</option>
          {FEATURES.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <button onClick={load} className="px-3 py-1.5 text-[12px] rounded-lg bg-[#002F5F] text-white font-medium">새로고침</button>
      </div>
      {loading ? <Spinner /> : !data ? <Err msg="데이터 로드 실패" /> : (
        <div className="space-y-4">
          <Section title="최근 오류 이벤트">
            <Table
              heads={["기능", "코드", "메시지", "시각"]}
              rows={data.events ?? []}
              render={(r, i) => (
                <tr key={r.id ?? i} className="border-b border-[#f5f5f5]">
                  <td className="py-2 pr-3 font-medium">{r.feature}</td>
                  <td className="py-2 pr-3"><Badge color={r.level === "critical" ? "red" : "amber"} text={r.error_code ?? r.level} /></td>
                  <td className="py-2 pr-3 max-w-[200px] truncate">{r.safe_message}</td>
                  <td className="py-2">{r.created_at?.slice(0, 16)}</td>
                </tr>
              )}
            />
          </Section>
          {(data.incidents ?? []).length > 0 && (
            <Section title="Incidents">
              <Table
                heads={["제목", "심각도", "상태", "발생시각"]}
                rows={data.incidents ?? []}
                render={(r, i) => (
                  <tr key={r.id ?? i} className="border-b border-[#f5f5f5]">
                    <td className="py-2 pr-3 font-medium">{r.title}</td>
                    <td className="py-2 pr-3"><Badge color={r.severity === "critical" ? "red" : "amber"} text={r.severity} /></td>
                    <td className="py-2 pr-3"><Badge color={r.status === "resolved" ? "green" : "red"} text={r.status} /></td>
                    <td className="py-2">{r.created_at?.slice(0, 16)}</td>
                  </tr>
                )}
              />
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function NotificationsTab({ poolId }: { poolId: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.get<any>(`/super/pools/${poolId}/control-center/notifications`).then(setData).catch(() => {}).finally(() => setLoading(false));
  }, [poolId]);
  return loading ? <Spinner /> : !data ? <Err msg="데이터 로드 실패" /> : (
    <>
      <div className="text-[11px] text-[#888] mb-2">전체 {data.total}건</div>
      <Table
        heads={["타입", "제목", "수신자", "읽음", "시각"]}
        rows={data.notifications ?? []}
        render={(r, i) => (
          <tr key={r.id ?? i} className="border-b border-[#f5f5f5]">
            <td className="py-2 pr-3 font-medium text-[10px]">{r.type}</td>
            <td className="py-2 pr-3">{r.title}</td>
            <td className="py-2 pr-3">{r.recipient_id?.slice(0, 8)}</td>
            <td className="py-2 pr-3"><Badge color={r.is_read ? "green" : "gray"} text={r.is_read ? "읽음" : "미읽"} /></td>
            <td className="py-2">{r.created_at?.slice(0, 16)}</td>
          </tr>
        )}
      />
    </>
  );
}

// ─────────────────── Storage Tab ────────────────────────────────
function StorageTab({ poolId }: { poolId: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.get<any>(`/super/pools/${poolId}/control-center/storage`)
      .then(setData).catch(() => {}).finally(() => setLoading(false));
  }, [poolId]);
  if (loading) return <Spinner />;
  if (!data) return <Err msg="데이터 로드 실패" />;

  const usedBytes     = Number(data.used_storage_bytes ?? 0);
  const quotaBytes    = data.quota_bytes !== null ? Number(data.quota_bytes) : null;
  const remainBytes   = data.remaining_bytes !== null ? Number(data.remaining_bytes) : null;
  const pct           = data.used_pct;                    // null = unlimited
  const unlimited     = quotaBytes === null;
  const blocked       = Boolean(data.upload_blocked);

  return (
    <div className="space-y-5">
      {/* Usage bar — §13 */}
      <Section title="저장공간 현황">
        {blocked && (
          <div className="mb-3 px-3 py-2 bg-red-50 border border-red-300 rounded-lg text-[12px] text-red-700 font-semibold">
            ⛔ 업로드 차단됨 — 이 수영장의 파일 업로드가 현재 불가합니다.
          </div>
        )}
        <div className="mb-4">
          <div className="flex justify-between text-[11px] mb-1.5 text-[#555]">
            <span>사용량</span>
            <span className="font-medium">
              {fmtBytes(usedBytes)} / {unlimited ? "무제한" : fmtBytes(quotaBytes!)}
              {pct !== null ? ` (${pct}%)` : ""}
            </span>
          </div>
          <div className="h-3 bg-[#f3f4f6] rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                (pct ?? 0) > 90 ? "bg-red-500" : (pct ?? 0) > 70 ? "bg-amber-400" : "bg-[#002F5F]"
              }`}
              style={{ width: unlimited ? "0%" : `${pct ?? 0}%` }}
            />
          </div>
        </div>
        {/* KPI grid */}
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: "Used",       value: fmtBytes(usedBytes) },
            { label: "Quota",      value: unlimited ? "무제한" : fmtBytes(quotaBytes!) },
            { label: "Remaining",  value: remainBytes !== null ? fmtBytes(remainBytes) : "무제한" },
            { label: "Percent",    value: pct !== null ? `${pct}%` : "N/A" },
          ].map(({ label, value }) => (
            <div key={label} className="bg-white border border-[#e5e7eb] rounded-xl p-3">
              <div className="text-[10px] text-[#aaa] uppercase tracking-wide">{label}</div>
              <div className="text-[14px] font-semibold text-[#111] mt-0.5">{value}</div>
            </div>
          ))}
        </div>
      </Section>

      {/* Upload blocked + quota source — §15/§16 */}
      <Section title="업로드 차단 / Quota 출처">
        <Row label="Upload Blocked"
          value={blocked ? "YES" : "NO"}
          valueClass={blocked ? "text-red-600 font-bold" : "text-green-600"} />
        <Row label="읽기 전용 모드" value={data.is_readonly ? "YES" : "NO"}
          valueClass={data.is_readonly ? "text-red-600" : "text-[#bbb]"} />
        <Row label="경고 발송일" value={data.storage_warning_sent_at?.slice(0, 10) ?? "없음"} />
        <div className="mt-2 text-[11px] text-[#888] bg-[#f9fafb] rounded-lg p-2.5">
          <div className="font-semibold text-[#555] mb-1">Quota 출처 (§15)</div>
          <div>Source: <span className="font-medium">{data.quota_source ?? "unknown"}</span></div>
          <div>base_storage_gb: {data.base_storage_gb} GB</div>
          <div>extra_storage_gb: {data.extra_storage_gb} GB</div>
          <div>video_storage_limit_mb: {data.video_storage_limit_mb} MB</div>
          <div className="mt-1 text-[10px] text-[#aaa]">
            Upload guard source: billing.ts → swimming_pools.upload_blocked (§16 검증됨)
          </div>
        </div>
      </Section>

      {/* File breakdown — §12 */}
      <Section title="파일 분류별 사용량">
        <div className="space-y-2 text-[12px]">
          <div className="flex justify-between py-2 border-b border-[#f5f5f5]">
            <span className="text-[#555]">미디어 파일</span>
            <span className="font-medium">{data.media_count ?? 0}개 · {fmtBytes(Number(data.media_bytes ?? 0))}</span>
          </div>
          <div className="flex justify-between py-2 border-b border-[#f5f5f5]">
            <span className="text-[#555]">커리큘럼 파일</span>
            <span className="font-medium">{data.curriculum_file_count ?? 0}개 · {fmtBytes(Number(data.curriculum_file_bytes ?? 0))}</span>
          </div>
        </div>
        <div className="mt-2 text-[10px] text-[#aaa]">
          사용량 소스: swimming_pools.used_storage_bytes (DB-cached aggregate, billing.ts 업데이트)
          <br />R2 bucket 실시간 scan: 금지 — Control Center 진입 시 object storage 호출 없음 (§14/§30)
        </div>
      </Section>
    </div>
  );
}

function AuditTab({ poolId }: { poolId: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.get<any>(`/super/pools/${poolId}/control-center/audit`).then(setData).catch(() => {}).finally(() => setLoading(false));
  }, [poolId]);
  return loading ? <Spinner /> : !data ? <Err msg="데이터 로드 실패" /> : (
    <>
      <div className="text-[11px] text-[#888] mb-2">전체 {data.total}건</div>
      <Table
        heads={["엔티티 타입", "액션", "액터", "이유", "시각"]}
        rows={data.logs ?? []}
        render={(r, i) => (
          <tr key={r.id ?? i} className="border-b border-[#f5f5f5]">
            <td className="py-2 pr-3 text-[10px] font-medium">{r.entity_type}</td>
            <td className="py-2 pr-3"><Badge color="gray" text={r.action} /></td>
            <td className="py-2 pr-3">{r.actor_id?.slice(0, 8)}</td>
            <td className="py-2 pr-3 max-w-[160px] truncate text-[#555]">{r.reason ?? "—"}</td>
            <td className="py-2">{r.created_at?.slice(0, 16)}</td>
          </tr>
        )}
      />
    </>
  );
}

function SupportTab({ poolId }: { poolId: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.get<any>(`/super/pools/${poolId}/control-center/support`).then(setData).catch(() => {}).finally(() => setLoading(false));
  }, [poolId]);
  return loading ? <Spinner /> : !data ? <Err msg="데이터 로드 실패" /> : (
    <>
      <div className="text-[11px] text-[#888] mb-2">전체 {data.total}건</div>
      <Table
        heads={["티켓", "역할", "상태", "해결 출처", "생성일"]}
        rows={data.cases ?? []}
        render={(r, i) => (
          <tr key={r.id ?? i} className="border-b border-[#f5f5f5]">
            <td className="py-2 pr-3 font-medium text-[10px]">{r.ticket_id ?? r.id?.slice(0, 8)}</td>
            <td className="py-2 pr-3">{r.actor_role}</td>
            <td className="py-2 pr-3"><Badge color={r.state === "RESOLVED" ? "green" : r.state === "HUMAN_REQUIRED" ? "red" : "amber"} text={r.state} /></td>
            <td className="py-2 pr-3">{r.resolution_source ?? "—"}</td>
            <td className="py-2">{r.created_at?.slice(0, 10)}</td>
          </tr>
        )}
      />
    </>
  );
}

// ─────────────────── Main Component ────────────────────
const TABS = [
  { key: "overview",        label: "Overview" },
  { key: "access",          label: "Access / Plans" },
  { key: "members",         label: "Members" },
  { key: "teachers",        label: "Teachers" },
  { key: "parents",         label: "Parents" },
  { key: "classes",         label: "Classes" },
  { key: "curriculum",      label: "Curriculum" },
  { key: "ai",              label: "AI Ops" },
  { key: "growth-reports",  label: "Growth Reports" },
  { key: "errors",          label: "Errors" },
  { key: "notifications",   label: "Notifications" },
  { key: "storage",         label: "Storage" },
  { key: "audit",           label: "Audit" },
  { key: "support",         label: "Support" },
] as const;

type TabKey = typeof TABS[number]["key"];

export default function SuperPoolControlCenter() {
  const [, params] = useRoute("/super/pools/:poolId");
  const [, navigate] = useLocation();
  const poolId = params?.poolId;

  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<TabKey>("overview");

  const loadSummary = useCallback(() => {
    if (!poolId) return;
    setLoading(true);
    api.get<Summary>(`/super/pools/${poolId}/control-center/summary`)
      .then(setSummary)
      .catch((e) => setError(e?.data?.error ?? "수영장 정보를 불러올 수 없습니다."))
      .finally(() => setLoading(false));
  }, [poolId]);

  useEffect(() => { loadSummary(); }, [loadSummary]);

  if (loading) return <div className="p-6 text-[13px] text-[#aaa]">불러오는 중...</div>;
  if (error)   return <div className="p-6 text-[13px] text-red-500">{error}</div>;
  if (!summary) return null;

  const healthColor = { GREEN: "green", YELLOW: "amber", RED: "red" }[summary.health] ?? "gray";
  const healthEmoji = { GREEN: "🟢", YELLOW: "🟡", RED: "🔴" }[summary.health] ?? "⚪";

  return (
    <div className="max-w-4xl mx-auto px-4 pb-20">
      {/* ── Header ── */}
      <div className="flex items-start gap-3 py-5 border-b border-[#e5e7eb] mb-4 sticky top-0 bg-white z-10">
        <div className="flex-1 min-w-0">
          <button onClick={() => navigate("/super/pools")} className="text-[11px] text-[#888] hover:text-[#333] mb-1">← 수영장 관리</button>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-[18px] font-bold text-[#111]">{summary.name}</h1>
            {summary.x_effective && <Badge color="navy" text="X" />}
            {summary.base_manual && <Badge color="purple" text="BASE MANUAL" />}
            <span className="text-[11px] text-[#888]">Pool Control Center</span>
          </div>
          <div className="text-[11px] text-[#888] mt-0.5">{summary.pool_id}</div>
        </div>
        <div className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#f9fafb] border border-[#e5e7eb]">
          <span>{healthEmoji}</span>
          <span className={`text-[11px] font-semibold ${healthColor === "green" ? "text-green-700" : healthColor === "red" ? "text-red-600" : "text-amber-600"}`}>{summary.health}</span>
        </div>
      </div>

      {/* ── Entitlement Pill Bar ── */}
      <div className="flex flex-wrap gap-2 mb-4">
        <div className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium border ${summary.base_effective ? "bg-[#f0fdf4] border-green-200 text-green-800" : "bg-[#f9fafb] border-[#e5e7eb] text-[#aaa]"}`}>
          BASE: {summary.base_effective ? (summary.base_manual ? "MANUAL ✓" : "PAID ✓") : "OFF"}
        </div>
        <div className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium border ${summary.x_effective ? "bg-[#002F5F] border-[#002F5F] text-white" : "bg-[#f9fafb] border-[#e5e7eb] text-[#aaa]"}`}>
          X: {summary.x_effective ? (summary.x_manual ? `MANUAL ${summary.x_plan_key?.toUpperCase() ?? ""}` : `PAID ${summary.x_plan_key?.toUpperCase() ?? ""}`) : "OFF"}
        </div>
        {summary.x_force_disabled && <Badge color="red" text="X FORCE DISABLED" />}
      </div>

      {/* ── Tab Bar ── */}
      <div className="flex gap-0.5 mb-4 overflow-x-auto pb-1 border-b border-[#e5e7eb]">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 text-[11px] font-medium rounded-t whitespace-nowrap shrink-0 transition-colors ${
              tab === t.key ? "bg-[#002F5F] text-white" : "text-[#666] hover:text-[#111] hover:bg-[#f5f5f5]"
            }`}
          >
            {t.label}
            {t.key === "errors" && summary.recent_error_count > 0 && (
              <span className="ml-1 bg-red-500 text-white text-[9px] rounded-full px-1">{summary.recent_error_count}</span>
            )}
            {t.key === "notifications" && summary.unread_notifications > 0 && (
              <span className="ml-1 bg-amber-500 text-white text-[9px] rounded-full px-1">{summary.unread_notifications}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── Tab Content ── */}
      <div>
        {tab === "overview"       && <OverviewTab s={summary} onNavigate={setTab} />}
        {tab === "access"         && <AccessTab s={summary} poolId={poolId!} onRefresh={loadSummary} />}
        {tab === "members"        && <MembersTab poolId={poolId!} />}
        {tab === "teachers"       && <TeachersTab poolId={poolId!} />}
        {tab === "parents"        && <ParentsTab poolId={poolId!} />}
        {tab === "classes"        && <ClassesTab poolId={poolId!} />}
        {tab === "curriculum"     && <CurriculumTab poolId={poolId!} />}
        {tab === "ai"             && <AiTab poolId={poolId!} />}
        {tab === "growth-reports" && <GrowthReportsTab poolId={poolId!} />}
        {tab === "errors"         && <ErrorsTab poolId={poolId!} />}
        {tab === "notifications"  && <NotificationsTab poolId={poolId!} />}
        {tab === "storage"        && <StorageTab poolId={poolId!} />}
        {tab === "audit"          && <AuditTab poolId={poolId!} />}
        {tab === "support"        && <SupportTab poolId={poolId!} />}
      </div>
    </div>
  );
}
