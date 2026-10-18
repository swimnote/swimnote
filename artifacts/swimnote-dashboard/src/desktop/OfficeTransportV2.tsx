import {useQuery,useQueryClient} from "@tanstack/react-query";
import {api} from "../lib/api-client";
import {useOfficeFormState} from "./office-form-bridge";
import {confirmRecoveryPointer} from "./OfficeRecovery";
import {OfficeTransportOperations} from "./OfficeTransportOperations";
import type {TransportRunPlan,TransportStep} from "../../../../lib/api-zod/src/transport";
const root="/transport";
const uuid=()=>crypto.randomUUID();
const today=()=>new Date().toLocaleDateString("sv-SE",{timeZone:"Asia/Seoul"});
const empty=():TransportRunPlan=>({name:"",date:today(),vehicleId:"",driverId:"",escortId:"",capacity:1,startTime:"09:00",returnBy:"10:00",
  steps:[{id:uuid(),action:"CENTER_BOARD",stopId:"CENTER",name:"센터 출발",time:"09:00",travelMinutes:0,fixed:false,studentIds:[]},
    {id:uuid(),action:"CENTER_HANDOVER",stopId:"CENTER",name:"센터 복귀·인계",time:"10:00",travelMinutes:0,fixed:false,studentIds:[]}]});
type Op={path:string;body:any};
const initial=()=>({tab:"crew",plan:empty(),id:"",revision:0,dirty:true,preview:null as any,approved:null as any,op:null as Op|null,busy:false,message:"",
  inviteType:"parent_accounts",inviteId:"",duty:"DRIVER",inviteCode:"",memberSearch:"",matches:[] as any[],candidates:null as any,
  studentId:"",preference:{enabled:true,from:today(),to:today(),weekdays:[1,2,3,4,5],inboundStopId:"",outboundStopId:"",handover:"",exceptions:[] as any[]},
  vehicleId:"",window:{start:"07:00",end:"20:00",weekdays:[1,2,3,4,5]},monitorId:"",recalculateFrom:1});
