import {useQuery,useQueryClient} from "@tanstack/react-query";
import {api} from "../lib/api-client";
import {useOfficeFormOwner,useOfficeFormState} from "./office-form-bridge";
type Kind="vehicle"|"stop"|"plan";
type Item={id:string;kind:Kind;data:Record<string,any>;revision:number};
type Named={id:string;name:string};
type Snapshot={id:string;plan_id:string;plan_revision:number;content_hash:string;approved_at:string};
type Boot={records:Item[];students:Named[];drivers:Named[];classes:Named[];snapshots:Snapshot[];studentListTruncated:boolean};
type Editor={id?:string;revision?:number;data:Record<string,any>};
type Pending={path:string;method:"POST"|"PATCH";body:Record<string,any>;kind:Kind;approve:boolean;id?:string};
type State={kind:Kind;editors:Record<Kind,Editor>;op?:Pending;busy:boolean;unknown:boolean;message:string;preview?:any;snapshot?:any};
const base="/office/operations/transport";
const defaults=(kind:Kind):Editor=>({data:kind==="vehicle"?{name:"",plate:"",capacity:15,driverId:"",status:"active"}:
  kind==="stop"?{name:"",address:"",status:"active"}:
  {name:"",weekday:1,direction:"INBOUND",vehicleId:"",classGroupId:"",classTime:"10:00",earliestTime:"09:00",bufferMinutes:10,toCenterMinutes:10,sourceSnapshotId:"",stops:[]}});
