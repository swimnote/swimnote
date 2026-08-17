/**
 * SuperPoolDetail — /super/pools/:poolId
 * SA0-B: 전체 섹션 구현
 * A. 기본 상태  B. Basic 구독  C. X 구독
 * D. X Setup   E. X04 구조화  F. AI Traces (최근 5)
 * G. 고객센터   H. 장애        I. 사용자 현황
 */
import { useEffect, useState } from "react";
import { useRoute, useLocation } from "wouter";
import { api } from "@/lib/api";

// ──────────────────── Types ────────────────────
interface PoolDetail {
  id: string;
  name: string;
  address?: string | null;
  phone?: string | null;
  owner_name?: string | null;
  owner_email?: string | null;
  approval_status: string;
  subscription_status?: string | null;
  subscription_tier?: string | null;
  plan_name?: string | null;
  subscription_starts_at?: string | null;
  subscription_ends_at?: string | null;
  trial_ends_at?: string | null;
  member_limit?: number | null;
  display_storage?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  homepage_slug?: string | null;
  homepage_enabled?: boolean | null;
  // X
  xmode_entitlement?: boolean | null;
  xmode_config_status?: string | null;
  x_paid_entitlement?: boolean | null;
  x_manual_entitlement?: boolean | null;
  x_force_disabled?: boolean | null;
  x_submission_submitted_at?: string | null;
  x_submission_reviewed_at?: string | null;
  x_submission_status?: string | null;
  // Members
  active_member_count?: number | null;
  total_member_count?: number | null;
  total_class_count?: number | null;
  teacher_count?: number | null;
  staff_count?: number | null;
}

interface AiTrace {
  id: string;
  feature: string | null;
  status: string;
  model: string | null;
  total_tokens: number | null;
  latency_ms: number | null;
  error_message: string | null;
  created_at: string;
}

interface Incident {
  id: string;
  title: string;
  severity: string;
  status: string;
  created_at: string;
}

interface Support {
  total_count: number;
  open_count: number;
  resolved_count: number;
}

// ──────────────────── Helpers ────────────────────
function Row({ label, value, valueClass }: { label: string; value?: string | number | boolean | null; valueClass?: string }) {
  const display = value == null ? "—" : typeof value === "boolean" ? (value ? "YES" : "NO") : String(value);
  return (
    <div className="flex justify-between py-2 border-b border-[#f5f5f5] last:border-0">
      <span className="text-[12px] text-[#888]">{label}</span>
      <span className={`text-[12px] font-medium text-right break-all max-w-[60%] ${valueClass ?? "text-[#111]"}`}>{display}</span>
    </div>
  );
}

function SectionCard({ title, children, badge }: { title: string; children: React.ReactNode; badge?: React.ReactNode }) {
  return (
    <div className="bg-white border border-[#e5e5e5] rounded-lg p-5">
      <div className="flex items-center gap-2 mb-4">
        <h3 className="text-[11px] font-bold text-[#999] uppercase tracking-wider">{title}</h3>
        {badge}
      </div>
      {children}
    </div>
  );
}

