/**
 * SuperPoolDetail — /super/pools/:poolId
 * SA0-A: 기본 Pool 정보 + 기존 PoolAdmin으로 연결
 * SA0-B에서 Pool Operations Detail 전체 구현 예정
 */
import { useEffect, useState } from "react";
import { useRoute, useLocation } from "wouter";
import { api } from "@/lib/api";

interface PoolDetail {
  id: string;
  name: string;
  address: string;
  phone: string;
  owner_name: string;
  owner_email: string;
  approval_status: string;
  subscription_status: string;
  subscription_start_at?: string | null;
  subscription_end_at?: string | null;
  subscription_tier?: string | null;
  member_limit?: number | null;
  created_at: string;
  updated_at?: string;
  homepage_slug?: string | null;
  homepage_enabled?: boolean | null;
  xmode_entitlement?: boolean | null;
  xmode_config_status?: string | null;
  x_paid_entitlement?: boolean | null;
  x_manual_entitlement?: boolean | null;
}

function Row({ label, value }: { label: string; value?: string | number | boolean | null }) {
  const display = value == null ? "—" : String(value);
  return (
    <div className="flex justify-between py-2 border-b border-[#f5f5f5] last:border-0">
      <span className="text-[12px] text-[#888]">{label}</span>
      <span className="text-[12px] font-medium text-[#111] max-w-[60%] text-right break-all">{display}</span>
    </div>
  );
}

export default function SuperPoolDetail() {
  const [, params] = useRoute("/super/pools/:poolId");
  const [, navigate] = useLocation();
  const poolId = params?.poolId;

  const [pool, setPool] = useState<PoolDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!poolId) return;
    setLoading(true);
    api.get<PoolDetail>(`/super/operators/${poolId}`)
      .then((d) => setPool(d))
      .catch((e) => setError(e?.data?.error || "수영장 정보를 불러올 수 없습니다."))
      .finally(() => setLoading(false));
  }, [poolId]);

  if (loading) return <div className="p-6 text-[13px] text-[#aaa]">불러오는 중...</div>;
  if (error) return <div className="p-6 text-[13px] text-red-500">{error}</div>;
  if (!pool) return null;

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
        {/* A. 기본 상태 */}
        <div className="bg-white border border-[#e5e5e5] rounded-lg p-5">
          <h3 className="text-[11px] font-bold text-[#999] uppercase tracking-wider mb-4">A. 기본 상태</h3>
          <Row label="pool_id" value={pool.id} />
          <Row label="수영장명" value={pool.name} />
          <Row label="주소" value={pool.address} />
          <Row label="전화번호" value={pool.phone} />
          <Row label="승인 상태" value={pool.approval_status} />
          <Row label="생성일" value={pool.created_at?.slice(0, 10)} />
          <Row label="최근 수정" value={pool.updated_at?.slice(0, 16)} />
        </div>

        {/* B. Basic 구독 */}
        <div className="bg-white border border-[#e5e5e5] rounded-lg p-5">
          <h3 className="text-[11px] font-bold text-[#999] uppercase tracking-wider mb-4">B. Basic 구독</h3>
          <Row label="구독 상태" value={pool.subscription_status} />
          <Row label="플랜" value={pool.subscription_tier} />
          <Row label="시작일" value={pool.subscription_start_at?.slice(0, 10)} />
          <Row label="만료일" value={pool.subscription_end_at?.slice(0, 10)} />
          <Row label="회원 한도" value={pool.member_limit} />
        </div>

        {/* C. X 구독 */}
        <div className="bg-white border border-[#e5e5e5] rounded-lg p-5">
          <h3 className="text-[11px] font-bold text-[#999] uppercase tracking-wider mb-4">C. X 구독</h3>
          <Row label="Paid entitlement" value={pool.x_paid_entitlement ? "YES" : "NO"} />
          <Row label="Manual entitlement" value={pool.x_manual_entitlement ? "YES" : "NO"} />
          <Row label="Legacy entitlement" value={pool.xmode_entitlement ? "YES" : "NO"} />
          <Row label="Config 상태" value={pool.xmode_config_status} />
        </div>

        {/* 관리 링크 */}
        <div className="bg-white border border-[#e5e5e5] rounded-lg p-5">
          <h3 className="text-[11px] font-bold text-[#999] uppercase tracking-wider mb-4">관리 도구</h3>
          <div className="flex flex-wrap gap-2">
            <a href={`/pool/${pool.id}/admin`}
              className="px-4 py-2 rounded-lg text-[12px] font-semibold border border-[#002F5F] text-[#002F5F] hover:bg-[#002F5F] hover:text-white transition-colors">
              PoolAdmin 전체 보기 →
            </a>
            {pool.homepage_slug && (
              <a href={`/${pool.homepage_slug}`} target="_blank" rel="noreferrer"
                className="px-4 py-2 rounded-lg text-[12px] font-semibold border border-[#e5e5e5] text-[#555] hover:bg-[#f5f5f5] transition-colors">
                홈페이지 보기 →
              </a>
            )}
          </div>
          <p className="text-[11px] text-[#bbb] mt-3">
            D. X Setup / E. X04 구조화 / F. AI / G. 고객센터 / H. 장애 / I. 사용자 섹션은 SA0-B에서 구현됩니다.
          </p>
        </div>
      </div>
    </div>
  );
}
