import {useQuery,useQueryClient} from "@tanstack/react-query";
import * as XLSX from "xlsx";
import {api} from "../lib/api-client";
import {useOfficeFormState} from "./office-form-bridge";
import {confirmRecoveryPointer} from "./OfficeRecovery";
import type {TransportRunPlan} from "../../../../lib/api-zod/src/transport";
const root="/transport";
const uuid=()=>crypto.randomUUID();
const KINDS=[["FUEL","주유"],["MAINTENANCE","정비"],["INSURANCE","보험"],["INSPECTION","검사"]] as const;
type Op={path:string;body:any};
const init=()=>({open:"planning",date:new Date().toLocaleDateString("sv-SE",{timeZone:"Asia/Seoul"}),settings:null as any,rev:0,
  calc:null as any,from:1,text:"",interp:null as any,vehicleId:"",kind:"FUEL",rec:{date:"",amount:"",odometer:"",note:"",dueDate:"",expenseId:""},
  runId:"",aiText:"",ai:null as any,invPhone:"",invDuty:"DRIVER",invCode:"",certReason:"",signature:"",decision:"LINK_EXISTING",resolveReason:"",eventId:"",doc:null as any,op:null as Op|null,busy:false,message:""});
export function OfficeTransportOperations({scope,plan,runId:editRunId,records,runs,locked,onPlan}:{scope:string;plan:TransportRunPlan;runId?:string;records:{id:string;kind:string;data:any}[];runs:any[];locked:boolean;onPlan:(p:TransportRunPlan)=>void}){
  const [s,set]=useOfficeFormState(`${scope}:transport-ops`,init()),qc=useQueryClient();
  const planning=useQuery({queryKey:["transport-planning",scope,s.date],queryFn:async()=>{const d=await api.get<any>(`${root}/planning?date=${encodeURIComponent(s.date)}`);if(!Array.isArray(d?.classes)||!Array.isArray(d?.items)||!Array.isArray(d?.warnings)||!d?.settings?.data)throw Error("계획 응답 계약을 확인하지 못했습니다.");return d;},retry:false});
  const ops=useQuery({queryKey:["transport-operations",scope,s.vehicleId],queryFn:async()=>{const d=await api.get<any>(`${root}/operations?vehicleId=${encodeURIComponent(s.vehicleId)}`);if(!Array.isArray(d?.items))throw Error("기록 응답 계약을 확인하지 못했습니다.");return d;},enabled:!!s.vehicleId,retry:false});
  const recon=useQuery({queryKey:["transport-recon",scope],queryFn:async()=>{const d=await api.get<any>(`${root}/reconciliation`);if(!Array.isArray(d?.items))throw Error("대조 응답 계약을 확인하지 못했습니다.");return d;},retry:false});
  const cap=useQuery({queryKey:["transport-ai-cap",scope],queryFn:async()=>{const d=await api.get<any>(`${root}/planning/ai-capability`);if(typeof d?.enabled!=="boolean")throw Error("AI 사용 가능 응답 계약을 확인하지 못했습니다.");return d;},retry:false});
  const notes=useQuery({queryKey:["transport-notifications",scope],queryFn:async()=>{const d=await api.get<any>(`${root}/notifications`);if(!Array.isArray(d?.items))throw Error("알림 진단 응답 계약을 확인하지 못했습니다.");return d;},retry:false,refetchInterval:10000});
  const pd=planning.data,settings=s.settings??pd?.settings?.data,rev=s.settings?s.rev:pd?.settings?.revision??0;
  const blocked=locked||s.busy||!!s.op;
  const patchSettings=(f:(d:any)=>any)=>set(o=>({...o,settings:f(structuredClone(o.settings??pd?.settings?.data??{departureBufferMinutes:0,handoverBufferMinutes:0,durations:{},overrides:[],travel:[]})),rev:o.settings?o.rev:pd?.settings?.revision??0}));
  function finish(op:Op,r:any){
    if(!r||typeof r!=="object"||r.error)throw {status:502,message:"처리 결과를 대조하지 못했습니다."};
    if(op.path.endsWith("/planning/ai-propose")){if(r.modelCalled!==true||!Array.isArray(r.plan?.steps)||typeof r.id!=="string")throw {status:502,message:"AI 제안 결과를 대조하지 못했습니다."};set(o=>({...o,ai:r,op:null,busy:false,message:"모델 해석 + 결정론 초안입니다. 적용 전에는 편집기가 바뀌지 않으며 저장·게시되지 않았습니다."}));return;}
    if(op.path.endsWith("/onboarding/invites")){if(typeof r.inviteCode!=="string"||r.sent!==false)throw {status:502,message:"초대 결과를 대조하지 못했습니다."};set(o=>({...o,invCode:r.inviteCode,invPhone:""}));}
    if(op.path.endsWith("/planning/settings"))set(o=>({...o,settings:null}));
    set(o=>({...o,op:null,busy:false,message:"서버 반영 확인. 푸시·알림·공식 제출은 하지 않았습니다."}));
    ["transport-planning","transport-operations","transport-recon","transport-notifications","transport-v2","transport-v2-detail"].forEach(k=>qc.invalidateQueries({queryKey:[k]}));
  }
  async function write(path:string,body:any){
    if(blocked)return;const op={path:`${root}${path}`,body:{...body,requestId:uuid()}};
    set(o=>({...o,op,busy:true,message:""}));
    try{finish(op,await api.post(op.path,op.body));}
    catch(e:any){set(o=>({...o,busy:false,op:!e.status||e.status>=500||e.code==="OFFICE_OUTCOME_UNKNOWN"?op:null,message:e.message??"결과 불명"}));}
  }
  async function recover(){
    if(!s.op||s.busy)return;const op=s.op;set(o=>({...o,busy:true}));
    try{const r=await api.get(`${root}/requests/${op.body.requestId}`);await confirmRecoveryPointer(op.body.requestId,r);finish(op,r);}
    catch(e:any){set(o=>({...o,busy:false,message:`${e.message}. 기록 없음도 미처리 증거가 아닙니다. 재전송하지 않습니다.`}));}
  }
  async function compute(path:string,body:any,apply:(r:any)=>void){
    if(blocked)return;set(o=>({...o,busy:true,message:""}));
    try{apply(await api.post(`${root}${path}`,body));}catch(e:any){set(o=>({...o,message:e.message}));}finally{set(o=>({...o,busy:false}));}
  }
  async function load(id:string){
    if(blocked)return;set(o=>({...o,busy:true,message:""}));
    try{const doc=await api.get<any>(`${root}/runs/${id}/document`);set(o=>({...o,doc}));}catch(e:any){set(o=>({...o,message:e.message}));}finally{set(o=>({...o,busy:false}));}
  }
  const num=(v:string)=>v===""?undefined:Number(v);
  const f=(label:string,value:any,fn:(x:string)=>void,type="text")=><label className="block">{label}<input className="border p-2 rounded block" aria-label={label} type={type} value={value??""} onChange={e=>fn(e.target.value)}/></label>;
  const vehicles=records.filter(x=>x.kind==="vehicle");
  const tabs=[["invite","신규 직원 초대"],["planning","수업·시간 기준 배차 초안"],["records","차량 주유·정비·보험·검사"],["recon","대조 보류 처리"],["doc","운행 기록 문서·확인"]];
  const rows:any[]=ops.data?.items??[];
  function exportXlsx(){
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rows.map(r=>({종류:r.kind,차량:r.vehicleId,일자:r.data?.date,금액:r.data?.amount,주행거리:r.data?.odometer,만료일:r.data?.dueDate,메모:r.data?.note,기록시각:r.created_at}))),"차량 기록");
    XLSX.writeFile(wb,`transport-records-${s.vehicleId}.xlsx`);
  }
  function exportDoc(){
    const d=s.doc;if(!d)return;const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([[d.label],["hash",d.hash],["official",String(d.official)]]),"문서");
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(d.events.map((e:any)=>({...e,studentIds:(e.studentIds??[]).join(",")}))),"이벤트");
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(d.certifications??[]),"확인");
    XLSX.writeFile(wb,`transport-run-${d.run?.id??"run"}.xlsx`);
  }
  const pending:any[]=(recon.data?.items??[]).filter((x:any)=>!x.resolution&&x.status!=="RESOLVED");
  return <section className="border rounded p-4 space-y-3" aria-label="운행 계획·운영 기록">
    <h2 className="font-semibold text-lg">수업 시간 기준 계획·차량 운영 기록</h2>
    <p>도로 최적화·AI 모델 호출이 아닙니다. 계산 결과는 제안일 뿐 자동 저장·게시되지 않으며 법적 준수 판정이 아닙니다.</p>
    {tabs.map(([k,l])=><button key={k} className="border p-2 mr-2" aria-pressed={s.open===k} onClick={()=>set(o=>({...o,open:k}))}>{l}</button>)}
    <fieldset disabled={blocked} className="space-y-3">
    {s.open==="invite"&&<>
      <p>직원 휴대폰 번호와 역할에 묶인 1회용 초대입니다. 문자·알림은 발송하지 않으며 아래 코드를 본인에게 직접 전달하세요. 직원은 앱 가입 시 같은 번호로 인증해야 합니다.</p>
      {f("직원 휴대폰 번호",s.invPhone,x=>set(o=>({...o,invPhone:x})),"tel")}
      <label>운행 역할<select aria-label="운행 역할" value={s.invDuty} onChange={e=>set(o=>({...o,invDuty:e.target.value}))}><option value="DRIVER">기사</option><option value="ESCORT">인솔자</option></select></label>
      <button disabled={!/^01[016789]\d{7,8}$/.test(s.invPhone.replace(/[-\s]/g,""))} onClick={()=>window.confirm(`${s.invPhone} / ${s.invDuty}\n운행 전용 초대 코드를 만듭니다. 관리자·강사 권한은 부여하지 않으며 문자는 발송하지 않습니다.`)&&void write("/onboarding/invites",{phone:s.invPhone.replace(/[-\s]/g,""),duty:s.invDuty,confirmed:true})}>초대 코드 생성</button>
      {s.invCode&&<p>1회 화면 전달 코드(발송 안 됨): <code>{s.invCode}</code> <button onClick={()=>set(o=>({...o,invCode:""}))}>코드 숨기기</button></p>}
    </>}
    {s.open==="planning"&&<>
      {f("계획 기준일",s.date,x=>set(o=>({...o,date:x,settings:null})),"date")}
      {planning.error&&<p role="alert">계획 조회 실패: {(planning.error as Error).message}</p>}
      {planning.isPending&&<p>계획 자료 조회 중</p>}
      {pd&&<>
        {pd.warnings.map((w:string)=><p key={w}>{w}</p>)}
        <h3>수업 시간 기준(명시 입력만 사용, 기본 수업 길이 추정 없음) · 버전 {rev}</h3>
        {f("출발 여유(분)",settings?.departureBufferMinutes,x=>patchSettings(d=>({...d,departureBufferMinutes:Number(x)})),"number")}
        {f("인계 여유(분)",settings?.handoverBufferMinutes,x=>patchSettings(d=>({...d,handoverBufferMinutes:Number(x)})),"number")}
        {pd.classes.map((c:any)=><div key={c.id}>{f(`수업 길이(분) ${c.name}`,settings?.durations?.[c.id]??"",x=>patchSettings(d=>{const n={...d.durations};if(x==="")delete n[c.id];else n[c.id]=Number(x);return {...d,durations:n};}),"number")}<small>{c.schedule_days} {c.schedule_time}</small></div>)}
        <h4>날짜별 휴강·변경</h4>
        {(settings?.overrides??[]).map((v:any,i:number)=><div key={i} className="border p-2">
          <select aria-label={`변경 수업 ${i+1}`} value={v.classId} onChange={e=>patchSettings(d=>{d.overrides[i].classId=e.target.value;return d;})}><option value="">선택</option>{pd.classes.map((c:any)=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
          {f(`변경 날짜 ${i+1}`,v.date,x=>patchSettings(d=>{d.overrides[i].date=x;return d;}),"date")}
          <label><input type="checkbox" checked={!!v.cancelled} onChange={e=>patchSettings(d=>{d.overrides[i].cancelled=e.target.checked;return d;})}/>휴강</label>
          {!v.cancelled&&<>{f(`변경 시작 ${i+1}`,v.start,x=>patchSettings(d=>{d.overrides[i].start=x;return d;}),"time")}{f(`변경 종료 ${i+1}`,v.end,x=>patchSettings(d=>{d.overrides[i].end=x;return d;}),"time")}</>}
          <button onClick={()=>patchSettings(d=>({...d,overrides:d.overrides.filter((_:any,n:number)=>n!==i)}))}>제외</button></div>)}
        <button onClick={()=>patchSettings(d=>({...d,overrides:[...d.overrides,{classId:"",date:s.date,cancelled:true}]}))}>휴강·변경 추가</button>
        <h4>구간 이동분(관리자 등록·근거 필수)</h4>
        {(settings?.travel??[]).map((v:any,i:number)=><div key={i} className="border p-2">
          {f(`이동 출발 ${i+1}`,v.from,x=>patchSettings(d=>{d.travel[i].from=x;return d;}))}{f(`이동 도착 ${i+1}`,v.to,x=>patchSettings(d=>{d.travel[i].to=x;return d;}))}
          {f(`이동 분 ${i+1}`,v.minutes,x=>patchSettings(d=>{d.travel[i].minutes=Number(x);return d;}),"number")}{f(`이동 근거 ${i+1}`,v.evidence,x=>patchSettings(d=>{d.travel[i].evidence=x;return d;}))}
          <button onClick={()=>patchSettings(d=>({...d,travel:d.travel.filter((_:any,n:number)=>n!==i)}))}>제외</button></div>)}
        <button onClick={()=>patchSettings(d=>({...d,travel:[...d.travel,{from:"",to:"",minutes:0,evidence:""}]}))}>이동 구간 추가</button>
        <button disabled={!s.settings} onClick={()=>window.confirm("명시한 수업·여유·이동 기준을 서버에 저장합니다. 계속합니까?")&&void write("/planning/settings",{expectedRevision:rev,data:settings})}>시간 기준 저장</button>
        <h3>회원별 수업 창 대조</h3>
        {pd.items.length===0&&<p>대조할 회원이 없습니다.</p>}
        {pd.items.map((it:any)=><p key={it.studentId}>{it.name} [{it.studentId}] · {it.enabled?"이용":"제외"} · {it.windows.map((w:any)=>`${w.start}-${w.end}(${w.source})`).join(", ")||"수업 창 없음"}{it.issues.length?` · 확인 필요: ${it.issues.join(" / ")}`:""}</p>)}
      </>}
      <h3>제약 기반 초안(고정 단계 보존·자동 저장 없음)</h3>
      {f("계산 시작 순번",s.from,x=>set(o=>({...o,from:Number(x)})),"number")}
      <button onClick={()=>void compute("/planning/calculate",{plan,from:s.from,...(editRunId?{id:editRunId}:{})},r=>set(o=>({...o,calc:r,message:"결정론적 제약 초안입니다. 적용 전에는 편집기가 바뀌지 않습니다."})))}>초안 계산</button>
      {s.calc&&<div className="border p-2">
        <p>{s.calc.source} · {s.calc.complete?"전체 배정":"미완성"} · 적용 전</p>
        {s.calc.unassigned.map((u:any)=><p key={u.studentId} role="alert">미배정 {u.studentId}: {u.reason}</p>)}
        {s.calc.conflicts.map((c:string)=><p key={c} role="alert">충돌: {c}</p>)}
        <p>제안 {s.calc.plan.steps.length}단계</p>
        <button onClick={()=>{if(window.confirm(`${s.calc.complete?"":"미완성 초안입니다. "}편집기에 적용합니다. 저장·게시는 따로 해야 합니다.`)){onPlan(s.calc.plan);set(o=>({...o,calc:null,message:"편집기에 적용했습니다. 저장 전입니다."}));}}}>편집기에 적용(저장 아님)</button>
        <button onClick={()=>set(o=>({...o,calc:null}))}>제안 버리기</button></div>}
      <h3>모델 보조 제안(운영자 비용 승인 필요, 별도 기능)</h3>
      {cap.error&&<p role="alert">AI 사용 가능 여부 조회 실패: {(cap.error as Error).message}</p>}
      {cap.data&&<p>{cap.data.enabled?"사용 가능":"비활성"} · {cap.data.reason}{cap.data.model?` · 모델 ${cap.data.model}`:""}{cap.data.maxTokens?` · 최대 ${cap.data.maxTokens} 토큰`:""}</p>}
      {f("모델에 전달할 조건 문장",s.aiText,x=>set(o=>({...o,aiText:x})))}
      <button disabled={!cap.data?.enabled||!s.aiText.trim()} onClick={()=>window.confirm(`모델을 실제 호출합니다. 비용이 발생할 수 있습니다.\n${cap.data?.model??""}\n결과는 제안이며 저장·게시되지 않습니다.`)&&void write("/planning/ai-propose",{text:s.aiText,plan,from:s.from,...(editRunId?{id:editRunId}:{})})}>모델 제안 요청(비용 발생)</button>
      {s.ai&&<div className="border p-2">
        <p>{s.ai.source} · 모델 호출 {String(s.ai.modelCalled)} · 원 요청 {s.ai.id} · {s.ai.complete?"전체 배정":"미완성"} · 적용 전</p>
        {s.ai.unassigned.map((u:any)=><p key={u.studentId} role="alert">미배정 {u.studentId}: {u.reason}</p>)}
        {s.ai.conflicts.map((c:string)=><p key={c} role="alert">충돌: {c}</p>)}
        <p>제안 {s.ai.plan.steps.length}단계</p>
        <button onClick={()=>{if(window.confirm("편집기에 적용합니다. 저장·게시는 따로 해야 합니다.")){onPlan(s.ai.plan);set(o=>({...o,ai:null,message:"편집기에 적용했습니다. 저장 전입니다."}));}}}>모델 제안 편집기에 적용(저장 아님)</button>
        <button onClick={()=>set(o=>({...o,ai:null}))}>제안 버리기</button></div>}
      <h3>조건 문장 해석(로컬 규칙, 모델 호출 없음)</h3>
      {f("조건 문장",s.text,x=>set(o=>({...o,text:x})))}
      <button disabled={!s.text.trim()} onClick={()=>void compute("/planning/interpret",{text:s.text},r=>set(o=>({...o,interp:r})))}>조건 해석</button>
      {s.interp&&<div className="border p-2"><p>{s.interp.source} · 모델 호출 {String(s.interp.modelCalled)}</p><pre>{JSON.stringify(s.interp.proposal,null,2)}</pre>
        <button onClick={()=>{const pr=s.interp.proposal??{};const patch:any={};if(typeof pr.date==="string")patch.date=pr.date;if(typeof pr.capacity==="number")patch.capacity=pr.capacity;if(typeof pr.startTime==="string")patch.startTime=pr.startTime;if(typeof pr.returnBy==="string")patch.returnBy=pr.returnBy;onPlan({...plan,...patch});set(o=>({...o,interp:null,message:"해석된 날짜·시각·정원만 편집기에 적용했습니다. 저장 전입니다."}));}}>해석 결과 편집기 적용</button></div>}
    </>}
    {s.open==="records"&&<>
      <label>기록 차량<select aria-label="기록 차량" value={s.vehicleId} onChange={e=>set(o=>({...o,vehicleId:e.target.value}))}><option value="">선택</option>{vehicles.map(v=><option key={v.id} value={v.id}>{v.data.name} [{v.id}]</option>)}</select></label>
      {ops.error&&<p role="alert">기록 조회 실패: {(ops.error as Error).message}</p>}
      {s.vehicleId&&ops.isPending&&<p>기록 조회 중</p>}
      {s.vehicleId&&ops.data&&<>
        {rows.length===0?<p>이 차량의 기록이 없습니다. 아래에서 추가하세요. 기록은 추가만 가능합니다.</p>:<table className="border"><thead><tr><th>종류</th><th>일자</th><th>금액</th><th>주행</th><th>만료</th><th>메모</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td>{r.kind}</td><td>{r.data?.date}</td><td>{r.data?.amount}</td><td>{r.data?.odometer}</td><td>{r.data?.dueDate}</td><td>{r.data?.note}</td></tr>)}</tbody></table>}
        <button disabled={!rows.length} onClick={exportXlsx}>불러온 기록 XLSX 내보내기</button>
        {(ops.data.certifications??[]).length>0&&<p>확인 기록 {ops.data.certifications.length}건</p>}
        <label>기록 종류<select aria-label="기록 종류" value={s.kind} onChange={e=>set(o=>({...o,kind:e.target.value}))}>{KINDS.map(([k,l])=><option key={k} value={k}>{l}</option>)}</select></label>
        {f("기록 일자",s.rec.date,x=>set(o=>({...o,rec:{...o.rec,date:x}})),"date")}{f("금액",s.rec.amount,x=>set(o=>({...o,rec:{...o.rec,amount:x}})),"number")}{f("주행거리",s.rec.odometer,x=>set(o=>({...o,rec:{...o.rec,odometer:x}})),"number")}
        {f("만료·예정일(선택)",s.rec.dueDate,x=>set(o=>({...o,rec:{...o.rec,dueDate:x}})),"date")}{f("연결 지출 ID(선택)",s.rec.expenseId,x=>set(o=>({...o,rec:{...o.rec,expenseId:x}})))}{f("메모",s.rec.note,x=>set(o=>({...o,rec:{...o.rec,note:x}})))}
        <button disabled={!s.rec.date||s.rec.amount===""} onClick={()=>window.confirm(`${s.kind} / ${s.rec.date} / ${s.rec.amount}\n수정·삭제할 수 없는 추가 기록으로 저장합니다.`)&&void write("/operations",{kind:s.kind,vehicleId:s.vehicleId,data:{date:s.rec.date,amount:num(s.rec.amount),odometer:num(s.rec.odometer),note:s.rec.note,...(s.rec.dueDate?{dueDate:s.rec.dueDate}:{}),...(s.rec.expenseId?{expenseId:s.rec.expenseId}:{})}})}>기록 추가</button>
      </>}
    </>}
    {s.open==="recon"&&<>
      <p>기기 기록과 서버 상태가 맞지 않아 보류된 항목입니다. 결정은 감사 기록으로 남으며 새 승하차 이벤트를 만들지 않습니다.</p>
      {recon.error&&<p role="alert">조회 실패: {(recon.error as Error).message}</p>}
      {recon.isPending&&<p>보류 목록 조회 중</p>}
      {recon.data&&pending.length===0&&<p>처리할 보류 항목이 없습니다.</p>}
      <label>처리 결정<select aria-label="처리 결정" value={s.decision} onChange={e=>set(o=>({...o,decision:e.target.value}))}><option value="ADOPT_ORIGINAL">원 관측 그대로 채택</option><option value="LINK_EXISTING">기존 이벤트에 연결</option><option value="RETAIN_OBSERVATION">관찰 기록으로 보존</option></select></label>
      {s.decision==="LINK_EXISTING"&&f("연결할 이벤트 ID",s.eventId,x=>set(o=>({...o,eventId:x})))}
      {f("처리 사유",s.resolveReason,x=>set(o=>({...o,resolveReason:x})))}
      {pending.map((x:any)=><div key={x.id} className="border p-2"><p>{x.command} · {x.actor} · run {x.run_id} v{x.revision} · {x.status} · {x.created_at}</p><p>{x.reason}</p><p>원 요청 ID {x.id} · 원 기록자 {x.actor} · 원 기록 시각 {x.created_at}</p>{s.decision==="ADOPT_ORIGINAL"&&<p>원 ID·기록자·시각을 그대로 보존하고 새 승하차 요청 ID를 만들지 않습니다. 현재 단계·정원·종료 운행과 맞지 않으면 서버가 거절합니다.</p>}
        <button disabled={!s.resolveReason.trim()||(s.decision==="LINK_EXISTING"&&!s.eventId.trim())} onClick={()=>window.confirm(`${x.id}\n${s.decision}\n되돌릴 수 없는 감사 결정입니다.`)&&void write(`/reconciliation/${x.id}/resolve`,{decision:s.decision,reason:s.resolveReason,...(s.decision==="LINK_EXISTING"?{eventId:s.eventId}:{})})}>결정 기록</button></div>)}
      <h3>알림 발송 상태 진단(읽기 전용)</h3>
      <p>우리 센터 발송 대기열 상태입니다. 이 화면에서 발송·재시도하지 않으며 SMS는 사용하지 않습니다. 결과 불명(UNKNOWN)은 자동 재시도하지 않습니다.</p>
      {notes.error&&<p role="alert">알림 진단 조회 실패: {(notes.error as Error).message}</p>}
      {notes.isPending&&<p>알림 상태 조회 중</p>}
      {notes.data&&<>
        <p>발송 활성 {String(notes.data.dispatchEnabled)} · 기기 수신 확인 {String(notes.data.deviceDeliveryProven)}{notes.data.warning?` · ${notes.data.warning}`:""}</p>
        {notes.data.items.length===0?<p>알림 대기열 기록이 없습니다.</p>:<table className="border"><thead><tr><th>이벤트</th><th>보호자</th><th>회원</th><th>상태</th><th>시도</th><th>오류</th><th>시각</th></tr></thead><tbody>{notes.data.items.map((n:any)=><tr key={`${n.event_id}:${n.parent_id}`}><td>{n.event_id}</td><td>{n.parent_id}</td><td>{n.student_id}</td><td>{n.state}</td><td>{n.attempts}</td><td>{n.last_error??""}</td><td>{n.attempted_at??""}</td></tr>)}</tbody></table>}
      </>}
      {(recon.data?.items??[]).filter((x:any)=>x.resolution).map((x:any)=><p key={x.id}>처리됨 {x.id}: {JSON.stringify(x.resolution)}</p>)}
    </>}
    {s.open==="doc"&&<>
      <label>운행<select aria-label="문서 운행" value={s.runId} onChange={e=>set(o=>({...o,runId:e.target.value,doc:null}))}><option value="">선택</option>{runs.map((r:any)=><option key={r.id} value={r.id}>{r.plan.date} {r.plan.name} [{r.id}] {r.status}</option>)}</select></label>
      <button disabled={!s.runId} onClick={()=>void load(s.runId)}>업무용 기록 불러오기</button>
      {s.doc&&<article><h3>{s.doc.label}</h3><p>공식 서명·법정 양식 아님 · hash {s.doc.hash}</p>
        <p>{s.doc.run?.plan?.name} · {s.doc.run?.status} · 이벤트 {s.doc.events.length}건 · 확인 {(s.doc.certifications??[]).length}건</p>
        <button onClick={exportDoc}>XLSX 내보내기</button><button onClick={()=>window.print()}>인쇄·PDF 저장</button>
        <h4>운행 확인 기록(CLOSED 운행만)</h4>
        {f("확인자 서명(이름 입력)",s.signature,x=>set(o=>({...o,signature:x})))}{f("확인 사유",s.certReason,x=>set(o=>({...o,certReason:x})))}
        <button disabled={s.doc.run?.status!=="CLOSED"||!s.signature.trim()||!s.certReason.trim()} onClick={()=>window.confirm(`${s.doc.run.id} / v${s.doc.run.revision}\n내부 업무용 확인 기록을 남깁니다. 공식 인증·법적 준수 증명이 아닙니다.`)&&void write(`/runs/${s.doc.run.id}/certify`,{expectedRevision:s.doc.run.revision,confirmed:true,signature:s.signature,reason:s.certReason})}>업무용 확인 기록 남기기</button>
        {s.doc.run?.status!=="CLOSED"&&<p>종료된 안전 운행만 확인할 수 있습니다.</p>}
      </article>}
    </>}
    </fieldset>
    {s.message&&<p role="status">{s.message}</p>}
    {s.op&&!s.busy&&<div role="alert">처리 결과 미확인: {s.op.body.requestId}. 편집·재전송을 잠갔습니다.<button onClick={()=>void recover()}>서버 결과 확인</button></div>}
  </section>;
}
