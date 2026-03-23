// ─── 스윔노트 디자인 시스템 토큰 ──────────────────────────────────────────
// "부드럽고 정돈된 학부모용 수영 앱"
// 메인 액션: 청록 #1F8F86 계열 단일 통일

const primary     = "#1F8F86";
const primaryDark = "#18766F";
const primaryLight = "#DDF2EF";

export default {
  light: {
    // ── 텍스트 ─────────────────────────────────────────────────────────
    text:           "#1F1F1F",   // primary text
    textSecondary:  "#6F6B68",   // secondary text
    textMuted:      "#9A948F",   // tertiary / hint / meta

    // ── 배경 ──────────────────────────────────────────────────────────
    background:     "#F6F3F1",   // 따뜻한 아이보리 앱 배경
    backgroundSoft: "#FBF8F6",   // 보조 연 배경

    // ── 서피스/카드 ───────────────────────────────────────────────────
    card:           "#FFFFFF",   // 기본 카드 흰색

    // ── 라인/경계 ─────────────────────────────────────────────────────
    border:         "#E9E2DD",   // 얇고 부드러운 경계선

    // ── 메인 브랜드 컬러 (청록) ───────────────────────────────────────
    tint:           primary,
    tintDark:       primaryDark,
    tintLight:      primaryLight,
    tabIconDefault: "#9A948F",
    tabIconSelected: primary,

    // ── 파스텔 카드 구분색 ────────────────────────────────────────────
    lavender:  "#EEDDF5",   // 연보라
    sky:       "#DCEEFF",   // 연하늘
    butter:    "#FFF1BF",   // 크림노랑
    peach:     "#F9DEDA",   // 연살구
    pinkSoft:  "#F6D8E1",   // 연핑크
    mintSoft:  "#DFF3EC",   // 민트

    // ── 상태 컬러 ─────────────────────────────────────────────────────
    success:  "#2E9B6F",
    warning:  "#E4A93A",
    error:    "#D96C6C",
    info:     "#4EA7D8",

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
    expired:    "#9A948F",
    suspended:  "#E4A93A",
    cancelled:  "#D96C6C",

    // ── 역할 컬러 (배지/인디케이터용) ────────────────────────────────
    superAdmin: "#7C3AED",
    poolAdmin:  primary,
    parent:     primary,

    // ── 비활성/장애 ───────────────────────────────────────────────────
    disabled:     "#D8D2CD",
    disabledText: "#8D8782",

    // ── 그림자 ────────────────────────────────────────────────────────
    shadow: "rgba(0,0,0,0.05)",
  },
};
