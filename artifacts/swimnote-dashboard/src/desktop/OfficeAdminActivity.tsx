import {useQuery} from "@tanstack/react-query";
import {api} from "../lib/api-client";
import {download,toCsv} from "./office-ops-lib";
import {ui} from "./office-ops-styles";
import {useReportPageState} from "../pages/growth-reports/ReportWorkflow";
const SPECS=[
  ["members","현재 회원","명 · 기간 무관"],
  ["registrations","신규 계약","계약 건 · 시작일"],
  ["renewals","재등록 계약","계약 건 · 시작일"],
  ["attendance","출결 기록","기록 건 · 출결일"],
  ["makeups","보강 대상","보강 건 · 원 결석일"],
] as const;
type Kind=typeof SPECS[number][0];
type Report={reportVersion:number;counts:Partial<Record<Kind,number>>;total:number;offset:number;limit:number;items:Array<{
  kind:Kind;id:string;student_id:string;name:string;date:string|null;status:string;label:string;
}>};
export function OfficeAdminActivity({scope,from,to,studentId,search}:{scope:string;from:string;to:string;studentId:string;search:string}){
  const [kind,setKind]=useReportPageState<Kind>("admin-activity-kind","members");
  const [offset,setOffset]=useReportPageState(`admin-activity-offset:${kind}:${from}:${to}:${studentId}:${search}`,0);
  const q=useQuery({queryKey:["office-activity",scope,from,to,studentId,search,kind,offset],retry:false,refetchOnMount:"always",refetchInterval:30000,
    queryFn:async()=>{
      const params=new URLSearchParams({from,to,studentId,search,kind,offset:String(offset),limit:"100"});
      const r=await api.get<Report>(`/office/operations/activity-report?${params}`);
      if(r.reportVersion!==1||!Array.isArray(r.items)||!Number.isSafeInteger(r.total))throw new Error("현황 보고서 계약 적용 대기입니다.");
      return r;
    }});
  const d=q.data,head=["기록ID","회원ID","회원","기준일","원본 상태","집계 기준"];
  const rows=d?.items.map(r=>[r.id,r.student_id,r.name,r.date??"현재",r.status,r.label])??[];
  return <section style={ui.box} data-testid="admin-activity">
    <strong>관리자 통합 현황 · 원본 업무 기록 조회</strong>
    <p style={{fontSize:12}}>기간 {from}~{to} · 회원 {studentId||"전체"} · 검색 {search||"없음"}. 회원은 현재 인원이며 신규·재등록은 현재 활성 OFFICE 계약의 시작일 기준 건수입니다. 과거 앱 등록 전체나 실결제 거래 건수로 합산하지 않습니다. 취소·초안 계약은 제외하고 출결·보강은 원본 상태를 함께 표시합니다.</p>
    {q.isLoading&&<p role="status">현황 조회 중…</p>}
    {q.isError&&<p role="alert">현황 조회 실패·서버 적용 대기입니다. 0건으로 추정하지 않습니다. <button onClick={()=>q.refetch()}>다시 조회</button></p>}
    {d&&!q.isError&&<>
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>{SPECS.map(([key,label,unit])=>
        <button style={key===kind?ui.btn:ui.btn2} key={key} onClick={()=>setKind(key)}>{label} {d.counts[key]??0} ({unit})</button>)}</div>
      <p>{SPECS.find(s=>s[0]===kind)?.[1]} 상세 · {d.total}건 중 {d.items.length?offset+1:0}~{offset+d.items.length} · 현재 페이지 최대 100건</p>
      <div style={{overflowX:"auto"}}><table style={{width:"100%",fontSize:12}}><thead><tr>{head.map(h=><th key={h}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((row,i)=><tr key={d.items[i].id}>{row.map((v,j)=><td key={j}>{v}</td>)}</tr>)}</tbody></table></div>
      {!rows.length&&<p>같은 조건의 기록이 없습니다.</p>}
      <div data-finance-noprint style={{display:"flex",gap:6}}>
        <button style={ui.btn2} disabled={!offset||q.isFetching} onClick={()=>setOffset(n=>Math.max(0,n-100))}>이전 100건</button>
        <button style={ui.btn2} disabled={offset+100>=d.total||q.isFetching} onClick={()=>setOffset(n=>n+100)}>다음 100건</button>
        <button style={ui.btn2} disabled={q.isFetching} onClick={()=>download(`activity-${kind}-${from}_${to}-page${offset/100+1}.csv`,
          toCsv(["조회 시작",from,"조회 종료",to],[
            ["회원",studentId||"전체","검색",search||"없음"],["선택 구분",kind,"전체 건수",d.total],
            ["출력 범위","현재 페이지","페이지 건수",rows.length],head,...rows]))}>현재 페이지 CSV · 전체 {d.total}건 아님</button>
      </div>
    </>}
  </section>;
}
