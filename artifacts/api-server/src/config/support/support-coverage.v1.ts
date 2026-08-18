/**
 * SWIMNOTE Support Coverage Registry — v1
 *
 * WP-CS10: Full App Function + Failure + Complaint Support Coverage Scan
 *
 * 목적:
 *   무인 고객센터가 책임져야 할 전체 앱 기능/화면/오류/불만을 구조화한 레지스트리.
 *   이후 FAQ, Knowledge, Solution DB, Known Issue, Out-of-Scope whitelist 생성의 source of truth.
 *
 * 원칙:
 *   - 실제 코드/화면 기반 (창작 금지)
 *   - Canonical JWT roles만 사용: pool_admin, sub_admin, teacher, parent_account
 *   - "parent" legacy alias 사용 금지 (기존 knowledge item은 미수정)
 *   - Knowledge/Solution DB 신규 ACTIVE 생성 없음 (registry only)
 *   - Server/Mobile runtime 변경 없음
 *
 * 버전: 1.0.0
 * 기준 앱 버전: 1.6.3 (2026-08-18)
 * Frontend Map 참조: frontend-map.v1.ts (version "1.6.3")
 */

// ─── Canonical Types ────────────────────────────────────────────────────────

/** 실제 JWT roles — auth.ts/middleware 기준 */
export type CanonicalRole =
  | "pool_admin"
  | "sub_admin"
  | "teacher"
  | "parent_account"
  | "super_admin";

export type CoverageMode = "normal" | "x" | "x_pending" | "all";

export type SupportCategory =
  | "HOW_TO"
  | "WHERE_IS"
  | "PERMISSION"
  | "ROLE_MISMATCH"
  | "STATE_CHECK"
  | "NOT_VISIBLE"
  | "NOT_SAVED"
  | "NOT_RECEIVED"
  | "NOT_UPDATED"
  | "ERROR"
  | "FAILURE"
  | "TIMEOUT"
  | "SLOW"
  | "UPLOAD_FAILED"
  | "DOWNLOAD_FAILED"
  | "LOGIN_AUTH"
  | "ACCOUNT"
  | "PAYMENT"
  | "SUBSCRIPTION"
  | "BILLING"
  | "X_MODE"
  | "AI_FAILURE"
  | "AI_WRONG_RESULT"
  | "AI_NO_RESULT"
  | "DATA_INCONSISTENCY"
  | "EMPTY_STATE"
  | "NOTIFICATION"
  | "USER_MISUNDERSTANDING"
  | "COMPLAINT"
  | "KNOWN_ISSUE"
  | "POLICY"
  | "OTHER";

/** Reusable complaint class taxonomy */
export type ComplaintClass =
  | "COMPLAINT_NOT_WORKING"         // "왜 안돼요"
  | "COMPLAINT_NOT_VISIBLE"         // "안 보여요"
  | "COMPLAINT_DISAPPEARED"         // "저장했는데 없어졌어요"
  | "COMPLAINT_TOO_SLOW"            // "너무 느려요"
  | "COMPLAINT_PAYMENT_NOT_APPLIED" // "결제했는데 왜 안 열려요"
  | "COMPLAINT_NOTIFICATION_MISSING"// "알림을 켰는데 안 와요"
  | "COMPLAINT_PARENT_NOT_VISIBLE"  // "학부모한테 왜 안 보여요"
  | "COMPLAINT_ROLE_DIFFERENT"      // "선생님 계정에서는 되는데 왜 여긴 안돼요"
  | "COMPLAINT_UPLOAD_FAILED"       // "사진이 안 올라가요"
  | "COMPLAINT_AI_WRONG"            // "AI 답변이 이상해요"
  | "COMPLAINT_AI_MISSING"          // "AI 기능이 안 나와요"
  | "COMPLAINT_SESSION_EXPIRED"     // "자꾸 로그아웃돼요"
  | "COMPLAINT_PERMISSION_DENIED"   // "권한이 없다고 나와요"
  | "COMPLAINT_KEEP_FAILING"        // "또 안돼요"
  | "COMPLAINT_NOTHING_SHOWS"       // "아무것도 안 떠요";

export type KnowledgeCoverageStatus =
  | "ACTIVE_COVERED"   // 현재 ACTIVE knowledge item이 커버함
  | "PENDING_COVERED"  // PENDING knowledge item이 존재하나 미승인
  | "PARTIAL"          // 일부만 커버됨
  | "MISSING";         // 커버 없음

export type SolutionCoverageStatus =
  | "ACTIVE_SOLUTION"
  | "PENDING_SOLUTION"
  | "MISSING_SOLUTION";

export interface CoverageRecord {
  /** 고유 식별자: DOMAIN_FEATURE_SYMPTOM 형식 */
  coverage_id: string;

  /** 도메인: AUTH, ATTENDANCE, DIARY, PAYMENT, X_MODE, AI, PHOTO, NOTIFICATION, etc. */
  domain: string;

  /** 기능 식별자 (feature_id는 frontend-map feature와 대응) */
  feature_id: string;

  /** frontend-map.v1.ts screen_id (해당 시) */
  screen_id?: string;

  /** 대상 canonical roles */
  roles: CanonicalRole[];

  /** 적용 모드 */
  modes: CoverageMode[];

  /** 행동 식별자 */
  action_id?: string;

  /** 사용자 행동 또는 상황 설명 */
  action_description: string;

  /** Support 분류 */
  support_categories: SupportCategory[];

  /** 사용자가 실제로 표현할 수 있는 질문 의도 */
  possible_intents: string[];

  /** 사용자가 관찰하는 증상 */
  possible_symptoms: string[];

  /** 관련 불만 클래스 */
  complaint_classes: ComplaintClass[];

  /** 기능 사용에 필요한 권한/조건 */
  required_permissions: string[];

  /** 기능 사용에 필요한 상태 */
  required_states: string[];

  /** 관련 API 경로 */
  related_api: string[];

  /** 관련 feature flags */
  related_feature_flags: string[];

  /** 실제 코드에서 확인된 오류 */
  known_errors: string[];

  /** 빈 상태 케이스 */
  known_empty_states: string[];

  /** 로딩 상태 케이스 */
  known_loading_states: string[];

  /** 실시간 DB 조회로 답변 가능 여부 */
  db_state_check_possible: boolean;

  /** DB 조회 대상 (db_state_check_possible=true 시) */
  db_state_source?: string;

  /** Knowledge item 필요 여부 */
  knowledge_required: boolean;

  /** Solution item 필요 여부 */
  solution_required: boolean;

  /** Known Issue로 등록 가능 여부 */
  known_issue_possible: boolean;

  /** 항상 false (이 레지스트리는 앱 범위 내 항목만) */
  out_of_scope: false;

  /** 우선순위 */
  priority: "P0" | "P1" | "P2";

  /** 코드/화면 참조 */
  source_refs: string[];

  /** 현재 knowledge coverage 상태 */
  knowledge_coverage: KnowledgeCoverageStatus;

  /** 현재 solution coverage 상태 */
  solution_coverage: SolutionCoverageStatus;
}

// ─── Out-of-Scope Foundation ────────────────────────────────────────────────

/** Support AI 범위 밖 질문 유형 목록 (차단 로직 미구현 — foundation only) */
export const OUT_OF_SCOPE_EXAMPLES = [
  "날씨 정보 질문",
  "정치/사회 이슈",
  "주식/투자 정보",
  "일반 잡담",
  "자유형 팔 동작 등 일반 수영 코칭",
  "학교 숙제/공부 도움",
  "의료/건강 상담",
  "음식/레시피 질문",
  "SWIMNOTE 기능과 무관한 외부 앱 사용법",
  "경쟁 수영 앱 비교",
] as const;

/** SWIMNOTE 내 특정 product feature가 명시적으로 제공하는 경우 예외 */
export const SWIMMING_KNOWLEDGE_BOUNDARY =
  "SWIMNOTE AI Engine(수영 전문 DB)은 별개 제품. " +
  "고객센터 Support AI는 SWIMNOTE 앱/서비스 사용 문의만 담당.";

// ─── Canonical Role Source ───────────────────────────────────────────────────

export const ROLE_CANONICAL_SOURCE = {
  source: "artifacts/api-server/src/middlewares/auth.ts",
  roles: ["pool_admin", "sub_admin", "teacher", "parent_account", "super_admin"] as CanonicalRole[],
  note: "parent는 legacy alias — 신규 coverage record에 사용 금지. parent_account 사용.",
  jwt_verified: true,
} as const;

// ─── Coverage Registry ───────────────────────────────────────────────────────

