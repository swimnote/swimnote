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
}

const X_PLANS = [
  { key: "x300", label: "X300", memberLimit: 300, priceLabel: "₩129,000/월" },
  { key: "x500", label: "X500", memberLimit: 500, priceLabel: "₩199,000/월" },
  { key: "x1000", label: "X1000", memberLimit: 1000, priceLabel: "₩359,000/월" },
];

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

// ─────────────────── Modal ────────────────────
function GrantXModal({ current_plan, onGrant, onClose, loading }: {
  current_plan: string | null; onGrant: (plan: string) => void; onClose: () => void; loading: boolean;
}) {
  const [plan, setPlan] = useState(current_plan ?? "x300");
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl p-6 w-[340px]" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-[15px] font-bold mb-1">X모드 직접 부여</h3>
        <p className="text-[12px] text-[#888] mb-4">결제 없이 즉시 적용. 슈퍼관리자 전용.</p>
        <div className="space-y-2 mb-4">
          {X_PLANS.map((p) => (
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
        <p className="text-[11px] text-amber-600 mb-4">⚠ 청구 없음. 슈퍼관리자 직접부여로 감사 기록됩니다.</p>
        <div className="flex gap-2">
          <button onClick={() => onGrant(plan)} disabled={loading} className="flex-1 py-2 text-[13px] font-semibold rounded-lg bg-[#002F5F] text-white disabled:opacity-50">
            {loading ? "처리 중..." : "확인 — 즉시 적용"}
          </button>
          <button onClick={onClose} disabled={loading} className="px-4 py-2 text-[13px] rounded-lg border border-[#e5e7eb] text-[#555]">취소</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────── Tab Panels ────────────────────

function OverviewTab({ s }: { s: Summary }) {
  const fmtBytes = (b: number) => b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b > 1e6 ? `${(b / 1e6).toFixed(0)} MB` : `${(b / 1e3).toFixed(0)} KB`;
  return (
    <div className="space-y-4">
      {s.health_issues.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <div className="text-[12px] font-semibold text-red-700 mb-1">⚠ Health Issues</div>
          {s.health_issues.map((h) => <div key={h} className="text-[11px] text-red-600">• {h}</div>)}
        </div>
      )}
      <div className="grid grid-cols-3 gap-2">
        <StatCard label="활성 회원" value={s.active_members} sub={`전체 ${s.total_members}명`} color="navy" />
        <StatCard label="교사" value={s.teacher_count} color="gray" />
        <StatCard label="학부모" value={s.parent_count} color="gray" />
        <StatCard label="활성반" value={s.active_class_count} color="gray" />
        <StatCard label="최근 오류 (7d)" value={s.recent_error_count} color={s.recent_error_count > 5 ? "red" : "gray"} />
        <StatCard label="미읽은 알림" value={s.unread_notifications} color="gray" />
        <StatCard label="GR 준비" value={s.gr_ready_count} sub={`실패 ${s.gr_failed_count}`} color={s.gr_failed_count > 0 ? "amber" : "gray"} />
        <StatCard label="AI 일지 (이번달)" value={s.recent_ai_diary_count} sub={s.recent_ai_month ?? ""} color="gray" />
        <StatCard label="저장 사용" value={fmtBytes(s.used_storage_bytes)} color={s.upload_blocked ? "red" : "gray"} />
      </div>
      <Section title="기본 정보">
        <Row label="pool_id" value={s.pool_id} />
        <Row label="수영장명" value={s.name} />
        <Row label="운영자" value={s.owner_name} />
        <Row label="승인 상태" value={s.approval_status} />
        <Row label="생성일" value={s.created_at?.slice(0, 10)} />
      </Section>
    </div>
  );
}

function AccessTab({ s, poolId, onRefresh }: { s: Summary; poolId: string; onRefresh: () => void }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [grantXModal, setGrantXModal] = useState(false);
  const [loadingBase, setLoadingBase] = useState(false);
  const [loadingX, setLoadingX] = useState(false);
  const [loadingRevoke, setLoadingRevoke] = useState(false);

  const grantBase = useCallback(async () => {
    if (!window.confirm("BASE SWIMNOTE를 직접 부여합니다. 결제 없음.")) return;
    setLoadingBase(true); setMsg(null);
    try {
      await api.patch(`/super/operators/${poolId}/base`, { base_manual_entitlement: true, reason: "Super Admin BASE grant" });
      setMsg({ ok: true, text: "BASE SWIMNOTE 직접 부여 완료" }); onRefresh();
    } catch (e: any) { setMsg({ ok: false, text: e?.data?.error || "부여 실패" }); }
    setLoadingBase(false);
  }, [poolId, onRefresh]);

  const revokeBase = useCallback(async () => {
    if (!window.confirm("BASE SWIMNOTE manual 권한을 회수합니다.")) return;
    setLoadingBase(true); setMsg(null);
    try {
      await api.patch(`/super/operators/${poolId}/base`, { base_manual_entitlement: false, reason: "Super Admin BASE revoke" });
      setMsg({ ok: true, text: "BASE SWIMNOTE 권한 회수 완료" }); onRefresh();
    } catch (e: any) { setMsg({ ok: false, text: e?.data?.error || "회수 실패" }); }
    setLoadingBase(false);
  }, [poolId, onRefresh]);

  const grantX = useCallback(async (plan: string) => {
    setLoadingX(true); setMsg(null);
    try {
      await api.patch(`/super/operators/${poolId}/xmode`, { xmode_entitlement: true, xmode_config_status: "READY", x_plan_key: plan, bypass_readiness_check: true, reason: `Super Admin X grant — ${plan}` });
      setGrantXModal(false); setMsg({ ok: true, text: `X모드 직접 부여 완료 (${plan.toUpperCase()})` }); onRefresh();
    } catch (e: any) { setMsg({ ok: false, text: e?.data?.error || "X 부여 실패" }); }
    setLoadingX(false);
  }, [poolId, onRefresh]);

  const revokeX = useCallback(async () => {
    if (!window.confirm("X모드 manual 권한을 회수합니다.")) return;
    setLoadingRevoke(true); setMsg(null);
    try {
      await api.patch(`/super/operators/${poolId}/xmode`, { xmode_entitlement: false, x_plan_key: null, reason: "Super Admin X revoke" });
      setMsg({ ok: true, text: "X모드 회수 완료" }); onRefresh();
    } catch (e: any) { setMsg({ ok: false, text: e?.data?.error || "회수 실패" }); }
    setLoadingRevoke(false);
  }, [poolId, onRefresh]);

  return (
    <div className="space-y-4">
      {msg && <Msg ok={msg.ok} text={msg.text} onClose={() => setMsg(null)} />}

      {/* BASE SWIMNOTE */}
      <Section title="BASE SWIMNOTE 이용권">
        <Row label="현재 상태" value={s.base_effective ? "활성" : "비활성"} valueClass={s.base_effective ? "text-green-700 font-bold" : "text-[#bbb]"} />
        <Row label="권한 출처" value={s.base_manual ? "슈퍼관리자 직접부여" : s.base_paid ? "결제" : "없음"} valueClass={s.base_manual ? "text-purple-700" : s.base_paid ? "text-green-700" : "text-[#bbb]"} />
        <Row label="구독 상태" value={s.subscription_status} />
        <Row label="구독 플랜" value={s.subscription_tier} />
        <Row label="Paid 이용권" value={s.base_paid} valueClass={s.base_paid ? "text-green-700" : "text-[#bbb]"} />
        <Row label="Manual 이용권" value={s.base_manual} valueClass={s.base_manual ? "text-purple-700 font-bold" : "text-[#bbb]"} />
        <div className="mt-3 flex gap-2">
          {!s.base_manual ? (
            <button onClick={grantBase} disabled={loadingBase} className="px-3 py-1.5 text-[12px] font-semibold rounded bg-[#002F5F] text-white disabled:opacity-50">
              {loadingBase ? "처리 중..." : "BASE 직접 부여"}
            </button>
          ) : (
            <button onClick={revokeBase} disabled={loadingBase} className="px-3 py-1.5 text-[12px] font-semibold rounded border border-red-300 text-red-600 disabled:opacity-50">
              {loadingBase ? "처리 중..." : "BASE 권한 회수"}
            </button>
          )}
        </div>
      </Section>

      {/* X MODE */}
      <Section title="SWIMNOTE X 이용권">
        <Row label="현재 X 상태" value={s.x_effective ? "활성" : "비활성"} valueClass={s.x_effective ? "text-green-700 font-bold" : "text-[#bbb]"} />
        <Row label="권한 출처" value={s.x_manual ? "슈퍼관리자 직접부여" : s.x_paid ? "결제" : "없음"} valueClass={s.x_manual ? "text-purple-700" : s.x_paid ? "text-green-700" : "text-[#bbb]"} />
        <Row label="현재 X 플랜" value={s.x_plan_key?.toUpperCase() ?? "—"} />
        <Row label="회원 한도" value={s.member_limit} />
        <Row label="Setup 상태" value={s.xmode_config_status} />
        <Row label="X Paid 이용권" value={s.x_paid} valueClass={s.x_paid ? "text-green-700" : "text-[#bbb]"} />
        <Row label="X Manual 이용권" value={s.x_manual} valueClass={s.x_manual ? "text-purple-700 font-bold" : "text-[#bbb]"} />
        <Row label="Force Disabled" value={s.x_force_disabled} valueClass={s.x_force_disabled ? "text-red-600 font-bold" : "text-[#bbb]"} />
        <div className="mt-3 flex gap-2">
          <button onClick={() => setGrantXModal(true)} disabled={loadingX || loadingRevoke} className="px-3 py-1.5 text-[12px] font-semibold rounded bg-[#002F5F] text-white disabled:opacity-50">
            {s.x_manual ? "X 플랜 변경" : "X모드 직접 부여"}
          </button>
          {s.x_manual && (
            <button onClick={revokeX} disabled={loadingX || loadingRevoke} className="px-3 py-1.5 text-[12px] font-semibold rounded border border-red-300 text-red-600 disabled:opacity-50">
              {loadingRevoke ? "처리 중..." : "X모드 회수"}
            </button>
          )}
        </div>
      </Section>

      {grantXModal && (
        <GrantXModal current_plan={s.x_plan_key} onGrant={grantX} onClose={() => setGrantXModal(false)} loading={loadingX} />
      )}
    </div>
  );
}

function MembersTab({ poolId }: { poolId: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get<any>(`/super/pools/${poolId}/control-center/members?q=${encodeURIComponent(q)}&status=${status}`);
      setData(r);
    } catch (_) {}
    setLoading(false);
  }, [poolId, q, status]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div className="flex gap-2 mb-3">
        <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()}
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
          <div className="text-[11px] text-[#888] mb-2">전체 {data.total}명</div>
          <Table
            heads={["이름", "상태", "반", "담당교사", "학부모", "최근일지"]}
            rows={data.members ?? []}
            render={(r, i) => (
              <tr key={r.id ?? i} className="border-b border-[#f5f5f5] hover:bg-[#fafafa]">
                <td className="py-2 pr-3"><div className="font-medium">{r.name}</div><div className="text-[10px] text-[#bbb]">{r.id?.slice(0, 8)}</div></td>
                <td className="py-2 pr-3"><Badge color={r.status === "active" ? "green" : "gray"} text={r.status === "active" ? "재원" : "퇴원"} /></td>
                <td className="py-2 pr-3">{r.class_name ?? "—"}</td>
                <td className="py-2 pr-3">{r.teacher_name ?? "—"}</td>
                <td className="py-2 pr-3">{Number(r.parent_count ?? 0)}</td>
                <td className="py-2">{r.last_diary_at ? r.last_diary_at.slice(0, 10) : "—"}</td>
              </tr>
            )}
          />
        </>
      )}
    </div>
  );
}

