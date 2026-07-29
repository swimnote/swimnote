// ─── 스윔노트 디자인 시스템 — Spacing 토큰 ──────────────────────────────────
// 모든 여백·간격은 이 값에서 선택합니다.
// 임의의 숫자를 StyleSheet에 직접 사용하지 않습니다.

export const spacing = {
  /** 4 — 아이콘 사이 최소 간격, 배지 내부 padding */
  xs:      4,
  /** 8 — 카드 내부 항목 간격, 버튼 아이콘 간격 */
  sm:      8,
  /** 12 — 카드 내부 gap, 섹션 간 최소 여백 */
  md:     12,
  /** 14 — 카드 padding (기본) */
  card:   14,
  /** 16 — 일반 내부 padding */
  base:   16,
  /** 20 — 좌우 화면 여백 (기준값) */
  screen: 20,
  /** 24 — 섹션 타이틀 상단 여백 */
  xl:     24,
  /** 32 — 빈 상태 아이콘 상단 여백 */
  xxl:    32,
  /** 40 — 큰 섹션 구분 여백 */
  section:40,
  /** 60 — 빈 상태 화면 상단 여백 */
  empty:  60,
} as const;

export type SpacingKey = keyof typeof spacing;
