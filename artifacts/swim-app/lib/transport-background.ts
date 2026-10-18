import {Platform} from "react-native";
import Constants from "expo-constants";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {transportVault,transportRequestId,type TransportVault} from "./transport-vault";
import {transportState,transportApproach,checkTransportCommand,type TransportCommand} from "../../../lib/api-zod/src/transport";
const SESSION="swimnote_transport_active",GPS_TASK="SWIMNOTE_TRANSPORT_LOCATION",ACTION_TASK="SWIMNOTE_TRANSPORT_ACTION";
const CATEGORY="SWIMNOTE_TRANSPORT",CARD="swimnote-transport-current";
const native=Platform.OS!=="web"&&Constants.appOwnership!=="expo";
let backgroundAvailable=false;
type Session={owner:string;runId:string;revision:number;expires:number;gps:boolean;armed?:{key:string;due:number};authorityAt?:number};
const actor=(owner:string)=>owner.split(":").slice(0,2).join(":");
const events=(v:TransportVault)=>[...v.manifest.events,...v.queue.filter(x=>!x.resolution).map(x=>({...x.command,actor:actor(v.owner),serverAt:""}))];
const readSession=async():Promise<Session|null>=>{
  const raw=await AsyncStorage.getItem(SESSION);return raw?JSON.parse(raw):null;
};
async function storedSessionMatches(owner:string){
  const values=Object.fromEntries(await AsyncStorage.multiGet(["auth_token","auth_kind","auth_parent","auth_admin"]));
  const type=values.auth_kind==="parent"?"parent_accounts":"users";
  const account=JSON.parse((type==="parent_accounts"?values.auth_parent:values.auth_admin)??"null");
  return values.auth_token&&account?.id&&owner.startsWith(`${type}:${account.id}:`)?values.auth_token:null;
}
async function syncBackground(owner:string){
  const {apiRequest}=await import("@/context/AuthContext");
  const token=await storedSessionMatches(owner);if(!token)return;
  const request=async(path:string,body?:unknown)=>{
    if(await storedSessionMatches(owner)!==token)throw Error("계정 변경: 원 소유 대기 보존");
    const response=await apiRequest(token,`/transport${path}`,body?{method:"POST",body:JSON.stringify(body),_noCache:true}:{_noCache:true});
    const data=await response.json();
    if(!response.ok)throw Object.assign(Error(data.error??"운행 동기화 결과 미확인"),{status:response.status,code:data.code});
    return data;
  };
  // Always current authority before replay; cached membership is not permission.
  try{
    const me=await request("/me");
    if(`${me.identity?.key}:${me.identity?.poolId}`!==owner)return;
    const v=await transportVault.read(owner),live=await request(`/runs/${v.runId}`);
    if(live.state?.closed||live.run?.revision!==v.manifest?.run.revision){
      await transportVault.mutate(owner,old=>({...old,queue:old.queue.map(q=>q.resolution?q:{...q,
        blocked:live.state?.closed?"CLOSED: 서버 종료와 원 관측을 관리자 대조하세요.":"VERSION_CHANGED: 원 배차 버전 관측을 관리자 대조하세요."})}));
      await stopTransportBackground();return;
    }
  }catch(e:any){
    if([401,403,404].includes(e.status)){
      await transportVault.mutate(owner,old=>({...old,manifest:null,queue:old.queue.map(q=>q.resolution?q:{...q,blocked:"ASSIGNMENT_REVOKED: 원 소유 관측 보존"})}));
      await stopTransportBackground();
    }
    throw e;
  }
  for(;;){
    const v=await transportVault.read(owner),head=v.queue.find(x=>!x.resolution);if(!head||head.blocked)return;
    try{
      const result=await request(`/runs/${head.runId}/events`,head.command);
      if(result.requestId!==head.command.requestId||result.revision!==head.command.revision||result.event?.actor!==actor(owner))throw Error("서버 영수증 계약 미확인");
      await transportVault.mutate(owner,old=>{
        if(old.manifest?.run.id===head.runId&&!old.manifest.events.some((e:any)=>e.requestId===head.command.requestId))old.manifest.events.push(result.event);
        return {...old,queue:old.queue.filter(x=>x.command.requestId!==head.command.requestId)};
      });
    }catch(e:any){
      if(e.status>=400&&e.status<500&&![408,429].includes(e.status))await transportVault.mutate(owner,old=>({...old,manifest:[401,403].includes(e.status)?null:old.manifest,
        queue:old.queue.map(x=>x.command.requestId===head.command.requestId?{...x,blocked:`${e.code}: ${e.message}`}:x)}));
      return;
    }
  }
}
export function transportHintId(runId:string,revision:number,stepId:string){return `swimnote-transport:${runId}:${revision}:${stepId}`;}
async function active(){
  const s=await readSession();if(!s||s.expires<Date.now())return null;
  const v=await transportVault.read(s.owner);
  if(!v.manifest||v.manifest.run.id!==s.runId||v.manifest.run.revision!==s.revision)return null;
  const state=transportState(v.manifest.run.plan,events(v));
  if(!state.started||state.closed)return null;
  return {s,v,state};
}
/** Notification actions append to the SAME encrypted queue. They never mark server reflection or issue new IDs on replay. */
export async function transportBackgroundAction(data:any,action:string){
  const current=await active();if(!current||action!=="CONFIRM_ALL")return false;
  const {s,v,state}=current;
  if(!await storedSessionMatches(s.owner))return false;
  if(data.owner!==s.owner||data.runId!==s.runId||data.revision!==s.revision)return false;
  const step=v.manifest.run.plan.steps.find((x:any)=>x.id===data.stepId);
  if(!step||v.queue.some(x=>x.blocked&&!x.resolution))return false;
  const all=events(v),studentIds=step.studentIds.filter((id:string)=>state.children[id]?.status!=="NO_SHOW"&&!all.some(e=>
    e.stepId===step.id&&e.studentIds?.includes(id)&&["BOARD","ALIGHT","NO_SHOW"].includes(e.kind)&&!all.some(x=>x.corrects===e.requestId)));
  const command:TransportCommand={requestId:transportRequestId(),revision:s.revision,deviceAt:new Date().toISOString(),stepId:step.id,studentIds,
    kind:["CENTER_BOARD","PICKUP"].includes(step.action)?"BOARD":"ALIGHT"};
  await transportVault.mutate(s.owner,old=>{
    if(old.manifest?.run.id!==s.runId||old.manifest.run.revision!==s.revision)throw Error("운행 버전 변경");
    checkTransportCommand(old.manifest.run.plan,events(old),command,actor(s.owner),s.revision);
    return {...old,queue:[...old.queue,{runId:s.runId,command}]};
  });
  // If network/background execution is interrupted, the durable queue keeps the original request.
  await syncBackground(s.owner).catch(()=>{});
  await refreshTransportSurface(s.owner);return true;
}
async function hint(near?:string){
  const current=await active();if(!current)return;
  const {s,v,state}=current,step=v.manifest.run.plan.steps.find((x:any)=>state.pending.includes(x.id));
  if(!step||["CENTER_BOARD","CENTER_HANDOVER"].includes(step.action))return;
  const key=`${s.runId}:${s.revision}:${step.id}`,id=transportHintId(s.runId,s.revision,step.id);
  const due=new Date(`${v.manifest.run.plan.date}T${step.time}:00+09:00`).getTime();
  if(v.hints.includes(key)||near!==step.id||Date.now()>=due)return;
  const N=await import("expo-notifications");
  // OS time delivery wins if already presented; GPS never reissues it.
  if((await N.getPresentedNotificationsAsync()).some(x=>x.request.identifier===id))return;
  let claimed=false;
  await transportVault.mutate(s.owner,old=>{
    if(old.hints.includes(key))return old;
    claimed=true;return {...old,hints:[...old.hints,key]};
  });
  if(!claimed)return;
  await N.cancelScheduledNotificationAsync(id);
  await N.scheduleNotificationAsync({identifier:id,content:{title:"정류장 접근 안내",body:"등록 반경·머무름 조건입니다. 도착·승하차 확인이 아닙니다.",
    categoryIdentifier:CATEGORY,data:{type:"transport",owner:s.owner,runId:s.runId,revision:s.revision,stepId:step.id}},trigger:null});
}
// Module-scope task definitions are imported by the root bundle, including headless launch.
if(native){
  try{
  const T=require("expo-task-manager") as typeof import("expo-task-manager");
  T.defineTask(GPS_TASK,async({data,error}:any)=>{
    if(error)return;
    const current=await active().catch(()=>null);
    if(!current){await stopTransportBackground();return;}
    if(!current.s.gps)return;
    if(Date.now()-(current.s.authorityAt??0)>60000){
      current.s.authorityAt=Date.now();await AsyncStorage.setItem(SESSION,JSON.stringify(current.s));
      // Authority/closure heartbeat only. Coordinates NEVER leave the device.
      await syncBackground(current.s.owner).catch(()=>{});
      if(!await readSession())return;
    }
    const step=current.v.manifest.run.plan.steps.find((x:any)=>current.state.pending.includes(x.id));
    if(!step?.gps)return;
    const p=data?.locations?.at(-1);if(!p)return;
    const key=`${current.s.runId}:${current.s.revision}:${step.id}:dwell`;
    const raw=await AsyncStorage.getItem(key),since=raw?Number(raw):null;
    const result=transportApproach(step.gps,{latitude:p.coords.latitude,longitude:p.coords.longitude,accuracy:p.coords.accuracy,timestamp:p.timestamp},since,Date.now());
    if(result.since===null)await AsyncStorage.removeItem(key);else await AsyncStorage.setItem(key,String(result.since));
    if(result.near)await hint(step.id);
  });
  T.defineTask(ACTION_TASK,async({data,error}:any)=>{
    if(error||!data||Platform.OS!=="android")return;
    if("actionIdentifier" in data)try{await transportBackgroundAction(data.notification?.request?.content?.data,data.actionIdentifier);}
    catch{
      const N=await import("expo-notifications");
      await N.scheduleNotificationAsync({identifier:CARD,content:{title:"차량 확인 보관 실패",body:"잠금을 해제하고 현재 운행에서 확인하세요. 서버 반영 완료가 아닙니다.",data:{type:"transport"}},trigger:null});
    }
  });
  backgroundAvailable=true;
  }catch{/* Old binaries stay usable; start reports the missing native integration instead of crashing app startup. */}
}
export async function stopTransportBackground(){
  if(!native)return;
  await AsyncStorage.removeItem(SESSION);
  const L=await import("expo-location"),N=await import("expo-notifications");
  if(await L.hasStartedLocationUpdatesAsync(GPS_TASK))await L.stopLocationUpdatesAsync(GPS_TASK);
  const all=await N.getAllScheduledNotificationsAsync();
  for(const n of all)if(n.identifier.startsWith("swimnote-transport"))await N.cancelScheduledNotificationAsync(n.identifier);
  for(const n of await N.getPresentedNotificationsAsync())if(n.request.identifier.startsWith("swimnote-transport"))await N.dismissNotificationAsync(n.request.identifier);
  if(Platform.OS==="ios"){
    const A=(await import("./TransportLiveActivity")).default;
    await Promise.all(A.getInstances().map(x=>x.end("immediate")));
  }
}
export async function guardTransportBackground(owner:string){
  if(!native)return;
  const session=await readSession();
  if(session&&session.owner!==owner)await stopTransportBackground();
}
export async function cancelTransportHint(key:string){
  if(!native)return;
  const N=await import("expo-notifications");
  await N.cancelScheduledNotificationAsync(`swimnote-transport:${key}`);
  await N.dismissNotificationAsync(`swimnote-transport:${key}`);
}
export async function refreshTransportSurface(owner:string){
  if(!native)return;
  const session=await readSession();if(!session||session.owner!==owner)return;
  const current=await active();if(!current){await stopTransportBackground();return;}
  const {s,v,state}=current,step=v.manifest.run.plan.steps.find((x:any)=>state.pending.includes(x.id))??v.manifest.run.plan.steps.at(-1);
  const N=await import("expo-notifications");
  const data={type:"transport",owner:s.owner,runId:s.runId,revision:s.revision,stepId:step.id};
  if(Platform.OS==="android")await N.scheduleNotificationAsync({identifier:CARD,content:{title:"SWIMNOTE 차량 운행",body:`${step.name} · 예정 ${step.time} · 미처리 ${state.pending.length} · 전송 대기 ${v.queue.filter(x=>!x.resolution).length}`,
    sticky:true,autoDismiss:false,categoryIdentifier:CATEGORY,data},trigger:null});
  if(Platform.OS==="ios")try{
    const A=(await import("./TransportLiveActivity")).default,instances=A.getInstances();
    const props={stop:step.name,time:step.time,pending:state.pending.length,onboard:state.onboard.length,queued:v.queue.filter(x=>!x.resolution).length};
    if(instances[0])await instances[0].update(props);else A.start(props,`swim-app://transport?runId=${encodeURIComponent(s.runId)}`);
    for(const extra of instances.slice(1))await extra.end("immediate");
  }catch{/* iOS <16.2, disabled Live Activity or missing extension: notification deep link remains available. */}
  // Only the currently pending stop is scheduled. Replace rather than accumulating stop prompts.
  const nextId=transportHintId(s.runId,s.revision,step.id);
  for(const n of await N.getAllScheduledNotificationsAsync())if(n.identifier.startsWith("swimnote-transport:")&&n.identifier!==nextId)await N.cancelScheduledNotificationAsync(n.identifier);
  const key=`${s.runId}:${s.revision}:${step.id}`,due=new Date(`${v.manifest.run.plan.date}T${step.time}:00+09:00`);
  // A previously armed OS time prompt may already have been delivered and dismissed.
  // Do not create a second prompt after foreground recovery; this records dedupe, NOT proof of display.
  if(s.armed?.key===key&&s.armed.due<=Date.now()){
    await transportVault.mutate(owner,old=>({...old,hints:[...new Set([...old.hints,key])]}));
    return;
  }
  if(!v.hints.includes(key)&&!["CENTER_BOARD","CENTER_HANDOVER"].includes(step.action)){
    const scheduled=await N.getAllScheduledNotificationsAsync(),presented=await N.getPresentedNotificationsAsync();
    if(!scheduled.some(n=>n.identifier===nextId)&&!presented.some(n=>n.request.identifier===nextId)){
      await N.scheduleNotificationAsync({identifier:nextId,content:{title:"차량 예정 시각 안내",body:"시간 도래는 도착·승하차 증거가 아닙니다. 정차 후 실제 확인하세요.",categoryIdentifier:CATEGORY,data},
        trigger:due.getTime()>Date.now()?{type:N.SchedulableTriggerInputTypes.DATE,date:due}:null});
      s.armed={key,due:due.getTime()};await AsyncStorage.setItem(SESSION,JSON.stringify(s));
      // An already due prompt is deduped immediately; future delivery is deduped by OS identifier.
      if(due.getTime()<=Date.now())await transportVault.mutate(owner,old=>({...old,hints:[...new Set([...old.hints,key])]}));
    }
  }
}
export async function startTransportBackground(owner:string,gps=false){
  if(!native||!backgroundAvailable)throw Error("운행 알림·Live Activity는 새 native 통합 binary에서 지원합니다.");
  const v=await transportVault.read(owner);
  if(!v.manifest||!transportState(v.manifest.run.plan,events(v)).started)throw Error("운행 시작 후 켜세요.");
  const N=await import("expo-notifications");
  if(Platform.OS==="android")await N.setNotificationChannelAsync("transport",{name:"차량 운행 안내",importance:N.AndroidImportance.DEFAULT,lockscreenVisibility:N.AndroidNotificationVisibility.PRIVATE});
  const permission=await N.requestPermissionsAsync();
  if(!permission.granted)throw Error("알림 권한이 없습니다. 앱에서 직접 확인할 수 있습니다.");
  await N.setNotificationCategoryAsync(CATEGORY,[
    {identifier:"CONFIRM_ALL",buttonTitle:Platform.OS==="android"?"정차 후 전원 확인":"열어서 승하차 확인",options:{opensAppToForeground:Platform.OS!=="android",isAuthenticationRequired:true}},
    {identifier:"OPEN",buttonTitle:"일부·미탑승·현재 운행",options:{opensAppToForeground:true,isAuthenticationRequired:true}},
  ]);
  await N.registerTaskAsync(ACTION_TASK);
  const s:Session={owner,runId:v.runId,revision:v.manifest.run.revision,
    expires:new Date(`${v.manifest.run.plan.date}T${v.manifest.run.plan.returnBy}:00+09:00`).getTime()+3600000,gps:false};
  if(s.expires<=Date.now())throw Error("운행일·종료 시각이 지났습니다.");
  await AsyncStorage.setItem(SESSION,JSON.stringify(s));
  if(gps){
    const L=await import("expo-location");
    const foreground=await L.requestForegroundPermissionsAsync();
    if(!foreground.granted)throw Error("위치 권한 거절: 시간 안내·직접 확인을 유지합니다.");
    const background=await L.requestBackgroundPermissionsAsync();
    if(!background.granted)throw Error("백그라운드 위치 권한 거절: 시간 안내·직접 확인을 유지합니다.");
    s.gps=true;await AsyncStorage.setItem(SESSION,JSON.stringify(s));
    await L.startLocationUpdatesAsync(GPS_TASK,{accuracy:L.Accuracy.High,timeInterval:5000,distanceInterval:10,
      pausesUpdatesAutomatically:false,showsBackgroundLocationIndicator:true,
      foregroundService:{notificationTitle:"SWIMNOTE 운행 GPS 사용 중",notificationBody:"기기 안에서 정류장 접근만 확인합니다. 운행 종료 시 중지됩니다.",killServiceOnDestroy:true}});
  }
  await refreshTransportSurface(owner);
}