function TeachersTab({ poolId }: { poolId: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.get<any>(`/super/pools/${poolId}/control-center/teachers`).then(setData).catch(() => {}).finally(() => setLoading(false));
  }, [poolId]);
  return loading ? <Spinner /> : !data ? <Err msg="데이터 로드 실패" /> : (
    <Table
      heads={["이름", "역할", "이메일", "최근 로그인", "담당반"]}
      rows={data.teachers ?? []}
      render={(r, i) => (
        <tr key={r.id ?? i} className="border-b border-[#f5f5f5] hover:bg-[#fafafa]">
          <td className="py-2 pr-3 font-medium">{r.name}</td>
          <td className="py-2 pr-3"><Badge color={r.role === "pool_admin" ? "navy" : "blue"} text={r.role === "pool_admin" ? "관리자" : "교사"} /></td>
          <td className="py-2 pr-3 text-[#555]">{r.email}</td>
          <td className="py-2 pr-3">{r.last_login_at ? r.last_login_at.slice(0, 10) : "—"}</td>
          <td className="py-2">{Number(r.active_class_count ?? 0)}</td>
        </tr>
      )}
    />
  );
}

function ParentsTab({ poolId }: { poolId: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await api.get<any>(`/super/pools/${poolId}/control-center/parents?q=${encodeURIComponent(q)}`)); } catch (_) {}
    setLoading(false);
  }, [poolId, q]);
  useEffect(() => { load(); }, [load]);
  return (
    <div>
      <div className="flex gap-2 mb-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()}
          placeholder="이름/전화번호" className="flex-1 border border-[#e5e7eb] rounded-lg px-3 py-1.5 text-[12px] outline-none focus:border-[#002F5F]" />
        <button onClick={load} className="px-3 py-1.5 text-[12px] rounded-lg bg-[#002F5F] text-white font-medium">검색</button>
      </div>
      {loading ? <Spinner /> : !data ? <Err msg="데이터 로드 실패" /> : (
        <>
          <div className="text-[11px] text-[#888] mb-2">전체 {data.total}명</div>
          <Table
            heads={["이름", "전화번호", "승인", "연결학생", "최근 로그인"]}
            rows={data.parents ?? []}
            render={(r, i) => (
              <tr key={r.id ?? i} className="border-b border-[#f5f5f5] hover:bg-[#fafafa]">
                <td className="py-2 pr-3 font-medium">{r.name}</td>
                <td className="py-2 pr-3">{r.phone}</td>
                <td className="py-2 pr-3"><Badge color={r.approved_at ? "green" : "gray"} text={r.approved_at ? "승인" : "대기"} /></td>
                <td className="py-2 pr-3">{Number(r.linked_student_count ?? 0)}</td>
                <td className="py-2">{r.last_login_at ? r.last_login_at.slice(0, 10) : "—"}</td>
              </tr>
            )}
          />
        </>
      )}
    </div>
  );
}

