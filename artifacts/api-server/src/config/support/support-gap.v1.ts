/**
 * support-gap.v1.ts — WP-CS11: Support Coverage Gap Classification
 *
 * 75개 CoverageRecord 전수에 대한 실제 production readiness 분류.
 *
 * 판정 기준 (우선순위 순):
 *   COVERED_ACTIVE   — 해당 record의 primary 카테고리를 해결하는 ACTIVE production 소스 존재
 *   COVERED_PENDING  — 해결 소스가 있으나 status=pending (미활성)
 *   PARTIAL          — WHERE_IS(FM) 또는 STATE_CHECK(DB_STATE) 등 보조 카테고리만 커버됨
 *   MISSING          — 어떤 ACTIVE 소스도 어떤 카테고리도 커버하지 못함
 *
 * Production ACTIVE 소스 (2026-08-18 기준):
 *   KNOWLEDGE items: ki_swimnote_intro (scope=global), ki_x_mode_intro (scope=global)
 *   PENDING items:   ki_seed_subscription_x_features (status=pending, 미활성)
 *   RULE items:      0 ACTIVE
 *   SOLUTION items:  0 ACTIVE
 *   KNOWN_ISSUE:     0 (super_incidents OPEN/INVESTIGATING/MITIGATED = 0)
 *   DB_STATE:        ACTIVE — subscription/X-mode/growth-report 키워드 기반 실시간 조회
 *   FRONTEND_MAP:    ACTIVE — 85 screens registered (static, v1.6.3)
 *
 * active_sources 형식:
 *   "KNOWLEDGE:<id>"          — ACTIVE knowledge item
 *   "FRONTEND_MAP:<screen_id>" — FM 정확 screen_id 매칭 (SCREEN_BY_ID lookup)
 *   "FM_KEYWORD:<screen_id>"  — FM keyword scoring 매칭 (query-based, 보장 아님)
 *   "DB_STATE:<domain>"       — 실시간 DB 상태 조회 (subscription|x_mode|growth_report)
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type GapReadiness =
  | "COVERED_ACTIVE"   // primary intent = ACTIVE production 소스로 해결 가능
  | "COVERED_PENDING"  // primary intent = PENDING 소스가 있으나 미활성
  | "PARTIAL"          // WHERE_IS 또는 STATE_CHECK 보조 카테고리만 커버됨
  | "MISSING";         // ACTIVE 소스 없음

export type CategoryReadiness =
  | "ACTIVE"    // ACTIVE production 소스로 해결 가능
  | "PENDING"   // PENDING 소스가 있으나 미활성
  | "PARTIAL"   // FM keyword 등 불완전한 소스
  | "MISSING";  // 소스 없음

export interface GapRecord {
  /** SUPPORT_COVERAGE_REGISTRY reference key */
  coverage_id: string;
  /** 전체 record readiness */
  overall_readiness: GapReadiness;
  /** 카테고리별 readiness (support_categories 기준) */
  category_readiness: Partial<Record<string, CategoryReadiness>>;
  /** ACTIVE production 소스 목록 */
  active_sources: string[];
  /** PENDING 소스 목록 (참고용) */
  pending_sources: string[];
  /** 미커버 이유 */
  gap_reasons: string[];
  /** FAQ 항목 신규 생성 필요 여부 */
  needs_faq_candidate: boolean;
  /** KNOWLEDGE 항목 신규 생성 필요 여부 */
  needs_knowledge_candidate: boolean;
  /** SOLUTION 항목 신규 생성 필요 여부 */
  needs_solution_candidate: boolean;
  /** RULE 항목 신규 생성 필요 여부 */
  needs_rule_candidate: boolean;
  /** super_incidents 연동 KNOWN_ISSUE 항목 필요 여부 */
  needs_known_issue_candidate: boolean;
  /**
   * Frontend Map에 screen_id 등록이 필요한지 여부
   * (screen_id가 FM에 없어서 WHERE_IS 커버리지 손실)
   */
  needs_fm_update: boolean;
  /**
   * 현재 코드만으로 deterministic 해결 가능 여부
   * (LLM 없이 RULE/DB_STATE/FM/KNOWLEDGE 레이어만으로)
   */
  deterministic_possible: boolean;
  notes?: string;
}

// ── GAP Registry ──────────────────────────────────────────────────────────────

