import {Text,VStack} from "@expo/ui/swift-ui";
import {createLiveActivity} from "expo-widgets";
type Props={stop:string;time:string;pending:number;onboard:number;queued:number};
const Layout=(props:Props)=>{
  "widget";
  return {banner:<VStack><Text>SWIMNOTE 차량 운행</Text><Text>{props.stop} · 예정 {props.time}</Text>
    <Text>미처리 {props.pending} · 미하차 {props.onboard} · 전송 대기 {props.queued}</Text>
    <Text>정차 후 열어서 실제 승하차 확인</Text></VStack>,
    compactLeading:<Text>차량</Text>,compactTrailing:<Text>{props.pending}</Text>,minimal:<Text>차</Text>,
    expandedBottom:<VStack><Text>{props.stop} · {props.time}</Text><Text>정차 후 열어서 확인</Text></VStack>};
};
export default createLiveActivity<Props>("TransportActivity",Layout);
