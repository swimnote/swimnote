import {useEffect,useRef,useState} from "react";
import {AppState,Platform} from "react-native";
import {transportApproach,type TransportStep} from "../../../lib/api-zod/src/transport";
/** No background permission, location upload, navigation or global location watcher. */
export function useTransportApproach(owner:string,active:boolean,target:TransportStep|undefined){
  const [wanted,setWanted]=useState(false),[foreground,setForeground]=useState(AppState.currentState==="active");
  const [near,setNear]=useState(""),[message,setMessage]=useState("GPS 안내 OFF · 직접 확인은 항상 가능합니다."),[settings,setSettings]=useState(false);
  const live=useRef({owner,active});live.current={owner,active};
  useEffect(()=>{setWanted(false);setNear("");setSettings(false);setMessage("GPS 안내 OFF · 직접 확인은 항상 가능합니다.");},[owner]);
  useEffect(()=>{const sub=AppState.addEventListener("change",s=>setForeground(s==="active"));return()=>sub.remove();},[]);
  async function enable(){
    if(!active||Platform.OS==="web")return;
    try{
      const location=await import("expo-location"),p=await location.requestForegroundPermissionsAsync();
      if(live.current.owner!==owner||!live.current.active)return;
      if(!p.granted){setWanted(false);setSettings(!p.canAskAgain);setMessage("위치 권한 없이 시간 안내·직접 확인을 계속할 수 있습니다.");return;}
      setSettings(false);setWanted(true);setMessage("앱 사용 중·운행 중에만 GPS 접근 안내를 사용합니다. 위치는 기기 밖으로 보내지 않습니다.");
    }catch{setMessage("위치 모듈을 사용할 수 없습니다. native 통합 빌드·기기 설정을 확인하세요. 수동 확인은 가능합니다.");}
  }
  useEffect(()=>{
    setNear("");
    if(!owner||!active||!wanted||!foreground||!target?.gps)return;
    let alive=true,subscription:{remove():void}|undefined,since:number|null=null;
    let position:{latitude:number;longitude:number;accuracy:number|null;timestamp:number}|null=null;
    const evaluate=()=>{
      if(!alive||!position)return;
      try{const result=transportApproach(target.gps,position,since,Date.now());since=result.since;setNear(result.near?target.id:"");}
      catch{since=null;setNear("");setWanted(false);setMessage("GPS 등록값을 확인하지 못했습니다. 시간 안내·직접 확인을 유지합니다.");}
    };
    const timer=setInterval(evaluate,5000);
    void (async()=>{
      try{
        const location=await import("expo-location");
        const permission=await location.getForegroundPermissionsAsync();
        if(!alive)return;
        if(!permission.granted){setWanted(false);setSettings(!permission.canAskAgain);setMessage("GPS 권한이 해제됐습니다. 시간 안내·직접 확인을 유지합니다.");return;}
        if(!await location.hasServicesEnabledAsync()){if(alive)setMessage("기기 위치 서비스 OFF · 시간 안내·직접 확인을 유지합니다.");return;}
        if(!alive)return;
        subscription=await location.watchPositionAsync({accuracy:location.Accuracy.High,timeInterval:5000,distanceInterval:0},p=>{
          if(!alive)return;
          position={latitude:p.coords.latitude,longitude:p.coords.longitude,accuracy:p.coords.accuracy,timestamp:p.timestamp};evaluate();
        });
        if(!alive)subscription.remove();
      }catch{if(alive)setMessage("GPS 신호를 받을 수 없습니다. 시간 안내·직접 확인을 유지합니다.");}
    })();
    return()=>{alive=false;clearInterval(timer);subscription?.remove();};
  },[owner,active,wanted,foreground,target?.id,JSON.stringify(target?.gps)]);
  return {nearStepId:near,message,settings,enabled:wanted,enable,disable:()=>{setWanted(false);setNear("");}};
}
