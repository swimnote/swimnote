/**
 * useTabScrollReset — 루트 탭 화면에서 사용
 * 같은 탭 버튼 재탭 시 자동으로 스크롤을 맨 위로 이동시킴
 *
 * 사용법:
 *   const scrollRef = useTabScrollReset("classes");
 *   <ScrollView ref={scrollRef} ...>
 */
import { useEffect, useRef } from "react";
import { ScrollView } from "react-native";
import { addTabResetListener } from "@/utils/tabReset";

export function useTabScrollReset(tabName: string) {
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    const unsub = addTabResetListener(tabName, () => {
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    });
    return unsub;
  }, [tabName]);

  return scrollRef;
}