const initial=():State=>({kind:"vehicle",editors:{vehicle:defaults("vehicle"),stop:defaults("stop"),plan:defaults("plan")},busy:false,unknown:false,message:""});
const errorText=(e:any)=>e?.message??e?.error??"요청을 확인하지 못했습니다.";
const unknown=(e:any)=>e?.code==="OFFICE_OUTCOME_UNKNOWN"||e?.code==="RESULT_UNKNOWN"||!e?.status||e.status>=500;
export function OfficeTransportPanel(){
  const owner=useOfficeFormOwner();
  return owner.scope&&owner.isAdmin?<TransportBody key={owner.scope} scope={owner.scope}/>:<p>센터 관리자만 배차를 준비할 수 있습니다.</p>;
}
function TransportBody({scope}:{scope:string}){
  const [s,set]=useOfficeFormState(`${scope}:transport-preparation`,initial()),qc=useQueryClient();
  const q=useQuery({queryKey:["office-transport",scope],queryFn:()=>api.get<Boot>(base),retry:false,refetchInterval:30000});
  const boot=q.data,editor=s.editors[s.kind],d=editor.data,locked=!!s.op||s.busy;
  const change=(data:Record<string,any>)=>set(old=>({...old,editors:{...old.editors,[old.kind]:{...old.editors[old.kind],data}},preview:undefined}));
  const field=(name:string,value:any)=>change({...d,[name]:value});
  function select(item?:Item){
    set(old=>({...old,editors:{...old.editors,[old.kind]:item?{id:item.id,revision:item.revision,data:structuredClone(item.data)}:defaults(old.kind)},preview:undefined,message:""}));
  }
  function complete(op:Pending,result:any){
    const item=result?.item;
    if(!item?.id||(op.approve?(item.plan_id!==op.id||item.plan_revision!==op.body.expectedRevision):
      (item.kind!==op.kind||!item.data||!Number.isSafeInteger(item.revision)||(op.id&&item.id!==op.id))))
      throw {status:502,message:"응답 대상·버전을 확인하지 못했습니다. 영수증으로만 복구하세요."};
    set(old=>({...old,op:undefined,busy:false,unknown:false,preview:undefined,
      editors:op.approve?old.editors:{...old.editors,[op.kind]:{id:item.id,revision:item.revision,data:item.data}},
      message:op.approve?"확정 스냅샷을 보관했습니다. 기사 배포·알림은 실행하지 않았습니다.":"저장했습니다. 배차는 저장 후 시간·정원을 검수하세요."}));
    qc.invalidateQueries({queryKey:["office-transport",scope]});
  }
  async function write(op:Pending){
    set(old=>({...old,op,busy:true,unknown:false,message:""}));
    try{complete(op,await (op.method==="POST"?api.post(op.path,op.body):api.patch(op.path,op.body)));}
    catch(e:any){set(old=>({...old,busy:false,unknown:unknown(e),op:unknown(e)?op:undefined,message:errorText(e)}));}
  }
  function save(){
    if(locked)return;
    const op:Pending={path:editor.id?`${base}/records/${editor.id}`:`${base}/records`,method:editor.id?"PATCH":"POST",kind:s.kind,approve:false,id:editor.id,
      body:{requestId:crypto.randomUUID(),...(editor.id?{expectedRevision:editor.revision}:{kind:s.kind}),data:structuredClone(d)}};
    void write(op);
  }
  async function preview(){
    if(locked||!editor.id)return;
    const saved=boot?.records.find(x=>x.id===editor.id);
    if(!saved||JSON.stringify(saved.data)!==JSON.stringify(d)||saved.revision!==editor.revision){set(old=>({...old,message:"현재 입력을 먼저 저장하거나 최신 초안을 다시 선택하세요.",preview:undefined}));return;}
    set(old=>({...old,busy:true,message:"",preview:undefined}));
    try{
      const p=await api.get<any>(`${base}/plans/${editor.id}/preview`);
      if(p.planId!==editor.id||p.revision!==editor.revision||!p.previewHash||!p.preview)throw Error("초안 ID·버전이 달라 다시 선택해야 합니다.");
      set(old=>({...old,busy:false,preview:p}));
    }catch(e){set(old=>({...old,busy:false,message:errorText(e)}));}
  }
  function approve(){
    if(locked||!s.preview||s.preview.planId!==editor.id)return;
    if(!window.confirm(`${d.name} [${editor.id}] / 버전 ${editor.revision} / ${s.preview.preview.studentCount}명\n검수한 확정 스냅샷만 보관합니다. 기사 전송·알림은 하지 않습니다.`))return;
    void write({path:`${base}/plans/${editor.id}/approve`,method:"POST",kind:"plan",approve:true,id:editor.id,
      body:{requestId:crypto.randomUUID(),expectedRevision:editor.revision,previewHash:s.preview.previewHash,confirmed:true}});
  }
  async function recover(){
    if(!s.op||s.busy)return;const op=s.op;set(old=>({...old,busy:true}));
    try{complete(op,await api.get(`/office/operations/receipts/${op.body.requestId}`));}
    catch(e){set(old=>({...old,busy:false,unknown:true,message:`${errorText(e)} 기록 없음도 미처리 증거가 아닙니다. 재전송하지 않습니다.`}));}
  }
  async function readSnapshot(id:string,reuse=false){
    if(locked)return;set(old=>({...old,busy:true,message:""}));
    try{
      const result=await api.get<any>(`${base}/snapshots/${id}`),item=result?.item;
      if(item?.id!==id||!item.snapshot?.plan||!item.content_hash)throw Error("확정 원본 ID·본문을 확인하지 못했습니다.");
      set(old=>reuse?{...old,busy:false,kind:"plan",editors:{...old.editors,plan:{data:{...structuredClone(item.snapshot.plan),sourceSnapshotId:id}}},
        preview:undefined,message:"확정 당시 시간을 새 초안으로 가져왔습니다. 현재 정원·회원·기사·시간은 다시 검수해야 합니다."}
        :{...old,busy:false,snapshot:item});
    }catch(e){set(old=>({...old,busy:false,message:errorText(e)}));}
  }
  const input=(key:string,label:string,type="text")=><label className="block">{label}<input className="block border rounded p-2" aria-label={label} type={type} value={d[key]??""}
    onChange={e=>field(key,type==="number"?Number(e.target.value):e.target.value)}/></label>;
  const pick=(key:string,label:string,items:Named[])=><label className="block">{label}<select className="block border rounded p-2" aria-label={label} value={d[key]??""} onChange={e=>field(key,e.target.value)}>
    <option value="">선택</option>{items.map(x=><option key={x.id} value={x.id}>{x.name} [{x.id}]</option>)}</select></label>;
  return <div className="space-y-4 p-4">
    <h1 className="text-xl font-semibold">무료 배차 준비·검수</h1>
    <p>수동 정기 배차와 확정 당시 기록입니다. GPS·내비·도로 ETA·자동 최적화·기사 배포·운행 실시간 연동은 아직 제공하지 않습니다.</p>
    <p>기사 담당자는 기존 강사 계정에 지정하는 준비 정보이며 기사 운행 권한을 부여하지 않습니다.</p>
    {q.isPending&&<p>배차 자료 조회 중</p>}
    {q.error&&<p role="alert">{errorText(q.error)} 기존 서버에는 배차 준비 소스·신규 migration의 별도 승인이 필요합니다. 저장된 것으로 표시하지 않습니다.</p>}
    {boot&&<>
      {boot.studentListTruncated&&<p role="alert">회원 선택은 앞 1,000명만 표시합니다. 전체 회원 검색·페이지 확장은 후속이며 임의 대상을 선택하지 않습니다.</p>}
      <fieldset disabled={locked}>
        <legend>준비 자료</legend>
        {(["vehicle","stop","plan"] as Kind[]).map((k,i)=><button className="border rounded px-3 py-1 mr-2" key={k} aria-pressed={s.kind===k} onClick={()=>set(old=>({...old,kind:k,preview:undefined}))}>{["차량","승차지","정기 배차"][i]}</button>)}
        <button className="border rounded px-3 py-1" onClick={()=>select()}>새로 작성</button>
        <ul>{boot.records.filter(x=>x.kind===s.kind).map(x=><li key={x.id}><button onClick={()=>select(x)}>{x.data.name} · 버전 {x.revision} [{x.id}]</button></li>)}</ul>
        <h2>{editor.id?"기존 자료 수정":"새 자료"} {editor.id&&`[${editor.id}]`}</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {input("name","이름")}
          {s.kind==="vehicle"&&<>{input("plate","차량번호")}{input("capacity","정원","number")}{pick("driverId","기사 담당자",boot.drivers)}</>}
          {s.kind==="stop"&&input("address","승차지 주소·위치 안내")}
          {s.kind!=="plan"&&<label>사용 상태<select aria-label="사용 상태" value={d.status} onChange={e=>field("status",e.target.value)}><option value="active">사용</option><option value="inactive">중지</option></select></label>}
          {s.kind==="plan"&&<>
            {pick("vehicleId","배차 차량",boot.records.filter(x=>x.kind==="vehicle"&&x.data.status==="active").map(x=>({id:x.id,name:x.data.name})))}
            {pick("classGroupId","수업 반",boot.classes)}
            <label>요일<select aria-label="요일" value={d.weekday} onChange={e=>field("weekday",Number(e.target.value))}>{["월","화","수","목","금","토","일"].map((v,i)=><option key={v} value={i+1}>{v}</option>)}</select></label>
            <label>운행 방향<select aria-label="운행 방향" value={d.direction} onChange={e=>field("direction",e.target.value)}><option value="INBOUND">등원</option><option value="OUTBOUND">하원</option></select></label>
            {input("earliestTime","최소 승차 시작·센터 출발 시각","time")}{input("classTime",d.direction==="INBOUND"?"수업 시작시각(직접 확인)":"수업 종료시각(직접 확인)","time")}
            {input("bufferMinutes","센터 여유시간(분)","number")}{d.direction==="INBOUND"&&input("toCenterMinutes","마지막 승차지→센터 직접 확인 이동시간(분)","number")}
          </>}
        </div>
        {s.kind==="plan"&&<section aria-label="승차지 배정">
          <p>이동시간은 관리자가 확인한 값만 입력하세요. 등원 첫 승차지의 이전 이동시간은 0입니다. 현재 반 수강 이력을 확인하며 미래 수강 변경·확정 결석·보강은 아직 자동 반영하지 않습니다.</p>
          {(d.stops??[]).map((row:any,index:number)=><div className="border rounded p-3 my-2" key={index}>
            <label>승차지 {index+1}<select aria-label={`승차지 ${index+1}`} value={row.stopId} onChange={e=>field("stops",d.stops.map((v:any,i:number)=>i===index?{...v,stopId:e.target.value}:v))}>
              <option value="">선택</option>{boot.records.filter(x=>x.kind==="stop"&&x.data.status==="active").map(x=><option key={x.id} value={x.id}>{x.data.name} · {x.data.address}</option>)}</select></label>
            <label>예정시각<input aria-label={`예정시각 ${index+1}`} type="time" value={row.time} onChange={e=>field("stops",d.stops.map((v:any,i:number)=>i===index?{...v,time:e.target.value}:v))}/></label>
            <label>이전 지점에서 이동(분)<input aria-label={`이동시간 ${index+1}`} type="number" value={row.travelMinutes} onChange={e=>field("stops",d.stops.map((v:any,i:number)=>i===index?{...v,travelMinutes:Number(e.target.value)}:v))}/></label>
            <label><input type="checkbox" checked={row.fixed} onChange={e=>field("stops",d.stops.map((v:any,i:number)=>i===index?{...v,fixed:e.target.checked}:v))}/>기준시각 고정</label>
            <label>회원(복수 선택)<select multiple aria-label={`탑승 회원 ${index+1}`} value={row.studentIds} onChange={e=>field("stops",d.stops.map((v:any,i:number)=>i===index?{...v,studentIds:Array.from(e.target.selectedOptions,x=>x.value)}:v))}>
              {boot.students.map(x=><option key={x.id} value={x.id}>{x.name} [{x.id}]</option>)}</select></label>
            <p>선택 회원 ID: {row.studentIds.join(", ")||"없음"}. 현재 목록에 없는 기존 ID도 입력에서 보존하며 검수 시 다시 확인합니다.</p>
            <button onClick={()=>field("stops",d.stops.filter((_:any,i:number)=>i!==index))}>이 승차지 제외</button>
          </div>)}
          <button onClick={()=>field("stops",[...d.stops,{stopId:"",time:"09:00",travelMinutes:0,fixed:false,studentIds:[]}])}>승차지 추가</button>
        </section>}
        <button className="border rounded px-3 py-2 mt-3" onClick={save}>준비 자료 저장</button>
        {s.kind==="plan"&&<button className="border rounded px-3 py-2 ml-2" disabled={!editor.id} onClick={()=>void preview()}>저장한 배차 검수</button>}
      </fieldset>
      {s.preview&&<section className="border rounded p-3" aria-label="배차 검수 미리보기">
        <h2>{s.preview.preview.plan.name} · 버전 {s.preview.revision} · {s.preview.preview.studentCount}명 / 정원 {s.preview.preview.vehicle.capacity}명</h2>
        <p>{s.preview.preview.vehicle.plate} / 기사 {s.preview.preview.driver.name} / {s.preview.preview.classGroup.name}</p>
        <ol>{s.preview.preview.stops.map((row:any)=><li key={row.stopId}>{row.time} {row.name} · {row.students.map((v:Named)=>v.name).join(", ")}{row.fixed?" · 기준시각 고정":""}</li>)}</ol>
        <p>관리자 입력 이동시간 기준의 정원·중복·순서·수업 여유 검수입니다. 실제 도로 ETA나 자동 솔버 결과가 아닙니다.</p>
        <button disabled={locked} onClick={approve}>검수 확인·확정본 보관(미배포)</button>
      </section>}
      <section aria-label="확정 배차 이력"><h2>확정 당시 배차 이력 · 기사 미배포</h2>
        {boot.snapshots.map(v=><div key={v.id}>{v.plan_id} · 버전 {v.plan_revision} · {v.approved_at}
          <button disabled={locked} onClick={()=>void readSnapshot(v.id)}>당시 확정본 열기</button>
          <button disabled={locked} onClick={()=>void readSnapshot(v.id,true)}>새 초안으로 재사용</button></div>)}
        {s.snapshot&&<article aria-label="확정 당시 배차">
          <h3>{s.snapshot.snapshot.plan.name} · 버전 {s.snapshot.plan_revision}</h3><p>원본 {s.snapshot.id} / SHA-256 {s.snapshot.content_hash}</p>
          <p>{s.snapshot.snapshot.vehicle.plate} / 정원 {s.snapshot.snapshot.vehicle.capacity} / 기사 {s.snapshot.snapshot.driver.name}</p>
          <ol>{s.snapshot.snapshot.stops.map((row:any)=><li key={row.stopId}>{row.time} {row.name} · {row.address} · {row.students.map((v:Named)=>v.name).join(", ")}</li>)}</ol>
        </article>}
      </section>
    </>}
    {s.message&&<p role="status">{s.message}</p>}
    {s.unknown&&<section role="alert">저장 결과 미확인입니다. 입력·재전송을 잠갔습니다. 메뉴 복귀 후에도 기존 영수증만 확인합니다.
      <button disabled={s.busy} onClick={()=>void recover()}>서버 처리 결과 확인</button></section>}
  </div>;
}
