/**
 * 학부모 요청 화면 — compatibility redirect
 * 기존 설정 메뉴·Push deep-link·외부 링크가 이 경로를 호출하는 경우를 위한 안전 브릿지.
 * 실제 UI는 notifications.tsx 내 "내 요청" 탭에 통합됐다.
 */
import { router, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { View } from "react-native";

export default function ParentRequestsCompatScreen() {
  const { requestId } = useLocalSearchParams<{ requestId?: string }>();

  useEffect(() => {
    // 단방향 redirect — notifications는 절대 여기로 되돌려 보내지 않는다
    router.replace({
      pathname: "/(parent)/notifications" as any,
      params: {
        tab: "requests",
        ...(requestId ? { requestId } : {}),
      },
    });
  }, []);   // 마운트 1회만 실행

  return <View style={{ flex: 1 }} />;
}
