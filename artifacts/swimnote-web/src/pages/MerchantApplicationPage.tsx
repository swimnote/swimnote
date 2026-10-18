import { useEffect, useState } from "react";

const STAGES = [
  ["준비 중", "필요한 서류와 담당자를 센터 내부에서 정리합니다."],
  ["신청서 제출", "제공사 절차에 따라 센터가 직접 제출했다고 기록합니다."],
  ["계약 체결", "계약이 끝난 사실을 센터가 확인해 기록합니다."],
  ["심사 승인", "승인 안내를 센터가 확인해 기록합니다."],
  ["결제 사용 개시", "센터가 사용 개시를 확인해 기록합니다."],
];
const ITEMS = ["신청 담당자 지정", "사업자 관련 서류 보유 여부 확인", "정산 받을 계좌 명의 확인 (번호는 이 화면에 적지 마세요)", "환불 기준 문서 정리", "제공사 안내 문서 수령 후 검토"];

export default function MerchantApplicationPage() {
  const [done, setDone] = useState<boolean[]>(ITEMS.map(() => false));
  useEffect(() => {
    document.title = "가맹점 신청 안내 | SWIMNOTE OFFICE";
    const existing=document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const meta=existing??document.createElement("meta"),previous=meta.content;
    meta.name="description";meta.content="스윔노트 오피스 가맹점 결제 신청 준비와 진행 단계 안내. 공식 계약·서류 경로는 제휴 문서 확인 후 연결합니다.";
    if(!existing)document.head.appendChild(meta);
    return()=>{if(existing)meta.content=previous;else meta.remove();};
  }, []);
  const wrap = { maxWidth: 760, margin: "0 auto", padding: "48px 20px" } as const;
  const card = { border: "1px solid var(--ds-border-strong)", borderRadius: 8, padding: 16, background: "var(--ds-n-050)" } as const;
  return <div style={wrap}>
    <p translate="no" style={{ fontSize: "var(--ds-text-label)", letterSpacing: "var(--ds-ls-wider)", color: "var(--ds-n-400)" }}>SWIMNOTE OFFICE</p>
    <h1 style={{ fontSize: "clamp(26px,5vw,38px)", letterSpacing: "-0.03em", color: "var(--ds-n-900)", margin: "8px 0 16px" }}>가맹점 신청 안내</h1>
    <p style={{ color: "var(--ds-text-secondary)", lineHeight: 1.7 }}>결제 사용을 준비하는 센터를 위한 안내입니다. 스윔노트는 신청서를 대신 제출하지 않으며, 센터가 진행 상황을 직접 기록합니다.</p>
    <h2 style={{ fontSize: 20, margin: "36px 0 12px" }}>비용 구분</h2>
    <div style={{ ...card, lineHeight: 1.7, color: "var(--ds-text-secondary)" }}>
      <p>스윔노트의 가맹점 진행 기록 기능 자체는 무료 정책으로 제공됩니다.</p>
      <p>외부 결제 제공사가 부과하는 수수료와 조건은 별개이며 제공사와 센터 사이에서 정해집니다. 스윔노트는 그 금액을 안내하거나 보증하지 않습니다.</p>
    </div>
    <h2 style={{ fontSize: 20, margin: "36px 0 12px" }}>진행 단계</h2>
    <ol style={{ paddingLeft: 20, lineHeight: 1.7, color: "var(--ds-text-secondary)" }}>{STAGES.map(([t, d]) => <li key={t}><strong>{t}</strong>: {d}</li>)}</ol>
    <p style={{ fontSize: 13, color: "var(--ds-n-500)" }}>모든 단계는 센터가 입력한 수기 기록이며 제공사가 확인한 결과가 아닙니다. 어느 단계에서도 PG 결제와 정산은 아직 제공되지 않습니다.</p>
    <h2 style={{ fontSize: 20, margin: "36px 0 12px" }}>공식 신청서와 서류</h2>
    <div style={card} data-testid="status-official-link-pending">공식 신청 페이지와 서류 연결은 제휴 문서 확정 후 안내됩니다. 이 프로젝트에 확인된 공식 경로는 아직 등록되지 않았습니다.</div>
    <h2 style={{ fontSize: 20, margin: "36px 0 12px" }}>준비 체크리스트</h2>
    <p style={{ fontSize: 13, color: "var(--ds-n-500)" }}>이 목록은 현재 화면에서만 유지되며 저장되거나 전송되지 않습니다. 개인정보와 계좌번호는 입력하지 마세요.</p>
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{ITEMS.map((t, i) => <label key={t} style={{ display: "flex", gap: 10, alignItems: "flex-start", minHeight: 36 }}>
      <input type="checkbox" checked={done[i]} onChange={() => setDone(d => d.map((v, n) => n === i ? !v : v))} data-testid={`check-prep-${i}`} /><span>{t}</span></label>)}</div>
    <h2 style={{ fontSize: 20, margin: "36px 0 12px" }}>센터별 진행 상황</h2>
    <p style={{ color: "var(--ds-text-secondary)", lineHeight: 1.7 }}>개별 센터의 진행 상태는 이 공개 페이지에 표시되지 않습니다. 권한이 있는 관리자가 PC 대시보드에 로그인한 뒤 재무 탭에서 기록하고 확인합니다.</p>
  </div>;
}
