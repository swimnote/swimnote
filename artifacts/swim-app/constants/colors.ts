// ─── 하위 호환 re-export barrel ─────────────────────────────────────────────
// 기존 import 패턴이 모두 그대로 동작합니다:
//   import Colors from "@/constants/colors";
//   const C = Colors.light;
//
// 신규 코드에서는 @/theme 에서 직접 import하세요:
//   import Colors from "@/theme/colors";
//   import { spacing, radius, textStyle, cardShadow } from "@/theme";

export { default, palette } from "@/theme/colors";
export type { ColorScheme } from "@/theme/colors";
