/**
 * SuperBilling — 구독 / 결제
 * SA0-A: 플레이스홀더. SA0-B에서 실제 데이터 연결.
 */
export default function SuperBilling() {
  return (
    <div className="p-6 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-[20px] font-bold text-[#111]">구독 / 결제</h1>
        <p className="text-[12px] text-[#999] mt-0.5">Basic · X 구독 상태 및 결제 이상 관리</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
        {[
          { label: "Basic 활성", value: "—" },
          { label: "X 활성", value: "—" },
          { label: "결제 실패", value: "—", warn: true },
          { label: "해지예정", value: "—" },
          { label: "만료", value: "—" },
          { label: "Sync 대기", value: "—" },
        ].map((s) => (
          <div key={s.label} className="bg-white border border-[#e5e5e5] rounded-lg px-4 py-3">
            <p className="text-[11px] text-[#aaa] mb-1">{s.label}</p>
            <p className={`text-[22px] font-bold ${s.warn ? "text-amber-600" : "text-[#111]"}`}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="space-y-3">
        {[
          { title: "Basic 구독", desc: "trial · active · expired · suspended · cancelled 상태별 목록" },
          { title: "X 구독", desc: "ACTIVE · CANCELLED_BUT_ACTIVE · EXPIRED · BILLING_ISSUE 필터" },
          { title: "결제 실패", desc: "payment_failed_at 기록 수영장 목록" },
          { title: "RevenueCat Events", desc: "최근 webhook 이벤트 · 실패 · sync pending" },
          { title: "Entitlement Anomalies", desc: "entitlement 불일치 감지" },
        ].map((item) => (
          <div key={item.title} className="bg-white border border-[#e5e5e5] rounded-lg p-4 flex items-start justify-between">
            <div>
              <p className="text-[14px] font-semibold text-[#111]">{item.title}</p>
              <p className="text-[12px] text-[#888] mt-0.5">{item.desc}</p>
            </div>
            <span className="text-[11px] text-[#bbb] bg-[#f5f5f5] px-2 py-1 rounded-full shrink-0 ml-3">SA0-B</span>
          </div>
        ))}
      </div>
    </div>
  );
}
