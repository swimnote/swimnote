// ─── 스윔노트 디자인 시스템 토큰 (민네오 색상 규칙) ──────────────────────────
// 민트(#2EC4B6): 선택상태·활성·강조
// 네이비(#1B4965): 헤더·제목·구조
// 오렌지(#F97316): 주요 버튼·행동
// 블루(#2563EB): 보조 버튼·링크

const mint      = "#2EC4B6";
const navy      = "#1B4965";
const mintLight = "#E6FFFA";
const orange    = "#F97316";
const blue      = "#2563EB";

export default {
  light: {
    // ── 텍스트 ─────────────────────────────────────────────────────────
    text:           "#111827",   // primary text
    textSecondary:  "#6B7280",   // secondary text
    textMuted:      "#9CA3AF",   // tertiary / hint / meta

    // ── 배경 ──────────────────────────────────────────────────────────
    background:     "#F8FAFC",   // 메인 앱 배경
    backgroundSoft: "#F1F5F9",   // 서브 배경

    // ── 서피스/카드 ───────────────────────────────────────────────────
    card:           "#FFFFFF",   // 카드 흰색

    // ── 라인/경계 ─────────────────────────────────────────────────────
    border:         "#E5E7EB",   // 경계선

    // ── 메인 액센트 (민트) ────────────────────────────────────────────
    tint:           mint,
    tintDark:       navy,
    tintLight:      mintLight,
    tabIconDefault: "#9CA3AF",
    tabIconSelected: mint,

    // ── 버튼 컬러 ─────────────────────────────────────────────────────
    button:          orange,     // 주요 버튼 (오렌지)
    buttonSecondary: blue,       // 보조 버튼 (블루)

    // ── 파스텔 카드 구분색 ────────────────────────────────────────────
    lavender:  "#EEDDF5",
    sky:       "#DCEEFF",
    butter:    "#FFF1BF",
    peach:     "#F9DEDA",
    pinkSoft:  "#F6D8E1",
    mintSoft:  "#E6FFFA",

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
    expired:    "#9CA3AF",
    suspended:  "#E4A93A",
    cancelled:  "#D96C6C",

    // ── 역할 컬러 (배지/인디케이터용) ────────────────────────────────
    superAdmin: "#7C3AED",
    poolAdmin:  mint,
    parent:     mint,

    // ── 비활성/장애 ───────────────────────────────────────────────────
    disabled:     "#F1F5F9",
    disabledText: "#9CA3AF",

    // ── 그림자 ────────────────────────────────────────────────────────
    shadow: "rgba(0,0,0,0.05)",
  },
};
