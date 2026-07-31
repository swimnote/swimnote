// ─── 스윔노트 디자인 시스템 — Radius 토큰 ───────────────────────────────────
// 모든 borderRadius는 이 값에서 선택합니다.

export const radius = {
  /** 6 — 배지, 상태 칩, 작은 태그 */
  xs:   6,
  /** 8 — 노트박스, 인라인 요소, 아이콘 배경(소형) */
  sm:   8,
  /** 10 — 버튼, 입력 필드, 이미지 썸네일, 아이콘 배경(중형) */
  md:  10,
  /** 10 — 아이콘 배경 원형(36×36) 전용 alias */
  icon:10,
  /** 12 — 헤더 버튼, 중형 버튼 */
  button: 12,
  /** 14 — 슬림 패널, 두꺼운 배너 카드 */
  panel: 14,
  /** 16 — 일반 카드 (기준값) */
  card: 16,
  /** 20 — 큰 모달, Bottom Sheet, 자녀 탭 */
  lg:  20,
  /** 24 — 최상위 Bottom Sheet */
  xl:  24,
  /** 9999 — 완전 원형 (pill 태그, 원형 아이콘) */
  full:9999,
} as const;

export type RadiusKey = keyof typeof radius;