export function OfficeTransportV2({scope,records}:{scope:string;records:{id:string;kind:string;data:any}[]}){
  const [s,set]=useOfficeFormState(`${scope}:transport-v2`,initial()),qc=useQueryClient();
  const q=useQuery({queryKey:["transport-v2",scope],queryFn:async()=>{
    const data=await api.get<any>(`${root}/admin`);
    if(!["members","runs","preferences","availability"].every(k=>Array.isArray(data?.[k])))throw Error("V2 응답 계약을 확인하지 못했습니다.");
    return data;
  },retry:false,refetchInterval:10000});
  const detail=useQuery({queryKey:["transport-v2-detail",scope,s.monitorId],queryFn:()=>api.get<any>(`${root}/admin/runs/${s.monitorId}`),enabled:!!s.monitorId,retry:false,refetchInterval:10000});
  const boot=[401,403].includes((q.error as any)?.status)?undefined:q.data,locked=s.busy||!!s.op||!!q.error,p=s.plan;
  const change=(patch:Partial<TransportRunPlan>)=>set(old=>({...old,plan:{...old.plan,...patch},dirty:true,preview:null,approved:null}));
  function steps(rows:TransportStep[]){
    const all=structuredClone(rows);
    all[0].studentIds=all.filter(x=>x.action==="DROP").flatMap(x=>x.studentIds);
    all[all.length-1].studentIds=all.filter(x=>x.action==="PICKUP").flatMap(x=>x.studentIds);
    change({steps:all});
  }
  const step=(i:number,patch:Partial<TransportStep>)=>steps(p.steps.map((x,n)=>n===i?{...x,...patch}:x));
  function finish(op:Op,result:any){
    if(!result||typeof result!=="object"||result.error)throw {status:502,message:"처리 결과를 대조하지 못했습니다."};
    if(op.path.endsWith("/runs/save")){
      if(!result.item?.id||!Number.isInteger(result.item.revision)||!Array.isArray(result.plan?.steps)||(op.body.id&&result.item.id!==op.body.id))throw {status:502,message:"저장 대상·버전·본문 불일치"};
      set(old=>({...old,plan:result.plan,id:result.item.id,revision:result.item.revision,dirty:false}));
    }
    if(op.path.endsWith("/invite"))set(old=>({...old,inviteCode:result.inviteCode}));
    if(op.path.endsWith("/approve"))set(old=>({...old,approved:result}));
    if(op.path.endsWith("/publish"))set(old=>({...old,approved:null,preview:null}));
    set(old=>({...old,op:null,busy:false,message:`서버 반영 확인: ${result.status??"저장"}. 푸시·SMS는 발송하지 않았습니다.`}));
    qc.invalidateQueries({queryKey:["transport-v2",scope]});qc.invalidateQueries({queryKey:["transport-v2-detail",scope]});
  }
  async function write(path:string,body:any){
    if(locked)return;const op={path:`${root}${path}`,body:{...body,requestId:uuid()}};
    set(old=>({...old,op,busy:true,message:""}));
    try{finish(op,await api.post(op.path,op.body));}
    catch(e:any){set(old=>({...old,busy:false,op:!e.status||e.status>=500||e.code==="OFFICE_OUTCOME_UNKNOWN"?op:null,message:e.message??"결과 불명"}));}
  }
  async function read(path:string,apply:(r:any)=>void){
    if(locked)return;set(old=>({...old,busy:true,message:""}));
    try{apply(await api.get(`${root}${path}`));}catch(e:any){set(old=>({...old,message:e.message}));}
    finally{set(old=>({...old,busy:false}));}
  }
  async function recover(){
    if(!s.op||s.busy)return;const op=s.op;set(old=>({...old,busy:true}));
    try{const result=await api.get(`${root}/requests/${op.body.requestId}`);await confirmRecoveryPointer(op.body.requestId,result);finish(op,result);}
    catch(e:any){set(old=>({...old,busy:false,message:`${e.message}. 기록 없음도 미처리 증거가 아닙니다. 재전송하지 않습니다.`}));}
  }
  const select=(label:string,value:string,onChange:(x:string)=>void,items:{id:string;name:string}[])=><label>{label}<select aria-label={label} value={value} onChange={e=>onChange(e.target.value)}><option value="">선택</option>{items.map(x=><option key={x.id} value={x.id}>{x.name} [{x.id}]</option>)}</select></label>;
  const field=(label:string,value:string|number,onChange:(x:string)=>void,type="text")=><label className="block">{label}<input className="border p-2 rounded block" aria-label={label} type={type} value={value} onChange={e=>onChange(e.target.value)}/></label>;
  const stopOptions=records.filter(x=>x.kind==="stop"&&x.data.status==="active").map(x=>({id:x.id,name:x.data.name}));
  const crew=(duty:string)=>boot.members.filter((x:any)=>x.status==="ACTIVE"&&x.duty===duty).map((x:any)=>({id:x.id,name:x.name}));
  return <section className="border rounded p-4 space-y-3" aria-label="V2 날짜별 혼합 운행">
    <h2 className="font-semibold text-lg">V2 날짜별 혼합 운행·기사 전용 배정</h2>
    <p>위 수동 준비 자료를 재사용합니다. 전역 관리자·강사 권한 대신 본인 수락한 운행 멤버십만 배정합니다. 도로 ETA·차량 위치 추적이 아닙니다.</p>
    <p>현재 검수는 등록 정원·가용시간·센터/담당·수강 기간·명시 결석·배차 중복·입력 시각 범위입니다. 실제 수업 요일·시작/종료·휴강/변경과 센터 버퍼의 자동 대조는 미연결이므로 운영 최종 검수 완료가 아닙니다. AI 제안·알림 실발송도 미연결입니다.</p>
    {q.error&&<p role="alert">V2 자료 조회 실패: {(q.error as Error).message}. 운영 migration·소스 별도 승인 전에는 사용 가능한 것으로 표시하지 않습니다.</p>}
    {q.isPending&&<p>V2 자료 조회 중</p>}
    {boot&&<fieldset disabled={locked} className="space-y-3">
      <legend>운행 업무</legend>
      {["crew","preferences","mixed","monitor"].map((tab,i)=><button className="border p-2 mr-2" key={tab} aria-pressed={s.tab===tab} onClick={()=>set(old=>({...old,tab}))}>{["기사·인솔자·가용시간","회원 정기·임시 이용","혼합 배차·확정·게시","운행 현황·이력"][i]}</button>)}
      {s.tab==="crew"&&<>
        <p>앱 ‘차량 확인·운행’ 화면의 기존 계정 종류·ID를 본인에게 확인하세요. 초대 코드는 화면에서 전달하며 자동 발송하지 않습니다.</p>
        {select("기존 계정 종류",s.inviteType,x=>set(old=>({...old,inviteType:x})),[{id:"users",name:"일반 사용자 계정"},{id:"parent_accounts",name:"보호자 로그인 계정"}])}
        {field("기존 계정 ID",s.inviteId,x=>set(old=>({...old,inviteId:x})))}
        {select("운행 전용 역할",s.duty,x=>set(old=>({...old,duty:x})),[{id:"DRIVER",name:"기사"},{id:"ESCORT",name:"인솔자"}])}
        <button onClick={()=>window.confirm(`${s.inviteType}:${s.inviteId} / ${s.duty}\n같은 센터의 기존 계정을 초대합니다. 관리자·강사 권한은 부여하지 않습니다.`)&&void write("/memberships/invite",{principalType:s.inviteType,principalId:s.inviteId,duty:s.duty,confirmed:true})}>운행 전용 초대 생성</button>
        {s.inviteCode&&<p>본인 전달용 1회 수락 코드(7일): <code>{s.inviteCode}</code></p>}
        {boot.members.map((m:any)=><div key={m.id}>{m.name} [{m.id}] · {m.duty} · {m.status}<button disabled={m.status==="REVOKED"} onClick={()=>window.confirm(`${m.name} [${m.id}]의 운행 접근을 회수합니까?`)&&void write(`/memberships/${m.id}/revoke`,{confirmed:true})}>배정 권한 회수</button></div>)}
        <h3>차량 운행 가능 시간</h3>
        {select("가용시간 차량",s.vehicleId,x=>set(old=>({...old,vehicleId:x,window:boot.availability.find((v:any)=>v.vehicle_id===x)?.data??initial().window})),records.filter(x=>x.kind==="vehicle").map(x=>({id:x.id,name:x.data.name})))}
        {field("가용 시작",s.window.start,x=>set(old=>({...old,window:{...old.window,start:x}})),"time")}{field("가용 종료",s.window.end,x=>set(old=>({...old,window:{...old.window,end:x}})),"time")}
        {field("가용 요일(월1~일7, 쉼표)",s.window.weekdays.join(","),x=>set(old=>({...old,window:{...old.window,weekdays:x.split(",").filter(Boolean).map(Number)}})))}
        <button disabled={!s.vehicleId} onClick={()=>void write(`/vehicles/${s.vehicleId}/availability`,{expectedRevision:boot.availability.find((x:any)=>x.vehicle_id===s.vehicleId)?.revision??0,data:s.window})}>차량 가능 시간 저장</button>
      </>}
      {s.tab==="preferences"&&<>
        {field("전체 회원 검색",s.memberSearch,x=>set(old=>({...old,memberSearch:x})))}
        <button onClick={()=>void read(`/students?search=${encodeURIComponent(s.memberSearch)}`,r=>set(old=>({...old,matches:r.items,message:r.truncated?"50명 초과: 검색어를 좁혀주세요.":""})))}>회원 찾기</button>
        {select("이용 설정 회원",s.studentId,x=>set(old=>({...old,studentId:x,preference:structuredClone(boot.preferences.find((v:any)=>v.student_id===x)?.data??initial().preference)})),s.matches)}
        <label><input type="checkbox" checked={s.preference.enabled} onChange={e=>set(old=>({...old,preference:{...old.preference,enabled:e.target.checked}}))}/>정기 이용</label>
        {field("이용 시작",s.preference.from,x=>set(old=>({...old,preference:{...old.preference,from:x}})),"date")}{field("이용 종료",s.preference.to,x=>set(old=>({...old,preference:{...old.preference,to:x}})),"date")}
        {field("이용 요일(월1~일7, 쉼표)",s.preference.weekdays.join(","),x=>set(old=>({...old,preference:{...old.preference,weekdays:x.split(",").filter(Boolean).map(Number)}})))}
        {select("정기 등원 정류장",s.preference.inboundStopId,x=>set(old=>({...old,preference:{...old.preference,inboundStopId:x}})),stopOptions)}
        {select("정기 귀가 정류장",s.preference.outboundStopId,x=>set(old=>({...old,preference:{...old.preference,outboundStopId:x}})),stopOptions)}
        {field("인계 조건",s.preference.handover,x=>set(old=>({...old,preference:{...old.preference,handover:x}})))}
        {s.preference.exceptions.map((e,i)=><div key={i}>
          {field(`임시 날짜 ${i+1}`,e.date,x=>set(old=>({...old,preference:{...old.preference,exceptions:old.preference.exceptions.map((v,n)=>n===i?{...v,date:x}:v)}})),"date")}
          <label><input type="checkbox" checked={e.enabled} onChange={event=>set(old=>({...old,preference:{...old.preference,exceptions:old.preference.exceptions.map((v,n)=>n===i?{...v,enabled:event.target.checked}:v)}}))}/>이날 이용</label>
          {select(`임시 등원 ${i+1}`,e.inboundStopId,x=>set(old=>({...old,preference:{...old.preference,exceptions:old.preference.exceptions.map((v,n)=>n===i?{...v,inboundStopId:x}:v)}})),stopOptions)}
          {select(`임시 귀가 ${i+1}`,e.outboundStopId,x=>set(old=>({...old,preference:{...old.preference,exceptions:old.preference.exceptions.map((v,n)=>n===i?{...v,outboundStopId:x}:v)}})),stopOptions)}
        </div>)}
        <button onClick={()=>set(old=>({...old,preference:{...old.preference,exceptions:[...old.preference.exceptions,{date:today(),enabled:false,inboundStopId:"",outboundStopId:""}]}}))}>임시 이용 변경 추가</button>
        <button disabled={!s.studentId} onClick={()=>void write(`/preferences/${s.studentId}`,{expectedRevision:boot.preferences.find((x:any)=>x.student_id===s.studentId)?.revision??0,data:s.preference})}>회원 이용 저장(게시 운행 유지)</button>
      </>}
      {s.tab==="mixed"&&<>
        <button onClick={()=>set(old=>({...old,plan:empty(),id:"",revision:0,dirty:true,preview:null,approved:null}))}>새 날짜별 운행</button>
        {boot.runs.map((x:any)=><button className="block" key={x.id} onClick={()=>set(old=>({...old,id:x.id,plan:structuredClone(x.pending_plan??x.plan),revision:x.pending_revision??x.revision,dirty:false,preview:null,
          approved:(x.pending_status??x.status)==="APPROVED"?{id:x.id,revision:x.pending_revision??x.revision,hash:x.pending_hash??x.approved_hash}:null}))}>{x.plan.name} [{x.id}] · 게시 v{x.revision} {x.status}{x.pending_revision?` / 수정안 v${x.pending_revision} ${x.pending_status}`:""}</button>)}
        <p>편집 대상 {s.id||"새 운행"} / 버전 {s.revision}. 게시 운행의 수정안은 별도로 보관하고 재확정·게시 전 기존 운행을 유지합니다.</p>
        {field("날짜별 운행 이름",p.name,x=>change({name:x}))}{field("운행일",p.date,x=>change({date:x}),"date")}
        {select("운행 차량",p.vehicleId,x=>change({vehicleId:x,capacity:records.find(v=>v.id===x)?.data.capacity??1}),records.filter(x=>x.kind==="vehicle"&&x.data.status==="active").map(x=>({id:x.id,name:x.data.name})))}
        <p>차량에 등록된 운행 정원 {p.capacity}명</p>
        {select("운행 전용 기사",p.driverId,x=>change({driverId:x}),crew("DRIVER"))}{select("운행 전용 인솔자(선택)",p.escortId,x=>change({escortId:x}),crew("ESCORT"))}
        {field("센터 출발 가능",p.startTime,x=>change({startTime:x}),"time")}{field("센터 복귀 제한·수업 여유 확인",p.returnBy,x=>change({returnBy:x}),"time")}
        <button onClick={()=>void read(`/candidates?date=${p.date}`,r=>set(old=>({...old,candidates:r})))}>운행일 이용·수강·보강·운영자 결석 대조</button>
        {s.candidates&&<div>{s.candidates.warnings.map((v:string)=><p key={v}>{v}</p>)}{s.candidates.items.map((v:any)=><p key={v.studentId}>{v.name} [{v.studentId}] · {v.enabled?"이용 대상":"제외/대조"} · 수강 {String(v.enrolled)} / 보강 {String(v.makeup)} / 기록 결석 {String(v.explicitAbsence)} / 임시 {String(v.temporary)}</p>)}</div>}
        {p.steps.map((v,i)=><div className="border p-2 my-2" key={v.id}>
          <b>{i+1}. {v.action} [{v.id}]</b>
          {i>0&&i<p.steps.length-1&&<>
            {select(`승하차 구분 ${i}`,v.action,x=>step(i,{action:x as "DROP"|"PICKUP"}),[{id:"DROP",name:"귀가 하차"},{id:"PICKUP",name:"등원 승차"}])}
            {select(`정류장 ${i}`,v.stopId,x=>step(i,{stopId:x,name:stopOptions.find(z=>z.id===x)?.name??""}),stopOptions)}
            {field(`회원 ID ${i}(쉼표)`,v.studentIds.join(","),x=>step(i,{studentIds:x.split(",").map(x=>x.trim()).filter(Boolean)}))}
            <button onClick={()=>steps(p.steps.filter((_,n)=>n!==i))}>미처리 정류장 제외</button>
          </>}
          <p>회원 ID: {v.studentIds.join(", ")||"없음"}</p>
          {field(`예정시각 ${i}`,v.time,x=>step(i,{time:x}),"time")}{field(`관리자 등록 이동분 ${i}`,v.travelMinutes,x=>step(i,{travelMinutes:Number(x)}),"number")}
          <label><input type="checkbox" checked={v.fixed} onChange={e=>step(i,{fixed:e.target.checked})}/>시각 고정(해제만 먼저 저장)</label>
        </div>)}
        <button onClick={()=>steps([...p.steps.slice(0,-1),{id:uuid(),action:"DROP",stopId:"",name:"정류장",time:"09:00",travelMinutes:0,fixed:false,studentIds:[]},p.steps[p.steps.length-1]])}>하차/승차 정류장 추가</button>
        <p>이동분은 관리자 등록값이며 도로 ETA가 아닙니다. 아래 자동 초안은 결정적 제약 삽입 계산이며 최적 도로 경로·실제 모델 호출이 아닙니다. 미배정·충돌은 별도로 검수하세요.</p>
        <button onClick={()=>void write("/runs/save",{id:s.id||undefined,expectedRevision:s.revision,plan:p})}>날짜별 운행 저장</button>
        <button disabled={!s.id||s.dirty} onClick={()=>void read(`/runs/${s.id}/review`,r=>set(old=>({...old,preview:r})))}>최신 저장본 검수</button>
        {field("부분 재계산 시작 순번(0부터)",s.recalculateFrom,x=>set(old=>({...old,recalculateFrom:Number(x)})),"number")}
        <button disabled={!s.id||s.dirty} onClick={async()=>{
          if(locked)return;set(old=>({...old,busy:true}));
          try{const r=await api.post<any>(`${root}/runs/${s.id}/recalculate`,{expectedRevision:s.revision,from:s.recalculateFrom});change({steps:r.plan.steps});set(old=>({...old,message:"등록 이동분 기반 수정 제안입니다. AI 호출·자동 저장 없음. 검토 후 저장하세요."}));}
          catch(e:any){set(old=>({...old,message:e.message}));}finally{set(old=>({...old,busy:false}));}
        }}>고정시각 보존 부분 제안(AI 아님)</button>
        {s.preview&&<div><p>검수 v{s.preview.revision} · hash {s.preview.hash}</p><button onClick={()=>window.confirm(`${s.id} / v${s.preview.revision} / ${s.preview.hash}\n관리자 등록 이동분·수업 도착 여유를 확인해 확정합니까?`)&&void write(`/runs/${s.id}/approve`,{expectedRevision:s.preview.revision,previewHash:s.preview.hash,confirmed:true})}>검수한 버전 확정</button></div>}
        {s.approved&&<button onClick={()=>window.confirm(`${s.approved.id} / v${s.approved.revision}\n기사 조회에 게시합니까? 수신 확인·푸시는 별도입니다.`)&&void write(`/runs/${s.approved.id}/publish`,{expectedRevision:s.approved.revision,hash:s.approved.hash,confirmed:true})}>확정 버전 기사 게시(미수신·미발송)</button>}
      </>}
      {s.tab==="monitor"&&<>
        {select("현황 운행",s.monitorId,x=>set(old=>({...old,monitorId:x})),boot.runs.map((x:any)=>({id:x.id,name:`${x.plan.date} ${x.plan.name}`})))}
        {detail.error&&<p role="alert">{(detail.error as Error).message}</p>}
        {detail.data&&<article><h3>업무용 운행표·확인 이력(법정 양식 아님)</h3>
          <p>{detail.data.run.plan.name} · 게시 v{detail.data.run.revision} · {detail.data.run.status} · 조회 {detail.data.serverAt}</p>
          <p>수신 확인 {detail.data.events.filter((e:any)=>e.kind==="ACK"&&e.revision===detail.data.run.revision).map((e:any)=>e.actor).join(", ")||"없음"} · 미하차 {detail.data.state.onboard.length} · 미처리 정류장 {detail.data.state.pending.length}</p>
          {detail.data.run.plan.steps.map((x:TransportStep)=><p key={x.id}>{x.time} · {x.action} · {x.name} · {x.studentIds.map(id=>detail.data.students.find((v:any)=>v.id===id)?.name??id).join(", ")} · {detail.data.state.pending.includes(x.id)?"미처리":"확인/명시적 미탑승"}</p>)}
          <ol>{detail.data.events.map((e:any)=><li key={e.requestId}>v{e.revision} / {e.kind} / {e.stepId} / {(e.studentIds??[]).join(",")} / 기기 {e.deviceAt} / 서버 {e.serverAt} / {e.actor}{e.corrects?` / 원기록 ${e.corrects} / 사유 ${e.reason}`:""}</li>)}</ol>
          <button onClick={()=>window.print()}>업무용 출력</button>
          <p>최근 서버 반영 상태입니다. 기기 오프라인 대기 기록·차량 위치·정확한 ETA가 아닙니다. 푸시 발송은 연결 전입니다.</p>
        </article>}
      </>}
    </fieldset>}
    {boot&&<OfficeTransportOperations scope={scope} plan={p} runId={s.id||undefined} records={records} runs={boot.runs} locked={locked} onPlan={(plan:TransportRunPlan)=>change(plan)}/>}
    {s.message&&<p role="status">{s.message}</p>}
    {s.op&&!s.busy&&<div role="alert">처리 결과 미확인: {s.op.body.requestId}. 편집·재전송을 잠갔습니다.<button onClick={()=>void recover()}>V2 서버 결과 확인</button></div>}
  </section>;
}