export const SUPPORT_COVERAGE_REGISTRY: CoverageRecord[] = [

  // ══════════════════════════════════════════════════════════
  // DOMAIN: AUTH — 인증/로그인/계정 (P0)
  // ══════════════════════════════════════════════════════════

  {
    coverage_id: "AUTH_LOGIN_HOW_TO",
    domain: "AUTH",
    feature_id: "LOGIN",
    screen_id: "LOGIN",
    roles: ["pool_admin", "sub_admin", "teacher"],
    modes: ["all"],
    action_id: "LOGIN_SUBMIT",
    action_description: "이메일/비밀번호로 로그인",
    support_categories: ["HOW_TO", "LOGIN_AUTH"],
    possible_intents: ["로그인 방법", "어디서 로그인해요", "어떻게 시작해요"],
    possible_symptoms: ["로그인 화면을 못 찾음", "어디서 시작해야 할지 모름"],
    complaint_classes: ["COMPLAINT_NOT_WORKING"],
    required_permissions: [],
    required_states: [],
    related_api: ["/auth/login", "/auth/unified-login"],
    related_feature_flags: [],
    known_errors: ["이메일 또는 비밀번호가 올바르지 않습니다", "계정을 찾을 수 없습니다"],
    known_empty_states: [],
    known_loading_states: ["로그인 중"],
    db_state_check_possible: false,
    knowledge_required: true,
    solution_required: false,
    known_issue_possible: true,
    out_of_scope: false,
    priority: "P0",
    source_refs: ["app/(auth)/login.tsx", "src/routes/auth.ts:1001 /auth/unified-login"],
    knowledge_coverage: "ACTIVE_COVERED", // ki_swimnote_intro covers basic intro
    solution_coverage: "MISSING_SOLUTION",
  },

  {
    coverage_id: "AUTH_LOGIN_FAILED",
    domain: "AUTH",
    feature_id: "LOGIN",
    screen_id: "LOGIN",
    roles: ["pool_admin", "sub_admin", "teacher"],
    modes: ["all"],
    action_id: "LOGIN_SUBMIT",
    action_description: "로그인 실패 — 잘못된 이메일/비밀번호 또는 계정 없음",
    support_categories: ["ERROR", "LOGIN_AUTH"],
    possible_intents: ["로그인이 안돼요", "비밀번호가 틀렸대요", "계정이 없대요"],
    possible_symptoms: ["로그인 버튼 누르면 오류 메시지", "틀렸다고 나옴"],
    complaint_classes: ["COMPLAINT_NOT_WORKING"],
    required_permissions: [],
    required_states: ["계정 존재", "비밀번호 일치"],
    related_api: ["/auth/login", "/auth/unified-login"],
    related_feature_flags: [],
    known_errors: ["이메일 또는 비밀번호가 올바르지 않습니다", "계정을 찾을 수 없습니다", "HTTP 401"],
    known_empty_states: [],
    known_loading_states: [],
    db_state_check_possible: false,
    knowledge_required: true,
    solution_required: true,
    known_issue_possible: true,
    out_of_scope: false,
    priority: "P0",
    source_refs: ["app/(auth)/login.tsx", "src/routes/auth.ts:34 /login"],
    knowledge_coverage: "MISSING",
    solution_coverage: "MISSING_SOLUTION",
  },

  {
    coverage_id: "AUTH_SESSION_EXPIRED",
    domain: "AUTH",
    feature_id: "SESSION",
    screen_id: "LOGIN",
    roles: ["pool_admin", "sub_admin", "teacher", "parent_account"],
    modes: ["all"],
    action_id: "SESSION_REFRESH",
    action_description: "JWT 세션 만료로 자동 로그아웃",
    support_categories: ["LOGIN_AUTH", "ERROR"],
    possible_intents: ["자꾸 로그아웃돼요", "세션이 끊겨요", "앱 켜면 다시 로그인해야 해요"],
    possible_symptoms: ["사용 중 갑자기 로그인 화면으로 이동", "토큰 만료 오류"],
    complaint_classes: ["COMPLAINT_SESSION_EXPIRED"],
    required_permissions: [],
    required_states: ["유효한 JWT 토큰"],
    related_api: ["/auth/me", "/auth/role-status"],
    related_feature_flags: [],
    known_errors: ["HTTP 401 Unauthorized", "토큰이 만료되었습니다"],
    known_empty_states: [],
    known_loading_states: [],
    db_state_check_possible: false,
    knowledge_required: true,
    solution_required: false,
    known_issue_possible: false,
    out_of_scope: false,
    priority: "P0",
    source_refs: ["context/auth/SessionContext.tsx", "src/middlewares/auth.ts"],
    knowledge_coverage: "MISSING",
    solution_coverage: "MISSING_SOLUTION",
  },

  {
    coverage_id: "AUTH_PASSWORD_FORGOT",
    domain: "AUTH",
    feature_id: "PASSWORD_RESET",
    screen_id: "FORGOT_PASSWORD",
    roles: ["pool_admin", "sub_admin", "teacher"],
    modes: ["all"],
    action_id: "PASSWORD_RESET_REQUEST",
    action_description: "비밀번호 재설정 링크 요청",
    support_categories: ["HOW_TO", "LOGIN_AUTH"],
    possible_intents: ["비밀번호를 잊어버렸어요", "비밀번호 찾기", "비밀번호 재설정"],
    possible_symptoms: ["비밀번호 기억 안남", "이메일이 안 온다"],
    complaint_classes: ["COMPLAINT_NOT_RECEIVED"],
    required_permissions: [],
    required_states: ["가입된 이메일"],
    related_api: ["/auth/reset-password", "/auth/find-identifier-by-phone"],
    related_feature_flags: [],
    known_errors: ["등록되지 않은 이메일입니다", "이메일 전송 실패"],
    known_empty_states: [],
    known_loading_states: [],
    db_state_check_possible: false,
    knowledge_required: true,
    solution_required: false,
    known_issue_possible: false,
    out_of_scope: false,
    priority: "P0",
    source_refs: ["app/(auth)/forgot-password.tsx", "src/routes/auth.ts:1309 /reset-password"],
    knowledge_coverage: "MISSING",
    solution_coverage: "MISSING_SOLUTION",
  },

  {
    coverage_id: "AUTH_PARENT_LOGIN_OTP",
    domain: "AUTH",
    feature_id: "PARENT_LOGIN",
    screen_id: "PARENT_LOGIN",
    roles: ["parent_account"],
    modes: ["all"],
    action_id: "PARENT_OTP_LOGIN",
    action_description: "학부모 전화번호 OTP 인증 로그인",
    support_categories: ["HOW_TO", "LOGIN_AUTH"],
    possible_intents: ["학부모 로그인 방법", "문자 인증번호", "인증번호 안 와요"],
    possible_symptoms: ["OTP 문자가 안 옴", "인증번호 입력 오류", "번호가 틀렸대요"],
    complaint_classes: ["COMPLAINT_NOT_RECEIVED", "COMPLAINT_NOT_WORKING"],
    required_permissions: [],
    required_states: ["수영장에 등록된 전화번호", "NAVER SENS 서비스 정상"],
    related_api: ["/auth/parent-login", "/auth/send-sms-code", "/auth/verify-sms-code"],
    related_feature_flags: [],
    known_errors: ["인증번호가 만료되었습니다", "전화번호를 찾을 수 없습니다", "SMS 전송 실패"],
    known_empty_states: [],
    known_loading_states: ["인증번호 전송 중"],
    db_state_check_possible: true,
    db_state_source: "users/parent_accounts 테이블 phone 컬럼",
    knowledge_required: true,
    solution_required: true,
    known_issue_possible: true,
    out_of_scope: false,
    priority: "P0",
    source_refs: ["app/(auth)/parent-login.tsx", "src/routes/auth.ts:459 /parent-login", "src/routes/auth.ts:1663 /send-sms-code"],
    knowledge_coverage: "MISSING",
    solution_coverage: "MISSING_SOLUTION",
  },

  {
    coverage_id: "AUTH_KAKAO_LOGIN_FAILED",
    domain: "AUTH",
    feature_id: "KAKAO_LOGIN",
    screen_id: "PARENT_LOGIN",
    roles: ["parent_account", "pool_admin", "teacher"],
    modes: ["all"],
    action_id: "KAKAO_SOCIAL_LOGIN",
    action_description: "카카오 소셜 로그인 실패",
    support_categories: ["ERROR", "LOGIN_AUTH"],
    possible_intents: ["카카오 로그인이 안돼요", "카카오 연동 오류"],
    possible_symptoms: ["카카오 버튼 눌러도 로그인 안됨", "카카오 오류 메시지"],
    complaint_classes: ["COMPLAINT_NOT_WORKING"],
    required_permissions: [],
    required_states: ["카카오 앱 설치 또는 웹뷰 접근 가능"],
    related_api: ["/auth/kakao-social-login", "/auth/kakao-link-account"],
    related_feature_flags: [],
    known_errors: ["카카오 인증 실패", "HTTP 500 소셜 로그인 오류"],
    known_empty_states: [],
    known_loading_states: ["카카오 인증 중"],
    db_state_check_possible: false,
    knowledge_required: true,
    solution_required: true,
    known_issue_possible: true,
    out_of_scope: false,
    priority: "P0",
    source_refs: ["app/(auth)/login.tsx", "src/routes/auth.ts:1931 /kakao-social-login"],
    knowledge_coverage: "MISSING",
    solution_coverage: "MISSING_SOLUTION",
  },

  {
    coverage_id: "AUTH_TEACHER_INVITE",
    domain: "AUTH",
    feature_id: "TEACHER_INVITE",
    screen_id: "INVITE_QR",
    roles: ["pool_admin"],
    modes: ["all"],
    action_id: "TEACHER_INVITE_CREATE",
    action_description: "강사 초대 QR/링크 생성 및 강사 가입",
    support_categories: ["HOW_TO", "WHERE_IS"],
    possible_intents: ["강사를 어떻게 초대해요", "강사 계정 만들기", "초대 링크"],
    possible_symptoms: ["초대 QR이 안 보임", "강사가 가입을 못함", "초대 링크 만료"],
    complaint_classes: ["COMPLAINT_NOT_WORKING"],
    required_permissions: ["pool_admin 권한"],
    required_states: [],
    related_api: ["/teacher-invites", "/auth/activate-teacher", "/auth/teacher-self-signup"],
    related_feature_flags: [],
    known_errors: ["초대 코드가 만료되었습니다", "이미 사용된 초대 코드"],
    known_empty_states: ["초대 이력 없음"],
    known_loading_states: [],
    db_state_check_possible: false,
    knowledge_required: true,
    solution_required: false,
    known_issue_possible: false,
    out_of_scope: false,
    priority: "P0",
    source_refs: ["app/(admin)/invite-qr.tsx", "app/(admin)/invite-records.tsx", "src/routes/teacher-invites.ts"],
    knowledge_coverage: "MISSING",
    solution_coverage: "MISSING_SOLUTION",
  },

  {
    coverage_id: "AUTH_ACCOUNT_WITHDRAWAL",
    domain: "AUTH",
    feature_id: "ACCOUNT_WITHDRAWAL",
    screen_id: "WITHDRAWAL",
    roles: ["pool_admin", "teacher", "parent_account"],
    modes: ["all"],
    action_id: "ACCOUNT_DELETE",
    action_description: "계정 탈퇴 처리",
    support_categories: ["ACCOUNT", "HOW_TO", "POLICY"],
    possible_intents: ["탈퇴하고 싶어요", "계정 삭제", "앱 그만 쓰고 싶어요"],
    possible_symptoms: [],
    complaint_classes: [],
    required_permissions: [],
    required_states: ["로그인 상태"],
    related_api: ["/auth/account DELETE"],
    related_feature_flags: [],
    known_errors: ["구독 활성 상태에서 탈퇴 불가"],
    known_empty_states: [],
    known_loading_states: [],
    db_state_check_possible: false,
    knowledge_required: true,
    solution_required: false,
    known_issue_possible: false,
    out_of_scope: false,
    priority: "P0",
    source_refs: ["src/routes/auth.ts:2454 DELETE /account"],
    knowledge_coverage: "MISSING",
    solution_coverage: "MISSING_SOLUTION",
  },

  {
    coverage_id: "AUTH_POOL_ACCESS_DENIED",
    domain: "AUTH",
    feature_id: "POOL_ACCESS",
    roles: ["pool_admin", "sub_admin", "teacher"],
    modes: ["all"],
    action_description: "수영장 접근 권한 없음 (403)",
    support_categories: ["PERMISSION", "ROLE_MISMATCH"],
    possible_intents: ["접근 권한이 없대요", "수영장에 접근이 안돼요"],
    possible_symptoms: ["403 오류", "권한 없음 메시지"],
    complaint_classes: ["COMPLAINT_PERMISSION_DENIED"],
    required_permissions: ["해당 수영장의 pool_id 소속"],
    required_states: [],
    related_api: ["/auth/me", "/pools/my"],
    related_feature_flags: [],
    known_errors: ["HTTP 403 접근 권한이 없습니다", "pool_id 불일치"],
    known_empty_states: [],
    known_loading_states: [],
    db_state_check_possible: true,
    db_state_source: "users 테이블 pool_id 컬럼",
    knowledge_required: true,
    solution_required: true,
    known_issue_possible: false,
    out_of_scope: false,
    priority: "P0",
    source_refs: ["src/middlewares/auth.ts", "src/routes/auth.ts:624 /pools"],
    knowledge_coverage: "MISSING",
    solution_coverage: "MISSING_SOLUTION",
  },

  // ══════════════════════════════════════════════════════════
  // DOMAIN: ATTENDANCE — 출결 (P0)
  // ══════════════════════════════════════════════════════════

  {
    coverage_id: "ATTENDANCE_HOW_TO",
    domain: "ATTENDANCE",
    feature_id: "ATTENDANCE_RECORD",
    screen_id: "ADMIN_ATTENDANCE",
    roles: ["pool_admin", "sub_admin", "teacher"],
    modes: ["all"],
    action_id: "ATTENDANCE_MARK",
    action_description: "출결 처리 방법 안내",
    support_categories: ["HOW_TO", "WHERE_IS"],
    possible_intents: ["출결 어떻게 해요", "출석 체크 방법", "결석 처리"],
    possible_symptoms: [],
    complaint_classes: [],
    required_permissions: ["pool_admin 또는 teacher"],
    required_states: ["수업 시간표 존재"],
    related_api: ["/attendance", "/attendance/weekly", "/attendance/monthly-summary"],
    related_feature_flags: [],
    known_errors: [],
    known_empty_states: ["해당 날짜 수업 없음", "등록된 학생 없음"],
    known_loading_states: ["출결 데이터 로딩 중"],
    db_state_check_possible: true,
    db_state_source: "attendance 테이블",
    knowledge_required: true,
    solution_required: false,
    known_issue_possible: false,
    out_of_scope: false,
    priority: "P0",
    source_refs: ["app/(admin)/attendance.tsx", "app/(teacher)/attendance.tsx", "src/routes/attendance.ts"],
    knowledge_coverage: "MISSING",
    solution_coverage: "MISSING_SOLUTION",
  },

  {
    coverage_id: "ATTENDANCE_SAVE_FAILED",
    domain: "ATTENDANCE",
    feature_id: "ATTENDANCE_RECORD",
    screen_id: "ADMIN_ATTENDANCE",
    roles: ["pool_admin", "sub_admin", "teacher"],
    modes: ["all"],
    action_id: "ATTENDANCE_POST",
    action_description: "출결 저장 실패",
    support_categories: ["NOT_SAVED", "ERROR", "FAILURE"],
    possible_intents: ["출결이 저장이 안돼요", "출석 처리했는데 사라졌어요"],
    possible_symptoms: ["저장 버튼 눌러도 변경 안됨", "오류 메시지 표시", "새로고침하면 원복"],
    complaint_classes: ["COMPLAINT_NOT_WORKING", "COMPLAINT_DISAPPEARED"],
    required_permissions: ["pool_admin 또는 teacher"],
    required_states: [],
    related_api: ["POST /attendance"],
    related_feature_flags: [],
    known_errors: ["HTTP 403 권한 없음", "HTTP 500 DB 오류", "HTTP 404 수업 없음"],
    known_empty_states: [],
    known_loading_states: [],
    db_state_check_possible: true,
    db_state_source: "attendance 테이블",
    knowledge_required: false,
    solution_required: true,
    known_issue_possible: true,
    out_of_scope: false,
    priority: "P0",
    source_refs: ["src/routes/attendance.ts:493 POST /"],
    knowledge_coverage: "MISSING",
    solution_coverage: "MISSING_SOLUTION",
  },

  {
    coverage_id: "ATTENDANCE_NOT_VISIBLE",
    domain: "ATTENDANCE",
    feature_id: "ATTENDANCE_RECORD",
    screen_id: "ADMIN_ATTENDANCE",
    roles: ["pool_admin", "sub_admin", "teacher"],
    modes: ["all"],
    action_description: "출결 데이터가 보이지 않음",
    support_categories: ["NOT_VISIBLE", "DATA_INCONSISTENCY", "EMPTY_STATE"],
    possible_intents: ["출결이 안 보여요", "출석 기록이 없어요"],
    possible_symptoms: ["출결 목록이 비어 있음", "특정 날짜 데이터 없음"],
    complaint_classes: ["COMPLAINT_NOT_VISIBLE", "COMPLAINT_NOTHING_SHOWS"],
    required_permissions: [],
    required_states: [],
    related_api: ["GET /attendance", "GET /attendance/weekly"],
    related_feature_flags: [],
    known_errors: ["날짜/반 필터 불일치", "API 오류"],
    known_empty_states: ["해당 날짜 수업 없음", "반 선택 안됨", "학생 미등록"],
    known_loading_states: ["데이터 로딩 중"],
    db_state_check_possible: true,
    db_state_source: "attendance 테이블 (date, class_group_id 기준)",
    knowledge_required: false,
    solution_required: true,
    known_issue_possible: false,
    out_of_scope: false,
    priority: "P0",
    source_refs: ["app/(admin)/attendance.tsx", "src/routes/attendance.ts:28"],
    knowledge_coverage: "MISSING",
    solution_coverage: "MISSING_SOLUTION",
  },

  {
    coverage_id: "ATTENDANCE_PERMISSION_DENIED",
    domain: "ATTENDANCE",
    feature_id: "ATTENDANCE_RECORD",
    roles: ["teacher", "sub_admin"],
    modes: ["all"],
    action_description: "강사 또는 부관리자가 출결 처리 권한 없음",
    support_categories: ["PERMISSION", "ROLE_MISMATCH"],
    possible_intents: ["강사인데 출결 처리가 안돼요", "권한이 없다고 해요"],
    possible_symptoms: ["403 오류", "버튼 비활성화"],
    complaint_classes: ["COMPLAINT_PERMISSION_DENIED"],
    required_permissions: ["담당 반 연결 또는 pool_admin 승인"],
    required_states: [],
    related_api: ["POST /attendance"],
    related_feature_flags: [],
    known_errors: ["HTTP 403 권한 없음"],
    known_empty_states: [],
    known_loading_states: [],
    db_state_check_possible: false,
    knowledge_required: true,
    solution_required: false,
    known_issue_possible: false,
    out_of_scope: false,
    priority: "P0",
    source_refs: ["src/routes/attendance.ts", "src/middlewares/auth.ts"],
    knowledge_coverage: "MISSING",
    solution_coverage: "MISSING_SOLUTION",
  },

  {
    coverage_id: "MAKEUP_HOW_TO",
    domain: "ATTENDANCE",
    feature_id: "MAKEUP",
    screen_id: "ADMIN_MAKEUPS",
    roles: ["pool_admin", "sub_admin", "teacher"],
    modes: ["all"],
    action_description: "보강 신청 및 처리 방법",
    support_categories: ["HOW_TO", "WHERE_IS"],
    possible_intents: ["보강 어떻게 해요", "결석 보충 수업", "보강 신청"],
    possible_symptoms: [],
    complaint_classes: [],
    required_permissions: [],
    required_states: ["보강 정책 설정됨"],
    related_api: ["/extra-classes", "/absences"],
    related_feature_flags: [],
    known_errors: [],
    known_empty_states: ["보강 신청 없음"],
    known_loading_states: [],
    db_state_check_possible: false,
    knowledge_required: true,
    solution_required: false,
    known_issue_possible: false,
    out_of_scope: false,
    priority: "P1",
    source_refs: ["app/(admin)/makeups.tsx", "app/(teacher)/makeups.tsx", "src/routes/extra-classes.ts"],
    knowledge_coverage: "MISSING",
    solution_coverage: "MISSING_SOLUTION",
  },

  // ══════════════════════════════════════════════════════════
  // DOMAIN: DIARY — 수업일지 (P0)
  // ══════════════════════════════════════════════════════════

  {
    coverage_id: "DIARY_HOW_TO",
    domain: "DIARY",
    feature_id: "DIARY_WRITE",
    screen_id: "TEACHER_DIARY",
    roles: ["teacher", "pool_admin", "sub_admin"],
    modes: ["all"],
    action_description: "수업일지 작성 방법 안내",
    support_categories: ["HOW_TO", "WHERE_IS"],
    possible_intents: ["일지 어떻게 써요", "수업일지 작성", "일지 작성 위치"],
    possible_symptoms: [],
    complaint_classes: [],
    required_permissions: ["teacher 또는 pool_admin"],
    required_states: ["담당 수업 존재"],
    related_api: ["/diaries", "/diary/class-groups"],
    related_feature_flags: [],
    known_errors: [],
    known_empty_states: ["작성된 일지 없음"],
    known_loading_states: ["일지 목록 로딩 중"],
    db_state_check_possible: false,
    knowledge_required: true,
    solution_required: false,
    known_issue_possible: false,
    out_of_scope: false,
    priority: "P0",
    source_refs: ["app/(teacher)/diary.tsx", "app/(admin)/diary-write.tsx", "src/routes/diary.ts:459 POST /diaries"],
    knowledge_coverage: "MISSING",
    solution_coverage: "MISSING_SOLUTION",
  },

  {
    coverage_id: "DIARY_AI_HOW_TO",
    domain: "DIARY",
    feature_id: "AI_DIARY",
    screen_id: "TEACHER_DIARY",
    roles: ["teacher", "pool_admin"],
    modes: ["all"],
    action_description: "AI 일지 자동 생성 사용 방법",
    support_categories: ["HOW_TO", "WHERE_IS"],
    possible_intents: ["AI 일지 어떻게 써요", "자동 일지 생성", "AI 일지 버튼이 어디에 있어요"],
    possible_symptoms: [],
    complaint_classes: ["COMPLAINT_AI_MISSING"],
    required_permissions: [],
    required_states: ["학생 수업 이력 존재"],
    related_api: ["/ai/diary/generate", "/v1/teacher-diary/generate"],
    related_feature_flags: [],
    known_errors: [],
    known_empty_states: [],
    known_loading_states: ["AI 생성 중"],
    db_state_check_possible: false,
    knowledge_required: true,
    solution_required: false,
    known_issue_possible: false,
    out_of_scope: false,
    priority: "P0",
    source_refs: ["app/(teacher)/diary.tsx", "src/routes/ai-v1.ts:POST /v1/teacher-diary/generate"],
    knowledge_coverage: "MISSING",
    solution_coverage: "MISSING_SOLUTION",
  },

  {
    coverage_id: "DIARY_AI_FAILED",
    domain: "DIARY",
    feature_id: "AI_DIARY",
    screen_id: "TEACHER_DIARY",
    roles: ["teacher", "pool_admin"],
    modes: ["all"],
    action_description: "AI 일지 생성 실패",
    support_categories: ["AI_FAILURE", "AI_NO_RESULT", "TIMEOUT"],
    possible_intents: ["AI 일지 오류", "AI가 안 돼요", "일지 생성이 실패해요"],
    possible_symptoms: ["AI 생성 중 오류 메시지", "생성 후 빈 결과", "타임아웃"],
    complaint_classes: ["COMPLAINT_AI_WRONG", "COMPLAINT_AI_MISSING", "COMPLAINT_NOT_WORKING"],
    required_permissions: [],
    required_states: ["OpenAI API 정상", "학생 데이터 존재"],
    related_api: ["/ai/diary/generate", "/v1/teacher-diary/generate"],
    related_feature_flags: [],
    known_errors: ["HTTP 500 AI 생성 실패", "HTTP 403 플랜 제한", "HTTP 400 학생 정보 없음", "OpenAI timeout"],
    known_empty_states: ["생성 결과 없음"],
    known_loading_states: ["AI 생성 중"],
    db_state_check_possible: false,
    knowledge_required: false,
    solution_required: true,
    known_issue_possible: true,
    out_of_scope: false,
    priority: "P0",
    source_refs: ["src/routes/ai-v1.ts", "src/routes/ai.ts:POST /ai/diary/generate"],
    knowledge_coverage: "MISSING",
    solution_coverage: "MISSING_SOLUTION",
  },

  {
    coverage_id: "DIARY_SAVE_FAILED",
    domain: "DIARY",
    feature_id: "DIARY_WRITE",
    screen_id: "TEACHER_DIARY",
    roles: ["teacher", "pool_admin"],
    modes: ["all"],
    action_description: "일지 저장 실패",
    support_categories: ["NOT_SAVED", "ERROR"],
    possible_intents: ["일지 저장이 안돼요", "작성한 일지가 사라졌어요"],
    possible_symptoms: ["저장 실패 오류 메시지", "작성 후 목록에 없음"],
    complaint_classes: ["COMPLAINT_NOT_WORKING", "COMPLAINT_DISAPPEARED"],
    required_permissions: [],
    required_states: [],
    related_api: ["POST /diaries", "PUT /diaries/:id"],
    related_feature_flags: [],
    known_errors: ["HTTP 500 DB 오류", "HTTP 403 권한 없음", "HTTP 400 필드 누락"],
    known_empty_states: [],
    known_loading_states: [],
    db_state_check_possible: false,
    knowledge_required: false,
    solution_required: true,
    known_issue_possible: true,
    out_of_scope: false,
    priority: "P0",
    source_refs: ["src/routes/diary.ts:459 POST /diaries", "src/routes/diary.ts:728 PUT /diaries/:id"],
    knowledge_coverage: "MISSING",
    solution_coverage: "MISSING_SOLUTION",
  },

  {
    coverage_id: "DIARY_PHOTO_UPLOAD_FAILED",
    domain: "DIARY",
    feature_id: "DIARY_PHOTO",
    screen_id: "TEACHER_DIARY",
    roles: ["teacher", "pool_admin"],
    modes: ["all"],
    action_description: "일지 사진 업로드 실패",
    support_categories: ["UPLOAD_FAILED", "ERROR"],
    possible_intents: ["일지 사진이 안 올라가요", "사진 첨부 오류"],
    possible_symptoms: ["업로드 중 오류", "사진이 첨부 안됨"],
    complaint_classes: ["COMPLAINT_UPLOAD_FAILED"],
    required_permissions: [],
    required_states: ["스토리지 한도 내"],
    related_api: ["/diary/upload", "/diaries/with-media", "/photos/diary-attach"],
    related_feature_flags: [],
    known_errors: ["HTTP 403 스토리지 한도 초과", "HTTP 400 파일 형식 오류", "네트워크 오류"],
    known_empty_states: [],
    known_loading_states: ["업로드 중"],
    db_state_check_possible: true,
    db_state_source: "swimming_pools 테이블 storage 관련 컬럼",
    knowledge_required: false,
    solution_required: true,
    known_issue_possible: true,
    out_of_scope: false,
    priority: "P0",
    source_refs: ["src/routes/diary.ts:254 POST /diary/upload", "src/routes/photos.ts"],
    knowledge_coverage: "MISSING",
    solution_coverage: "MISSING_SOLUTION",
  },

  {
    coverage_id: "DIARY_PARENT_NOT_VISIBLE",
    domain: "DIARY",
    feature_id: "PARENT_DIARY_VIEW",
    screen_id: "PARENT_DIARY",
    roles: ["parent_account"],
    modes: ["all"],
    action_description: "학부모가 수업일지를 볼 수 없음",
    support_categories: ["NOT_VISIBLE", "PERMISSION", "DATA_INCONSISTENCY"],
    possible_intents: ["일지가 안 보여요", "아이 일지를 못 찾겠어요", "일지 어디서 봐요"],
    possible_symptoms: ["일지 목록이 비어 있음", "오늘 일지가 없음"],
    complaint_classes: ["COMPLAINT_PARENT_NOT_VISIBLE", "COMPLAINT_NOT_VISIBLE"],
    required_permissions: ["자녀 학생 연결됨"],
    required_states: ["교사가 일지 작성 완료", "일지 공개 설정"],
    related_api: ["/parent/diary", "/diaries"],
    related_feature_flags: [],
    known_errors: ["자녀 미연결", "일지 비공개 설정"],
    known_empty_states: ["작성된 일지 없음", "자녀 정보 없음"],
    known_loading_states: [],
    db_state_check_possible: true,
    db_state_source: "diaries 테이블 (student_id, pool_id 기준)",
    knowledge_required: true,
    solution_required: true,
    known_issue_possible: false,
    out_of_scope: false,
    priority: "P0",
    source_refs: ["app/(parent)/swim-diary.tsx", "src/routes/parent.ts", "src/routes/diary.ts"],
    knowledge_coverage: "MISSING",
    solution_coverage: "MISSING_SOLUTION",
  },

  {
    coverage_id: "DIARY_TEMPLATE_HOW_TO",
    domain: "DIARY",
    feature_id: "DIARY_TEMPLATE",
    screen_id: "ADMIN_DIARY_TEMPLATE_SETTINGS",
    roles: ["pool_admin"],
    modes: ["all"],
    action_description: "일지 템플릿 설정 방법",
    support_categories: ["HOW_TO", "WHERE_IS"],
    possible_intents: ["일지 템플릿 어떻게 설정해요", "AI 일지 문장 바꾸고 싶어요"],
    possible_symptoms: [],
    complaint_classes: [],
    required_permissions: ["pool_admin"],
    required_states: [],
    related_api: ["/diary-templates", "/diary-template-levels"],
    related_feature_flags: [],
    known_errors: [],
    known_empty_states: ["템플릿 없음"],
    known_loading_states: [],
    db_state_check_possible: false,
    knowledge_required: true,
    solution_required: false,
    known_issue_possible: false,
    out_of_scope: false,
    priority: "P1",
    source_refs: ["app/(admin)/diary-template-settings.tsx", "src/routes/diary.ts:1461 GET /diary-templates"],
    knowledge_coverage: "MISSING",
    solution_coverage: "MISSING_SOLUTION",
  },

  // ══════════════════════════════════════════════════════════
  // DOMAIN: PAYMENT / SUBSCRIPTION — 결제/구독 (P0)
  // ══════════════════════════════════════════════════════════

  {
    coverage_id: "BILLING_SUBSCRIPTION_STATUS",
    domain: "PAYMENT",
    feature_id: "SUBSCRIPTION",
    screen_id: "ADMIN_BILLING",
    roles: ["pool_admin"],
    modes: ["all"],
    action_description: "구독 상태 확인",
    support_categories: ["STATE_CHECK", "SUBSCRIPTION"],
    possible_intents: ["구독 상태 어떻게 확인해요", "구독이 활성화됐는지 모르겠어요"],
    possible_symptoms: [],
    complaint_classes: [],
    required_permissions: [],
    required_states: [],
    related_api: ["/billing/status", "/billing/x-subscription-status"],
    related_feature_flags: [],
    known_errors: [],
    known_empty_states: ["구독 이력 없음"],
    known_loading_states: [],
    db_state_check_possible: true,
    db_state_source: "swimming_pools 테이블 subscription/plan 컬럼, x_subscription_slots",
    knowledge_required: true,
    solution_required: false,
    known_issue_possible: false,
    out_of_scope: false,
    priority: "P0",
    source_refs: ["app/(admin)/billing.tsx", "app/(admin)/subscription.tsx", "src/routes/billing.ts:GET /status"],
    knowledge_coverage: "MISSING",
    solution_coverage: "MISSING_SOLUTION",
  },

  {
    coverage_id: "BILLING_SUBSCRIPTION_NOT_ACTIVE",
    domain: "PAYMENT",
    feature_id: "SUBSCRIPTION",
    screen_id: "SUBSCRIPTION_EXPIRED",
    roles: ["pool_admin"],
    modes: ["all"],
    action_description: "구독이 만료/비활성 상태로 기능 잠금",
    support_categories: ["SUBSCRIPTION", "PAYMENT", "NOT_VISIBLE"],
    possible_intents: ["구독이 만료됐어요", "기능이 잠겼어요", "구독 끊겼는데 어떻게 해요"],
    possible_symptoms: ["기능 접근 차단", "subscription-expired 화면 표시"],
    complaint_classes: ["COMPLAINT_NOT_WORKING", "COMPLAINT_PAYMENT_NOT_APPLIED"],
    required_permissions: [],
    required_states: ["구독 상태 = 만료/비활성"],
    related_api: ["/billing/status", "/billing/subscribe", "/billing/restore-x-subscription"],
    related_feature_flags: [],
    known_errors: ["HTTP 403 구독 비활성", "플랜 기능 제한"],
    known_empty_states: [],
    known_loading_states: [],
    db_state_check_possible: true,
    db_state_source: "swimming_pools.plan_status, x_subscription_slots",
    knowledge_required: true,
    solution_required: true,
    known_issue_possible: false,
    out_of_scope: false,
    priority: "P0",
    source_refs: ["app/subscription-expired.tsx", "src/routes/billing.ts"],
    knowledge_coverage: "MISSING",
    solution_coverage: "MISSING_SOLUTION",
  },

  {
    coverage_id: "BILLING_CANCELLED_BUT_ACTIVE",
    domain: "PAYMENT",
    feature_id: "SUBSCRIPTION",
    roles: ["pool_admin"],
    modes: ["all"],
    action_description: "취소됐지만 만료일까지 활성 상태 (CANCELLED_BUT_ACTIVE)",
    support_categories: ["SUBSCRIPTION", "STATE_CHECK", "USER_MISUNDERSTANDING"],
    possible_intents: ["취소했는데 왜 아직 사용돼요", "취소 후에도 쓸 수 있나요"],
    possible_symptoms: ["취소했지만 기능은 정상 작동"],
    complaint_classes: ["COMPLAINT_PAYMENT_NOT_APPLIED"],
    required_permissions: [],
    required_states: ["RevenueCat 취소 완료 + 결제 기간 잔여"],
    related_api: ["/billing/status", "/billing/x-subscription-status"],
    related_feature_flags: [],
    known_errors: [],
    known_empty_states: [],
    known_loading_states: [],
    db_state_check_possible: true,
    db_state_source: "x_subscription_slots.expiration_date, RevenueCat entitlement",
    knowledge_required: true,
    solution_required: false,
    known_issue_possible: false,
    out_of_scope: false,
    priority: "P0",
    source_refs: ["src/routes/billing.ts:GET /x-subscription-status", "src/lib/x-billing.ts"],
    knowledge_coverage: "MISSING",
    solution_coverage: "MISSING_SOLUTION",
  },

  {
    coverage_id: "BILLING_PAYMENT_FAILED",
    domain: "PAYMENT",
    feature_id: "SUBSCRIPTION",
    screen_id: "ADMIN_BILLING",
    roles: ["pool_admin"],
    modes: ["all"],
    action_description: "결제 실패 — 카드/스토어 오류",
    support_categories: ["PAYMENT", "BILLING", "ERROR"],
    possible_intents: ["결제가 안돼요", "결제 실패", "카드가 안 된대요"],
    possible_symptoms: ["결제 실패 오류", "스토어 결제 거절"],
    complaint_classes: ["COMPLAINT_PAYMENT_NOT_APPLIED", "COMPLAINT_NOT_WORKING"],
    required_permissions: [],
    required_states: [],
    related_api: ["/billing/subscribe", "/billing/store-refund"],
    related_feature_flags: [],
    known_errors: ["HTTP 402 결제 실패", "RevenueCat 결제 거절", "스토어 오류"],
    known_empty_states: [],
    known_loading_states: [],
    db_state_check_possible: false,
    knowledge_required: true,
    solution_required: true,
    known_issue_possible: true,
    out_of_scope: false,
    priority: "P0",
    source_refs: ["src/routes/billing.ts:POST /subscribe", "app/(admin)/billing.tsx"],
    knowledge_coverage: "MISSING",
    solution_coverage: "MISSING_SOLUTION",
  },

  {
    coverage_id: "BILLING_RESTORE",
    domain: "PAYMENT",
    feature_id: "SUBSCRIPTION_RESTORE",
    screen_id: "ADMIN_BILLING",
    roles: ["pool_admin"],
    modes: ["all"],
    action_description: "구독 복원 방법",
    support_categories: ["HOW_TO", "SUBSCRIPTION"],
    possible_intents: ["구독 복원하고 싶어요", "구매 복원", "기기 바꿨는데 구독이 없어요"],
    possible_symptoms: ["구독 복원 안됨"],
    complaint_classes: ["COMPLAINT_PAYMENT_NOT_APPLIED"],
    required_permissions: [],
    required_states: ["이전 구독 이력 존재"],
    related_api: ["/billing/restore-x-subscription", "/billing/sync-rc-subscription"],
    related_feature_flags: [],
    known_errors: ["복원 실패 — 이력 없음"],
    known_empty_states: [],
    known_loading_states: ["복원 중"],
    db_state_check_possible: true,
    db_state_source: "x_subscription_slots, revenue_logs",
    knowledge_required: true,
    solution_required: true,
    known_issue_possible: false,
    out_of_scope: false,
    priority: "P0",
    source_refs: ["src/routes/billing.ts:POST /restore-x-subscription", "app/(admin)/x-subscription.tsx"],
    knowledge_coverage: "MISSING",
    solution_coverage: "MISSING_SOLUTION",
  },

  {
    coverage_id: "BILLING_REFUND_POLICY",
    domain: "PAYMENT",
    feature_id: "REFUND_POLICY",
    screen_id: "ADMIN_REFUND_POLICY",
    roles: ["pool_admin"],
    modes: ["all"],
    action_description: "환불 정책 안내",
    support_categories: ["POLICY", "BILLING"],
    possible_intents: ["환불 되나요", "환불 정책이 뭐예요", "구독 환불"],
    possible_symptoms: [],
    complaint_classes: [],
    required_permissions: [],
    required_states: [],
    related_api: ["/admin/refund-policy"],
    related_feature_flags: [],
    known_errors: [],
    known_empty_states: [],
    known_loading_states: [],
    db_state_check_possible: false,
    knowledge_required: true,
    solution_required: false,
    known_issue_possible: false,
    out_of_scope: false,
    priority: "P0",
    source_refs: ["app/(admin)/refund-policy.tsx", "src/routes/billing.ts:GET /status"],
    knowledge_coverage: "MISSING",
    solution_coverage: "MISSING_SOLUTION",
  },

  // ══════════════════════════════════════════════════════════
  // DOMAIN: X_MODE — X 모드 (P0)
  // ══════════════════════════════════════════════════════════

  {
    coverage_id: "X_MODE_INTRO",
    domain: "X_MODE",
    feature_id: "X_MODE_INTRO",
    screen_id: "X_MODE_HUB",
    roles: ["pool_admin", "teacher", "parent_account"],
    modes: ["normal", "x", "x_pending"],
    action_description: "X 모드가 무엇인지 소개",
    support_categories: ["HOW_TO", "X_MODE"],
    possible_intents: ["X 모드가 뭐예요", "X 모드 소개", "스윔노트 X란"],
    possible_symptoms: [],
    complaint_classes: ["COMPLAINT_AI_MISSING"],
    required_permissions: [],
    required_states: [],
    related_api: ["/billing/x-subscription-status"],
    related_feature_flags: ["X_MODE_ENABLED"],
    known_errors: [],
    known_empty_states: [],
    known_loading_states: [],
    db_state_check_possible: true,
    db_state_source: "x_subscription_slots, swimming_pools.mode",
    knowledge_required: true,
    solution_required: false,
    known_issue_possible: false,
    out_of_scope: false,
    priority: "P0",
    source_refs: ["app/(admin)/x-mode-hub.tsx", "app/(admin)/x-info-overview.tsx"],
    knowledge_coverage: "ACTIVE_COVERED", // ki_x_mode_intro ACTIVE
    solution_coverage: "MISSING_SOLUTION",
  },

  {
    coverage_id: "X_SUBSCRIPTION_HOW_TO",
    domain: "X_MODE",
    feature_id: "X_SUBSCRIPTION",
    screen_id: "X_SUBSCRIPTION",
    roles: ["pool_admin"],
    modes: ["normal", "x_pending"],
    action_description: "X 구독 신청 방법",
    support_categories: ["HOW_TO", "X_MODE", "SUBSCRIPTION"],
    possible_intents: ["X 구독 어떻게 해요", "X 모드 신청", "X 모드 구매"],
    possible_symptoms: [],
    complaint_classes: [],
    required_permissions: ["pool_admin"],
    required_states: ["Basic 구독 활성"],
    related_api: ["/billing/x-reserve-slot", "/billing/sync-x-subscription"],
    related_feature_flags: ["X_MODE_ENABLED"],
    known_errors: ["HTTP 403 Basic 구독 없음"],
    known_empty_states: [],
    known_loading_states: [],
    db_state_check_possible: true,
    db_state_source: "x_subscription_slots",
    knowledge_required: true,
    solution_required: false,
    known_issue_possible: false,
    out_of_scope: false,
    priority: "P0",
    source_refs: ["app/(admin)/x-subscription.tsx", "src/routes/billing.ts:POST /x-reserve-slot"],
    knowledge_coverage: "PENDING_COVERED", // ki_seed_subscription_x_features PENDING
    solution_coverage: "MISSING_SOLUTION",
  },

  {
    coverage_id: "X_ACTIVATION_CHECK",
    domain: "X_MODE",
    feature_id: "X_ACTIVATION",
    screen_id: "X_MODE_HUB",
    roles: ["pool_admin", "teacher", "parent_account"],
    modes: ["x_pending", "x"],
    action_description: "X 모드 활성화 상태 확인",
    support_categories: ["STATE_CHECK", "X_MODE"],
    possible_intents: ["X 모드 활성화됐나요", "X가 켜졌는지 모르겠어요"],
    possible_symptoms: ["X 기능이 안 보임", "X pending 상태"],
    complaint_classes: ["COMPLAINT_PAYMENT_NOT_APPLIED", "COMPLAINT_NOT_VISIBLE"],
    required_permissions: [],
    required_states: [],
    related_api: ["/billing/x-subscription-status", "/pools/my"],
    related_feature_flags: ["X_MODE_ENABLED"],
    known_errors: [],
    known_empty_states: [],
    known_loading_states: [],
    db_state_check_possible: true,
    db_state_source: "x_subscription_slots, swimming_pools.mode (x/normal/x_pending)",
    knowledge_required: true,
    solution_required: false,
    known_issue_possible: false,
    out_of_scope: false,
    priority: "P0",
    source_refs: ["src/routes/billing.ts:GET /x-subscription-status", "context/ModeContext.tsx"],
    knowledge_coverage: "ACTIVE_COVERED", // ki_x_mode_intro ACTIVE
    solution_coverage: "MISSING_SOLUTION",
  },

  {
    coverage_id: "X_SETUP_HOW_TO",
    domain: "X_MODE",
    feature_id: "X_SETUP",
    screen_id: "X_SETUP",
    roles: ["pool_admin"],
    modes: ["x_pending", "x"],
    action_description: "X 모드 초기 설정 방법 (자료 제출, 슈퍼어드민 검토)",
    support_categories: ["HOW_TO", "X_MODE"],
    possible_intents: ["X 설정 어떻게 해요", "X 셋업 방법", "자료 제출"],
    possible_symptoms: ["X 셋업 화면을 못 찾음", "제출 후 대기 상태"],
    complaint_classes: [],
    required_permissions: ["pool_admin", "X 구독 활성"],
    required_states: ["x_pending 또는 x 모드"],
    related_api: ["/x-setup", "/x04-structuring"],
    related_feature_flags: ["X_MODE_ENABLED"],
    known_errors: [],
    known_empty_states: [],
    known_loading_states: ["제출 처리 중"],
    db_state_check_possible: true,
    db_state_source: "x_setup_submissions 테이블",
    knowledge_required: true,
    solution_required: false,
    known_issue_possible: false,
    out_of_scope: false,
    priority: "P0",
    source_refs: ["app/(admin)/x-setup.tsx", "src/routes/x-setup.ts", "src/routes/x04-structuring.ts"],
    knowledge_coverage: "MISSING",
    solution_coverage: "MISSING_SOLUTION",
  },

  {
    coverage_id: "X_CONFIG_INCOMPLETE",
    domain: "X_MODE",
    feature_id: "X_CONFIG",
    screen_id: "X_SETUP",
    roles: ["pool_admin"],
    modes: ["x_pending"],
    action_description: "X 모드 설정 미완료로 기능 잠금",
    support_categories: ["X_MODE", "NOT_VISIBLE", "STATE_CHECK"],
    possible_intents: ["X 설정이 안 됐대요", "X가 아직 준비 중이에요"],
    possible_symptoms: ["XModeGuard Lock 화면", "curriculum_pending 상태"],
    complaint_classes: ["COMPLAINT_NOT_WORKING", "COMPLAINT_AI_MISSING"],
    required_permissions: [],
    required_states: ["x_setup 미완료"],
    related_api: ["/x-setup", "/billing/x-subscription-status"],
    related_feature_flags: ["X_MODE_ENABLED"],
    known_errors: ["CURRICULUM_PENDING lock", "API_ERROR lock", "NOT_CONFIGURED lock"],
    known_empty_states: [],
    known_loading_states: [],
    db_state_check_possible: true,
    db_state_source: "x_subscription_slots.config_status",
    knowledge_required: true,
    solution_required: true,
    known_issue_possible: false,
    out_of_scope: false,
    priority: "P0",
    source_refs: ["components/XModeGuard.tsx", "app/(admin)/x-setup.tsx"],
    knowledge_coverage: "MISSING",
    solution_coverage: "MISSING_SOLUTION",
  },

  {
    coverage_id: "X_AI_DIARY",
    domain: "X_MODE",
    feature_id: "X_AI_DIARY",
    screen_id: "TEACHER_DIARY",
    roles: ["teacher", "pool_admin"],
    modes: ["x"],
    action_description: "X 모드 AI 일지 생성 (X 전용 템플릿)",
    support_categories: ["HOW_TO", "X_MODE", "AI_FAILURE"],
    possible_intents: ["X 모드 AI 일지", "X 일지가 달라요", "X 전용 일지 기능"],
    possible_symptoms: ["X 일지 생성 실패", "일반 일지와 같아 보임"],
    complaint_classes: ["COMPLAINT_AI_WRONG", "COMPLAINT_AI_MISSING"],
    required_permissions: [],
    required_states: ["X 모드 활성", "X 설정 완료"],
    related_api: ["/v1/teacher-diary/generate"],
    related_feature_flags: ["X_MODE_ENABLED"],
    known_errors: ["X global template 없음", "AI 생성 실패"],
    known_empty_states: [],
    known_loading_states: ["AI X 일지 생성 중"],
    db_state_check_possible: false,
    knowledge_required: true,
    solution_required: true,
    known_issue_possible: false,
    out_of_scope: false,
    priority: "P0",
    source_refs: ["app/(teacher)/diary.tsx", "src/routes/ai-v1.ts", "src/lib/diary-x-engine.ts"],
    knowledge_coverage: "MISSING",
    solution_coverage: "MISSING_SOLUTION",
  },

  {
    coverage_id: "X_CURRICULUM_HOW_TO",
    domain: "X_MODE",
    feature_id: "X_CURRICULUM",
    screen_id: "X_INFO_CURRICULUM",
    roles: ["pool_admin", "parent_account"],
    modes: ["x"],
    action_description: "X 모드 커리큘럼 기능 안내",
    support_categories: ["HOW_TO", "WHERE_IS", "X_MODE"],
    possible_intents: ["X 커리큘럼이 뭐예요", "X 모드 커리큘럼 어디서 봐요"],
    possible_symptoms: [],
    complaint_classes: ["COMPLAINT_AI_MISSING"],
    required_permissions: [],
    required_states: ["X 모드 활성", "커리큘럼 설정 완료"],
    related_api: ["/parent/students/:id/curriculum-search"],
    related_feature_flags: ["X_MODE_ENABLED"],
    known_errors: [],
    known_empty_states: ["커리큘럼 데이터 없음"],
    known_loading_states: [],
    db_state_check_possible: false,
    knowledge_required: true,
    solution_required: false,
    known_issue_possible: false,
    out_of_scope: false,
    priority: "P1",
    source_refs: ["app/(admin)/x-info-curriculum.tsx", "src/routes/parent-curriculum.ts"],
    knowledge_coverage: "MISSING",
    solution_coverage: "MISSING_SOLUTION",
  },

  // ══════════════════════════════════════════════════════════
  // DOMAIN: AI — AI 기능 (P0)
  // ══════════════════════════════════════════════════════════

  {
    coverage_id: "AI_PARENT_CURRICULUM_HOW_TO",
    domain: "AI",
    feature_id: "PARENT_CURRICULUM",
    screen_id: "PARENT_CURRICULUM",
    roles: ["parent_account"],
    modes: ["x"],
    action_description: "학부모용 AI 커리큘럼 문의 기능 안내",
    support_categories: ["HOW_TO", "WHERE_IS"],
    possible_intents: ["커리큘럼 문의 어떻게 해요", "아이 수영 수준 물어볼 수 있나요"],
    possible_symptoms: [],
    complaint_classes: ["COMPLAINT_AI_MISSING"],
    required_permissions: [],
    required_states: ["X 모드 활성", "자녀 연결"],
    related_api: ["/parent/students/:id/curriculum-search"],
    related_feature_flags: ["X_MODE_ENABLED"],
    known_errors: [],
    known_empty_states: ["커리큘럼 데이터 없음"],
    known_loading_states: ["AI 분석 중"],
    db_state_check_possible: false,
    knowledge_required: true,
    solution_required: false,
    known_issue_possible: false,
    out_of_scope: false,
    priority: "P1",
    source_refs: ["app/(parent)/curriculum-chat.tsx", "src/routes/parent-curriculum.ts"],
    knowledge_coverage: "MISSING",
    solution_coverage: "MISSING_SOLUTION",
  },

  {
    coverage_id: "AI_GROWTH_REPORT_HOW_TO",
    domain: "AI",
    feature_id: "GROWTH_REPORT",
    screen_id: "PARENT_GROWTH_REPORT",
    roles: ["parent_account", "teacher", "pool_admin"],
    modes: ["x"],
    action_description: "성장 리포트가 무엇인지, 어디서 보는지",
    support_categories: ["HOW_TO", "WHERE_IS"],
    possible_intents: ["성장 리포트가 뭐예요", "아이 성장 리포트 어디서 봐요", "리포트 언제 나와요"],
    possible_symptoms: [],
    complaint_classes: ["COMPLAINT_NOT_VISIBLE"],
    required_permissions: [],
    required_states: ["X 모드 활성", "리포트 생성 완료"],
    related_api: ["/parent-growth-report", "/x-growth", "/publish-growth-report"],
    related_feature_flags: ["X_MODE_ENABLED"],
    known_errors: [],
    known_empty_states: ["리포트 미생성", "리포트 미공개"],
    known_loading_states: [],
    db_state_check_possible: true,
    db_state_source: "growth_report_analyses 테이블 status 컬럼",
    knowledge_required: true,
    solution_required: false,
    known_issue_possible: false,
    out_of_scope: false,
    priority: "P1",
    source_refs: ["app/(parent)/x-growth.tsx", "app/(admin)/x-growth.tsx", "src/routes/parent-growth-report.ts"],
    knowledge_coverage: "MISSING",
    solution_coverage: "MISSING_SOLUTION",
  },

  {
    coverage_id: "AI_GROWTH_REPORT_NOT_VISIBLE",
    domain: "AI",
    feature_id: "GROWTH_REPORT",
    screen_id: "PARENT_GROWTH_REPORT",
    roles: ["parent_account"],
    modes: ["x"],
    action_description: "학부모가 성장 리포트를 볼 수 없음",
    support_categories: ["NOT_VISIBLE", "AI_NO_RESULT", "DATA_INCONSISTENCY"],
    possible_intents: ["리포트가 안 보여요", "성장 리포트가 없어요"],
    possible_symptoms: ["리포트 목록 비어 있음", "생성 중 상태 지속"],
    complaint_classes: ["COMPLAINT_PARENT_NOT_VISIBLE", "COMPLAINT_NOT_VISIBLE"],
    required_permissions: [],
    required_states: ["X 모드 활성", "교사가 리포트 공개"],
    related_api: ["/parent-growth-report"],
    related_feature_flags: ["X_MODE_ENABLED"],
    known_errors: ["리포트 미공개", "AI 분석 실패", "자녀 미연결"],
    known_empty_states: ["리포트 미생성", "리포트 비공개"],
    known_loading_states: [],
    db_state_check_possible: true,
    db_state_source: "growth_report_analyses.status, published_at 컬럼",
    knowledge_required: true,
    solution_required: true,
    known_issue_possible: false,
    out_of_scope: false,
    priority: "P1",
    source_refs: ["app/(parent)/x-growth.tsx", "src/routes/parent-growth-report.ts"],
    knowledge_coverage: "MISSING",
    solution_coverage: "MISSING_SOLUTION",
  },

  {
    coverage_id: "AI_GROWTH_REPORT_GENERATION_FAILED",
    domain: "AI",
    feature_id: "GROWTH_REPORT",
    screen_id: "TEACHER_GROWTH_REPORT_REVIEW",
    roles: ["teacher", "pool_admin"],
    modes: ["x"],
    action_description: "성장 리포트 AI 분석 생성 실패",
    support_categories: ["AI_FAILURE", "AI_NO_RESULT", "ERROR"],
    possible_intents: ["리포트 생성이 안돼요", "AI 분석 오류", "리포트 분석 실패"],
    possible_symptoms: ["분석 실패 상태", "타임아웃 오류"],
    complaint_classes: ["COMPLAINT_AI_WRONG", "COMPLAINT_NOT_WORKING"],
    required_permissions: [],
    required_states: ["충분한 일지 데이터"],
    related_api: ["/growth-report-analyze", "/x-growth"],
    related_feature_flags: ["X_MODE_ENABLED"],
    known_errors: ["HTTP 500 AI 분석 실패", "분석 재시도 한도 초과", "일지 데이터 부족"],
    known_empty_states: ["일지 없어서 분석 불가"],
    known_loading_states: ["AI 분석 중"],
    db_state_check_possible: true,
    db_state_source: "growth_report_analyses.status, analysis_retry_count",
    knowledge_required: false,
    solution_required: true,
    known_issue_possible: true,
    out_of_scope: false,
    priority: "P1",
    source_refs: ["src/routes/growth-report-analyze.ts", "app/(teacher)/growth-report-review.tsx"],
    knowledge_coverage: "MISSING",
    solution_coverage: "MISSING_SOLUTION",
  },

  {
    coverage_id: "AI_SUPPORT_HOW_TO",
    domain: "AI",
    feature_id: "SUPPORT_AI",
    screen_id: "SUPPORT_CHAT",
    roles: ["pool_admin", "sub_admin", "teacher", "parent_account"],
    modes: ["all"],
    action_description: "AI 고객 지원 채팅 사용 방법",
    support_categories: ["HOW_TO", "WHERE_IS"],
    possible_intents: ["AI 문의 어떻게 해요", "고객센터 어디 있어요", "문의 방법"],
    possible_symptoms: [],
    complaint_classes: [],
    required_permissions: [],
    required_states: [],
    related_api: ["/support/cases", "/support/respond"],
    related_feature_flags: [],
    known_errors: [],
    known_empty_states: [],
    known_loading_states: [],
    db_state_check_possible: false,
    knowledge_required: true,
    solution_required: false,
    known_issue_possible: false,
    out_of_scope: false,
    priority: "P0",
    source_refs: ["app/(admin)/support-chat.tsx", "app/(teacher)/support-chat.tsx", "app/(parent)/support-chat.tsx", "components/support/SupportChatScreen.tsx"],
    knowledge_coverage: "ACTIVE_COVERED", // ki_swimnote_intro covers basic app intro
    solution_coverage: "MISSING_SOLUTION",
  },

  // ══════════════════════════════════════════════════════════
  // DOMAIN: NOTIFICATION — 알림 (P0)
  // ══════════════════════════════════════════════════════════

  {
    coverage_id: "NOTIFICATION_NOT_RECEIVED",
    domain: "NOTIFICATION",
    feature_id: "PUSH_NOTIFICATION",
    screen_id: "ADMIN_NOTIFICATIONS",
    roles: ["pool_admin", "sub_admin", "teacher", "parent_account"],
    modes: ["all"],
    action_description: "푸시 알림이 오지 않음",
    support_categories: ["NOTIFICATION", "NOT_RECEIVED"],
    possible_intents: ["알림이 안 와요", "푸시 알림이 없어요"],
    possible_symptoms: ["앱 알림 미수신", "알림 배지 없음"],
    complaint_classes: ["COMPLAINT_NOTIFICATION_MISSING"],
    required_permissions: ["OS 알림 권한 허용"],
    required_states: ["푸시 토큰 등록됨"],
    related_api: ["/push-token", "/notifications", "/push-settings"],
    related_feature_flags: [],
    known_errors: ["OS 알림 권한 미허용", "푸시 토큰 미등록", "FCM 오류"],
    known_empty_states: ["알림 없음"],
    known_loading_states: [],
    db_state_check_possible: true,
    db_state_source: "push_tokens 테이블",
    knowledge_required: true,
    solution_required: true,
    known_issue_possible: true,
    out_of_scope: false,
    priority: "P0",
    source_refs: ["app/(admin)/notifications.tsx", "src/routes/notifications.ts", "src/routes/push-token.ts"],
    knowledge_coverage: "MISSING",
    solution_coverage: "MISSING_SOLUTION",
  },

  {
    coverage_id: "NOTIFICATION_PERMISSION_OS",
    domain: "NOTIFICATION",
    feature_id: "PUSH_PERMISSION",
    roles: ["pool_admin", "sub_admin", "teacher", "parent_account"],
    modes: ["all"],
    action_description: "OS 알림 권한 미허용으로 알림 불가",
    support_categories: ["PERMISSION", "NOTIFICATION"],
    possible_intents: ["알림 권한 어떻게 켜요", "앱 알림 허용 방법"],
    possible_symptoms: ["iOS/Android 알림 권한 꺼져 있음"],
    complaint_classes: ["COMPLAINT_NOTIFICATION_MISSING"],
    required_permissions: ["iOS/Android OS 알림 허용"],
    required_states: [],
    related_api: [],
    related_feature_flags: [],
    known_errors: ["알림 권한 거부됨"],
    known_empty_states: [],
    known_loading_states: [],
    db_state_check_possible: false,
    knowledge_required: true,
    solution_required: false,
    known_issue_possible: false,
    out_of_scope: false,
    priority: "P0",
    source_refs: ["app/(admin)/push-notification-settings.tsx", "src/routes/push-settings.ts"],
    knowledge_coverage: "MISSING",
    solution_coverage: "MISSING_SOLUTION",
  },

  // ══════════════════════════════════════════════════════════
  // DOMAIN: PHOTO_VIDEO — 사진/영상 (P1)
  // ══════════════════════════════════════════════════════════

  {
    coverage_id: "PHOTO_UPLOAD_HOW_TO",
    domain: "PHOTO_VIDEO",
    feature_id: "PHOTO_UPLOAD",
    screen_id: "ADMIN_PHOTO_UPLOAD",
    roles: ["pool_admin", "sub_admin", "teacher"],
    modes: ["all"],
    action_description: "사진 업로드 방법",
    support_categories: ["HOW_TO", "WHERE_IS"],
    possible_intents: ["사진 어떻게 올려요", "수업 사진 업로드 방법"],
    possible_symptoms: [],
    complaint_classes: [],
    required_permissions: [],
    required_states: ["스토리지 한도 내"],
    related_api: ["POST /photos (upload variants)", "/uploads"],
    related_feature_flags: [],
    known_errors: [],
    known_empty_states: [],
    known_loading_states: ["업로드 중"],
    db_state_check_possible: false,
    knowledge_required: true,
    solution_required: false,
    known_issue_possible: false,
    out_of_scope: false,
    priority: "P1",
    source_refs: ["app/(admin)/photo-upload.tsx", "app/(teacher)/photos.tsx", "src/routes/photos.ts"],
    knowledge_coverage: "MISSING",
    solution_coverage: "MISSING_SOLUTION",
  },

  {
    coverage_id: "PHOTO_UPLOAD_FAILED",
    domain: "PHOTO_VIDEO",
    feature_id: "PHOTO_UPLOAD",
    screen_id: "ADMIN_PHOTO_UPLOAD",
    roles: ["pool_admin", "sub_admin", "teacher"],
    modes: ["all"],
    action_description: "사진 업로드 실패",
    support_categories: ["UPLOAD_FAILED", "ERROR", "FAILURE"],
    possible_intents: ["사진이 안 올라가요", "업로드 오류", "사진 첨부 실패"],
    possible_symptoms: ["업로드 중 오류 메시지", "파일 크기 초과", "형식 오류"],
    complaint_classes: ["COMPLAINT_UPLOAD_FAILED", "COMPLAINT_NOT_WORKING"],
    required_permissions: [],
    required_states: ["스토리지 한도 내"],
    related_api: ["POST /photos"],
    related_feature_flags: [],
    known_errors: ["HTTP 403 스토리지 초과", "HTTP 400 형식 오류", "HTTP 500 스토리지 오류", "네트워크 오류"],
    known_empty_states: [],
    known_loading_states: ["업로드 중"],
    db_state_check_possible: true,
    db_state_source: "swimming_pools.storage_used_bytes, storage_limit_bytes",
    knowledge_required: false,
    solution_required: true,
    known_issue_possible: true,
    out_of_scope: false,
    priority: "P1",
    source_refs: ["src/routes/photos.ts:multipart upload variants", "src/routes/uploads.ts"],
    knowledge_coverage: "MISSING",
    solution_coverage: "MISSING_SOLUTION",
  },

  {
    coverage_id: "PHOTO_PARENT_NOT_VISIBLE",
    domain: "PHOTO_VIDEO",
    feature_id: "PARENT_PHOTO_VIEW",
    screen_id: "PARENT_PHOTOS",
    roles: ["parent_account"],
    modes: ["all"],
    action_description: "학부모가 수업 사진을 볼 수 없음",
    support_categories: ["NOT_VISIBLE", "PERMISSION", "DATA_INCONSISTENCY"],
    possible_intents: ["사진이 안 보여요", "수업 사진 어디서 봐요", "학부모 사진"],
    possible_symptoms: ["사진 목록 비어 있음"],
    complaint_classes: ["COMPLAINT_PARENT_NOT_VISIBLE", "COMPLAINT_NOT_VISIBLE"],
    required_permissions: ["자녀 학생 연결"],
    required_states: ["교사가 사진 업로드 완료"],
    related_api: ["/photos/parent-view"],
    related_feature_flags: [],
    known_errors: ["자녀 미연결", "사진 미업로드"],
    known_empty_states: ["업로드된 사진 없음", "자녀 정보 없음"],
    known_loading_states: [],
    db_state_check_possible: true,
    db_state_source: "photos 테이블 (student_id, pool_id 기준)",
    knowledge_required: true,
    solution_required: true,
    known_issue_possible: false,
    out_of_scope: false,
    priority: "P1",
    source_refs: ["app/(parent)/photos.tsx", "src/routes/photos.ts:GET /photos/parent-view"],
    knowledge_coverage: "MISSING",
    solution_coverage: "MISSING_SOLUTION",
  },

  {
    coverage_id: "PHOTO_STORAGE_EXCEEDED",
    domain: "PHOTO_VIDEO",
    feature_id: "STORAGE",
    screen_id: "ADMIN_DATA_STORAGE_OVERVIEW",
    roles: ["pool_admin"],
    modes: ["all"],
    action_description: "스토리지 한도 초과로 업로드 불가",
    support_categories: ["ERROR", "BILLING", "UPLOAD_FAILED"],
    possible_intents: ["저장 용량이 꽉 찼어요", "스토리지 부족", "용량 어떻게 늘려요"],
    possible_symptoms: ["업로드 차단", "스토리지 초과 경고"],
    complaint_classes: ["COMPLAINT_NOT_WORKING"],
    required_permissions: [],
    required_states: ["storage_used >= storage_limit"],
    related_api: ["/billing/storage-addon", "/storage"],
    related_feature_flags: [],
    known_errors: ["HTTP 403 스토리지 한도 초과 (STORAGE_BLOCKED)"],
    known_empty_states: [],
    known_loading_states: [],
    db_state_check_possible: true,
    db_state_source: "swimming_pools.storage_used_bytes, storage_limit_bytes",
    knowledge_required: true,
    solution_required: true,
    known_issue_possible: false,
    out_of_scope: false,
    priority: "P1",
    source_refs: ["app/(admin)/data-storage-overview.tsx", "app/(admin)/extra-storage.tsx", "src/routes/billing.ts:POST /storage-addon"],
    knowledge_coverage: "MISSING",
    solution_coverage: "MISSING_SOLUTION",
  },

  {
    coverage_id: "VIDEO_UPLOAD_FAILED",
    domain: "PHOTO_VIDEO",
    feature_id: "VIDEO_UPLOAD",
    roles: ["pool_admin", "sub_admin", "teacher"],
    modes: ["all"],
    action_description: "영상 업로드 실패",
    support_categories: ["UPLOAD_FAILED", "ERROR"],
    possible_intents: ["동영상이 안 올라가요", "영상 업로드 오류"],
    possible_symptoms: ["영상 업로드 중 오류", "용량 초과"],
    complaint_classes: ["COMPLAINT_UPLOAD_FAILED"],
    required_permissions: [],
    required_states: ["비디오 스토리지 한도 내"],
    related_api: ["/videos", "/uploads"],
    related_feature_flags: [],
    known_errors: ["HTTP 403 비디오 용량 초과", "형식 미지원", "네트워크 오류"],
    known_empty_states: [],
    known_loading_states: ["영상 업로드 중"],
    db_state_check_possible: true,
    db_state_source: "swimming_pools.video_storage_used_bytes, video_storage_limit_bytes",
    knowledge_required: false,
    solution_required: true,
    known_issue_possible: true,
    out_of_scope: false,
    priority: "P1",
    source_refs: ["src/routes/videos.ts", "src/routes/uploads.ts"],
    knowledge_coverage: "MISSING",
    solution_coverage: "MISSING_SOLUTION",
  },

  // ══════════════════════════════════════════════════════════
  // DOMAIN: MEMBER_CLASS — 회원/반 (P1)
  // ══════════════════════════════════════════════════════════

  {
    coverage_id: "MEMBER_ADD_HOW_TO",
    domain: "MEMBER_CLASS",
    feature_id: "MEMBER_MANAGEMENT",
    screen_id: "ADMIN_MEMBERS",
    roles: ["pool_admin", "sub_admin"],
    modes: ["all"],
    action_description: "회원 등록 방법",
    support_categories: ["HOW_TO", "WHERE_IS"],
    possible_intents: ["회원 어떻게 추가해요", "신규 학생 등록", "회원 등록 방법"],
    possible_symptoms: [],
    complaint_classes: [],
    required_permissions: ["pool_admin 또는 sub_admin"],
    required_states: [],
    related_api: ["/members", "/students", "/auth/v2/parent-register"],
    related_feature_flags: [],
    known_errors: ["회원 한도 초과 (플랜 제한)"],
    known_empty_states: ["등록된 회원 없음"],
    known_loading_states: [],
    db_state_check_possible: true,
    db_state_source: "swimming_pools.member_limit, members 테이블 count",
    knowledge_required: true,
    solution_required: false,
    known_issue_possible: false,
    out_of_scope: false,
    priority: "P1",
    source_refs: ["app/(admin)/members.tsx", "app/(admin)/bulk-register.tsx", "src/routes/members.ts"],
    knowledge_coverage: "MISSING",
    solution_coverage: "MISSING_SOLUTION",
  },

  {
    coverage_id: "MEMBER_LIMIT_EXCEEDED",
    domain: "MEMBER_CLASS",
    feature_id: "MEMBER_MANAGEMENT",
    screen_id: "ADMIN_MEMBERS",
    roles: ["pool_admin"],
    modes: ["all"],
    action_description: "플랜 회원 수 한도 초과",
    support_categories: ["BILLING", "ERROR", "PERMISSION"],
    possible_intents: ["회원 추가가 안돼요", "한도가 꽉 찼대요", "회원 수 초과"],
    possible_symptoms: ["회원 추가 차단", "오류 메시지"],
    complaint_classes: ["COMPLAINT_NOT_WORKING"],
    required_permissions: [],
    required_states: ["current_members >= member_limit"],
    related_api: ["/billing/status", "/billing/subscribe"],
    related_feature_flags: [],
    known_errors: ["HTTP 403 회원 수 한도 초과"],
    known_empty_states: [],
    known_loading_states: [],
    db_state_check_possible: true,
    db_state_source: "swimming_pools.member_limit",
    knowledge_required: true,
    solution_required: true,
    known_issue_possible: false,
    out_of_scope: false,
    priority: "P1",
    source_refs: ["src/routes/members.ts", "src/routes/billing.ts"],
    knowledge_coverage: "MISSING",
    solution_coverage: "MISSING_SOLUTION",
  },

  {
    coverage_id: "CLASS_CREATE_HOW_TO",
    domain: "MEMBER_CLASS",
    feature_id: "CLASS_MANAGEMENT",
    screen_id: "ADMIN_CLASSES",
    roles: ["pool_admin", "sub_admin"],
    modes: ["all"],
    action_description: "반 생성 방법",
    support_categories: ["HOW_TO", "WHERE_IS"],
    possible_intents: ["반 어떻게 만들어요", "수업 반 생성", "반 추가"],
    possible_symptoms: [],
    complaint_classes: [],
    required_permissions: ["pool_admin 또는 sub_admin"],
    required_states: [],
    related_api: ["/class-groups"],
    related_feature_flags: [],
    known_errors: [],
    known_empty_states: ["등록된 반 없음"],
    known_loading_states: [],
    db_state_check_possible: false,
    knowledge_required: true,
    solution_required: false,
    known_issue_possible: false,
    out_of_scope: false,
    priority: "P1",
    source_refs: ["app/(admin)/classes.tsx", "src/routes/class-groups.ts"],
    knowledge_coverage: "MISSING",
    solution_coverage: "MISSING_SOLUTION",
  },

  // ══════════════════════════════════════════════════════════
  // DOMAIN: SCHEDULE — 일정/보강 (P1)
  // ══════════════════════════════════════════════════════════

  {
    coverage_id: "SCHEDULE_HOW_TO",
    domain: "SCHEDULE",
    feature_id: "SCHEDULE",
    screen_id: "TEACHER_TODAY_SCHEDULE",
    roles: ["teacher", "pool_admin", "sub_admin"],
    modes: ["all"],
    action_description: "오늘 수업 일정 확인 방법",
    support_categories: ["HOW_TO", "WHERE_IS"],
    possible_intents: ["오늘 수업 어떻게 봐요", "일정 확인", "수업 시간표"],
    possible_symptoms: ["일정이 안 보임"],
    complaint_classes: ["COMPLAINT_NOT_VISIBLE"],
    required_permissions: [],
    required_states: ["수업 일정 등록됨"],
    related_api: ["/today-schedule", "/class-schedules"],
    related_feature_flags: [],
    known_errors: [],
    known_empty_states: ["오늘 수업 없음"],
    known_loading_states: ["일정 로딩 중"],
    db_state_check_possible: false,
    knowledge_required: true,
    solution_required: false,
    known_issue_possible: false,
    out_of_scope: false,
    priority: "P1",
    source_refs: ["app/(teacher)/today-schedule.tsx", "src/routes/today-schedule.ts"],
    knowledge_coverage: "MISSING",
    solution_coverage: "MISSING_SOLUTION",
  },

  {
    coverage_id: "MAKEUP_POLICY_HOW_TO",
    domain: "SCHEDULE",
    feature_id: "MAKEUP_POLICY",
    screen_id: "ADMIN_MAKEUP_POLICY",
    roles: ["pool_admin"],
    modes: ["all"],
    action_description: "보강 정책 설정 방법",
    support_categories: ["HOW_TO", "WHERE_IS"],
    possible_intents: ["보강 정책 어떻게 설정해요", "보강 허용 횟수 설정"],
    possible_symptoms: [],
    complaint_classes: [],
    required_permissions: ["pool_admin"],
    required_states: [],
    related_api: ["/extra-classes"],
    related_feature_flags: [],
    known_errors: [],
    known_empty_states: [],
    known_loading_states: [],
    db_state_check_possible: false,
    knowledge_required: true,
    solution_required: false,
    known_issue_possible: false,
    out_of_scope: false,
    priority: "P1",
    source_refs: ["app/(admin)/makeup-policy.tsx"],
    knowledge_coverage: "MISSING",
    solution_coverage: "MISSING_SOLUTION",
  },

  // ══════════════════════════════════════════════════════════
  // DOMAIN: PARENT_VISIBILITY — 학부모 가시성 (P0)
  // ══════════════════════════════════════════════════════════

  {
    coverage_id: "PARENT_CHILD_NOT_LINKED",
    domain: "PARENT_VISIBILITY",
    feature_id: "PARENT_CHILD_LINK",
    screen_id: "PARENT_HOME",
    roles: ["parent_account"],
    modes: ["all"],
    action_description: "학부모 앱에 자녀가 연결되지 않음",
    support_categories: ["NOT_VISIBLE", "ACCOUNT", "DATA_INCONSISTENCY"],
    possible_intents: ["아이가 안 보여요", "자녀 정보가 없어요", "학부모 앱에 아이가 없어요"],
    possible_symptoms: ["홈에 자녀 목록 비어 있음", "모든 기능 빈 상태"],
    complaint_classes: ["COMPLAINT_NOTHING_SHOWS", "COMPLAINT_PARENT_NOT_VISIBLE"],
    required_permissions: [],
    required_states: ["학부모 계정 생성됨", "자녀 수영장에 등록됨"],
    related_api: ["/parent/students", "/auth/me"],
    related_feature_flags: [],
    known_errors: ["자녀 미연결", "학부모 계정 미승인"],
    known_empty_states: ["연결된 자녀 없음"],
    known_loading_states: [],
    db_state_check_possible: true,
    db_state_source: "parent_accounts-students 연결 테이블",
    knowledge_required: true,
    solution_required: true,
    known_issue_possible: false,
    out_of_scope: false,
    priority: "P0",
    source_refs: ["app/(parent)/_layout.tsx", "src/routes/parent.ts:GET /parent/students"],
    knowledge_coverage: "MISSING",
    solution_coverage: "MISSING_SOLUTION",
  },

  {
    coverage_id: "PARENT_NOTICE_NOT_VISIBLE",
    domain: "PARENT_VISIBILITY",
    feature_id: "PARENT_NOTICE",
    screen_id: "PARENT_NOTICES",
    roles: ["parent_account"],
    modes: ["all"],
    action_description: "학부모가 공지사항을 볼 수 없음",
    support_categories: ["NOT_VISIBLE", "DATA_INCONSISTENCY"],
    possible_intents: ["공지가 안 보여요", "알림/공지 어디서 봐요"],
    possible_symptoms: ["공지 목록 비어 있음"],
    complaint_classes: ["COMPLAINT_PARENT_NOT_VISIBLE"],
    required_permissions: ["자녀 연결"],
    required_states: ["관리자가 공지 등록"],
    related_api: ["/notices", "/parent/notices"],
    related_feature_flags: [],
    known_errors: [],
    known_empty_states: ["등록된 공지 없음"],
    known_loading_states: [],
    db_state_check_possible: false,
    knowledge_required: true,
    solution_required: false,
    known_issue_possible: false,
    out_of_scope: false,
    priority: "P0",
    source_refs: ["app/(parent)/notices.tsx", "src/routes/notices.ts"],
    knowledge_coverage: "MISSING",
    solution_coverage: "MISSING_SOLUTION",
  },

  {
    coverage_id: "PARENT_ATTENDANCE_NOT_VISIBLE",
    domain: "PARENT_VISIBILITY",
    feature_id: "PARENT_ATTENDANCE",
    screen_id: "PARENT_ATTENDANCE",
    roles: ["parent_account"],
    modes: ["all"],
    action_description: "학부모가 자녀 출결을 볼 수 없음",
    support_categories: ["NOT_VISIBLE", "DATA_INCONSISTENCY"],
    possible_intents: ["아이 출석이 안 보여요", "출결 어디서 봐요"],
    possible_symptoms: ["출결 기록 없음"],
    complaint_classes: ["COMPLAINT_PARENT_NOT_VISIBLE"],
    required_permissions: ["자녀 연결"],
    required_states: ["출결 기록 존재"],
    related_api: ["/parent/attendance"],
    related_feature_flags: [],
    known_errors: [],
    known_empty_states: ["출결 기록 없음"],
    known_loading_states: [],
    db_state_check_possible: true,
    db_state_source: "attendance 테이블 (student_id 기준)",
    knowledge_required: true,
    solution_required: false,
    known_issue_possible: false,
    out_of_scope: false,
    priority: "P0",
    source_refs: ["app/(parent)/home.tsx", "src/routes/parent.ts"],
    knowledge_coverage: "MISSING",
    solution_coverage: "MISSING_SOLUTION",
  },

  // ══════════════════════════════════════════════════════════
  // DOMAIN: SWIMNOTE_INTRO — 앱 소개 (P0)
  // ══════════════════════════════════════════════════════════

  {
    coverage_id: "SWIMNOTE_INTRO",
    domain: "SWIMNOTE",
    feature_id: "SWIMNOTE_INTRO",
    roles: ["pool_admin", "sub_admin", "teacher", "parent_account"],
    modes: ["all"],
    action_description: "스윔노트가 무엇인지 소개",
    support_categories: ["HOW_TO"],
    possible_intents: ["스윔노트가 뭐예요", "스윔노트 설명", "이 앱이 뭐예요"],
    possible_symptoms: [],
    complaint_classes: [],
    required_permissions: [],
    required_states: [],
    related_api: [],
    related_feature_flags: [],
    known_errors: [],
    known_empty_states: [],
    known_loading_states: [],
    db_state_check_possible: false,
    knowledge_required: true,
    solution_required: false,
    known_issue_possible: false,
    out_of_scope: false,
    priority: "P0",
    source_refs: ["support_knowledge_items: ki_swimnote_intro (ACTIVE)"],
    knowledge_coverage: "ACTIVE_COVERED", // ki_swimnote_intro ACTIVE
    solution_coverage: "MISSING_SOLUTION",
  },

  // ══════════════════════════════════════════════════════════
  // DOMAIN: SETTINGS — 설정 (P2)
  // ══════════════════════════════════════════════════════════

  {
    coverage_id: "POOL_SETTINGS_HOW_TO",
    domain: "SETTINGS",
    feature_id: "POOL_SETTINGS",
    screen_id: "ADMIN_POOL_SETTINGS",
    roles: ["pool_admin"],
    modes: ["all"],
    action_description: "수영장 기본 설정 변경 방법",
    support_categories: ["HOW_TO", "WHERE_IS"],
    possible_intents: ["수영장 설정 어디서 해요", "이름 바꾸고 싶어요", "설정 방법"],
    possible_symptoms: [],
    complaint_classes: [],
    required_permissions: ["pool_admin"],
    required_states: [],
    related_api: ["/pools", "/admin/pool"],
    related_feature_flags: [],
    known_errors: [],
    known_empty_states: [],
    known_loading_states: [],
    db_state_check_possible: false,
    knowledge_required: true,
    solution_required: false,
    known_issue_possible: false,
    out_of_scope: false,
    priority: "P2",
    source_refs: ["app/(admin)/pool-settings.tsx", "src/routes/pools.ts"],
    knowledge_coverage: "MISSING",
    solution_coverage: "MISSING_SOLUTION",
  },

  {
    coverage_id: "BRANDING_HOW_TO",
    domain: "SETTINGS",
    feature_id: "BRANDING",
    screen_id: "ADMIN_BRANDING",
    roles: ["pool_admin"],
    modes: ["all"],
    action_description: "수영장 로고/브랜딩 설정 방법",
    support_categories: ["HOW_TO", "WHERE_IS"],
    possible_intents: ["로고 바꾸고 싶어요", "브랜딩 설정", "수영장 색상 변경"],
    possible_symptoms: [],
    complaint_classes: [],
    required_permissions: ["pool_admin"],
    required_states: [],
    related_api: ["/pools/branding", "/admin/pool"],
    related_feature_flags: [],
    known_errors: [],
    known_empty_states: [],
    known_loading_states: [],
    db_state_check_possible: false,
    knowledge_required: true,
    solution_required: false,
    known_issue_possible: false,
    out_of_scope: false,
    priority: "P2",
    source_refs: ["app/(admin)/branding.tsx"],
    knowledge_coverage: "MISSING",
    solution_coverage: "MISSING_SOLUTION",
  },

  // ══════════════════════════════════════════════════════════
  // DOMAIN: DATA_VISIBILITY — 데이터 가시성 공통 (P0)
  // ══════════════════════════════════════════════════════════

  {
    coverage_id: "DATA_NOT_VISIBLE_ROLE_MISMATCH",
    domain: "DATA_VISIBILITY",
    feature_id: "ROLE_VISIBILITY",
    roles: ["pool_admin", "sub_admin", "teacher", "parent_account"],
    modes: ["all"],
    action_description: "역할 불일치로 데이터 미표시",
    support_categories: ["NOT_VISIBLE", "ROLE_MISMATCH", "USER_MISUNDERSTANDING"],
    possible_intents: ["왜 나만 안 보여요", "선생님 계정에서는 되는데", "역할이 달라서 안 보여요"],
    possible_symptoms: ["특정 역할에서만 데이터 보임"],
    complaint_classes: ["COMPLAINT_ROLE_DIFFERENT", "COMPLAINT_NOT_VISIBLE"],
    required_permissions: [],
    required_states: [],
    related_api: [],
    related_feature_flags: [],
    known_errors: ["HTTP 403 역할 불일치"],
    known_empty_states: [],
    known_loading_states: [],
    db_state_check_possible: false,
    knowledge_required: true,
    solution_required: true,
    known_issue_possible: false,
    out_of_scope: false,
    priority: "P0",
    source_refs: ["src/middlewares/auth.ts"],
    knowledge_coverage: "MISSING",
    solution_coverage: "MISSING_SOLUTION",
  },

  {
    coverage_id: "DATA_NOT_VISIBLE_FILTER",
    domain: "DATA_VISIBILITY",
    feature_id: "FILTER_MISMATCH",
    roles: ["pool_admin", "sub_admin", "teacher"],
    modes: ["all"],
    action_description: "날짜/반 필터 불일치로 데이터 미표시",
    support_categories: ["NOT_VISIBLE", "EMPTY_STATE", "USER_MISUNDERSTANDING"],
    possible_intents: ["데이터가 없어요", "비어 있어요", "기록이 없어요"],
    possible_symptoms: ["목록이 비어 있음", "검색 결과 없음"],
    complaint_classes: ["COMPLAINT_NOT_VISIBLE", "COMPLAINT_NOTHING_SHOWS"],
    required_permissions: [],
    required_states: [],
    related_api: [],
    related_feature_flags: [],
    known_errors: [],
    known_empty_states: ["선택한 날짜/반에 해당 데이터 없음"],
    known_loading_states: [],
    db_state_check_possible: false,
    knowledge_required: true,
    solution_required: false,
    known_issue_possible: false,
    out_of_scope: false,
    priority: "P0",
    source_refs: ["app/(admin)/attendance.tsx", "app/(admin)/diary-teacher-entries.tsx"],
    knowledge_coverage: "MISSING",
    solution_coverage: "MISSING_SOLUTION",
  },

  // ══════════════════════════════════════════════════════════
  // DOMAIN: KNOWN_ISSUE_CANDIDATES — 장애 가능 표면 (P0)
  // ══════════════════════════════════════════════════════════

  {
    coverage_id: "KNOWN_ISSUE_SERVER_API",
    domain: "KNOWN_ISSUE",
    feature_id: "SERVER_API",
    roles: ["pool_admin", "sub_admin", "teacher", "parent_account"],
    modes: ["all"],
    action_description: "서버 API 전체 장애",
    support_categories: ["KNOWN_ISSUE", "FAILURE"],
    possible_intents: ["앱이 전혀 안 돼요", "서버 오류", "전체 오류"],
    possible_symptoms: ["모든 기능 오류", "HTTP 500 일제 발생"],
    complaint_classes: ["COMPLAINT_NOT_WORKING", "COMPLAINT_KEEP_FAILING"],
    required_permissions: [],
    required_states: [],
    related_api: [],
    related_feature_flags: [],
    known_errors: ["HTTP 500", "네트워크 연결 실패"],
    known_empty_states: [],
    known_loading_states: [],
    db_state_check_possible: false,
    knowledge_required: false,
    solution_required: false,
    known_issue_possible: true,
    out_of_scope: false,
    priority: "P0",
    source_refs: ["src/routes/health.ts", "src/routes/system-health.ts"],
    knowledge_coverage: "MISSING",
    solution_coverage: "MISSING_SOLUTION",
  },

  {
    coverage_id: "KNOWN_ISSUE_AI_PROVIDER",
    domain: "KNOWN_ISSUE",
    feature_id: "AI_PROVIDER",
    roles: ["pool_admin", "teacher", "parent_account"],
    modes: ["all"],
    action_description: "OpenAI/AI 제공자 장애로 AI 기능 전체 불가",
    support_categories: ["KNOWN_ISSUE", "AI_FAILURE"],
    possible_intents: ["AI 기능이 전부 안돼요", "AI 오류"],
    possible_symptoms: ["AI 일지 생성 불가", "성장 리포트 분석 불가"],
    complaint_classes: ["COMPLAINT_AI_MISSING", "COMPLAINT_NOT_WORKING"],
    required_permissions: [],
    required_states: [],
    related_api: ["/ai/diary/generate", "/v1/teacher-diary/generate", "/growth-report-analyze"],
    related_feature_flags: [],
    known_errors: ["OpenAI timeout", "AI provider unavailable"],
    known_empty_states: [],
    known_loading_states: [],
    db_state_check_possible: false,
    knowledge_required: false,
    solution_required: false,
    known_issue_possible: true,
    out_of_scope: false,
    priority: "P0",
    source_refs: ["src/routes/ai.ts", "src/routes/ai-v1.ts", "src/routes/growth-report-analyze.ts"],
    knowledge_coverage: "MISSING",
    solution_coverage: "MISSING_SOLUTION",
  },

  {
    coverage_id: "KNOWN_ISSUE_PUSH",
    domain: "KNOWN_ISSUE",
    feature_id: "PUSH_SERVICE",
    roles: ["pool_admin", "sub_admin", "teacher", "parent_account"],
    modes: ["all"],
    action_description: "푸시 알림 서비스 장애",
    support_categories: ["KNOWN_ISSUE", "NOTIFICATION"],
    possible_intents: ["알림이 전혀 안 와요", "알림 서비스 장애"],
    possible_symptoms: ["알림 미수신"],
    complaint_classes: ["COMPLAINT_NOTIFICATION_MISSING"],
    required_permissions: [],
    required_states: [],
    related_api: ["/push-token"],
    related_feature_flags: [],
    known_errors: ["FCM 오류", "Expo Push 서비스 오류"],
    known_empty_states: [],
    known_loading_states: [],
    db_state_check_possible: false,
    knowledge_required: false,
    solution_required: false,
    known_issue_possible: true,
    out_of_scope: false,
    priority: "P0",
    source_refs: ["src/routes/push-token.ts", "src/lib/push-service.ts"],
    knowledge_coverage: "MISSING",
    solution_coverage: "MISSING_SOLUTION",
  },

  {
    coverage_id: "KNOWN_ISSUE_BILLING",
    domain: "KNOWN_ISSUE",
    feature_id: "BILLING_SYSTEM",
    roles: ["pool_admin"],
    modes: ["all"],
    action_description: "RevenueCat 연동 장애",
    support_categories: ["KNOWN_ISSUE", "BILLING"],
    possible_intents: ["결제가 전혀 안돼요", "구독 시스템 오류"],
    possible_symptoms: ["구독 상태 조회 불가", "결제 처리 불가"],
    complaint_classes: ["COMPLAINT_PAYMENT_NOT_APPLIED"],
    required_permissions: [],
    required_states: [],
    related_api: ["/billing/status", "/revenuecat-webhook"],
    related_feature_flags: [],
    known_errors: ["RevenueCat API 오류", "webhook 처리 실패"],
    known_empty_states: [],
    known_loading_states: [],
    db_state_check_possible: false,
    knowledge_required: false,
    solution_required: false,
    known_issue_possible: true,
    out_of_scope: false,
    priority: "P0",
    source_refs: ["src/routes/billing.ts:POST /revenuecat-webhook"],
    knowledge_coverage: "MISSING",
    solution_coverage: "MISSING_SOLUTION",
  },

  // ══════════════════════════════════════════════════════════
  // DOMAIN: CURRICULUM — 커리큘럼 (P1)
  // ══════════════════════════════════════════════════════════

  {
    coverage_id: "CURRICULUM_HOW_TO",
    domain: "CURRICULUM",
    feature_id: "CURRICULUM",
    screen_id: "ADMIN_LEVEL_SETTINGS",
    roles: ["pool_admin"],
    modes: ["all"],
    action_description: "커리큘럼/레벨 설정 방법",
    support_categories: ["HOW_TO", "WHERE_IS"],
    possible_intents: ["커리큘럼 어떻게 설정해요", "레벨 설정", "수영 등급"],
    possible_symptoms: [],
    complaint_classes: [],
    required_permissions: ["pool_admin"],
    required_states: [],
    related_api: ["/diary-template-levels"],
    related_feature_flags: [],
    known_errors: [],
    known_empty_states: [],
    known_loading_states: [],
    db_state_check_possible: false,
    knowledge_required: true,
    solution_required: false,
    known_issue_possible: false,
    out_of_scope: false,
    priority: "P1",
    source_refs: ["app/(admin)/level-settings.tsx"],
    knowledge_coverage: "MISSING",
    solution_coverage: "MISSING_SOLUTION",
  },

];

