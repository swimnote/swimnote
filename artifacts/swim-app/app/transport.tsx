import React,{useEffect,useRef,useState} from "react";
import {AppState,Button,Linking,Platform,ScrollView,Text,TextInput,View,Alert} from "react-native";
import {useSafeAreaInsets} from "react-native-safe-area-context";
import {useQuery,useQueryClient} from "@tanstack/react-query";
import {useAuth,apiRequest} from "@/context/AuthContext";
import Colors from "@/constants/colors";
import {transportVault,transportRequestId,type TransportVault} from "@/lib/transport-vault";
import {useTransportApproach} from "@/lib/use-transport-approach";
import {startTransportBackground,stopTransportBackground,refreshTransportSurface,cancelTransportHint} from "@/lib/transport-background";
import {router,useLocalSearchParams} from "expo-router";
import {useTransportRealtime} from "@/lib/use-transport-realtime";
import {validateRunPlan,checkTransportCommand,transportState,nextTransportStep,transportHint,type TransportCommand,type TransportEvent} from "../../../lib/api-zod/src/transport";
const C=Colors.light;
const empty=(owner:string):TransportVault=>({owner,runId:"",manifest:null,queue:[],hints:[]});
export default function TransportScreen(){
  const params=useLocalSearchParams<{runId?:string;stepId?:string}>();
  const auth=useAuth(),qc=useQueryClient(),insets=useSafeAreaInsets();
  const account=auth.kind==="parent"?auth.parentAccount:auth.adminUser;
  const poolId=(account as any)?.swimming_pool_id??auth.pool?.id??auth.activePoolId;
  const identityType=auth.kind==="parent"?"parent_accounts":"users";
  const owner=account?.id&&poolId?`${identityType}:${account.id}:${poolId}`:"";
  const actor=account?.id?`${identityType}:${account.id}`:"";
  const [view,setView]=useState(auth.kind==="parent"?"parent":"driver"),[v,setV]=useState<TransportVault>(empty("")),[selected,setSelected]=useState(""),[chosen,setChosen]=useState<string[]>([]);
  const [message,setMessage]=useState(""),[busy,setBusy]=useState(false),[localFault,setLocalFault]=useState(false),[invite,setInvite]=useState(""),[reason,setReason]=useState(""),[hint,setHint]=useState<any>(null);
  const generation=useRef(0),syncing=useRef(false),liveOwner=useRef(owner),liveToken=useRef(auth.token);
  liveOwner.current=owner;liveToken.current=auth.token;
  async function call(path:string,body?:unknown){
    if(!auth.token||!owner)throw Error("현재 로그인 계정·센터를 확인하세요.");
    const token=auth.token;
    const response=await apiRequest(token,`/transport${path}`,{_noCache:true,...(body===undefined?{}:{method:"POST",body:JSON.stringify(body)})});
    if(owner!==liveOwner.current||token!==liveToken.current)throw Error("이전 계정 요청 결과를 차단했습니다.");
    const data=await response.json();
    if(owner!==liveOwner.current||token!==liveToken.current)throw Error("이전 계정 응답을 차단했습니다.");
    if(!response.ok)throw Object.assign(Error(data.error??"차량 조회·기록 요청 실패"),{status:response.status,code:data.code});
    return data;
  }
  const me=useQuery({queryKey:["transport-me",owner],queryFn:async()=>{
    const data=await call("/me");
    if(data.identity?.key!==actor||data.identity?.poolId!==poolId||!Array.isArray(data.memberships))throw Object.assign(Error("현재 계정·센터 운행 권한 응답을 확인하지 못했습니다."),{status:403});
    return data;
  },enabled:!!owner&&!!auth.token,retry:false,staleTime:0,refetchInterval:30000});
  const runs=useQuery({queryKey:["transport-runs",owner],queryFn:()=>call("/runs"),enabled:!!owner&&!!auth.token,retry:false,refetchInterval:15000});
  const parent=useQuery({queryKey:["transport-parent",owner],queryFn:()=>call("/parent"),enabled:!!owner&&!!auth.token&&view==="parent"&&auth.kind==="parent",retry:false,refetchInterval:10000});
  useEffect(()=>{
    const gen=++generation.current;setV(empty(owner));setSelected("");setChosen([]);setHint(null);setMessage("");setLocalFault(false);
    if(owner&&Platform.OS!=="web")transportVault.read(owner).then(value=>{
      if(value.manifest){validateRunPlan(value.manifest.run?.plan);if(!Array.isArray(value.manifest.events)||!Array.isArray(value.manifest.students))throw Error("기기 명단 계약을 확인할 수 없습니다. 전송 대기는 원 보관에 유지합니다.");}
      if(gen===generation.current)setV(value);
    }).catch(e=>{if(gen===generation.current){setLocalFault(true);setMessage(e.message);}});
    return()=>{generation.current++;if(owner&&Platform.OS!=="web"&&liveOwner.current!==owner)void transportVault.mutate(owner,value=>({...value,manifest:null})).catch(()=>{});};
  },[owner]);
  const manifest=v.owner===owner?v.manifest:null;
  useEffect(()=>{
    if(!owner||!manifest)return;
    if([401,403].includes((me.error as any)?.status)){void save(old=>({...old,manifest:null})).catch(()=>{});setV(old=>({...old,manifest:null}));return;}
    if(!me.data)return;
    const assigned=me.data.identity.key===actor&&me.data.identity.poolId===poolId&&me.data.memberships.some((x:any)=>x.status==="ACTIVE"&&[manifest.run.plan.driverId,manifest.run.plan.escortId].includes(x.id));
    if(!assigned){void save(old=>({...old,manifest:null})).catch(()=>{});setV(old=>({...old,manifest:null}));setMessage("운행 권한 회수·배정 변경 확인: 이전 명단 접근을 닫았습니다. 미전송 기록은 보존합니다.");}
  },[me.data,me.error,owner,manifest?.run.id]);
  async function save(fn:(old:TransportVault)=>TransportVault){
    if(Platform.OS==="web")throw Error("보호된 오프라인 보관은 native 앱에서만 지원합니다. 이 웹 화면에서 운행 확인을 보내지 않습니다.");
    const value=await transportVault.mutate(owner,fn);
    if(liveOwner.current===owner)setV(value);
    return value;
  }
  async function load(id=v.runId){
    if(!id||busy)return;setBusy(true);
    try{
      const data=await call(`/runs/${id}`);
      if(data.run?.id!==id||data.run.pool_id!==poolId||!Array.isArray(data.events)||!Array.isArray(data.students))throw Error("운행 ID·센터·응답 계약을 확인하지 못했습니다.");
      validateRunPlan(data.run.plan);
      await save(old=>{
        if(old.queue.length&&old.runId!==id)throw Error("이전 운행 전송 대기를 먼저 대조하세요.");
        return {...old,runId:id,manifest:data};
      });
      setLocalFault(false);setMessage("서버 운행을 조회했습니다. 미전송 확인은 별도 전송 대기입니다.");
    }catch(e:any){
      if(e.status===403||e.status===401){await save(old=>({...old,manifest:null})).catch(()=>{});setV(old=>({...old,manifest:null}));}
      setMessage(e.message);
    }finally{setBusy(false);}
  }
  useEffect(()=>{
    if(!owner||!v.runId||!auth.token)return;
    const timer=setInterval(()=>{if(AppState.currentState==="active")void load();},15000);
    const sub=AppState.addEventListener("change",state=>{if(state==="active")void load();});
    return()=>{clearInterval(timer);sub.remove();};
  },[owner,v.runId,auth.token,busy]);
  const liveLoad=useRef(load);liveLoad.current=load;
  useTransportRealtime(owner,auth.token,()=>{void liveLoad.current();});
  const pending=v.queue.filter(x=>x.runId===v.runId&&!x.resolution);
  const localEvents:TransportEvent[]=manifest?[...manifest.events,...pending.map(x=>({...x.command,actor,serverAt:""}))]:[];
  const state=manifest?transportState(manifest.run.plan,localEvents):null;
  const serverState=manifest?transportState(manifest.run.plan,manifest.events):null;
  const step=manifest?.run.plan.steps.find((x:any)=>x.id===selected)??manifest?.run.plan.steps[0];
  const nextPending=manifest?.run.plan.steps.find((x:any)=>state?.pending.includes(x.id));
  const gps=useTransportApproach(`${owner}:${manifest?.run.id??""}:${manifest?.run.revision??0}`,view==="driver"&&!!state?.started&&!state?.closed,nextPending);
  useEffect(()=>{
    if(!manifest||!state?.started||state.closed)return;
    if(hint&&!state.pending.includes(hint.stepId)){setHint(null);return;}
    const tick=()=>{
      if(AppState.currentState!=="active")return;
      const parts=new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Seoul",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date()).split(":");
      const h=transportHint(manifest.run.plan,state.pending,v.hints,manifest.run.revision,Number(parts[0])*60+Number(parts[1]),gps.nearStepId,manifest.run.id);
      if(h&&!hint){
        let claimed=false;
        void save(old=>{
          if(old.hints.includes(h.key))return old;
          claimed=true;return {...old,hints:[...old.hints,h.key]};
        }).then(async()=>{if(claimed){await cancelTransportHint(h.key).catch(()=>{});setHint(h);}})
          .catch(e=>{setLocalFault(true);setMessage(e.message);});
      }
    };
    tick();const timer=setInterval(tick,15000);return()=>clearInterval(timer);
  },[manifest,state?.pending.join(","),state?.started,state?.closed,v.hints.join(","),hint,gps.nearStepId]);
  async function sync(){
    if(syncing.current||!owner||localFault)return;syncing.current=true;setBusy(true);
    try{
      while(liveOwner.current===owner){
        const current=await transportVault.read(owner),head=current.queue.find(x=>!x.resolution);
        if(!head||head.blocked)break;
        try{
          const result=await call(`/runs/${head.runId}/events`,head.command);
          if(result.requestId!==head.command.requestId||result.event?.actor!==actor||result.revision!==head.command.revision)throw Error("서버 기록 ID·처리자·버전을 확인하지 못했습니다.");
          await save(old=>{
            if(old.manifest?.run.id===head.runId&&!old.manifest.events.some((x:any)=>x.requestId===head.command.requestId))old.manifest.events.push(result.event);
            return {...old,queue:old.queue.filter(x=>x.command.requestId!==head.command.requestId)};
          });
        }catch(e:any){
          if(e.status>=400&&e.status<500&&![408,429].includes(e.status)){
            await save(old=>({...old,manifest:e.status===403?null:old.manifest,queue:old.queue.map(x=>x.command.requestId===head.command.requestId?{...x,blocked:`${e.code}: ${e.message}`} :x)}));
          }
          throw e;
        }
      }
      setMessage("서버 전송 결과를 대조했습니다. 보류 기록은 삭제하지 않습니다.");qc.invalidateQueries({queryKey:["transport-runs",owner]});
    }catch(e:any){setMessage(`전송 대기·대조 필요: ${e.message}. 같은 요청 ID를 보존합니다.`);}
    finally{syncing.current=false;if(liveOwner.current===owner)setBusy(false);}
  }
  async function command(kind:TransportCommand["kind"],ids?:string[],extra:Partial<TransportCommand>={}){
    if(!manifest||busy||localFault||pending.some(x=>x.blocked))return;
    const c:TransportCommand={requestId:transportRequestId(),revision:manifest.run.revision,kind,deviceAt:new Date().toISOString(),stepId:step?.id,studentIds:ids,...extra};
    setBusy(true);
    try{
      checkTransportCommand(manifest.run.plan,localEvents,c,actor,manifest.run.revision);
      const stored=await save(old=>{
        if(!old.manifest||old.manifest.run.id!==manifest.run.id||old.manifest.run.revision!==c.revision)throw Error("기기 운행 버전이 바뀌었습니다.");
        const effective=[...old.manifest.events,...old.queue.filter(x=>!x.resolution).map(x=>({...x.command,actor,serverAt:""}))];
        checkTransportCommand(old.manifest.run.plan,effective,c,actor,c.revision);
        return {...old,queue:[...old.queue,{runId:manifest.run.id,command:c}]};
      });
      setChosen([]);
      const nextState=transportState(manifest.run.plan,[...manifest.events,...stored.queue.filter(x=>!x.resolution).map(x=>({...x.command,actor,serverAt:""}))]);
      if(["BOARD","ALIGHT","NO_SHOW"].includes(kind))setSelected(nextTransportStep(manifest.run.plan,nextState.pending,step.id)??step.id);
      setMessage(kind==="FINISH"?"현장 최종 확인·종료 입력 / 서버 전송 대기":"기기에 확인 입력을 보관했습니다. 서버 반영 전 전송 대기입니다.");
      setTimeout(()=>void sync(),0);
    }catch(e:any){if(!(e.code))setLocalFault(true);setMessage(e.message);}
    finally{setBusy(false);}
  }
  useEffect(()=>{if(owner&&params.runId&&params.runId!==v.runId&&!busy)void load(params.runId);},[owner,params.runId]);
  useEffect(()=>{if(params.stepId&&manifest?.run.plan.steps.some((s:any)=>s.id===params.stepId))setSelected(params.stepId);},[params.stepId,manifest?.run.id]);
  useEffect(()=>{
    if(manifest&&state?.started&&!state.closed)void refreshTransportSurface(owner).catch(e=>setMessage(e.message));
    else if(state?.closed||!owner)void stopTransportBackground().catch(()=>{});
  },[owner,manifest?.run.revision,state?.pending.join(","),state?.closed,pending.length]);
  async function reconcile(){
    setBusy(true);
    try{
      for(const item of pending.filter(x=>x.blocked)){
        const uploadId=item.observationRequestId??transportRequestId();
        await save(old=>({...old,queue:old.queue.map(x=>x.command.requestId===item.command.requestId?{...x,observationRequestId:uploadId}:x)}));
        await call("/observations",{requestId:uploadId,runId:item.runId,command:item.command,reason:item.blocked});
        const result=await call(`/observations/${item.command.requestId}`);
        if(result.decision)await save(old=>({...old,queue:old.queue.map(x=>x.command.requestId===item.command.requestId?{...x,resolution:{decision:result.decision,reason:result.reason,event_id:result.event_id}}:x)}));
      }
      setMessage("당시 원 관측을 PC 대조에 전달했습니다. 관리자 해결 전 원 기록은 보류하며 새 승하차로 만들지 않습니다.");
    }catch(e:any){setMessage(`관측 전달·결과 미확인: ${e.message}. 원 요청과 대기는 보존합니다.`);}
    finally{setBusy(false);}
  }
  if(!auth.token)return <View style={{padding:24}}><Text>기존 스윔노트 계정으로 로그인하거나 센터 초대를 받아 가입하세요.</Text><Button title="기사·인솔자 최초 가입" onPress={()=>router.push("/(auth)/signup?transport=1" as any)}/></View>;
  return <ScrollView contentContainerStyle={{padding:16,paddingTop:insets.top+12,paddingBottom:insets.bottom+24,backgroundColor:C.background,gap:12}}>
    <Text style={{fontSize:22,fontWeight:"700",color:C.text}}>차량 확인·운행</Text>
    <Text>정차 후 또는 인솔자가 조작하세요. 버튼 확인은 실제 안전벨트·인계를 자동 증명하지 않습니다.</Text>
    <Text>내 계정: {identityType} / {account?.id} · 센터 {poolId??"확인 필요"}</Text>
    {me.error&&<Text>운행 권한 조회 실패: {(me.error as Error).message}. 캐시는 서버 확정·현재 권한 확인이 아닙니다.</Text>}
    <Button title="기사·인솔자 운행" onPress={()=>setView("driver")}/>
    {auth.kind==="parent"&&<Button title="내 자녀 차량 확인" onPress={()=>setView("parent")}/>}
    {view==="parent"?<>
      <Text>자기 자녀의 서버 반영 상태입니다. 위치 추적·정확한 ETA가 아닙니다. 푸시 OFF여도 조회합니다.</Text>
      {parent.isPending&&<Text>서버 상태 조회 중</Text>}{parent.error&&<Text>조회 실패: {(parent.error as Error).message}. 미탑승·정상으로 추정하지 않습니다.</Text>}
       {![401,403].includes((parent.error as any)?.status)&&parent.data?.items.map((x:any)=><View key={`${x.runId}:${x.studentId}`}><Text>{x.date} / 자녀 {x.studentId} / v{x.revision} / {x.status}</Text><Text>기기 확인 {x.deviceAt??"없음"} / 서버 반영 {x.serverAt??"없음"} / 조회 {x.queriedAt}</Text>{x.scheduled.map((s:any,i:number)=><Text key={i}>{s.time} {s.action} {s.name}</Text>)}</View>)}
       {parent.data&&!parent.error&&!parent.data.items.length&&<Text>승인된 자녀에게 게시된 운행이 없습니다.</Text>}
      <Text>차량 푸시 선택은 저장할 수 있지만 발송 연동 승인 전에는 발송하지 않습니다. 자동 SMS 전환은 없습니다.</Text>
       {[...new Set<string>(([401,403].includes((parent.error as any)?.status)?[]:parent.data?.items??[]).map((x:any)=>x.studentId))].map(id=>{
        const item=parent.data.items.find((x:any)=>x.studentId===id);
        return <Button key={id} title={`${id} 차량 알림 희망: ${item.notifyEnabled?"ON":"OFF"} (발송 연결 전)`} disabled={busy} onPress={async()=>{
          setBusy(true);try{await call("/parent/preferences",{requestId:transportRequestId(),studentId:id,enabled:!item.notifyEnabled});qc.invalidateQueries({queryKey:["transport-parent",owner]});setMessage("알림 선택만 저장했습니다. 실발송하지 않았습니다.");}catch(e:any){setMessage(e.message);}finally{setBusy(false);}
        }}/>;
      })}
    </>:<>
      <TextInput accessibilityLabel="운행 초대 코드" placeholder="본인에게 전달된 초대 코드" value={invite} onChangeText={setInvite} style={{borderWidth:1,padding:12}}/>
      <Button title="운행 전용 초대 수락" disabled={busy||!invite} onPress={async()=>{
        setBusy(true);try{await call("/onboarding/accept",{requestId:transportRequestId(),inviteCode:invite});setInvite("");qc.invalidateQueries({queryKey:["transport-me",owner]});qc.invalidateQueries({queryKey:["transport-runs",owner]});setMessage("운행 전용 초대를 수락했습니다. 관리자·강사 권한은 추가하지 않습니다.");}catch(e:any){setMessage(e.message);}finally{setBusy(false);}
      }}/>
      {runs.error&&<Text>담당 목록 조회 실패: {(runs.error as Error).message}</Text>}
      {runs.data?.items.map((run:any)=><Button key={run.id} title={`${run.date} ${run.name} / v${run.revision} ${run.status}`} disabled={busy} onPress={()=>void load(run.id)}/>)}
      <Button title="저장된 운행 다시 조회" disabled={busy||!v.runId} onPress={()=>void load()}/>
       <Button title={`기존 요청 ID로 전송 대기 동기화 (${localFault?"기기 오류·수량 확인 불가":pending.length})`} disabled={busy||localFault||!pending.length} onPress={()=>void sync()}/>
      {pending.map(x=><Text key={x.command.requestId}>전송 {x.blocked?"보류·관리자 대조":"대기"} / {x.command.kind} / v{x.command.revision} / {x.command.requestId} {x.blocked}</Text>)}
      <Button title="보류 관측 PC 대조 전달·해결 결과 확인" disabled={busy||!pending.some(x=>x.blocked)} onPress={()=>void reconcile()}/>
      {v.queue.filter(x=>x.resolution).map(x=><Text key={x.command.requestId}>원 관측 보존 / {x.command.requestId} / {x.resolution?.decision} / {x.resolution?.reason} (새 승하차가 아닙니다)</Text>)}
      {manifest&&state&&<>
        <Text style={{fontWeight:"700"}}>{manifest.run.plan.name} / v{manifest.run.revision}</Text>
        <Text>서버 마지막 반영 {serverState?.lastServerAt??"확인 없음"} / 기기 미처리 {state.pending.length} / 미하차 {state.onboard.length}</Text>
         {hint&&<View><Text>{hint.reason==="GPS_APPROACH"?"등록 반경·머무름에 따른 GPS 접근":"예정시각 도래"} 안내입니다. 도착·승하차 증거가 아니며 화면 선택을 바꾸지 않습니다.</Text><Button title="아직 도착 전·접기" onPress={()=>setHint(null)}/></View>}
         <Text>{gps.message}</Text>
         <Button title={gps.enabled?"GPS 접근 안내 끄기":"앱 사용 중 GPS 접근 안내 켜기 (선택)"} disabled={busy||!state.started||state.closed} onPress={()=>gps.enabled?gps.disable():void gps.enable()}/>
         {gps.settings&&<Button title="기기 설정에서 위치 권한 확인" onPress={()=>void Linking.openSettings().catch(()=>setMessage("기기 설정을 열지 못했습니다."))}/>}
        <Button title="이 게시 버전 수신 확인" disabled={busy||state.closed||localEvents.some(e=>e.kind==="ACK"&&e.actor===actor&&e.revision===manifest.run.revision)} onPress={()=>void command("ACK")}/>
        <Button title="운행 시작" disabled={busy||state.started||state.closed} onPress={()=>void command("START")}/>
        <Text>예정 순서 / 실제 처리는 서버 이력에 별도 보존</Text>
        {manifest.run.plan.steps.map((x:any)=><Button key={x.id} title={`${x.time} ${x.name} (${x.action}) · ${state.pending.includes(x.id)?"미처리":"확인/명시적 미탑승"}`} onPress={()=>{setSelected(x.id);setChosen([]);}}/>)}
        {step&&<>
          <Text style={{fontSize:20,fontWeight:"700"}}>{step.name} / {step.time} / {step.action}</Text>
          <Text>{step.address??"센터 지정 장소"}</Text>
          <Text>운행 당시 인계조건: {step.studentIds.map((id:string)=>`${manifest.students.find((x:any)=>x.id===id)?.name??id}: ${manifest.run.plan.handoverSnapshot?.[id]||"별도 조건 미등록·현장 확인"}`).join(" / ")}</Text>
          <Button title="이전 (화면 이동만)" onPress={()=>{const i=manifest.run.plan.steps.findIndex((x:any)=>x.id===step.id);setSelected(manifest.run.plan.steps[Math.max(0,i-1)].id);setChosen([]);}}/>
          <Button title="다음 (화면 이동만)" onPress={()=>{const i=manifest.run.plan.steps.findIndex((x:any)=>x.id===step.id);setSelected(manifest.run.plan.steps[Math.min(manifest.run.plan.steps.length-1,i+1)].id);setChosen([]);}}/>
          {step.studentIds.map((id:string)=>{
            const student=manifest.students.find((x:any)=>x.id===id),child=state.children[id];
            return <View key={id}><Button title={`${chosen.includes(id)?"선택 · ":""}${student?.name??id} · ${child?.status} · ${pending.some(x=>x.command.studentIds?.includes(id))?"전송 대기":"서버 기록"}`} onPress={()=>setChosen(old=>old.includes(id)?old.filter(x=>x!==id):[...old,id])}/>
              {[student?.parent_phone,student?.parent_phone2,student?.parent_phone3,student?.parent_phone4].filter(Boolean).map((phone:string,i:number)=><Button key={i} title={`보호자 ${i+1} 전화`} onPress={()=>{const value=phone.replace(/[^+\d]/g,"");if(/^\+?\d{7,15}$/.test(value))void Linking.openURL(`tel:${value}`).catch(()=>setMessage("기본 전화 앱을 열지 못했습니다."));else setMessage("회원정보의 연락처를 확인하세요.");}}/>)}</View>;
          })}
          <Button title={["CENTER_BOARD","PICKUP"].includes(step.action)?"전원 탑승·벨트 확인":"전원 하차·인계 확인"} disabled={busy||state.closed||localFault||pending.some(x=>!!x.blocked)} onPress={()=>{
            const ids=step.studentIds.filter((id:string)=>!localEvents.some(e=>e.stepId===step.id&&e.studentIds?.includes(id)&&["BOARD","ALIGHT","NO_SHOW"].includes(e.kind)&&!localEvents.some(v=>v.corrects===e.requestId))&&state.children[id]?.status!=="NO_SHOW");
            Alert.alert("실제 확인",`${step.name} / ${ids.length}명. 정차 상태에서 확인했습니까?`,[{text:"취소",style:"cancel"},{text:"확인",onPress:()=>void command(["CENTER_BOARD","PICKUP"].includes(step.action)?"BOARD":"ALIGHT",ids)}]);
          }}/>
          <Button title="선택 회원만 승하차 확인" disabled={busy||!chosen.length||state.closed} onPress={()=>void command(["CENTER_BOARD","PICKUP"].includes(step.action)?"BOARD":"ALIGHT",chosen)}/>
          <Button title="선택 회원 미탑승" disabled={busy||!chosen.length||state.closed||!["CENTER_BOARD","PICKUP"].includes(step.action)} onPress={()=>void command("NO_SHOW",chosen)}/>
        </>}
        <TextInput accessibilityLabel="직전 기록 정정 사유" placeholder="직전 본인 확인 기록의 정정 사유" value={reason} onChangeText={setReason} style={{borderWidth:1,padding:12}}/>
        <Button title="직전 오입력 정정 (원기록 보존)" disabled={busy||!reason.trim()||state.closed} onPress={()=>{
          const last=localEvents.filter(e=>["BOARD","ALIGHT","NO_SHOW"].includes(e.kind)&&!localEvents.some(x=>x.corrects===e.requestId)).slice(-1)[0];
          void command("CORRECT",undefined,{corrects:last?.requestId,reason});
        }}/>
        <Button title={pending.some(x=>x.command.kind==="FINISH")?"현장 종료 확인·전송 대기":"센터 인계·차량 내부 최종 확인 후 종료"} disabled={busy||state.closed||state.pending.length>0||state.onboard.length>0} onPress={()=>Alert.alert("센터 복귀·차량 내부 최종 확인","센터로 복귀했고 모든 학생의 하차·인계와 차량 내부 잔류 여부를 직접 확인했습니까?",[{text:"취소",style:"cancel"},{text:"확인·종료",onPress:()=>void command("FINISH",undefined,{cabinChecked:true,centerReturned:true})}])}/>
          <Button title="운행 알림·iPhone Live Activity 켜기" disabled={busy||!state.started||state.closed} onPress={()=>void startTransportBackground(owner).then(()=>setMessage("운행 표시 연결. iPhone은 잠금 해제 후 앱에서 확인하며 Android 전원 확인은 기기 보관 대기입니다.")).catch(e=>setMessage(e.message))}/>
          <Button title="백그라운드 GPS 접근 안내 추가 (선택)" disabled={busy||!state.started||state.closed} onPress={()=>void startTransportBackground(owner,true).then(()=>setMessage("운행 중 위치 안내를 켰습니다. OS가 중단할 수 있으며 위치는 서버에 보내지 않습니다.")).catch(e=>setMessage(e.message))}/>
          <Button title="운행 표시·백그라운드 위치 끄기" onPress={()=>void stopTransportBackground().catch(e=>setMessage(e.message))}/>
          <Text>알림 시각은 도착 증거가 아닙니다. iPhone Live Activity는 iOS 16.2 이상·새 native binary에서 지원하며 표시 제한 시 알림에서 현재 운행을 여세요. 잠금·강제 종료·절전에서는 OS가 실행을 중단할 수 있습니다. Android도 잠금으로 보호 보관이 불가능하면 앱에서 확인합니다. OTA만으로 배포할 수 없습니다.</Text>
      </>}
    </>}
    {message&&<Text accessibilityLiveRegion="polite">{message}</Text>}
    {localFault&&<Text>기기 보관 오류: 새 확인·재전송을 중지했습니다. 저장된 운행 조회로 복구하고 현장 기록을 대조하세요.</Text>}
  </ScrollView>;
}
