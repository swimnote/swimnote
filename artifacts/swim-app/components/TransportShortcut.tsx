import {Button,View} from "react-native";
import {router} from "expo-router";
export function TransportShortcut(){
  return <View style={{padding:12}}><Button title="차량 확인·기사 전용 운행" onPress={()=>router.push("/transport" as any)}/></View>;
}
