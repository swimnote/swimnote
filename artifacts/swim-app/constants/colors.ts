// ─── 스윔노트 디자인 시스템 토큰 ──────────────────────────────────────────
// 아이콘 3색 규칙:
//   파랑(#007AFF)  → 탐색·기본행동 (홈, 일정, 검색, 설정)
//   녹색(#00704A)  → 완료·긍정    (출석, 승인, 매출, 저장)
//   주황(#FF6F0F)  → 경고·알림    (결석, 지각, 대기, 삭제)

const mint      = "#2EC4B6";
const navy      = "#0F172A";
const mintLight = "#E6FAF8";
const orange    = "#F97316";
const blue      = "#2563EB";

// ── 아이콘 3색 시스템 ─────────────────────────────────────────────────────
const iconBlue   = "#007AFF";
const iconGreen  = "#00704A";
const iconOrange = "#FF6F0F";
const iconBlueBg   = "#EAF4FF";
const iconGreenBg  = "#E6F5EF";
const iconOrangeBg = "#FFF2E8";

export default {
  light: {
    // ── 텍스트 ─────────────────────────────────────────────────────────
    text:           "#0F172A",   // primary
    textSecondary:  "#64748B",   // secondary
    textMuted:      "#64748B",   // hint / meta

    // ── 배경 ──────────────────────────────────────────────────────────
    background:     "#F5F5F5",   // 앱 배경 (따뜻한 연회색)
    backgroundSoft: "#EBEBEB",   // 서브 배경

    // ── 서피스/카드 ───────────────────────────────────────────────────
    card:           "#FFFFFF",   // 카드 흰색

    // ── 라인/경계 ─────────────────────────────────────────────────────
    border:         "#E8E8E8",   // 경계선 (더 연하게)

    // ── 메인 액센트 (민트) ────────────────────────────────────────────
    tint:           mint,
    tintDark:       navy,
    tintLight:      mintLight,
    tabIconDefault: "#C7C7CC",
    tabIconSelected: mint,

    // ── 버튼 컬러 ─────────────────────────────────────────────────────
    button:          orange,
    buttonSecondary: blue,

    // ── 아이콘 3색 시스템 ────────────────────────────────────────────
    iconBlue:       iconBlue,    // 탐색·기본행동
    iconGreen:      iconGreen,   // 완료·긍정
    iconOrange:     iconOrange,  // 경고·알림
    iconBlueBg:     iconBlueBg,
    iconGreenBg:    iconGreenBg,
    iconOrangeBg:   iconOrangeBg,

    // ── 아이콘 카테고리 색상 (레거시 — 신규 코드는 iconBlue/Green/Orange 사용) ──
    iconSchedule: iconBlue,
    iconMember:   iconOrange,
    iconInfo:     iconGreen,

    // ── 파스텔 카드 구분색 ────────────────────────────────────────────
    lavender:  "#EEDDF5",
    sky:       "#DCEEFF",
    butter:    "#FFF1BF",
    peach:     "#F9DEDA",
    pinkSoft:  "#F6D8E1",
    mintSoft:  "#E6FAF8",

    // ── 상태 컬러 ─────────────────────────────────────────────────────
    success:  "#2E9B6F",
    warning:  "#E4A93A",
    error:    "#D96C6C",
    info:     blue,

    // ── 출결 상태 ─────────────────────────────────────────────────────
    present:  "#2E9B6F",
    absent:   "#D96C6C",
    late:     "#E4A93A",

    // ── 회원 상태 ─────────────────────────────────────────────────────
    approved:   "#2E9B6F",
    pending:    "#E4A93A",
    rejected:   "#D96C6C",
    trial:      "#8B5CF6",
    active:     "#2E9B6F",
    expired:    "#C7C7CC",
    suspended:  "#E4A93A",
    cancelled:  "#D96C6C",

    // ── 역할 컬러 (배지/인디케이터용) ────────────────────────────────
    superAdmin: "#7C3AED",
    poolAdmin:  mint,
    parent:     mint,

    // ── 비활성/장애 ───────────────────────────────────────────────────
    disabled:     "#EBEBEB",
    disabledText: "#C7C7CC",

    // ── 그림자 ────────────────────────────────────────────────────────
    shadow: "rgba(0,0,0,0.06)",
  },
};
