// ─── 스윔노트 디자인 시스템 토큰 ──────────────────────────────────────────
// 아이콘 색상 규칙:
//   민트(#2EC4B6)  → 스케줄/출결/시간표 관련
//   오렌지(#F97316) → 회원관리/등록/결제 관련
//   네이비(#1B4965) → 설정/정보/공지 관련

const mint      = "#2EC4B6";
const navy      = "#1B4965";
const mintLight = "#E6FAF8";
const orange    = "#F97316";
const blue      = "#2563EB";

export default {
  light: {
    // ── 텍스트 ─────────────────────────────────────────────────────────
    text:           "#1C1C1E",   // primary (iOS 스타일 검정)
    textSecondary:  "#8E8E93",   // secondary
    textMuted:      "#C7C7CC",   // hint / meta

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

    // ── 아이콘 카테고리 색상 ──────────────────────────────────────────
    iconSchedule: mint,          // 스케줄/출결/시간표
    iconMember:   orange,        // 회원관리/등록/결제
    iconInfo:     navy,          // 설정/정보/공지

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
