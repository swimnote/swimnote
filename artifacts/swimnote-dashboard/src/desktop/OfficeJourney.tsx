import { useEffect,useState } from "react";
import { ResourceTable } from "./OfficeOperationsPanel";
import NewMemberPage from "../pages/members/NewMemberPage";
import { InvoiceStep } from "./OfficeBillingWorkflows";
import type { OpsItem } from "./office-ops-lib";
import { ui } from "./office-ops-styles";
type JourneyState={linked?:OpsItem;created?:OpsItem;member:{id:string;name:string}|null};
const memory=new Map<string,JourneyState>();
if(typeof window!=="undefined")window.addEventListener("office:session-invalid",()=>memory.clear());

/** Existing forms/APIs, in one detail. Seeds never execute or imply a saved assignment. */
export function ContractContinuation({contract,scope,studentName,onDone=()=>{}}:{contract:OpsItem;scope:string;studentName:string;onDone?:()=>void}){
  const [assigned,setAssigned]=useState(false);
  const c=contract.data;
  return <section style={{...ui.box,display:"grid",gap:10}} data-testid="contract-continuation">
    <strong>{studentName} · 계약 {contract.id.slice(0,8)} · {c.startDate}~{c.endDate}</strong>
    <details open><summary>다음: 날짜별 반 배정 · 회원/계약/기간 전달됨</summary>
      <ResourceTable key={contract.id} res="enrollments" scopeKey={scope} draftKey={`contract-${contract.id}`}
        seed={{form:{studentId:c.studentId,contractId:contract.id,startDate:c.startDate,endDate:c.endDate,status:"active"}}}
        onSaved={()=>{setAssigned(true);onDone();}}/>
      <p role="status">{assigned?"수강 배정을 저장했습니다. 다른 반은 새로 등록으로 추가할 수 있습니다.":"반을 선택하고 저장하세요. 아래 청구와 수강 배정은 서로 다른 기록이며 자동 처리하지 않습니다."}</p>
    </details>
    <InvoiceStep scope={scope} contract={contract} studentName={studentName} onDone={onDone}/>
  </section>;
}
export function OfficeJourney({scope,contact,contract}:{scope:string;contact?:OpsItem;contract?:OpsItem}){
  const key=`${scope}:${contact?.id??contract?.id}`,d0=memory.get(key);
  const [linked,setLinked]=useState<OpsItem|undefined>(d0?.linked??contact),[created,setCreated]=useState<OpsItem|undefined>(d0?.created??contract);
  const [member,setMember]=useState<{id:string;name:string}|null>(d0?.member??null);
  useEffect(()=>{memory.set(key,{linked,created,member});},[key,linked,created,member]);
  const studentId=member?.id??linked?.data.studentId??created?.data.studentId;
  const name=member?.name??linked?.data.name??studentId??"회원";
  return <section style={{display:"grid",gap:10}} data-testid="office-journey">
    <h2 style={{fontSize:17}}>상담 → 체험·대기 → 등록 → 계약 → 반 배정 → 청구</h2>
    {linked&&<ResourceTable res="contacts" scopeKey={scope} draftKey={`follow-${linked.id}`}
      seed={{edit:linked,form:Object.fromEntries(Object.entries(linked.data).map(([k,v])=>[k,String(v??"")]))}}
      onSaved={setLinked}/>}
    {!studentId&&<details open><summary>회원 등록 · 상담 정보를 가져옵니다</summary>
      <p>기존 회원이면 위 연결 회원을 선택해 저장하세요. 새 회원일 때만 아래 등록을 사용합니다.</p>
      <NewMemberPage initialValues={{name:linked?.data.name??"",parent_phone:linked?.data.phone??""}} onCreated={setMember}/>
    </details>}
    {member&&linked?.data.studentId!==member.id&&linked&&<ResourceTable res="contacts" scopeKey={scope} draftKey={`link-${linked.id}-${member.id}`}
      seed={{edit:linked,form:{...Object.fromEntries(Object.entries(linked.data).map(([k,v])=>[k,String(v??"")])),studentId:member.id,stage:"registered"}}}
      onSaved={setLinked}/>}
    {studentId&&!created&&<>
      <details><summary>필요하면 새 상품 등록 · 기존 상품은 계약에서 바로 선택</summary><ResourceTable res="products" scopeKey={scope} draftKey={`journey-${studentId}`}/></details>
      <ResourceTable res="contracts" scopeKey={scope} draftKey={`journey-${studentId}`}
        seed={{form:{studentId,status:"active"}}} onSaved={setCreated}/>
    </>}
    {created&&<ContractContinuation contract={created} scope={scope} studentName={name}/>}
  </section>;
}
