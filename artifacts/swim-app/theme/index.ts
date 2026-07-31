// ─── 스윔노트 디자인 시스템 — Theme 진입점 ──────────────────────────────────
// 신규 파일에서는 @/theme 에서 직접 import합니다.
//
// 사용법:
//   import { spacing, radius, textStyle, cardShadow } from "@/theme";
//   import Colors from "@/theme/colors";

export { default as Colors, palette } from "./colors";
export type { ColorScheme } from "./colors";

export { spacing } from "./spacing";
export type { SpacingKey } from "./spacing";

export { radius } from "./radius";
export type { RadiusKey } from "./radius";

export { fontFamily, fontSize, lineHeight, textStyle } from "./typography";
export type { TextStyleKey } from "./typography";

export { cardShadow, elevatedShadow, bannerShadow, noShadow } from "./shadows";
