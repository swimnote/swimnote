/**
 * (parent)/requests.tsx — redirect 전용
 *
 * 이 화면은 notifications.tsx의 [내 요청] 탭으로 통합됐습니다.
 * 기존 딥링크/backTo/requestId 파라미터를 보존하며 이동합니다.
 */
import { router, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";

export default function ParentRequestsRedirect() {
  const params = useLocalSearchParams<{
    backTo?: string;
    requestId?: string;
  }>();

  useEffect(() => {
    const searchParams = new URLSearchParams();
    searchParams.set("tab", "requests");
    if (params.requestId) searchParams.set("requestId", params.requestId);
    if (params.backTo)    searchParams.set("backTo", params.backTo);

    const target = `/(parent)/notifications?${searchParams.toString()}`;
    router.replace(target as any);
  }, []);

  return null;
}
