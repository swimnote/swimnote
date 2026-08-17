/**
 * SuperIncidents — 장애 관리
 * SA0-A: shell + 기존 risk-center / op-logs 재배치.
 * incidents CRUD DB는 SA0-B에서 구현. 이번 단계 DB 변경 금지.
 */
import { useState, useEffect } from "react";
import { api } from "@/lib/api";

interface RiskItem {
  id?: string;
  title?: string;
  severity?: string;
  status?: string;
  service?: string;
  started_at?: string;
  detected_at?: string;
  description?: string;
}

interface OpLog {
  id: string;
  action: string;
  actor_type?: string;
  actor_id?: string;
  pool_id?: string;
  created_at: string;
  details?: Record<string, unknown>;
}

type Tab = "risk" | "oplogs";

const sevColor: Record<string, string> = {
  SEV1: "bg-red-600 text-white",
  SEV2: "bg-red-100 text-red-700",
  SEV3: "bg-amber-100 text-amber-700",
  SEV4: "bg-gray-100 text-gray-500",
};

const statusColor: Record<string, string> = {
  OPEN:          "bg-red-50 text-red-600 border-red-200",
  INVESTIGATING: "bg-amber-50 text-amber-700 border-amber-200",
  MITIGATED:     "bg-blue-50 text-blue-700 border-blue-200",
  RESOLVED:      "bg-green-50 text-green-700 border-green-200",
};

export default function SuperIncidents() {
  const [tab, setTab] = useState<Tab>("risk");

  // Risk center
  const [riskData, setRiskData] = useState<RiskItem[]>([]);
  const [riskLoading, setRiskLoading] = useState(false);
  const [riskError, setRiskError] = useState(false);

  // Op logs
  const [opLogs, setOpLogs] = useState<OpLog[]>([]);
  const [opLoading, setOpLoading] = useState(false);
  const [opError, setOpError] = useState(false);

  useEffect(() => {
    if (tab === "risk") {
      setRiskLoading(true);
      api.get<any>("/super/risk-center")
        .then((d) => {
          const items: RiskItem[] = Array.isArray(d) ? d : (d?.incidents ?? d?.items ?? []);
          setRiskData(items);
          setRiskError(false);
        })
        .catch(() => setRiskError(true))
        .finally(() => setRiskLoading(false));
    } else {
      setOpLoading(true);
      api.get<OpLog[]>("/super/op-logs")
        .then((d) => { setOpLogs(d); setOpError(false); })
        .catch(() => setOpError(true))
        .finally(() => setOpLoading(false));
    }
  }, [tab]);

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-[20px] font-bold text-[#111]">장애 관리</h1>
        <p className="text-[12px] text-[#999] mt-0.5">서비스 장애 · 리스크 · 운영 로그</p>
      </div>

      {/* SA0-B notice */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-5 flex items-start gap-2">
        <span className="text-amber-500 text-[14px] shrink-0 mt-0.5">⚠</span>
        <div>
          <p className="text-[12px] font-semibold text-amber-800">Incident CRUD (SA0-B)</p>
          <p className="text-[11px] text-amber-700 mt-0.5">
            incidents 테이블 생성 + SEV1-4 상태 관리 + 생성/수정 폼은 SA0-B에서 구현됩니다.
            현재는 기존 risk-center 데이터 및 op-logs를 표시합니다.
          </p>
        </div>
      </div>

      {/* Sub tabs */}
      <div className="flex gap-1.5 mb-5">
        {[
          { id: "risk" as Tab,    label: "Risk Center" },
          { id: "oplogs" as Tab,  label: "운영 로그" },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-1.5 rounded-full text-[12px] font-medium transition-all ${
              tab === t.id
                ? "bg-[#002F5F] text-white"
                : "bg-white border border-[#e5e5e5] text-[#888] hover:bg-[#f5f5f5]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Risk center */}
      {tab === "risk" && (
        <div>
          {riskLoading ? (
            <div className="py-10 text-center text-[13px] text-[#aaa]">불러오는 중...</div>
          ) : riskError ? (
            <div className="bg-white border border-[#e5e5e5] rounded-lg p-6 text-center">
              <p className="text-[13px] text-[#888]">risk-center 데이터를 불러올 수 없습니다.</p>
              <p className="text-[11px] text-[#bbb] mt-1">엔드포인트: /super/risk-center</p>
            </div>
          ) : riskData.length === 0 ? (
            <div className="bg-white border border-[#e5e5e5] rounded-lg p-8 text-center">
              <p className="text-[13px] text-[#888]">현재 리스크 항목 없음</p>
              <p className="text-[11px] text-[#bbb] mt-1">SA0-B에서 신규 incidents CRUD 구현 예정</p>
            </div>
          ) : (
            <div className="space-y-2">
              {riskData.map((item, idx) => (
                <div key={item.id ?? idx} className="bg-white border border-[#e5e5e5] rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    {item.severity && (
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded ${sevColor[item.severity] ?? "bg-gray-100 text-gray-500"} shrink-0`}>
                        {item.severity}
                      </span>
                    )}
                    {item.status && (
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${statusColor[item.status] ?? "bg-gray-50 text-gray-500 border-gray-200"} shrink-0`}>
                        {item.status}
                      </span>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold text-[#111]">{item.title ?? "—"}</p>
                      {item.description && <p className="text-[11px] text-[#888] mt-0.5">{item.description}</p>}
                      <div className="flex gap-3 mt-1">
                        {item.service && <p className="text-[10px] text-[#aaa]">서비스: {item.service}</p>}
                        {item.started_at && <p className="text-[10px] text-[#aaa]">시작: {item.started_at.slice(0, 16)}</p>}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Op logs */}
      {tab === "oplogs" && (
        <div>
          {opLoading ? (
            <div className="py-10 text-center text-[13px] text-[#aaa]">불러오는 중...</div>
          ) : opError ? (
            <div className="bg-white border border-[#e5e5e5] rounded-lg p-6 text-center">
              <p className="text-[13px] text-[#888]">운영 로그를 불러올 수 없습니다.</p>
            </div>
          ) : opLogs.length === 0 ? (
            <div className="bg-white border border-[#e5e5e5] rounded-lg p-8 text-center">
              <p className="text-[13px] text-[#888]">운영 로그 없음</p>
            </div>
          ) : (
            <div className="bg-white border border-[#e5e5e5] rounded-lg overflow-hidden">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="bg-[#f8f8f8] border-b border-[#e5e5e5]">
                    <th className="text-left px-4 py-2 text-[#888] font-semibold">시각</th>
                    <th className="text-left px-4 py-2 text-[#888] font-semibold">액션</th>
                    <th className="text-left px-4 py-2 text-[#888] font-semibold">Actor</th>
                    <th className="text-left px-4 py-2 text-[#888] font-semibold">Pool</th>
                  </tr>
                </thead>
                <tbody>
                  {opLogs.slice(0, 100).map((log) => (
                    <tr key={log.id} className="border-b border-[#f5f5f5] hover:bg-[#fafafa]">
                      <td className="px-4 py-2 text-[#aaa] whitespace-nowrap">{log.created_at?.slice(0, 16)}</td>
                      <td className="px-4 py-2 font-medium text-[#333]">{log.action}</td>
                      <td className="px-4 py-2 text-[#888]">{log.actor_type}/{log.actor_id}</td>
                      <td className="px-4 py-2 text-[#aaa]">{log.pool_id ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
