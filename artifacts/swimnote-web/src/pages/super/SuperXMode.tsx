/**
 * SuperXMode — X MODE 운영
 * X 수영장 목록 + XSetupTab 직접 연결 (재사용, 복제 금지)
 * XSetupTab은 PoolAdmin.tsx에서 export 처리
 */
import { useState, useEffect } from "react";
import { api, getToken } from "@/lib/api";
import { XSetupTab } from "@/pages/PoolAdmin";

interface XPool {
  id: string;
  name: string;
  xmode_config_status?: string | null;
  x_paid_entitlement?: boolean | null;
  x_manual_entitlement?: boolean | null;
  xmode_entitlement?: boolean | null;
  approval_status: string;
}

const xStatusLabel: Record<string, string> = {
  NOT_CONFIGURED: "미설정",
  READY: "준비완료",
  CURRICULUM_PENDING: "커리큘럼 대기",
  SUBMITTED: "제출완료",
  UNDER_REVIEW: "검토중",
  REVISION_REQUESTED: "수정요청",
  APPROVED: "승인",
};
const xStatusColor: Record<string, string> = {
  NOT_CONFIGURED: "bg-gray-100 text-gray-500",
  READY: "bg-blue-50 text-blue-700",
  CURRICULUM_PENDING: "bg-amber-50 text-amber-700",
  SUBMITTED: "bg-purple-50 text-purple-700",
  UNDER_REVIEW: "bg-blue-50 text-blue-700",
  REVISION_REQUESTED: "bg-red-50 text-red-600",
  APPROVED: "bg-green-50 text-green-700",
};

export default function SuperXMode() {
  const [pools, setPools] = useState<XPool[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPool, setSelectedPool] = useState<XPool | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    api.get<any[]>("/admin/pools?approval_status=approved")
      .then((data) => {
        const xPools = data.filter(
          (p) => p.x_paid_entitlement || p.x_manual_entitlement || p.xmode_entitlement
        );
        setPools(xPools);
      })
      .catch(() => setPools([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = pools.filter((p) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q);
  });

  const token = getToken() ?? "";

  return (
    <div className="flex h-full" style={{ minHeight: "calc(100vh - 0px)" }}>
      {/* Left: Pool list */}
      <div className="w-72 border-r border-[#e5e5e5] bg-white flex flex-col shrink-0">
        <div className="p-4 border-b border-[#e5e5e5]">
          <h1 className="text-[15px] font-bold text-[#111] mb-3">X MODE 운영</h1>
          <input
            type="text"
            placeholder="수영장 검색..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-3 py-1.5 rounded-lg border border-[#e5e5e5] text-[12px] text-[#111] placeholder:text-[#ccc] focus:outline-none focus:border-[#002F5F]"
          />
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="py-8 text-center text-[12px] text-[#aaa]">불러오는 중...</div>
          ) : filtered.length === 0 ? (
            <div className="py-8 text-center text-[12px] text-[#aaa]">
              {searchQuery ? "검색 결과 없음" : "X 수영장 없음"}
            </div>
          ) : (
            filtered.map((pool) => {
              const configStatus = pool.xmode_config_status ?? "NOT_CONFIGURED";
              const isSelected = selectedPool?.id === pool.id;
              return (
                <button
                  key={pool.id}
                  onClick={() => setSelectedPool(pool)}
                  className={`w-full text-left px-4 py-3 border-b border-[#f0f0f0] transition-colors ${
                    isSelected ? "bg-[#002F5F] text-white" : "hover:bg-[#f8f8f8]"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className={`text-[13px] font-semibold truncate ${isSelected ? "text-white" : "text-[#111]"}`}>
                        {pool.name}
                      </p>
                      <p className={`text-[10px] mt-0.5 truncate ${isSelected ? "text-[#aac5ef]" : "text-[#999]"}`}>
                        {pool.id}
                      </p>
                    </div>
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 mt-0.5 ${
                      isSelected
                        ? "bg-white/20 text-white"
                        : (xStatusColor[configStatus] ?? "bg-gray-100 text-gray-500")
                    }`}>
                      {xStatusLabel[configStatus] ?? configStatus}
                    </span>
                  </div>
                  <div className={`flex gap-1 mt-1`}>
                    {pool.x_paid_entitlement && <span className={`text-[10px] ${isSelected ? "text-[#aac5ef]" : "text-blue-600"}`}>유료</span>}
                    {pool.x_manual_entitlement && <span className={`text-[10px] ${isSelected ? "text-[#aac5ef]" : "text-purple-600"}`}>수동</span>}
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div className="px-4 py-3 border-t border-[#e5e5e5]">
          <p className="text-[11px] text-[#aaa]">총 {pools.length}개 X 수영장</p>
        </div>
      </div>

      {/* Right: XSetupTab */}
      <div className="flex-1 overflow-y-auto bg-[#f5f5f7]">
        {selectedPool ? (
          <div className="p-0">
            {/* Pool header */}
            <div className="px-6 py-4 bg-white border-b border-[#e5e5e5] flex items-center justify-between">
              <div>
                <h2 className="text-[15px] font-bold text-[#111]">{selectedPool.name}</h2>
                <p className="text-[11px] text-[#999]">{selectedPool.id}</p>
              </div>
              <a
                href={`/pool/${selectedPool.id}/admin`}
                className="text-[11px] text-[#002F5F] border border-[#002F5F] px-3 py-1 rounded-lg hover:bg-[#002F5F] hover:text-white transition-colors"
              >
                PoolAdmin 전체 보기 →
              </a>
            </div>
            {/* XSetupTab reuse */}
            <div className="p-4">
              <XSetupTab
                poolId={selectedPool.id}
                token={token}
                apiBase="/api"
              />
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center py-20">
            <div className="text-[40px] mb-4">⚡</div>
            <p className="text-[14px] font-semibold text-[#555]">X 수영장을 선택하세요</p>
            <p className="text-[12px] text-[#aaa] mt-1">왼쪽 목록에서 수영장을 클릭하면 X Setup이 표시됩니다</p>
          </div>
        )}
      </div>
    </div>
  );
}