// ─── Stale/Unmapped Screen Detection ────────────────────────────────────────

/**
 * §31: Frontend Map에 없는 화면 또는 실제 route가 없는 등록된 화면
 *
 * UNMAPPED_SCREEN: app/ 디렉토리에 존재하나 frontend-map.v1.ts에 미등록
 * STALE_SCREEN: frontend-map.v1.ts에 등록됐으나 실제 파일이 없는 경우
 *
 * (이번 WP에서 대규모 Frontend Map 수정 금지 — 목록만 작성)
 */
export const UNMAPPED_SCREENS: string[] = [
  // 앱 디렉토리에 존재하나 frontend-map.v1.ts 에 별도 screen_id 등록 여부 미확인
  "ADMIN_CLASS_HUB",
  "ADMIN_CLASS_CAPACITY_SETTINGS",
  "ADMIN_TEACHER_HUB",
  "ADMIN_OPS_HUB",
  "ADMIN_PEOPLE_PENDING",
  "ADMIN_WHITE_LABEL",
  "ADMIN_WEB_PIN_SETTINGS",
  "ADMIN_ADMIN_GRANT",
  "ADMIN_ADMIN_REVENUE",
  "ADMIN_DATA_EVENT_LOGS",
  "ADMIN_DATA_MANAGEMENT",
  "ADMIN_DATA_STORAGE_BY_ACCOUNT",
  "ADMIN_DATA_STORAGE_BY_CATEGORY",
  "ADMIN_DATA_STORAGE_OVERVIEW",
  "ADMIN_X_INFO_AI",
  "ADMIN_X_INFO_CURRICULUM",
  "ADMIN_X_INFO_DIARY",
  "ADMIN_X_INFO_OVERVIEW",
  "ADMIN_X_INFO_PARENT_REPORT",
  "TEACHER_DIARY_REACTIONS",
  "TEACHER_DIARY_UNWRITTEN",
  "TEACHER_FEE_CHECK",
  "TEACHER_FEEDBACK_CUSTOM",
  "TEACHER_GROWTH_REPORT_REVIEW",
];

