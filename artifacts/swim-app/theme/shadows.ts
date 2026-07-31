// ─── 스윔노트 디자인 시스템 — Shadow 토큰 ───────────────────────────────────
// 컴포넌트마다 shadow 값을 직접 작성하지 않습니다.
// preset을 StyleSheet에 spread하여 사용합니다.
//
// 사용법:
//   import { cardShadow } from "@/theme/shadows";
//   card: { borderRadius: 16, backgroundColor: "#fff", ...cardShadow }

import { Platform } from "react-native";
import type { ViewStyle } from "react-native";

/** 일반 카드 그림자 — 대부분의 카드에 사용 */
export const cardShadow: ViewStyle = Platform.select({
  ios: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
  },
  android: {
    elevation: 2,
  },
}) ?? {};

/** 강조 카드 그림자 — 모달, 플로팅 버튼, 중요 카드 */
export const elevatedShadow: ViewStyle = Platform.select({
  ios: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.10,
    shadowRadius: 10,
  },
  android: {
    elevation: 4,
  },
}) ?? {};

/** 배너 그림자 — strip / slider 배너 */
export const bannerShadow: ViewStyle = Platform.select({
  ios: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
  },
  android: {
    elevation: 1,
  },
}) ?? {};

/** 그림자 없음 — 명시적으로 그림자를 제거할 때 사용 */
export const noShadow: ViewStyle = Platform.select({
  ios: {
    shadowColor: "transparent",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
  },
  android: {
    elevation: 0,
  },
}) ?? {};