function SevBadge({ sev }: { sev: string }) {
  const colors: Record<string, string> = {
    SEV1: "bg-red-100 text-red-700",
    SEV2: "bg-orange-100 text-orange-700",
    SEV3: "bg-amber-100 text-amber-700",
    SEV4: "bg-gray-100 text-gray-600",
  };
  return <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded ${colors[sev] ?? colors.SEV4}`}>{sev}</span>;
}

function xConfigLabel(s?: string | null) {
  const labels: Record<string, string> = {
    NOT_CONFIGURED:  "미구성",
    SUBMITTED:       "자료 제출됨",
    UNDER_REVIEW:    "검토 중",
    APPROVED:        "승인됨",
    REVISION_NEEDED: "수정 요청",
    REJECTED:        "반려",
  };
  return labels[s ?? ""] ?? (s ?? "—");
}

// ──────────────────── Component ────────────────────
export default function SuperPoolDetail() {
  const [, params] = useRoute("/super/pools/:poolId");
  const [, navigate] = useLocation();
  const poolId = params?.poolId;

  const [pool, setPool] = useState<PoolDetail | null>(null);
  const [support, setSupport] = useState<Support | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Async-loaded: AI traces, incidents
  const [aiTraces, setAiTraces] = useState<AiTrace[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);

  useEffect(() => {
    if (!poolId) return;
    setLoading(true); setError("");

    api.get<{ pool: PoolDetail; support: Support }>(`/super/operators/${poolId}`)
      .then((d) => {
        setPool(d.pool);
        setSupport(d.support ?? null);
      })
      .catch((e) => setError(e?.data?.error || "수영장 정보를 불러올 수 없습니다."))
      .finally(() => setLoading(false));

    // AI traces (최근 5)
    api.get<{ traces: AiTrace[] }>(`/super/ai-traces?pool_id=${poolId}&limit=5`)
      .then((r) => setAiTraces(r.traces ?? []))
      .catch(() => setAiTraces([]));

    // incidents affecting this pool
    api.get<{ incidents: Incident[] }>(`/super/incidents?pool_id=${poolId}&limit=5`)
      .then((r) => setIncidents(r.incidents ?? []))
      .catch(() => setIncidents([]));
  }, [poolId]);

  if (loading) return <div className="p-6 text-[13px] text-[#aaa]">불러오는 중...</div>;
  if (error)   return <div className="p-6 text-[13px] text-red-500">{error}</div>;
  if (!pool)   return null;

  const xActive = pool.x_paid_entitlement || pool.x_manual_entitlement || pool.xmode_entitlement;

  return (
    <div className="p-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate("/super/pools")}
          className="text-[12px] text-[#888] hover:text-[#111] flex items-center gap-1">
          ← 수영장 관리
        </button>
        <span className="text-[#ddd]">/</span>
        <span className="text-[14px] font-bold text-[#111]">{pool.name}</span>
        {xActive && (
          <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-[#002F5F] text-white">X</span>
        )}
      </div>

      <div className="space-y-4">
        {/* ── A. 기본 상태 ── */}
        <SectionCard title="A. 기본 상태">
          <Row label="pool_id" value={pool.id} />
          <Row label="수영장명" value={pool.name} />
          <Row label="주소" value={pool.address} />
          <Row label="전화번호" value={pool.phone} />
          <Row label="운영자명" value={pool.owner_name} />
          <Row label="승인 상태" value={pool.approval_status} />
          <Row label="생성일" value={pool.created_at?.slice(0, 10)} />
          <Row label="최근 수정" value={pool.updated_at?.slice(0, 16)} />
        </SectionCard>

        {/* ── B. Basic 구독 ── */}
        <SectionCard title="B. Basic 구독">
          <Row label="구독 상태" value={pool.subscription_status} />
          <Row label="플랜" value={pool.plan_name ?? pool.subscription_tier} />
          <Row label="시작일" value={pool.subscription_starts_at?.slice(0, 10)} />
          <Row label="만료일" value={pool.subscription_ends_at?.slice(0, 10)} />
          <Row label="Trial 만료" value={pool.trial_ends_at?.slice(0, 10)} />
          <Row label="회원 한도" value={pool.member_limit} />
          <Row label="저장공간" value={pool.display_storage} />
        </SectionCard>

        {/* ── C. X 구독 ── */}
        <SectionCard
          title="C. X 구독"
          badge={xActive ? <span className="px-1.5 py-0.5 text-[10px] font-bold bg-[#002F5F] text-white rounded">X ACTIVE</span> : undefined}
        >
          <Row label="Paid entitlement" value={pool.x_paid_entitlement} valueClass={pool.x_paid_entitlement ? "text-green-700" : "text-[#bbb]"} />
          <Row label="Manual entitlement" value={pool.x_manual_entitlement} valueClass={pool.x_manual_entitlement ? "text-green-700" : "text-[#bbb]"} />
          <Row label="Force disabled" value={pool.x_force_disabled} valueClass={pool.x_force_disabled ? "text-red-600" : "text-[#bbb]"} />
        </SectionCard>

        {/* ── D. X Setup ── */}
        <SectionCard title="D. X Setup">
          <Row label="Setup 상태" value={xConfigLabel(pool.xmode_config_status)} />
          <Row label="자료 제출일" value={pool.x_submission_submitted_at?.slice(0, 10)} />
          <Row label="검토일" value={pool.x_submission_reviewed_at?.slice(0, 10)} />
          <Row label="제출 결과" value={pool.x_submission_status} />
          <div className="mt-3">
            <button
              onClick={() => navigate("/super/x-mode")}
              className="text-[11px] text-[#002F5F] hover:underline"
            >
              X MODE 관리 페이지에서 검토 →
            </button>
          </div>
        </SectionCard>

        {/* ── E. X04 구조화 ── */}
        <SectionCard title="E. X04 구조화">
          <p className="text-[12px] text-[#888] mb-2">
            커리큘럼 자료 구조화 상태는 X MODE 관리 화면의 XSetupTab에서 확인합니다.
          </p>
          <button
            onClick={() => navigate("/super/x-mode")}
            className="text-[11px] text-[#002F5F] hover:underline"
          >
            X MODE 관리 → XSetup 탭 →
          </button>
        </SectionCard>

        {/* ── F. AI Traces (최근 5) ── */}
        <SectionCard title="F. 최근 AI 호출 (5건)">
          {aiTraces.length === 0 ? (
            <p className="text-[12px] text-[#bbb]">AI 호출 기록 없음</p>
          ) : (
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-[#f0f0f0]">
                  <th className="text-left py-1.5 text-[10px] text-[#bbb] font-semibold">Feature</th>
                  <th className="text-left py-1.5 text-[10px] text-[#bbb] font-semibold">Status</th>
                  <th className="text-right py-1.5 text-[10px] text-[#bbb] font-semibold">Tokens</th>
                  <th className="text-right py-1.5 text-[10px] text-[#bbb] font-semibold">응답</th>
                </tr>
              </thead>
              <tbody>
                {aiTraces.map((t) => (
                  <tr key={t.id} className="border-b border-[#f5f5f5] last:border-0">
                    <td className="py-2 text-[#555] max-w-[100px] truncate">{t.feature ?? "—"}</td>
                    <td className="py-2">
                      <span className={`px-1 py-0.5 text-[10px] font-bold rounded ${
                        t.status === "SUCCESS" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                      }`}>{t.status}</span>
                    </td>
                    <td className="py-2 text-right text-[#888]">{t.total_tokens?.toLocaleString() ?? "—"}</td>
                    <td className={`py-2 text-right font-medium ${(t.latency_ms ?? 0) > 5000 ? "text-amber-600" : "text-[#888]"}`}>
                      {t.latency_ms != null ? `${(t.latency_ms / 1000).toFixed(1)}s` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="mt-2">
            <button
              onClick={() => navigate("/super/ai")}
              className="text-[11px] text-[#002F5F] hover:underline"
            >
              AI 운영 전체 보기 →
            </button>
          </div>
        </SectionCard>

        {/* ── G. 고객센터 ── */}
        <SectionCard title="G. 고객센터">
          {support ? (
            <>
              <Row label="전체 티켓" value={support.total_count} />
              <Row label="미처리" value={support.open_count} valueClass={support.open_count > 0 ? "text-amber-600" : undefined} />
              <Row label="해결됨" value={support.resolved_count} valueClass="text-green-700" />
            </>
          ) : (
            <p className="text-[12px] text-[#bbb]">지원 데이터 없음</p>
          )}
          <div className="mt-3">
            <button
              onClick={() => navigate("/super/support")}
              className="text-[11px] text-[#002F5F] hover:underline"
            >
              고객센터 전체 보기 →
            </button>
          </div>
        </SectionCard>

        {/* ── H. 장애 ── */}
        <SectionCard title="H. 관련 장애">
          {incidents.length === 0 ? (
            <p className="text-[12px] text-[#bbb]">이 수영장에 영향을 미친 장애 없음</p>
          ) : (
            <div className="space-y-2">
              {incidents.map((inc) => (
                <div key={inc.id} className="flex items-center gap-2 py-1.5 border-b border-[#f5f5f5] last:border-0">
                  <SevBadge sev={inc.severity} />
                  <span className="flex-1 text-[12px] text-[#111] truncate">{inc.title}</span>
                  <span className="text-[11px] text-[#bbb]">{inc.status}</span>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3">
            <button
              onClick={() => navigate("/super/incidents")}
              className="text-[11px] text-[#002F5F] hover:underline"
            >
              장애 관리 →
            </button>
          </div>
        </SectionCard>

        {/* ── I. 사용자 현황 ── */}
        <SectionCard title="I. 사용자 현황">
          <Row label="활성 회원" value={pool.active_member_count} valueClass="text-green-700" />
          <Row label="전체 회원" value={pool.total_member_count} />
          <Row label="수업 수" value={pool.total_class_count} />
          <Row label="강사 수" value={pool.teacher_count} />
          <Row label="스태프 수" value={pool.staff_count} />
        </SectionCard>

        {/* ── 관리 도구 ── */}
        <SectionCard title="관리 도구">
          <div className="flex flex-wrap gap-2">
            <a
              href={`/pool/${pool.id}/admin`}
              className="px-4 py-2 rounded-lg text-[12px] font-semibold border border-[#002F5F] text-[#002F5F] hover:bg-[#002F5F] hover:text-white transition-colors"
            >
              PoolAdmin 전체 보기 →
            </a>
            {pool.homepage_slug && (
              <a
                href={`/${pool.homepage_slug}`}
                target="_blank"
                rel="noreferrer"
                className="px-4 py-2 rounded-lg text-[12px] font-semibold border border-[#e5e5e5] text-[#555] hover:bg-[#f5f5f5] transition-colors"
              >
                홈페이지 보기 →
              </a>
            )}
            <button
              onClick={() => navigate(`/super/billing`)}
              className="px-4 py-2 rounded-lg text-[12px] font-semibold border border-[#e5e5e5] text-[#555] hover:bg-[#f5f5f5] transition-colors"
            >
              구독 현황 →
            </button>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