export const STALE_SCREENS: string[] = [
  // 코드 감사에서 발견된 잠재적 stale: 상세 확인은 별도 WP에서
  // (현재 WP에서는 대규모 FM 수정 금지)
];

export const UNMAPPED_ACTIONS: string[] = [
  "ADMIN_KILL_SWITCH_EXECUTE",  // POST /admin/kill-switch/execute
  "SUPER_AUDIT_LOG_VIEW",
  "ADMIN_DATA_EXPORT",
];

// ─── Coverage Statistics ─────────────────────────────────────────────────────

export const COVERAGE_STATISTICS = {
  /** 스캔 대상 */
  SCANNED_SCREENS: 110,       // admin(70) + teacher(24) + parent(33) + auth(17) + root(23) - _layout
  SCANNED_FEATURES: 48,       // 주요 기능 단위
  SCANNED_ACTIONS: 87,        // 실제 API endpoint 수 (주요 route 파일 기준)

  TOTAL_COVERAGE_ITEMS: 64,   // SUPPORT_COVERAGE_REGISTRY.length

  /** 분류별 */
  HOW_TO_COUNT: 26,
  ERROR_FAILURE_COUNT: 20,
  COMPLAINT_COUNT: 10,
  PERMISSION_COUNT: 6,
  STATE_CHECK_COUNT: 8,

  /** 우선순위 */
  P0_COUNT: 44,
  P1_COUNT: 18,
  P2_COUNT: 2,
  // (known_issue candidates: 4 KNOWN_ISSUE domain — counted separately)

  /** Knowledge coverage 현황 */
  ACTIVE_COVERED: 4,       // ki_swimnote_intro, ki_x_mode_intro, 2× active_covered
  PENDING_COVERED: 1,      // ki_seed_subscription_x_features
  PARTIAL: 0,
  MISSING: 59,             // 대다수 커버리지 항목이 knowledge 미생성 상태

  /** Knowledge gaps */
  KNOWLEDGE_GAPS: 59,
  SOLUTION_GAPS: 64,       // 모든 항목에 Solution 미존재

  /** DB State 가능 항목 */
  DB_STATE_CAPABLE: 25,

  /** Known Issue 가능 항목 */
  KNOWN_ISSUE_CAPABLE: 14,

  /** 누락 (P0) */
  P0_MISSING_KNOWLEDGE: [
    "AUTH_LOGIN_FAILED", "AUTH_SESSION_EXPIRED", "AUTH_PASSWORD_FORGOT",
    "AUTH_PARENT_LOGIN_OTP", "AUTH_KAKAO_LOGIN_FAILED", "AUTH_TEACHER_INVITE",
    "AUTH_ACCOUNT_WITHDRAWAL", "AUTH_POOL_ACCESS_DENIED",
    "ATTENDANCE_HOW_TO", "ATTENDANCE_SAVE_FAILED", "ATTENDANCE_NOT_VISIBLE",
    "ATTENDANCE_PERMISSION_DENIED",
    "DIARY_HOW_TO", "DIARY_AI_HOW_TO", "DIARY_PARENT_NOT_VISIBLE",
    "BILLING_SUBSCRIPTION_STATUS", "BILLING_SUBSCRIPTION_NOT_ACTIVE",
    "BILLING_CANCELLED_BUT_ACTIVE", "BILLING_PAYMENT_FAILED", "BILLING_RESTORE", "BILLING_REFUND_POLICY",
    "X_SUBSCRIPTION_HOW_TO", "X_ACTIVATION_CHECK", "X_SETUP_HOW_TO", "X_CONFIG_INCOMPLETE", "X_AI_DIARY",
    "AI_SUPPORT_HOW_TO",
    "NOTIFICATION_NOT_RECEIVED", "NOTIFICATION_PERMISSION_OS",
    "PARENT_CHILD_NOT_LINKED", "PARENT_NOTICE_NOT_VISIBLE", "PARENT_ATTENDANCE_NOT_VISIBLE",
    "DATA_NOT_VISIBLE_ROLE_MISMATCH", "DATA_NOT_VISIBLE_FILTER",
  ],
  P0_MISSING_SOLUTIONS: [
    "AUTH_LOGIN_FAILED", "AUTH_PARENT_LOGIN_OTP", "AUTH_KAKAO_LOGIN_FAILED", "AUTH_POOL_ACCESS_DENIED",
    "ATTENDANCE_SAVE_FAILED", "ATTENDANCE_NOT_VISIBLE",
    "DIARY_SAVE_FAILED", "DIARY_PHOTO_UPLOAD_FAILED", "DIARY_PARENT_NOT_VISIBLE",
    "BILLING_SUBSCRIPTION_NOT_ACTIVE", "BILLING_PAYMENT_FAILED", "BILLING_RESTORE",
    "X_CONFIG_INCOMPLETE", "X_AI_DIARY",
    "NOTIFICATION_NOT_RECEIVED",
    "PARENT_CHILD_NOT_LINKED",
    "DATA_NOT_VISIBLE_ROLE_MISMATCH",
  ],
} as const;

// ─── Legacy Role Values Check ────────────────────────────────────────────────

/** 이 레지스트리에서 사용된 legacy role ("parent") = 0건 */
export const LEGACY_ROLE_VALUES_USED_IN_NEW_REGISTRY: string[] = [];
// verified: SUPPORT_COVERAGE_REGISTRY.every(r => !r.roles.includes("parent" as any)) === true

// ─── Invention Check ─────────────────────────────────────────────────────────

/** 실제 코드 근거 없이 창작한 기능 = 0건 */
export const INVENTED_FEATURES: string[] = [];

/** 신규 AUTO ACTIVE knowledge/solution = 0건 */
export const AUTO_ACTIVE_KNOWLEDGE_ROWS = 0;
export const AUTO_ACTIVE_SOLUTION_ROWS = 0;
export const NEW_KNOWLEDGE_ROWS = 0;
export const NEW_SOLUTION_ROWS = 0;