export const SUPPORT_GAP_REGISTRY: GapRecord[] = [

  // ══════════════════════════════════════════════════════════
  // DOMAIN: AUTH — 인증/로그인/계정
  // ══════════════════════════════════════════════════════════

  {
    coverage_id: "AUTH_LOGIN_HOW_TO",
    overall_readiness: "COVERED_ACTIVE",
    category_readiness: {
      HOW_TO:     "ACTIVE",   // ki_swimnote_intro covers basic app intro/login
      WHERE_IS:   "ACTIVE",   // FM SCREEN_ID_EXACT: LOGIN
      LOGIN_AUTH: "MISSING",  // 구체적 로그인 단계별 FAQ 없음
    },
    active_sources: ["KNOWLEDGE:ki_swimnote_intro", "FRONTEND_MAP:LOGIN"],
    pending_sources: [],
    gap_reasons: [],
    needs_faq_candidate: false,
    needs_knowledge_candidate: false,
    needs_solution_candidate: false,
    needs_rule_candidate: false,
    needs_known_issue_candidate: false,
    needs_fm_update: false,
    deterministic_possible: true,
    notes: "ki_swimnote_intro가 '스윔노트 로그인 방법'의 기본 소개를 커버함. 로그인 오류 해결은 별도 SOLUTION 필요.",
  },

  {
    coverage_id: "AUTH_LOGIN_FAILED",
    overall_readiness: "PARTIAL",
    category_readiness: {
      ERROR:      "MISSING",
      LOGIN_AUTH: "MISSING",
      WHERE_IS:   "ACTIVE",   // FM SCREEN_ID_EXACT: LOGIN
    },
    active_sources: ["FRONTEND_MAP:LOGIN"],
    pending_sources: [],
    gap_reasons: [
      "ERROR 카테고리: 로그인 실패 원인(잘못된 비밀번호, 계정 없음) 해결 SOLUTION 없음",
      "LOGIN_AUTH 카테고리: 로그인 오류 코드별 안내 FAQ 없음",
    ],
    needs_faq_candidate: true,
    needs_knowledge_candidate: false,
    needs_solution_candidate: true,
    needs_rule_candidate: false,
    needs_known_issue_candidate: true,
    needs_fm_update: false,
    deterministic_possible: true,
    notes: "FM이 WHERE_IS만 커버. 로그인 실패 SOLUTION + 오류 메시지별 FAQ 필요.",
  },

  {
    coverage_id: "AUTH_SESSION_EXPIRED",
    overall_readiness: "PARTIAL",
    category_readiness: {
      LOGIN_AUTH: "MISSING",
      ERROR:      "MISSING",
      WHERE_IS:   "ACTIVE",   // FM SCREEN_ID_EXACT: LOGIN
    },
    active_sources: ["FRONTEND_MAP:LOGIN"],
    pending_sources: [],
    gap_reasons: ["세션 만료 자동 로그아웃 원인 안내 FAQ/KNOWLEDGE 없음"],
    needs_faq_candidate: true,
    needs_knowledge_candidate: false,
    needs_solution_candidate: false,
    needs_rule_candidate: false,
    needs_known_issue_candidate: false,
    needs_fm_update: false,
    deterministic_possible: true,
  },

  {
    coverage_id: "AUTH_PASSWORD_FORGOT",
    overall_readiness: "PARTIAL",
    category_readiness: {
      HOW_TO:     "MISSING",
      LOGIN_AUTH: "MISSING",
      WHERE_IS:   "ACTIVE",   // FM SCREEN_ID_EXACT: FORGOT_PASSWORD
    },
    active_sources: ["FRONTEND_MAP:FORGOT_PASSWORD"],
    pending_sources: [],
    gap_reasons: ["비밀번호 재설정 단계별 안내 FAQ 없음", "이메일 미수신 시 해결 SOLUTION 없음"],
    needs_faq_candidate: true,
    needs_knowledge_candidate: false,
    needs_solution_candidate: false,
    needs_rule_candidate: false,
    needs_known_issue_candidate: false,
    needs_fm_update: false,
    deterministic_possible: true,
  },

  {
    coverage_id: "AUTH_PARENT_LOGIN_OTP",
    overall_readiness: "PARTIAL",
    category_readiness: {
      HOW_TO:     "MISSING",
      LOGIN_AUTH: "MISSING",
      WHERE_IS:   "ACTIVE",   // FM SCREEN_ID_EXACT: PARENT_LOGIN
    },
    active_sources: ["FRONTEND_MAP:PARENT_LOGIN"],
    pending_sources: [],
    gap_reasons: [
      "OTP 문자 미수신 원인 안내 FAQ 없음",
      "학부모 전화번호 기반 로그인 단계별 안내 KNOWLEDGE 없음",
    ],
    needs_faq_candidate: true,
    needs_knowledge_candidate: false,
    needs_solution_candidate: true,
    needs_rule_candidate: false,
    needs_known_issue_candidate: true,
    needs_fm_update: false,
    deterministic_possible: true,
  },

  {
    coverage_id: "AUTH_KAKAO_LOGIN_FAILED",
    overall_readiness: "PARTIAL",
    category_readiness: {
      ERROR:      "MISSING",
      LOGIN_AUTH: "MISSING",
      WHERE_IS:   "ACTIVE",   // FM SCREEN_ID_EXACT: PARENT_LOGIN
    },
    active_sources: ["FRONTEND_MAP:PARENT_LOGIN"],
    pending_sources: [],
    gap_reasons: ["카카오 소셜 로그인 실패 원인 및 해결 SOLUTION 없음"],
    needs_faq_candidate: true,
    needs_knowledge_candidate: false,
    needs_solution_candidate: true,
    needs_rule_candidate: false,
    needs_known_issue_candidate: true,
    needs_fm_update: false,
    deterministic_possible: true,
  },

  {
    coverage_id: "AUTH_TEACHER_INVITE",
    overall_readiness: "PARTIAL",
    category_readiness: {
      HOW_TO:   "MISSING",
      WHERE_IS: "PARTIAL",   // FM keyword: ADMIN_INVITE_QR 키워드 매칭 가능 (not exact)
    },
    active_sources: ["FM_KEYWORD:ADMIN_INVITE_QR"],
    pending_sources: [],
    gap_reasons: [
      "screen_id='INVITE_QR'가 FM에 없음 (FM: ADMIN_INVITE_QR) — WHERE_IS keyword만 가능",
      "강사 초대 단계별 안내 FAQ/KNOWLEDGE 없음",
    ],
    needs_faq_candidate: true,
    needs_knowledge_candidate: false,
    needs_solution_candidate: false,
    needs_rule_candidate: false,
    needs_known_issue_candidate: false,
    needs_fm_update: true,
    deterministic_possible: false,
    notes: "FM에 INVITE_QR screen_id 추가 시 WHERE_IS 완전 커버 가능",
  },

  {
    coverage_id: "AUTH_ACCOUNT_WITHDRAWAL",
    overall_readiness: "MISSING",
    category_readiness: {
      HOW_TO:  "MISSING",
      ACCOUNT: "MISSING",
      POLICY:  "MISSING",
    },
    active_sources: [],
    pending_sources: [],
    gap_reasons: [
      "screen_id='WITHDRAWAL' FM 미등록 — WHERE_IS 커버 불가",
      "탈퇴 정책 및 절차 안내 FAQ/KNOWLEDGE 없음",
    ],
    needs_faq_candidate: true,
    needs_knowledge_candidate: false,
    needs_solution_candidate: false,
    needs_rule_candidate: false,
    needs_known_issue_candidate: false,
    needs_fm_update: true,
    deterministic_possible: false,
  },

  {
    coverage_id: "AUTH_POOL_ACCESS_DENIED",
    overall_readiness: "MISSING",
    category_readiness: {
      PERMISSION:   "MISSING",
      ROLE_MISMATCH: "MISSING",
    },
    active_sources: [],
    pending_sources: [],
    gap_reasons: [
      "screen_id 없음 — FM WHERE_IS 커버 불가",
      "수영장 403 접근 거부 원인 안내 FAQ/SOLUTION 없음",
    ],
    needs_faq_candidate: true,
    needs_knowledge_candidate: false,
    needs_solution_candidate: true,
    needs_rule_candidate: false,
    needs_known_issue_candidate: false,
    needs_fm_update: false,
    deterministic_possible: false,
  },

  // ══════════════════════════════════════════════════════════
  // DOMAIN: ATTENDANCE — 출결
  // ══════════════════════════════════════════════════════════

  {
    coverage_id: "ATTENDANCE_HOW_TO",
    overall_readiness: "PARTIAL",
    category_readiness: {
      HOW_TO:   "MISSING",
      WHERE_IS: "ACTIVE",   // FM SCREEN_ID_EXACT: ADMIN_ATTENDANCE
    },
    active_sources: ["FRONTEND_MAP:ADMIN_ATTENDANCE"],
    pending_sources: [],
    gap_reasons: ["출결 처리 단계별 안내 FAQ 없음"],
    needs_faq_candidate: true,
    needs_knowledge_candidate: false,
    needs_solution_candidate: false,
    needs_rule_candidate: false,
    needs_known_issue_candidate: false,
    needs_fm_update: false,
    deterministic_possible: true,
  },

  {
    coverage_id: "ATTENDANCE_SAVE_FAILED",
    overall_readiness: "PARTIAL",
    category_readiness: {
      NOT_SAVED: "MISSING",
      ERROR:     "MISSING",
      FAILURE:   "MISSING",
      WHERE_IS:  "ACTIVE",   // FM SCREEN_ID_EXACT: ADMIN_ATTENDANCE
    },
    active_sources: ["FRONTEND_MAP:ADMIN_ATTENDANCE"],
    pending_sources: [],
    gap_reasons: ["출결 저장 실패 원인 및 해결 SOLUTION 없음"],
    needs_faq_candidate: false,
    needs_knowledge_candidate: false,
    needs_solution_candidate: true,
    needs_rule_candidate: false,
    needs_known_issue_candidate: true,
    needs_fm_update: false,
    deterministic_possible: true,
  },

  {
    coverage_id: "ATTENDANCE_NOT_VISIBLE",
    overall_readiness: "PARTIAL",
    category_readiness: {
      NOT_VISIBLE:         "MISSING",
      DATA_INCONSISTENCY:  "MISSING",
      EMPTY_STATE:         "MISSING",
      WHERE_IS:            "ACTIVE",   // FM SCREEN_ID_EXACT: ADMIN_ATTENDANCE
    },
    active_sources: ["FRONTEND_MAP:ADMIN_ATTENDANCE"],
    pending_sources: [],
    gap_reasons: ["출결 데이터 미표시 원인(날짜 필터, 반 선택 등) 안내 SOLUTION 없음"],
    needs_faq_candidate: false,
    needs_knowledge_candidate: false,
    needs_solution_candidate: true,
    needs_rule_candidate: false,
    needs_known_issue_candidate: false,
    needs_fm_update: false,
    deterministic_possible: true,
  },

  {
    coverage_id: "ATTENDANCE_PERMISSION_DENIED",
    overall_readiness: "MISSING",
    category_readiness: {
      PERMISSION:    "MISSING",
      ROLE_MISMATCH: "MISSING",
    },
    active_sources: [],
    pending_sources: [],
    gap_reasons: [
      "screen_id 없음 — FM WHERE_IS 커버 불가",
      "강사/부관리자 출결 권한 안내 FAQ 없음",
    ],
    needs_faq_candidate: true,
    needs_knowledge_candidate: false,
    needs_solution_candidate: false,
    needs_rule_candidate: false,
    needs_known_issue_candidate: false,
    needs_fm_update: false,
    deterministic_possible: false,
  },

  {
    coverage_id: "MAKEUP_HOW_TO",
    overall_readiness: "PARTIAL",
    category_readiness: {
      HOW_TO:   "MISSING",
      WHERE_IS: "ACTIVE",   // FM SCREEN_ID_EXACT: ADMIN_MAKEUPS
    },
    active_sources: ["FRONTEND_MAP:ADMIN_MAKEUPS"],
    pending_sources: [],
    gap_reasons: ["보강 신청 및 처리 단계별 안내 FAQ 없음"],
    needs_faq_candidate: true,
    needs_knowledge_candidate: false,
    needs_solution_candidate: false,
    needs_rule_candidate: false,
    needs_known_issue_candidate: false,
    needs_fm_update: false,
    deterministic_possible: true,
  },

  // ══════════════════════════════════════════════════════════
  // DOMAIN: DIARY — 수업일지
  // ══════════════════════════════════════════════════════════

  {
    coverage_id: "DIARY_HOW_TO",
    overall_readiness: "PARTIAL",
    category_readiness: {
      HOW_TO:   "MISSING",
      WHERE_IS: "ACTIVE",   // FM SCREEN_ID_EXACT: TEACHER_DIARY
    },
    active_sources: ["FRONTEND_MAP:TEACHER_DIARY"],
    pending_sources: [],
    gap_reasons: ["수업일지 작성 단계별 안내 FAQ 없음"],
    needs_faq_candidate: true,
    needs_knowledge_candidate: false,
    needs_solution_candidate: false,
    needs_rule_candidate: false,
    needs_known_issue_candidate: false,
    needs_fm_update: false,
    deterministic_possible: true,
  },

  {
    coverage_id: "DIARY_AI_HOW_TO",
    overall_readiness: "PARTIAL",
    category_readiness: {
      HOW_TO:   "MISSING",
      WHERE_IS: "ACTIVE",   // FM SCREEN_ID_EXACT: TEACHER_DIARY
    },
    active_sources: ["FRONTEND_MAP:TEACHER_DIARY"],
    pending_sources: [],
    gap_reasons: ["AI 일지 자동 생성 사용 방법 FAQ 없음"],
    needs_faq_candidate: true,
    needs_knowledge_candidate: false,
    needs_solution_candidate: false,
    needs_rule_candidate: false,
    needs_known_issue_candidate: false,
    needs_fm_update: false,
    deterministic_possible: true,
  },

  {
    coverage_id: "DIARY_AI_FAILED",
    overall_readiness: "PARTIAL",
    category_readiness: {
      AI_FAILURE:  "MISSING",
      AI_NO_RESULT:"MISSING",
      TIMEOUT:     "MISSING",
      WHERE_IS:    "ACTIVE",   // FM SCREEN_ID_EXACT: TEACHER_DIARY
    },
    active_sources: ["FRONTEND_MAP:TEACHER_DIARY"],
    pending_sources: [],
    gap_reasons: ["AI 일지 생성 실패(타임아웃/500/학생정보없음) 해결 SOLUTION 없음"],
    needs_faq_candidate: false,
    needs_knowledge_candidate: false,
    needs_solution_candidate: true,
    needs_rule_candidate: false,
    needs_known_issue_candidate: true,
    needs_fm_update: false,
    deterministic_possible: true,
  },

  {
    coverage_id: "DIARY_SAVE_FAILED",
    overall_readiness: "PARTIAL",
    category_readiness: {
      NOT_SAVED: "MISSING",
      ERROR:     "MISSING",
      WHERE_IS:  "ACTIVE",   // FM SCREEN_ID_EXACT: TEACHER_DIARY
    },
    active_sources: ["FRONTEND_MAP:TEACHER_DIARY"],
    pending_sources: [],
    gap_reasons: ["일지 저장 실패 원인 및 해결 SOLUTION 없음"],
    needs_faq_candidate: false,
    needs_knowledge_candidate: false,
    needs_solution_candidate: true,
    needs_rule_candidate: false,
    needs_known_issue_candidate: true,
    needs_fm_update: false,
    deterministic_possible: true,
  },

  {
    coverage_id: "DIARY_PHOTO_UPLOAD_FAILED",
    overall_readiness: "PARTIAL",
    category_readiness: {
      UPLOAD_FAILED: "MISSING",
      ERROR:         "MISSING",
      WHERE_IS:      "ACTIVE",   // FM SCREEN_ID_EXACT: TEACHER_DIARY
    },
    active_sources: ["FRONTEND_MAP:TEACHER_DIARY"],
    pending_sources: [],
    gap_reasons: ["일지 사진 업로드 실패 원인 해결 SOLUTION 없음"],
    needs_faq_candidate: false,
    needs_knowledge_candidate: false,
    needs_solution_candidate: true,
    needs_rule_candidate: false,
    needs_known_issue_candidate: true,
    needs_fm_update: false,
    deterministic_possible: true,
  },

  {
    coverage_id: "DIARY_PARENT_NOT_VISIBLE",
    overall_readiness: "PARTIAL",
    category_readiness: {
      NOT_VISIBLE:        "MISSING",
      PERMISSION:         "MISSING",
      DATA_INCONSISTENCY: "MISSING",
      WHERE_IS:           "ACTIVE",   // FM SCREEN_ID_EXACT: PARENT_DIARY
    },
    active_sources: ["FRONTEND_MAP:PARENT_DIARY"],
    pending_sources: [],
    gap_reasons: [
      "학부모 일지 미표시 원인(교사 미작성, 자녀 미연결, 비공개) 안내 FAQ/SOLUTION 없음",
    ],
    needs_faq_candidate: true,
    needs_knowledge_candidate: false,
    needs_solution_candidate: true,
    needs_rule_candidate: false,
    needs_known_issue_candidate: false,
    needs_fm_update: false,
    deterministic_possible: true,
  },

  {
    coverage_id: "DIARY_TEMPLATE_HOW_TO",
    overall_readiness: "PARTIAL",
    category_readiness: {
      HOW_TO:   "MISSING",
      WHERE_IS: "ACTIVE",   // FM SCREEN_ID_EXACT: ADMIN_DIARY_TEMPLATE_SETTINGS
    },
    active_sources: ["FRONTEND_MAP:ADMIN_DIARY_TEMPLATE_SETTINGS"],
    pending_sources: [],
    gap_reasons: ["일지 템플릿 설정 방법 FAQ 없음"],
    needs_faq_candidate: true,
    needs_knowledge_candidate: false,
    needs_solution_candidate: false,
    needs_rule_candidate: false,
    needs_known_issue_candidate: false,
    needs_fm_update: false,
    deterministic_possible: true,
  },

  // ══════════════════════════════════════════════════════════
  // DOMAIN: PAYMENT / SUBSCRIPTION — 결제/구독
  // ══════════════════════════════════════════════════════════

  {
    coverage_id: "BILLING_SUBSCRIPTION_STATUS",
    overall_readiness: "COVERED_ACTIVE",
    category_readiness: {
      STATE_CHECK:  "ACTIVE",   // DB_STATE: subscription keywords → actual pool state
      SUBSCRIPTION: "ACTIVE",   // DB_STATE resolves subscription status
      WHERE_IS:     "ACTIVE",   // FM SCREEN_ID_EXACT: ADMIN_BILLING
    },
    active_sources: ["DB_STATE:subscription", "FRONTEND_MAP:ADMIN_BILLING"],
    pending_sources: [],
    gap_reasons: [],
    needs_faq_candidate: false,
    needs_knowledge_candidate: false,
    needs_solution_candidate: false,
    needs_rule_candidate: false,
    needs_known_issue_candidate: false,
    needs_fm_update: false,
    deterministic_possible: true,
    notes: "DB_STATE가 pool의 실제 billing_state/subscription_status를 조회해 답변. query에 '구독' 포함 시 자동 발동.",
  },

  {
    coverage_id: "BILLING_SUBSCRIPTION_NOT_ACTIVE",
    overall_readiness: "PARTIAL",
    category_readiness: {
      SUBSCRIPTION: "PARTIAL",  // DB_STATE: 상태 확인 가능, 해결 안내 없음
      PAYMENT:      "MISSING",
      NOT_VISIBLE:  "MISSING",
    },
    active_sources: ["DB_STATE:subscription"],
    pending_sources: [],
    gap_reasons: [
      "screen_id='SUBSCRIPTION_EXPIRED' FM 미등록 — WHERE_IS 커버 불가",
      "구독 만료 시 재구독 방법 FAQ/SOLUTION 없음",
      "DB_STATE가 상태 확인만 가능, 해결 단계 안내 불가",
    ],
    needs_faq_candidate: true,
    needs_knowledge_candidate: false,
    needs_solution_candidate: true,
    needs_rule_candidate: false,
    needs_known_issue_candidate: false,
    needs_fm_update: true,
    deterministic_possible: true,
    notes: "DB_STATE는 '구독이 비활성입니다' 정도만 답변 가능. 재구독 단계 안내를 위한 SOLUTION 필요.",
  },

  {
    coverage_id: "BILLING_CANCELLED_BUT_ACTIVE",
    overall_readiness: "COVERED_ACTIVE",
    category_readiness: {
      STATE_CHECK:        "ACTIVE",   // DB_STATE: subscription keywords → pool state
      SUBSCRIPTION:       "ACTIVE",   // DB_STATE resolves cancellation status
      USER_MISUNDERSTANDING: "ACTIVE", // DB_STATE answers '취소했는데 왜 사용됨'
    },
    active_sources: ["DB_STATE:subscription"],
    pending_sources: [],
    gap_reasons: [],
    needs_faq_candidate: false,
    needs_knowledge_candidate: false,
    needs_solution_candidate: false,
    needs_rule_candidate: false,
    needs_known_issue_candidate: false,
    needs_fm_update: false,
    deterministic_possible: true,
    notes: "DB_STATE가 '취소됐으나 만료일까지 활성' 상태를 직접 조회해 오해 해소 가능.",
  },

  {
    coverage_id: "BILLING_PAYMENT_FAILED",
    overall_readiness: "PARTIAL",
    category_readiness: {
      PAYMENT:  "MISSING",
      BILLING:  "MISSING",
      ERROR:    "MISSING",
      WHERE_IS: "ACTIVE",   // FM SCREEN_ID_EXACT: ADMIN_BILLING
    },
    active_sources: ["FRONTEND_MAP:ADMIN_BILLING"],
    pending_sources: [],
    gap_reasons: ["결제 실패 원인(카드, 스토어 거절) 및 해결 SOLUTION 없음"],
    needs_faq_candidate: true,
    needs_knowledge_candidate: false,
    needs_solution_candidate: true,
    needs_rule_candidate: false,
    needs_known_issue_candidate: true,
    needs_fm_update: false,
    deterministic_possible: true,
  },

  {
    coverage_id: "BILLING_RESTORE",
    overall_readiness: "PARTIAL",
    category_readiness: {
      HOW_TO:       "MISSING",
      SUBSCRIPTION: "PARTIAL",   // DB_STATE: subscription 키워드 partially
      WHERE_IS:     "ACTIVE",    // FM SCREEN_ID_EXACT: ADMIN_BILLING
    },
    active_sources: ["FRONTEND_MAP:ADMIN_BILLING", "DB_STATE:subscription"],
    pending_sources: [],
    gap_reasons: [
      "구독 복원 단계별 안내 FAQ/SOLUTION 없음",
      "DB_STATE는 현재 상태만 확인, 복원 방법 안내 불가",
    ],
    needs_faq_candidate: true,
    needs_knowledge_candidate: false,
    needs_solution_candidate: true,
    needs_rule_candidate: false,
    needs_known_issue_candidate: false,
    needs_fm_update: false,
    deterministic_possible: true,
  },

  {
    coverage_id: "BILLING_REFUND_POLICY",
    overall_readiness: "PARTIAL",
    category_readiness: {
      POLICY:   "MISSING",
      BILLING:  "MISSING",
      WHERE_IS: "ACTIVE",   // FM SCREEN_ID_EXACT: ADMIN_REFUND_POLICY
    },
    active_sources: ["FRONTEND_MAP:ADMIN_REFUND_POLICY"],
    pending_sources: [],
    gap_reasons: ["환불 정책 내용 KNOWLEDGE/FAQ 없음"],
    needs_faq_candidate: false,
    needs_knowledge_candidate: true,
    needs_solution_candidate: false,
    needs_rule_candidate: false,
    needs_known_issue_candidate: false,
    needs_fm_update: false,
    deterministic_possible: true,
    notes: "환불 정책은 KNOWLEDGE item으로 정리 필요 (사실 기반, FAQ 보다는 KNOWLEDGE가 적합).",
  },

  // ══════════════════════════════════════════════════════════
  // DOMAIN: X_MODE — X 모드
  // ══════════════════════════════════════════════════════════

  {
    coverage_id: "X_MODE_INTRO",
    overall_readiness: "COVERED_ACTIVE",
    category_readiness: {
      HOW_TO: "ACTIVE",   // ki_x_mode_intro ACTIVE
      X_MODE: "ACTIVE",   // ki_x_mode_intro ACTIVE
    },
    active_sources: ["KNOWLEDGE:ki_x_mode_intro"],
    pending_sources: [],
    gap_reasons: [],
    needs_faq_candidate: false,
    needs_knowledge_candidate: false,
    needs_solution_candidate: false,
    needs_rule_candidate: false,
    needs_known_issue_candidate: false,
    needs_fm_update: false,
    deterministic_possible: true,
    notes: "ki_x_mode_intro(scope=global, status=active)가 X 모드 소개 primary intent를 커버함.",
  },

  {
    coverage_id: "X_SUBSCRIPTION_HOW_TO",
    overall_readiness: "COVERED_PENDING",
    category_readiness: {
      HOW_TO:       "PENDING",   // ki_seed_subscription_x_features PENDING
      X_MODE:       "PENDING",
      SUBSCRIPTION: "MISSING",
    },
    active_sources: [],
    pending_sources: ["KNOWLEDGE:ki_seed_subscription_x_features"],
    gap_reasons: [
      "ki_seed_subscription_x_features status=pending — ACTIVE 시 HOW_TO 커버 가능",
      "screen_id='X_SUBSCRIPTION' FM 미등록 — WHERE_IS 커버 불가",
    ],
    needs_faq_candidate: false,
    needs_knowledge_candidate: false,
    needs_solution_candidate: false,
    needs_rule_candidate: false,
    needs_known_issue_candidate: false,
    needs_fm_update: true,
    deterministic_possible: false,
    notes: "ki_seed_subscription_x_features를 ACTIVE로 전환하면 COVERED_ACTIVE로 승격 가능.",
  },

  {
    coverage_id: "X_ACTIVATION_CHECK",
    overall_readiness: "COVERED_ACTIVE",
    category_readiness: {
      STATE_CHECK: "ACTIVE",   // DB_STATE: x_mode keywords + ki_x_mode_intro
      X_MODE:      "ACTIVE",   // ki_x_mode_intro ACTIVE
      HOW_TO:      "ACTIVE",   // ki_x_mode_intro covers X 활성화 확인 방법
    },
    active_sources: ["KNOWLEDGE:ki_x_mode_intro", "DB_STATE:x_mode"],
    pending_sources: [],
    gap_reasons: [],
    needs_faq_candidate: false,
    needs_knowledge_candidate: false,
    needs_solution_candidate: false,
    needs_rule_candidate: false,
    needs_known_issue_candidate: false,
    needs_fm_update: false,
    deterministic_possible: true,
    notes: "DB_STATE가 실제 x_enabled/x_status를 조회 + ki_x_mode_intro가 X 활성 확인 방법 커버. 이중 active 소스.",
  },

  {
    coverage_id: "X_SETUP_HOW_TO",
    overall_readiness: "PARTIAL",
    category_readiness: {
      HOW_TO: "MISSING",
      X_MODE: "MISSING",
      WHERE_IS: "PARTIAL",   // FM keyword: ADMIN_X_SETUP 키워드 매칭 가능
    },
    active_sources: ["FM_KEYWORD:ADMIN_X_SETUP"],
    pending_sources: [],
    gap_reasons: [
      "screen_id='X_SETUP' FM 미등록 (FM: ADMIN_X_SETUP) — WHERE_IS keyword만",
      "X 설정 제출 절차 및 슈퍼어드민 검토 안내 FAQ 없음",
    ],
    needs_faq_candidate: true,
    needs_knowledge_candidate: false,
    needs_solution_candidate: false,
    needs_rule_candidate: false,
    needs_known_issue_candidate: false,
    needs_fm_update: true,
    deterministic_possible: false,
  },

  {
    coverage_id: "X_CONFIG_INCOMPLETE",
    overall_readiness: "PARTIAL",
    category_readiness: {
      X_MODE:      "MISSING",
      NOT_VISIBLE: "MISSING",
      STATE_CHECK: "PARTIAL",   // DB_STATE: x_mode keywords partially
      WHERE_IS:    "PARTIAL",   // FM keyword: ADMIN_X_SETUP 매칭 가능
    },
    active_sources: ["FM_KEYWORD:ADMIN_X_SETUP", "DB_STATE:x_mode"],
    pending_sources: [],
    gap_reasons: [
      "screen_id='X_SETUP' FM 미등록 — WHERE_IS keyword만",
      "XModeGuard lock 상태(CURRICULUM_PENDING/NOT_CONFIGURED/API_ERROR) 해결 SOLUTION 없음",
    ],
    needs_faq_candidate: false,
    needs_knowledge_candidate: false,
    needs_solution_candidate: true,
    needs_rule_candidate: false,
    needs_known_issue_candidate: false,
    needs_fm_update: true,
    deterministic_possible: false,
  },

  {
    coverage_id: "X_AI_DIARY",
    overall_readiness: "PARTIAL",
    category_readiness: {
      HOW_TO:    "MISSING",
      X_MODE:    "MISSING",
      AI_FAILURE:"MISSING",
      WHERE_IS:  "ACTIVE",   // FM SCREEN_ID_EXACT: TEACHER_DIARY
    },
    active_sources: ["FRONTEND_MAP:TEACHER_DIARY"],
    pending_sources: [],
    gap_reasons: [
      "X 전용 AI 일지 사용 방법 및 일반 모드와 차이 안내 FAQ 없음",
      "X global template 없음 오류 해결 SOLUTION 없음",
    ],
    needs_faq_candidate: true,
    needs_knowledge_candidate: false,
    needs_solution_candidate: true,
    needs_rule_candidate: false,
    needs_known_issue_candidate: false,
    needs_fm_update: false,
    deterministic_possible: true,
  },

  {
    coverage_id: "X_CURRICULUM_HOW_TO",
    overall_readiness: "MISSING",
    category_readiness: {
      HOW_TO:   "MISSING",
      WHERE_IS: "MISSING",
      X_MODE:   "MISSING",
    },
    active_sources: [],
    pending_sources: [],
    gap_reasons: [
      "screen_id='X_INFO_CURRICULUM' FM 미등록 — WHERE_IS 커버 불가",
      "X 모드 커리큘럼 기능 안내 FAQ 없음",
    ],
    needs_faq_candidate: true,
    needs_knowledge_candidate: false,
    needs_solution_candidate: false,
    needs_rule_candidate: false,
    needs_known_issue_candidate: false,
    needs_fm_update: true,
    deterministic_possible: false,
  },

  // ══════════════════════════════════════════════════════════
  // DOMAIN: AI — AI 기능
  // ══════════════════════════════════════════════════════════

  {
    coverage_id: "AI_PARENT_CURRICULUM_HOW_TO",
    overall_readiness: "PARTIAL",
    category_readiness: {
      HOW_TO:   "MISSING",
      WHERE_IS: "PARTIAL",   // FM keyword: PARENT_CURRICULUM_CHAT 키워드 매칭 가능
    },
    active_sources: ["FM_KEYWORD:PARENT_CURRICULUM_CHAT"],
    pending_sources: [],
    gap_reasons: [
      "screen_id='PARENT_CURRICULUM' FM 미등록 (FM: PARENT_CURRICULUM_CHAT) — keyword만",
      "학부모 AI 커리큘럼 문의 사용 방법 FAQ 없음",
    ],
    needs_faq_candidate: true,
    needs_knowledge_candidate: false,
    needs_solution_candidate: false,
    needs_rule_candidate: false,
    needs_known_issue_candidate: false,
    needs_fm_update: true,
    deterministic_possible: false,
  },

  {
    coverage_id: "AI_GROWTH_REPORT_HOW_TO",
    overall_readiness: "PARTIAL",
    category_readiness: {
      HOW_TO:      "MISSING",
      WHERE_IS:    "ACTIVE",   // FM SCREEN_ID_EXACT: PARENT_GROWTH_REPORT
      STATE_CHECK: "PARTIAL",  // DB_STATE: growth_report 키워드 → PENDING 리포트 확인
    },
    active_sources: ["FRONTEND_MAP:PARENT_GROWTH_REPORT", "DB_STATE:growth_report"],
    pending_sources: [],
    gap_reasons: [
      "성장 리포트 발행 주기 및 조회 방법 FAQ 없음",
      "DB_STATE는 PENDING 상태 확인만 가능, HOW_TO 안내 불가",
    ],
    needs_faq_candidate: true,
    needs_knowledge_candidate: false,
    needs_solution_candidate: false,
    needs_rule_candidate: false,
    needs_known_issue_candidate: false,
    needs_fm_update: false,
    deterministic_possible: true,
  },

  {
    coverage_id: "AI_GROWTH_REPORT_NOT_VISIBLE",
    overall_readiness: "PARTIAL",
    category_readiness: {
      NOT_VISIBLE:        "MISSING",
      AI_NO_RESULT:       "MISSING",
      DATA_INCONSISTENCY: "MISSING",
      WHERE_IS:           "ACTIVE",   // FM SCREEN_ID_EXACT: PARENT_GROWTH_REPORT
    },
    active_sources: ["FRONTEND_MAP:PARENT_GROWTH_REPORT"],
    pending_sources: [],
    gap_reasons: ["학부모 성장 리포트 미표시 원인(미공개, 미생성, 자녀 미연결) FAQ/SOLUTION 없음"],
    needs_faq_candidate: true,
    needs_knowledge_candidate: false,
    needs_solution_candidate: true,
    needs_rule_candidate: false,
    needs_known_issue_candidate: false,
    needs_fm_update: false,
    deterministic_possible: true,
  },

  {
    coverage_id: "AI_GROWTH_REPORT_GENERATION_FAILED",
    overall_readiness: "PARTIAL",
    category_readiness: {
      AI_FAILURE:  "MISSING",
      AI_NO_RESULT:"MISSING",
      ERROR:       "MISSING",
      WHERE_IS:    "ACTIVE",   // FM SCREEN_ID_EXACT: TEACHER_GROWTH_REPORT_REVIEW
    },
    active_sources: ["FRONTEND_MAP:TEACHER_GROWTH_REPORT_REVIEW"],
    pending_sources: [],
    gap_reasons: ["성장 리포트 AI 분석 실패 원인 및 재시도 방법 SOLUTION 없음"],
    needs_faq_candidate: false,
    needs_knowledge_candidate: false,
    needs_solution_candidate: true,
    needs_rule_candidate: false,
    needs_known_issue_candidate: true,
    needs_fm_update: false,
    deterministic_possible: true,
  },

  {
    coverage_id: "AI_SUPPORT_HOW_TO",
    overall_readiness: "COVERED_ACTIVE",
    category_readiness: {
      HOW_TO:   "ACTIVE",   // ki_swimnote_intro covers app usage including support
      WHERE_IS: "PARTIAL",  // FM keyword: ADMIN/TEACHER/PARENT_SUPPORT_CHAT
    },
    active_sources: ["KNOWLEDGE:ki_swimnote_intro", "FM_KEYWORD:ADMIN_SUPPORT_CHAT"],
    pending_sources: [],
    gap_reasons: [],
    needs_faq_candidate: false,
    needs_knowledge_candidate: false,
    needs_solution_candidate: false,
    needs_rule_candidate: false,
    needs_known_issue_candidate: false,
    needs_fm_update: true,
    deterministic_possible: true,
    notes: "ki_swimnote_intro가 '고객센터 사용 방법' 기본 안내 커버. 특정 역할별 진입점 안내는 FM 업데이트 시 강화 가능. screen_id='SUPPORT_CHAT' FM 미등록(keyword만) — 정보성 메모.",
  },

  // ══════════════════════════════════════════════════════════
  // DOMAIN: NOTIFICATION — 알림
  // ══════════════════════════════════════════════════════════

  {
    coverage_id: "NOTIFICATION_NOT_RECEIVED",
    overall_readiness: "PARTIAL",
    category_readiness: {
      NOTIFICATION: "MISSING",
      NOT_RECEIVED: "MISSING",
      WHERE_IS:     "ACTIVE",   // FM SCREEN_ID_EXACT: ADMIN_NOTIFICATIONS
    },
    active_sources: ["FRONTEND_MAP:ADMIN_NOTIFICATIONS"],
    pending_sources: [],
    gap_reasons: ["푸시 알림 미수신 원인 및 해결(권한, 토큰 등) SOLUTION 없음"],
    needs_faq_candidate: true,
    needs_knowledge_candidate: false,
    needs_solution_candidate: true,
    needs_rule_candidate: false,
    needs_known_issue_candidate: true,
    needs_fm_update: false,
    deterministic_possible: true,
  },

  {
    coverage_id: "NOTIFICATION_PERMISSION_OS",
    overall_readiness: "MISSING",
    category_readiness: {
      PERMISSION:   "MISSING",
      NOTIFICATION: "MISSING",
    },
    active_sources: [],
    pending_sources: [],
    gap_reasons: [
      "screen_id 없음 — FM WHERE_IS 커버 불가",
      "iOS/Android OS 알림 권한 켜는 방법 FAQ 없음",
    ],
    needs_faq_candidate: true,
    needs_knowledge_candidate: false,
    needs_solution_candidate: false,
    needs_rule_candidate: false,
    needs_known_issue_candidate: false,
    needs_fm_update: false,
    deterministic_possible: false,
    notes: "OS 알림 권한 안내는 플랫폼별 KNOWLEDGE item으로 정리 필요 (iOS 설정 앱 경로 등).",
  },

  // ══════════════════════════════════════════════════════════
  // DOMAIN: PHOTO_VIDEO — 사진/영상
  // ══════════════════════════════════════════════════════════

  {
    coverage_id: "PHOTO_UPLOAD_HOW_TO",
    overall_readiness: "PARTIAL",
    category_readiness: {
      HOW_TO:   "MISSING",
      WHERE_IS: "ACTIVE",   // FM SCREEN_ID_EXACT: ADMIN_PHOTO_UPLOAD
    },
    active_sources: ["FRONTEND_MAP:ADMIN_PHOTO_UPLOAD"],
    pending_sources: [],
    gap_reasons: ["사진 업로드 단계별 안내 FAQ 없음"],
    needs_faq_candidate: true,
    needs_knowledge_candidate: false,
    needs_solution_candidate: false,
    needs_rule_candidate: false,
    needs_known_issue_candidate: false,
    needs_fm_update: false,
    deterministic_possible: true,
  },

  {
    coverage_id: "PHOTO_UPLOAD_FAILED",
    overall_readiness: "PARTIAL",
    category_readiness: {
      UPLOAD_FAILED: "MISSING",
      ERROR:         "MISSING",
      FAILURE:       "MISSING",
      WHERE_IS:      "ACTIVE",   // FM SCREEN_ID_EXACT: ADMIN_PHOTO_UPLOAD
    },
    active_sources: ["FRONTEND_MAP:ADMIN_PHOTO_UPLOAD"],
    pending_sources: [],
    gap_reasons: ["사진 업로드 실패(크기/형식/스토리지 초과) 해결 SOLUTION 없음"],
    needs_faq_candidate: false,
    needs_knowledge_candidate: false,
    needs_solution_candidate: true,
    needs_rule_candidate: false,
    needs_known_issue_candidate: true,
    needs_fm_update: false,
    deterministic_possible: true,
  },

  {
    coverage_id: "PHOTO_PARENT_NOT_VISIBLE",
    overall_readiness: "PARTIAL",
    category_readiness: {
      NOT_VISIBLE:        "MISSING",
      PERMISSION:         "MISSING",
      DATA_INCONSISTENCY: "MISSING",
      WHERE_IS:           "ACTIVE",   // FM SCREEN_ID_EXACT: PARENT_PHOTOS
    },
    active_sources: ["FRONTEND_MAP:PARENT_PHOTOS"],
    pending_sources: [],
    gap_reasons: ["학부모 사진 미표시 원인(자녀 미연결, 미업로드) FAQ/SOLUTION 없음"],
    needs_faq_candidate: true,
    needs_knowledge_candidate: false,
    needs_solution_candidate: true,
    needs_rule_candidate: false,
    needs_known_issue_candidate: false,
    needs_fm_update: false,
    deterministic_possible: true,
  },

  {
    coverage_id: "PHOTO_STORAGE_EXCEEDED",
    overall_readiness: "MISSING",
    category_readiness: {
      ERROR:         "MISSING",
      BILLING:       "MISSING",
      UPLOAD_FAILED: "MISSING",
    },
    active_sources: [],
    pending_sources: [],
    gap_reasons: [
      "screen_id='ADMIN_DATA_STORAGE_OVERVIEW' FM 미등록 — WHERE_IS 커버 불가",
      "스토리지 초과 해결 방법(추가 구매/정리) FAQ/SOLUTION 없음",
    ],
    needs_faq_candidate: true,
    needs_knowledge_candidate: false,
    needs_solution_candidate: true,
    needs_rule_candidate: false,
    needs_known_issue_candidate: false,
    needs_fm_update: true,
    deterministic_possible: false,
  },

  {
    coverage_id: "VIDEO_UPLOAD_FAILED",
    overall_readiness: "MISSING",
    category_readiness: {
      UPLOAD_FAILED: "MISSING",
      ERROR:         "MISSING",
    },
    active_sources: [],
    pending_sources: [],
    gap_reasons: [
      "screen_id 없음 — FM WHERE_IS 커버 불가",
      "영상 업로드 실패 해결 SOLUTION 없음",
    ],
    needs_faq_candidate: false,
    needs_knowledge_candidate: false,
    needs_solution_candidate: true,
    needs_rule_candidate: false,
    needs_known_issue_candidate: true,
    needs_fm_update: false,
    deterministic_possible: false,
  },

  // ══════════════════════════════════════════════════════════
  // DOMAIN: MEMBER_CLASS — 회원/반
  // ══════════════════════════════════════════════════════════

  {
    coverage_id: "MEMBER_ADD_HOW_TO",
    overall_readiness: "PARTIAL",
    category_readiness: {
      HOW_TO:   "MISSING",
      WHERE_IS: "ACTIVE",   // FM SCREEN_ID_EXACT: ADMIN_MEMBERS
    },
    active_sources: ["FRONTEND_MAP:ADMIN_MEMBERS"],
    pending_sources: [],
    gap_reasons: ["회원 등록 단계별 안내 FAQ 없음"],
    needs_faq_candidate: true,
    needs_knowledge_candidate: false,
    needs_solution_candidate: false,
    needs_rule_candidate: false,
    needs_known_issue_candidate: false,
    needs_fm_update: false,
    deterministic_possible: true,
  },

  {
    coverage_id: "MEMBER_LIMIT_EXCEEDED",
    overall_readiness: "PARTIAL",
    category_readiness: {
      BILLING:    "MISSING",
      ERROR:      "MISSING",
      PERMISSION: "MISSING",
      WHERE_IS:   "ACTIVE",   // FM SCREEN_ID_EXACT: ADMIN_MEMBERS
    },
    active_sources: ["FRONTEND_MAP:ADMIN_MEMBERS"],
    pending_sources: [],
    gap_reasons: ["플랜 회원 수 한도 초과 시 업그레이드 안내 FAQ/SOLUTION 없음"],
    needs_faq_candidate: true,
    needs_knowledge_candidate: false,
    needs_solution_candidate: true,
    needs_rule_candidate: false,
    needs_known_issue_candidate: false,
    needs_fm_update: false,
    deterministic_possible: true,
  },

  {
    coverage_id: "CLASS_CREATE_HOW_TO",
    overall_readiness: "PARTIAL",
    category_readiness: {
      HOW_TO:   "MISSING",
      WHERE_IS: "ACTIVE",   // FM SCREEN_ID_EXACT: ADMIN_CLASSES
    },
    active_sources: ["FRONTEND_MAP:ADMIN_CLASSES"],
    pending_sources: [],
    gap_reasons: ["반 생성 단계별 안내 FAQ 없음"],
    needs_faq_candidate: true,
    needs_knowledge_candidate: false,
    needs_solution_candidate: false,
    needs_rule_candidate: false,
    needs_known_issue_candidate: false,
    needs_fm_update: false,
    deterministic_possible: true,
  },

  // ══════════════════════════════════════════════════════════
  // DOMAIN: SCHEDULE — 일정/보강
  // ══════════════════════════════════════════════════════════

  {
    coverage_id: "SCHEDULE_HOW_TO",
    overall_readiness: "PARTIAL",
    category_readiness: {
      HOW_TO:   "MISSING",
      WHERE_IS: "ACTIVE",   // FM SCREEN_ID_EXACT: TEACHER_TODAY_SCHEDULE
    },
    active_sources: ["FRONTEND_MAP:TEACHER_TODAY_SCHEDULE"],
    pending_sources: [],
    gap_reasons: ["오늘 수업 일정 확인 방법 FAQ 없음"],
    needs_faq_candidate: true,
    needs_knowledge_candidate: false,
    needs_solution_candidate: false,
    needs_rule_candidate: false,
    needs_known_issue_candidate: false,
    needs_fm_update: false,
    deterministic_possible: true,
  },

  {
    coverage_id: "MAKEUP_POLICY_HOW_TO",
    overall_readiness: "PARTIAL",
    category_readiness: {
      HOW_TO:   "MISSING",
      WHERE_IS: "ACTIVE",   // FM SCREEN_ID_EXACT: ADMIN_MAKEUP_POLICY
    },
    active_sources: ["FRONTEND_MAP:ADMIN_MAKEUP_POLICY"],
    pending_sources: [],
    gap_reasons: ["보강 정책 설정 방법 FAQ 없음"],
    needs_faq_candidate: true,
    needs_knowledge_candidate: false,
    needs_solution_candidate: false,
    needs_rule_candidate: false,
    needs_known_issue_candidate: false,
    needs_fm_update: false,
    deterministic_possible: true,
  },

  // ══════════════════════════════════════════════════════════
  // DOMAIN: PARENT_VISIBILITY — 학부모 가시성
  // ══════════════════════════════════════════════════════════

  {
    coverage_id: "PARENT_CHILD_NOT_LINKED",
    overall_readiness: "PARTIAL",
    category_readiness: {
      NOT_VISIBLE:        "MISSING",
      ACCOUNT:            "MISSING",
      DATA_INCONSISTENCY: "MISSING",
      WHERE_IS:           "ACTIVE",   // FM SCREEN_ID_EXACT: PARENT_HOME
    },
    active_sources: ["FRONTEND_MAP:PARENT_HOME"],
    pending_sources: [],
    gap_reasons: [
      "자녀 미연결 원인(수영장 미등록, 계정 미승인) 및 해결 FAQ/SOLUTION 없음",
    ],
    needs_faq_candidate: true,
    needs_knowledge_candidate: false,
    needs_solution_candidate: true,
    needs_rule_candidate: false,
    needs_known_issue_candidate: false,
    needs_fm_update: false,
    deterministic_possible: true,
  },

  {
    coverage_id: "PARENT_NOTICE_NOT_VISIBLE",
    overall_readiness: "PARTIAL",
    category_readiness: {
      NOT_VISIBLE:        "MISSING",
      DATA_INCONSISTENCY: "MISSING",
      WHERE_IS:           "ACTIVE",   // FM SCREEN_ID_EXACT: PARENT_NOTICES
    },
    active_sources: ["FRONTEND_MAP:PARENT_NOTICES"],
    pending_sources: [],
    gap_reasons: ["학부모 공지사항 미표시 원인 안내 FAQ 없음"],
    needs_faq_candidate: true,
    needs_knowledge_candidate: false,
    needs_solution_candidate: false,
    needs_rule_candidate: false,
    needs_known_issue_candidate: false,
    needs_fm_update: false,
    deterministic_possible: true,
  },

  {
    coverage_id: "PARENT_ATTENDANCE_NOT_VISIBLE",
    overall_readiness: "PARTIAL",
    category_readiness: {
      NOT_VISIBLE:        "MISSING",
      DATA_INCONSISTENCY: "MISSING",
      WHERE_IS:           "ACTIVE",   // FM SCREEN_ID_EXACT: PARENT_ATTENDANCE
    },
    active_sources: ["FRONTEND_MAP:PARENT_ATTENDANCE"],
    pending_sources: [],
    gap_reasons: ["학부모 자녀 출결 미표시 원인 안내 FAQ 없음"],
    needs_faq_candidate: true,
    needs_knowledge_candidate: false,
    needs_solution_candidate: false,
    needs_rule_candidate: false,
    needs_known_issue_candidate: false,
    needs_fm_update: false,
    deterministic_possible: true,
  },

  // ══════════════════════════════════════════════════════════
  // DOMAIN: SWIMNOTE_INTRO — 앱 소개
  // ══════════════════════════════════════════════════════════

  {
    coverage_id: "SWIMNOTE_INTRO",
    overall_readiness: "COVERED_ACTIVE",
    category_readiness: {
      HOW_TO: "ACTIVE",   // ki_swimnote_intro ACTIVE — primary intent
    },
    active_sources: ["KNOWLEDGE:ki_swimnote_intro"],
    pending_sources: [],
    gap_reasons: [],
    needs_faq_candidate: false,
    needs_knowledge_candidate: false,
    needs_solution_candidate: false,
    needs_rule_candidate: false,
    needs_known_issue_candidate: false,
    needs_fm_update: false,
    deterministic_possible: true,
    notes: "ki_swimnote_intro(scope=global, status=active)가 '스윔노트가 뭐예요' primary intent를 직접 커버.",
  },

  // ══════════════════════════════════════════════════════════
  // DOMAIN: SETTINGS — 설정
  // ══════════════════════════════════════════════════════════

  {
    coverage_id: "POOL_SETTINGS_HOW_TO",
    overall_readiness: "PARTIAL",
    category_readiness: {
      HOW_TO:   "MISSING",
      WHERE_IS: "ACTIVE",   // FM SCREEN_ID_EXACT: ADMIN_POOL_SETTINGS
    },
    active_sources: ["FRONTEND_MAP:ADMIN_POOL_SETTINGS"],
    pending_sources: [],
    gap_reasons: ["수영장 기본 설정 변경 방법 FAQ 없음"],
    needs_faq_candidate: true,
    needs_knowledge_candidate: false,
    needs_solution_candidate: false,
    needs_rule_candidate: false,
    needs_known_issue_candidate: false,
    needs_fm_update: false,
    deterministic_possible: true,
  },

  {
    coverage_id: "BRANDING_HOW_TO",
    overall_readiness: "MISSING",
    category_readiness: {
      HOW_TO:   "MISSING",
      WHERE_IS: "MISSING",
    },
    active_sources: [],
    pending_sources: [],
    gap_reasons: [
      "screen_id='ADMIN_BRANDING' FM 미등록 — WHERE_IS 커버 불가",
      "로고/브랜딩 설정 방법 FAQ 없음",
    ],
    needs_faq_candidate: true,
    needs_knowledge_candidate: false,
    needs_solution_candidate: false,
    needs_rule_candidate: false,
    needs_known_issue_candidate: false,
    needs_fm_update: true,
    deterministic_possible: false,
  },

  // ══════════════════════════════════════════════════════════
  // DOMAIN: DATA_VISIBILITY — 데이터 가시성 공통
  // ══════════════════════════════════════════════════════════

  {
    coverage_id: "DATA_NOT_VISIBLE_ROLE_MISMATCH",
    overall_readiness: "MISSING",
    category_readiness: {
      NOT_VISIBLE:          "MISSING",
      ROLE_MISMATCH:        "MISSING",
      USER_MISUNDERSTANDING:"MISSING",
    },
    active_sources: [],
    pending_sources: [],
    gap_reasons: [
      "screen_id 없음 — FM WHERE_IS 커버 불가",
      "역할별 데이터 가시성 차이 안내 FAQ/KNOWLEDGE 없음",
    ],
    needs_faq_candidate: true,
    needs_knowledge_candidate: true,
    needs_solution_candidate: true,
    needs_rule_candidate: false,
    needs_known_issue_candidate: false,
    needs_fm_update: false,
    deterministic_possible: false,
    notes: "역할별 권한 차이 설명은 KNOWLEDGE item으로 정리 후 cross-cutting RULE 고려 가능.",
  },

  {
    coverage_id: "DATA_NOT_VISIBLE_FILTER",
    overall_readiness: "MISSING",
    category_readiness: {
      NOT_VISIBLE:          "MISSING",
      EMPTY_STATE:          "MISSING",
      USER_MISUNDERSTANDING:"MISSING",
    },
    active_sources: [],
    pending_sources: [],
    gap_reasons: [
      "screen_id 없음 — FM WHERE_IS 커버 불가",
      "날짜/반 필터 불일치로 데이터 미표시 안내 FAQ 없음",
    ],
    needs_faq_candidate: true,
    needs_knowledge_candidate: false,
    needs_solution_candidate: false,
    needs_rule_candidate: false,
    needs_known_issue_candidate: false,
    needs_fm_update: false,
    deterministic_possible: false,
    notes: "공통 empty-state 안내 FAQ로 여러 화면에 적용 가능 (cross-cutting coverage).",
  },

  // ══════════════════════════════════════════════════════════
  // DOMAIN: KNOWN_ISSUE — 장애 가능 표면
  // ══════════════════════════════════════════════════════════

  {
    coverage_id: "KNOWN_ISSUE_SERVER_API",
    overall_readiness: "MISSING",
    category_readiness: {
      KNOWN_ISSUE: "MISSING",   // super_incidents OPEN/INVESTIGATING/MITIGATED = 0
      FAILURE:     "MISSING",
    },
    active_sources: [],
    pending_sources: [],
    gap_reasons: [
      "super_incidents ACTIVE = 0 — KNOWN_ISSUE layer 미발동",
      "screen_id 없음 — FM WHERE_IS 커버 불가",
      "서버 전체 장애 안내 KNOWN_ISSUE knowledge 없음",
    ],
    needs_faq_candidate: false,
    needs_knowledge_candidate: false,
    needs_solution_candidate: false,
    needs_rule_candidate: false,
    needs_known_issue_candidate: true,
    needs_fm_update: false,
    deterministic_possible: false,
    notes: "장애 발생 시 super_incidents OPEN + ki_server_outage 연결로 즉시 커버 가능. 사전 준비 필요.",
  },

  {
    coverage_id: "KNOWN_ISSUE_AI_PROVIDER",
    overall_readiness: "MISSING",
    category_readiness: {
      KNOWN_ISSUE: "MISSING",
      AI_FAILURE:  "MISSING",
    },
    active_sources: [],
    pending_sources: [],
    gap_reasons: [
      "super_incidents ACTIVE = 0 — KNOWN_ISSUE layer 미발동",
      "AI 제공자 장애 안내 KNOWN_ISSUE knowledge 없음",
    ],
    needs_faq_candidate: false,
    needs_knowledge_candidate: false,
    needs_solution_candidate: false,
    needs_rule_candidate: false,
    needs_known_issue_candidate: true,
    needs_fm_update: false,
    deterministic_possible: false,
  },

  {
    coverage_id: "KNOWN_ISSUE_PUSH",
    overall_readiness: "MISSING",
    category_readiness: {
      KNOWN_ISSUE:  "MISSING",
      NOTIFICATION: "MISSING",
    },
    active_sources: [],
    pending_sources: [],
    gap_reasons: [
      "super_incidents ACTIVE = 0 — KNOWN_ISSUE layer 미발동",
      "푸시 서비스 장애 안내 KNOWN_ISSUE knowledge 없음",
    ],
    needs_faq_candidate: false,
    needs_knowledge_candidate: false,
    needs_solution_candidate: false,
    needs_rule_candidate: false,
    needs_known_issue_candidate: true,
    needs_fm_update: false,
    deterministic_possible: false,
  },

  {
    coverage_id: "KNOWN_ISSUE_BILLING",
    overall_readiness: "MISSING",
    category_readiness: {
      KNOWN_ISSUE: "MISSING",
      BILLING:     "MISSING",
    },
    active_sources: [],
    pending_sources: [],
    gap_reasons: [
      "super_incidents ACTIVE = 0 — KNOWN_ISSUE layer 미발동",
      "RevenueCat 장애 안내 KNOWN_ISSUE knowledge 없음",
    ],
    needs_faq_candidate: false,
    needs_knowledge_candidate: false,
    needs_solution_candidate: false,
    needs_rule_candidate: false,
    needs_known_issue_candidate: true,
    needs_fm_update: false,
    deterministic_possible: false,
  },

  // ══════════════════════════════════════════════════════════
  // DOMAIN: CURRICULUM — 커리큘럼
  // ══════════════════════════════════════════════════════════

  {
    coverage_id: "CURRICULUM_HOW_TO",
    overall_readiness: "PARTIAL",
    category_readiness: {
      HOW_TO:   "MISSING",
      WHERE_IS: "ACTIVE",   // FM SCREEN_ID_EXACT: ADMIN_LEVEL_SETTINGS
    },
    active_sources: ["FRONTEND_MAP:ADMIN_LEVEL_SETTINGS"],
    pending_sources: [],
    gap_reasons: ["커리큘럼/레벨 설정 방법 FAQ 없음"],
    needs_faq_candidate: true,
    needs_knowledge_candidate: false,
    needs_solution_candidate: false,
    needs_rule_candidate: false,
    needs_known_issue_candidate: false,
    needs_fm_update: false,
    deterministic_possible: true,
  },

  // ══════════════════════════════════════════════════════════
  // DOMAIN: SETTINGS — WP-CS10 CLOSURE 추가 레코드
  // ══════════════════════════════════════════════════════════

  {
    coverage_id: "CLASS_CAPACITY_SETTINGS_HOW_TO",
    overall_readiness: "MISSING",
    category_readiness: {
      HOW_TO:   "MISSING",
      NOT_SAVED:"MISSING",
    },
    active_sources: [],
    pending_sources: [],
    gap_reasons: [
      "screen_id='ADMIN_CLASS_CAPACITY_SETTINGS' FM 미등록 — WHERE_IS 커버 불가",
      "반 정원 설정 방법 FAQ 없음",
    ],
    needs_faq_candidate: true,
    needs_knowledge_candidate: false,
    needs_solution_candidate: false,
    needs_rule_candidate: false,
    needs_known_issue_candidate: false,
    needs_fm_update: true,
    deterministic_possible: false,
  },

  {
    coverage_id: "MEMBER_PENDING_HOW_TO",
    overall_readiness: "PARTIAL",
    category_readiness: {
      HOW_TO:       "MISSING",
      UPLOAD_FAILED:"MISSING",
      WHERE_IS:     "ACTIVE",   // FM SCREEN_ID_EXACT: ADMIN_PEOPLE_PENDING
    },
    active_sources: ["FRONTEND_MAP:ADMIN_PEOPLE_PENDING"],
    pending_sources: [],
    gap_reasons: [
      "미배정 회원 관리 및 CSV 업로드 방법 FAQ 없음",
      "CSV 파싱 오류 해결 SOLUTION 없음",
    ],
    needs_faq_candidate: true,
    needs_knowledge_candidate: false,
    needs_solution_candidate: true,
    needs_rule_candidate: false,
    needs_known_issue_candidate: false,
    needs_fm_update: false,
    deterministic_possible: true,
  },

  {
    coverage_id: "SETTINGS_WHITE_LABEL_HOW_TO",
    overall_readiness: "MISSING",
    category_readiness: {
      HOW_TO:   "MISSING",
      NOT_SAVED:"MISSING",
    },
    active_sources: [],
    pending_sources: [],
    gap_reasons: [
      "screen_id='ADMIN_WHITE_LABEL' FM 미등록 — WHERE_IS 커버 불가",
      "화이트 라벨 설정 방법 FAQ 없음",
    ],
    needs_faq_candidate: true,
    needs_knowledge_candidate: false,
    needs_solution_candidate: false,
    needs_rule_candidate: false,
    needs_known_issue_candidate: false,
    needs_fm_update: true,
    deterministic_possible: false,
  },

  {
    coverage_id: "SETTINGS_WEB_PIN_HOW_TO",
    overall_readiness: "PARTIAL",
    category_readiness: {
      HOW_TO:     "MISSING",
      LOGIN_AUTH: "MISSING",
      NOT_SAVED:  "MISSING",
      WHERE_IS:   "ACTIVE",   // FM SCREEN_ID_EXACT: ADMIN_WEB_PIN_SETTINGS
    },
    active_sources: ["FRONTEND_MAP:ADMIN_WEB_PIN_SETTINGS"],
    pending_sources: [],
    gap_reasons: [
      "웹 PIN 설정 및 변경 방법 FAQ 없음",
      "PIN 분실 시 재설정 SOLUTION 없음",
    ],
    needs_faq_candidate: true,
    needs_knowledge_candidate: false,
    needs_solution_candidate: true,
    needs_rule_candidate: false,
    needs_known_issue_candidate: false,
    needs_fm_update: false,
    deterministic_possible: true,
  },

  {
    coverage_id: "SETTINGS_ADMIN_GRANT_HOW_TO",
    overall_readiness: "MISSING",
    category_readiness: {
      HOW_TO:    "MISSING",
      PERMISSION:"MISSING",
    },
    active_sources: [],
    pending_sources: [],
    gap_reasons: [
      "screen_id='ADMIN_ADMIN_GRANT' FM 미등록 — WHERE_IS 커버 불가",
      "강사 관리자 권한 부여/회수 방법 FAQ 없음",
    ],
    needs_faq_candidate: true,
    needs_knowledge_candidate: false,
    needs_solution_candidate: false,
    needs_rule_candidate: false,
    needs_known_issue_candidate: false,
    needs_fm_update: true,
    deterministic_possible: false,
  },

  {
    coverage_id: "REVENUE_SETTLEMENT_HOW_TO",
    overall_readiness: "MISSING",
    category_readiness: {
      HOW_TO:   "MISSING",
      NOT_SAVED:"MISSING",
    },
    active_sources: [],
    pending_sources: [],
    gap_reasons: [
      "screen_id='ADMIN_ADMIN_REVENUE' FM 미등록 — WHERE_IS 커버 불가",
      "매출 정산 방법 FAQ 없음",
    ],
    needs_faq_candidate: true,
    needs_knowledge_candidate: false,
    needs_solution_candidate: false,
    needs_rule_candidate: false,
    needs_known_issue_candidate: false,
    needs_fm_update: true,
    deterministic_possible: false,
  },

  {
    coverage_id: "STORAGE_QUOTA_HOW_TO",
    overall_readiness: "MISSING",
    category_readiness: {
      HOW_TO:      "MISSING",
      STATE_CHECK: "MISSING",
      COMPLAINT:   "MISSING",
    },
    active_sources: [],
    pending_sources: [],
    gap_reasons: [
      "screen_id='ADMIN_DATA_STORAGE_OVERVIEW' FM 미등록 — WHERE_IS 커버 불가",
      "저장공간 현황 확인 및 정리 방법 FAQ/SOLUTION 없음",
    ],
    needs_faq_candidate: true,
    needs_knowledge_candidate: false,
    needs_solution_candidate: true,
    needs_rule_candidate: false,
    needs_known_issue_candidate: false,
    needs_fm_update: true,
    deterministic_possible: false,
  },

  {
    coverage_id: "ADMIN_TEACHER_OVERVIEW_HOW_TO",
    overall_readiness: "PARTIAL",
    category_readiness: {
      HOW_TO:     "MISSING",
      NOT_VISIBLE:"MISSING",
      WHERE_IS:   "ACTIVE",   // FM SCREEN_ID_EXACT: ADMIN_TEACHER_HUB
    },
    active_sources: ["FRONTEND_MAP:ADMIN_TEACHER_HUB"],
    pending_sources: [],
    gap_reasons: ["선생님 운영 현황 확인 방법 FAQ 없음"],
    needs_faq_candidate: true,
    needs_knowledge_candidate: false,
    needs_solution_candidate: false,
    needs_rule_candidate: false,
    needs_known_issue_candidate: false,
    needs_fm_update: false,
    deterministic_possible: true,
  },

  {
    coverage_id: "DIARY_REACTIONS_HOW_TO",
    overall_readiness: "MISSING",
    category_readiness: {
      HOW_TO:     "MISSING",
      NOT_VISIBLE:"MISSING",
    },
    active_sources: [],
    pending_sources: [],
    gap_reasons: [
      "screen_id='TEACHER_DIARY_REACTIONS' FM 미등록 — WHERE_IS 커버 불가",
      "학부모 일지 반응·댓글 확인 및 답글 방법 FAQ 없음",
    ],
    needs_faq_candidate: true,
    needs_knowledge_candidate: false,
    needs_solution_candidate: false,
    needs_rule_candidate: false,
    needs_known_issue_candidate: false,
    needs_fm_update: true,
    deterministic_possible: false,
  },

  {
    coverage_id: "DIARY_TEMPLATE_CUSTOM_HOW_TO",
    overall_readiness: "MISSING",
    category_readiness: {
      HOW_TO:   "MISSING",
      NOT_SAVED:"MISSING",
    },
    active_sources: [],
    pending_sources: [],
    gap_reasons: [
      "screen_id='TEACHER_FEEDBACK_CUSTOM' FM 미등록 — WHERE_IS 커버 불가",
      "일지 템플릿 개인 수정 방법 FAQ 없음",
    ],
    needs_faq_candidate: true,
    needs_knowledge_candidate: false,
    needs_solution_candidate: false,
    needs_rule_candidate: false,
    needs_known_issue_candidate: false,
    needs_fm_update: true,
    deterministic_possible: false,
  },

  {
    coverage_id: "GROWTH_REPORT_REVIEW_HOW_TO",
    overall_readiness: "PARTIAL",
    category_readiness: {
      HOW_TO:  "MISSING",
      FAILURE: "MISSING",
      WHERE_IS:"ACTIVE",   // FM SCREEN_ID_EXACT: TEACHER_GROWTH_REPORT_REVIEW
    },
    active_sources: ["FRONTEND_MAP:TEACHER_GROWTH_REPORT_REVIEW"],
    pending_sources: [],
    gap_reasons: [
      "성장 리포트 검토·승인·재분석 방법 FAQ 없음",
      "승인 후 상태 미변경 SOLUTION 없음",
    ],
    needs_faq_candidate: true,
    needs_knowledge_candidate: false,
    needs_solution_candidate: true,
    needs_rule_candidate: false,
    needs_known_issue_candidate: false,
    needs_fm_update: false,
    deterministic_possible: true,
  },

];