function ClassesTab({ poolId }: { poolId: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.get<any>(`/super/pools/${poolId}/control-center/classes`).then(setData).catch(() => {}).finally(() => setLoading(false));
  }, [poolId]);
  return loading ? <Spinner /> : !data ? <Err msg="데이터 로드 실패" /> : (
    <Table
      heads={["반명", "담당교사", "학생수", "상태"]}
      rows={data.classes ?? []}
      render={(r, i) => (
        <tr key={r.id ?? i} className="border-b border-[#f5f5f5] hover:bg-[#fafafa]">
          <td className="py-2 pr-3 font-medium">{r.name}</td>
          <td className="py-2 pr-3">{r.teacher_name ?? "—"}</td>
          <td className="py-2 pr-3">{Number(r.student_count ?? 0)}</td>
          <td className="py-2"><Badge color={r.active ? "green" : "gray"} text={r.active ? "활성" : "비활성"} /></td>
        </tr>
      )}
    />
  );
}

function CurriculumTab({ poolId }: { poolId: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<string | null>(null);

  useEffect(() => {
    api.get<any>(`/super/pools/${poolId}/control-center/curriculum`).then(setData).catch(() => {}).finally(() => setLoading(false));
  }, [poolId]);

  const download = async (sub: any, fileKey: string, fileName: string) => {
    setDownloading(fileKey);
    try {
      const r = await api.get<{ url: string }>(`/super/pools/${poolId}/control-center/curriculum/download?file_key=${encodeURIComponent(fileKey)}&submission_id=${sub.id}`);
      const a = document.createElement("a");
      a.href = r.url; a.download = fileName; a.target = "_blank";
      a.click();
    } catch (e: any) { alert(e?.data?.error ?? "다운로드 실패"); }
    setDownloading(null);
  };

  return loading ? <Spinner /> : !data ? <Err msg="데이터 로드 실패" /> : (
    <div className="space-y-4">
      <Section title="제출 이력">
        {(data.submissions ?? []).length === 0 ? <Empty text="제출 이력 없음" /> : (
          (data.submissions ?? []).map((sub: any) => (
            <div key={sub.id} className="py-2 border-b border-[#f5f5f5] last:border-0">
              <div className="flex items-center justify-between">
                <div>
                  <Badge color={sub.status === "approved" ? "green" : sub.status === "pending" ? "amber" : "gray"} text={sub.status} />
                  <span className="ml-2 text-[11px] text-[#555]">v{sub.submission_version} — {sub.submitted_at?.slice(0, 10)}</span>
                </div>
              </div>
              <div className="flex gap-2 mt-1.5 flex-wrap">
                {sub.curriculum_file_key && (
                  <button onClick={() => download(sub, sub.curriculum_file_key, sub.curriculum_file_name ?? "curriculum.docx")}
                    disabled={downloading === sub.curriculum_file_key}
                    className="px-2 py-1 text-[11px] rounded border border-[#002F5F] text-[#002F5F] hover:bg-[#f0f4ff]">
                    {downloading === sub.curriculum_file_key ? "..." : "📄 커리큘럼 다운로드"}
                  </button>
                )}
                {sub.website_file_key && (
                  <button onClick={() => download(sub, sub.website_file_key, sub.website_file_name ?? "website.docx")}
                    disabled={downloading === sub.website_file_key}
                    className="px-2 py-1 text-[11px] rounded border border-[#002F5F] text-[#002F5F] hover:bg-[#f0f4ff]">
                    {downloading === sub.website_file_key ? "..." : "🌐 홈페이지 자료 다운로드"}
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </Section>
      <Section title="패키지 이력">
        {(data.packages ?? []).length === 0 ? <Empty text="패키지 없음" /> : (
          <Table
            heads={["버전", "패키지명", "생성일"]}
            rows={data.packages ?? []}
            render={(r, i) => (
              <tr key={r.id ?? i} className="border-b border-[#f5f5f5]">
                <td className="py-2 pr-3">v{r.package_version}</td>
                <td className="py-2 pr-3">{r.package_name}</td>
                <td className="py-2">{r.generated_at?.slice(0, 10)}</td>
              </tr>
            )}
          />
        )}
      </Section>
    </div>
  );
}

function AiTab({ poolId }: { poolId: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.get<any>(`/super/pools/${poolId}/control-center/ai`).then(setData).catch(() => {}).finally(() => setLoading(false));
  }, [poolId]);
  return loading ? <Spinner /> : !data ? <Err msg="데이터 로드 실패" /> : (
    <div className="space-y-4">
      <Section title="월별 AI 사용량">
        <Table
          heads={["월", "일지 수", "교사 수", "AI 호출", "학부모 검색"]}
          rows={data.snapshots ?? []}
          render={(r, i) => (
            <tr key={i} className="border-b border-[#f5f5f5]">
              <td className="py-2 pr-3 font-medium">{r.year_month}</td>
              <td className="py-2 pr-3">{r.diary_count ?? 0}</td>
              <td className="py-2 pr-3">{r.teacher_count ?? 0}</td>
              <td className="py-2 pr-3">{r.ai_call_count ?? 0}</td>
              <td className="py-2">{r.parent_search_count ?? 0}</td>
            </tr>
          )}
        />
      </Section>
      <Section title="최근 AI 호출 (20건)">
        <Table
          heads={["기능", "상태", "모델", "토큰", "지연", "시각"]}
          rows={data.recent_traces ?? []}
          render={(r, i) => (
            <tr key={r.id ?? i} className="border-b border-[#f5f5f5]">
              <td className="py-2 pr-3 font-medium">{r.feature}</td>
              <td className="py-2 pr-3"><Badge color={r.status === "success" ? "green" : "red"} text={r.status} /></td>
              <td className="py-2 pr-3">{r.llm_model ?? "—"}</td>
              <td className="py-2 pr-3">{r.total_tokens ?? "—"}</td>
              <td className="py-2 pr-3">{r.latency_ms ? `${r.latency_ms}ms` : "—"}</td>
              <td className="py-2">{r.created_at?.slice(0, 16)}</td>
            </tr>
          )}
        />
      </Section>
    </div>
  );
}

function GrowthReportsTab({ poolId }: { poolId: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.get<any>(`/super/pools/${poolId}/control-center/growth-reports`).then(setData).catch(() => {}).finally(() => setLoading(false));
  }, [poolId]);
  return loading ? <Spinner /> : !data ? <Err msg="데이터 로드 실패" /> : (
    <div className="space-y-4">
      <Section title="배치 작업 (최근 5건)">
        <Table
          heads={["날짜", "상태", "대상", "완료", "실패"]}
          rows={data.batch_jobs ?? []}
          render={(r, i) => (
            <tr key={r.id ?? i} className="border-b border-[#f5f5f5]">
              <td className="py-2 pr-3 font-medium">{r.batch_date}</td>
              <td className="py-2 pr-3"><Badge color={r.status === "completed" ? "green" : r.status === "failed" ? "red" : "amber"} text={r.status} /></td>
              <td className="py-2 pr-3">{r.total_students ?? "—"}</td>
              <td className="py-2 pr-3">{r.processed_count ?? "—"}</td>
              <td className="py-2">{r.failed_count ?? 0}</td>
            </tr>
          )}
        />
      </Section>
      <Section title="리포트 목록">
        <Table
          heads={["학생", "날짜", "상태", "시도", "다음 시도"]}
          rows={data.reports ?? []}
          render={(r, i) => (
            <tr key={r.id ?? i} className="border-b border-[#f5f5f5]">
              <td className="py-2 pr-3 font-medium">{r.student_name ?? r.student_id?.slice(0, 8)}</td>
              <td className="py-2 pr-3">{r.batch_date}</td>
              <td className="py-2 pr-3">
                <Badge color={r.status === "PUBLISHED" ? "green" : r.status === "FAILED" ? "red" : r.status === "READY_TO_SEND" ? "blue" : "gray"} text={r.status} />
              </td>
              <td className="py-2 pr-3">{r.attempts ?? 0}</td>
              <td className="py-2">{r.next_attempt_at ? r.next_attempt_at.slice(0, 16) : "—"}</td>
            </tr>
          )}
        />
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

function StorageTab({ poolId }: { poolId: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.get<any>(`/super/pools/${poolId}/control-center/storage`).then(setData).catch(() => {}).finally(() => setLoading(false));
  }, [poolId]);
  if (loading) return <Spinner />;
  if (!data) return <Err msg="데이터 로드 실패" />;
  const fmtBytes = (b: number) => b > 1e9 ? `${(b / 1e9).toFixed(2)} GB` : b > 1e6 ? `${(b / 1e6).toFixed(0)} MB` : `${Math.round(b / 1e3)} KB`;
  const quotaBytes = data.quota_mb * 1024 * 1024;
  const pct = quotaBytes > 0 ? Math.min(100, Math.round(data.used_storage_bytes / quotaBytes * 100)) : 0;
  return (
    <div className="space-y-4">
      <Section title="저장공간 현황">
        <div className="mb-3">
          <div className="flex justify-between text-[11px] mb-1">
            <span>사용량</span>
            <span>{fmtBytes(data.used_storage_bytes)} / {data.quota_mb} MB ({pct}%)</span>
          </div>
          <div className="h-2 bg-[#f3f4f6] rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${pct > 90 ? "bg-red-500" : pct > 70 ? "bg-amber-400" : "bg-[#002F5F]"}`} style={{ width: `${pct}%` }} />
          </div>
        </div>
        <Row label="업로드 차단" value={data.upload_blocked} valueClass={data.upload_blocked ? "text-red-600 font-bold" : "text-[#bbb]"} />
        <Row label="경고 발송일" value={data.storage_warning_sent_at?.slice(0, 10)} />
        <Row label="미디어 파일 수" value={data.media_count} />
        <Row label="미디어 용량" value={fmtBytes(data.media_bytes)} />
        <Row label="커리큘럼 제출 수" value={data.curriculum_submission_count} />
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
        {tab === "overview"       && <OverviewTab s={summary} />}
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