// ── Validation helpers ────────────────────────────────────────────────────────

/** GAP_REGISTRY에 없는 coverage_ids = 0 이어야 함 */
export const UNCLASSIFIED_COVERAGE_RECORDS: string[] = [];

// ── Statistics ────────────────────────────────────────────────────────────────

export const GAP_STATISTICS = {
  TOTAL_GAP_RECORDS: 75,
  COVERED_ACTIVE_COUNT:  7,
  COVERED_PENDING_COUNT: 1,
  PARTIAL_COUNT:         46,
  MISSING_COUNT:         21,

  // P0 priority records with MISSING readiness
  P0_MISSING_COUNT: 10,   // AUTH_ACCOUNT_WITHDRAWAL, AUTH_POOL_ACCESS_DENIED, ATTENDANCE_PERMISSION_DENIED,
                           // NOTIFICATION_PERMISSION_OS, DATA_NOT_VISIBLE_ROLE_MISMATCH, DATA_NOT_VISIBLE_FILTER,
                           // KNOWN_ISSUE_SERVER_API, KNOWN_ISSUE_AI_PROVIDER, KNOWN_ISSUE_PUSH, KNOWN_ISSUE_BILLING

  // Active sources summary
  ACTIVE_KNOWLEDGE_IDS: ["ki_swimnote_intro", "ki_x_mode_intro"],
  PENDING_KNOWLEDGE_IDS: ["ki_seed_subscription_x_features"],
  ACTIVE_INCIDENTS: 0,
  FM_SCREENS_REGISTERED: 85,

  // Records with ACTIVE FM exact screen match (WHERE_IS covered)
  FM_EXACT_COVERED_COUNT: 43,
  // Records with FM keyword possible (no exact screen_id match)
  FM_KEYWORD_POSSIBLE_COUNT: 5,
  // Records with NO FM coverage whatsoever
  FM_NONE_COUNT: 27,

  // Records needing FM update (screen_id not in FM)
  NEEDS_FM_UPDATE_COUNT: 18,

  // Candidate needs
  NEEDS_FAQ_CANDIDATE_COUNT: 53,
  NEEDS_KNOWLEDGE_CANDIDATE_COUNT: 3,
  NEEDS_SOLUTION_CANDIDATE_COUNT: 29,
  NEEDS_RULE_CANDIDATE_COUNT: 0,
  NEEDS_KNOWN_ISSUE_CANDIDATE_COUNT: 4,

  // Deterministic resolution possible (at least one category)
  DETERMINISTIC_POSSIBLE_COUNT: 49,
  DETERMINISTIC_NOT_POSSIBLE_COUNT: 26,

  // DB_STATE active domains
  DB_STATE_ACTIVE_DOMAINS: ["subscription", "x_mode", "growth_report"] as const,

  // Records fully covered by only DB_STATE (no knowledge needed if DB_STATE fires)
  DB_STATE_PRIMARY_ACTIVE_COUNT: 3,  // BILLING_SUBSCRIPTION_STATUS, BILLING_CANCELLED_BUT_ACTIVE, X_ACTIVATION_CHECK
} as const;

// ── Lookup helpers ────────────────────────────────────────────────────────────

/** coverage_id → GapRecord 빠른 조회 */
export const GAP_BY_COVERAGE_ID = new Map<string, GapRecord>(
  SUPPORT_GAP_REGISTRY.map((r) => [r.coverage_id, r])
);

/** readiness별 필터 */
export function getGapsByReadiness(readiness: GapReadiness): GapRecord[] {
  return SUPPORT_GAP_REGISTRY.filter((r) => r.overall_readiness === readiness);
}

/** FAQ 후보 필요 레코드 */
export function getRecordsNeedingFaq(): GapRecord[] {
  return SUPPORT_GAP_REGISTRY.filter((r) => r.needs_faq_candidate);
}

/** SOLUTION 후보 필요 레코드 */
export function getRecordsNeedingSolution(): GapRecord[] {
  return SUPPORT_GAP_REGISTRY.filter((r) => r.needs_solution_candidate);
}

/** FM 업데이트 필요 레코드 (screen_id FM 미등록) */
export function getRecordsNeedingFmUpdate(): GapRecord[] {
  return SUPPORT_GAP_REGISTRY.filter((r) => r.needs_fm_update);
}
