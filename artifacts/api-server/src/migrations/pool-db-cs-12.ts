/**
 * WP-CS12 Migration — Support FAQ/Solution Candidate Generation
 *
 * CS11 gap analysis 기반 신규 candidate 생성.
 * 모든 항목 status='pending' — Super Admin 검토 후 active 전환 필요.
 * AI 자동 ACTIVE 절대 금지.
 *
 * Coverage:
 *   P0 MISSING 10개:
 *     AUTH_ACCOUNT_WITHDRAWAL, AUTH_POOL_ACCESS_DENIED,
 *     ATTENDANCE_PERMISSION_DENIED, NOTIFICATION_PERMISSION_OS,
 *     DATA_NOT_VISIBLE_ROLE_MISMATCH, DATA_NOT_VISIBLE_FILTER,
 *     KNOWN_ISSUE_SERVER_API, KNOWN_ISSUE_AI_PROVIDER,
 *     KNOWN_ISSUE_PUSH, KNOWN_ISSUE_BILLING
 *
 *   P1/P2 launch-relevant PARTIAL 11개:
 *     DIARY_AI_FAILED, DIARY_SAVE_FAILED, DIARY_PHOTO_UPLOAD_FAILED,
 *     BILLING_PAYMENT_FAILED, PARENT_CHILD_NOT_LINKED,
 *     DIARY_PARENT_NOT_VISIBLE, X_SETUP_HOW_TO,
 *     AI_GROWTH_REPORT_HOW_TO, ATTENDANCE_SAVE_FAILED
 *
 * Source evidence: repository code only — no SWIMNOTE policy invented.
 * KNOWN_ISSUE candidates use FAQ type (no incident_id linkage — CS15 책임).
 *
 * Total candidates: 21 (FAQ×11, SOLUTION×10)
 */

import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

let ran = false;

export async function runCs12Migration() {
  if (ran) return;
  ran = true;

  try {
    const seeds: Cs12SeedItem[] = [

      // ══════════════════════════════════════════════════════════
      // P0: AUTH_ACCOUNT_WITHDRAWAL
      // Source: auth.ts:2449-2548 / settings.tsx:424-437
      // ══════════════════════════════════════════════════════════

      {
        id: "ki_cs12_account_withdrawal",
        item_type: "FAQ",
        category: "ACCOUNT",
        feature: "WITHDRAWAL",
        title: "회원 탈퇴 방법",
        question: "스윔노트 계정을 탈퇴하려면 어떻게 하나요?",
        answer:
          // CS19: 탈퇴 복구 절대 단정 표현 제거.
          // auth.ts:2451 — immediate=false(기본): 90일 유예, 기간 내 재가입 시 데이터 복구 가능.
          // immediate=true: 즉시 익명화. 두 경로 혼재 → 고객센터 안내로 전환.
          "앱 설정 화면에서 '회원 탈퇴'를 선택하면 탈퇴를 신청할 수 있습니다. " +
          "탈퇴 처리 방식은 계정 유형에 따라 다릅니다. " +
          "수영장 관리자 계정은 유료 구독 중일 경우 90일 유예 기간이 적용됩니다. " +
          "데이터 복구 가능 여부 등 자세한 사항은 고객센터에 문의해 주세요.",
        content:
          "회원 탈퇴는 앱 > 설정 > 회원 탈퇴에서 신청합니다. " +
          "강사/학부모는 즉시 탈퇴 처리되고, 유료 구독 중인 수영장 관리자는 90일 유예 후 자동 완료됩니다. " +
          "탈퇴 처리 중에는 읽기 전용 모드로 전환됩니다. " +
          "유예 기간 중 재가입 등 데이터 복구 가능 여부는 고객센터에서 확인하시기 바랍니다.",
        affected_roles: ["pool_admin", "teacher", "parent_account"],
        affected_modes: ["normal", "x"],
        frontend_screen_id: "TEACHER_SETTINGS",
        source_type: "CODE_POLICY",
        source_ref: "auth.ts:2449-2548 / settings.tsx:424-437",
      },

      {
        id: "ki_cs12_pool_admin_withdrawal_deferred",
        item_type: "FAQ",
        category: "ACCOUNT",
        feature: "WITHDRAWAL",
        title: "수영장 관리자 탈퇴 유예 기간 안내",
        question: "수영장 관리자가 탈퇴하면 바로 삭제되나요?",
        answer:
          "유료 구독 중인 수영장 관리자 계정은 탈퇴 신청 후 90일 유예 기간이 적용됩니다. " +
          "이 기간에는 읽기만 가능하며, 90일 후 계정과 연결된 학부모 계정이 일괄 삭제됩니다. " +
          "무료 플랜은 즉시 탈퇴됩니다.",
        content:
          "유료 수영장 관리자: 탈퇴 신청 → 90일 유예 → 자동 완료. " +
          "유예 기간 중 결제 관련 조회만 허용(읽기 전용). " +
          "무료 플랜 및 강사: 즉시 처리. 탈퇴 시 수영장 내 학부모 계정도 연쇄 처리됩니다.",
        affected_roles: ["pool_admin"],
        affected_modes: ["normal", "x"],
        frontend_screen_id: "TEACHER_SETTINGS",
        source_type: "CODE_POLICY",
        source_ref: "auth.ts:2449-2548 (paid pool_admin 90-day deferred branch)",
      },

      // ══════════════════════════════════════════════════════════
      // P0: AUTH_POOL_ACCESS_DENIED
      // Source: middlewares/auth.ts:60-227 (requireRole / pool guard)
      // ══════════════════════════════════════════════════════════

      {
        id: "ki_cs12_pool_access_denied",
        item_type: "SOLUTION",
        category: "ACCOUNT",
        feature: "ACCESS",
        title: "수영장 접근 거부 오류 해결",
        question: "앱에서 '접근 권한이 없습니다' 오류가 나요.",
        answer:
          "로그인 계정이 해당 수영장에 등록되지 않았거나 토큰이 만료된 경우 발생합니다. " +
          "로그아웃 후 재로그인하거나 수영장 관리자에게 초대를 요청하세요.",
        content:
          "증상: 403/401 접근 거부 오류. " +
          "원인: 1) 계정이 이 수영장에 등록되지 않음 2) 앱 로그인 토큰 만료 3) 역할 변경됨. " +
          "확인: 로그아웃 후 재로그인 → 오류 지속 시 수영장 관리자에게 등록 요청.",
        affected_roles: ["pool_admin", "teacher", "parent_account"],
        affected_modes: ["normal", "x"],
        frontend_screen_id: null,
        source_type: "CODE_POLICY",
        source_ref: "middlewares/auth.ts:60-227 (requireRole / pool guard 403)",
        solution_steps: [
          "앱을 완전히 종료 후 재실행합니다.",
          "로그아웃 후 다시 로그인합니다.",
          "같은 오류가 반복되면 수영장 관리자에게 계정 등록 여부를 확인합니다.",
          "관리자라면 역할·풀 설정을 재확인하거나 고객센터에 문의합니다.",
        ],
      },

      // ══════════════════════════════════════════════════════════
      // P0: ATTENDANCE_PERMISSION_DENIED
      // Source: attendance.ts + students.ts:1424-1591 (role guards)
      // ══════════════════════════════════════════════════════════

      {
        id: "ki_cs12_attendance_permission",
        item_type: "FAQ",
        category: "ATTENDANCE",
        feature: "PERMISSION",
        title: "출결 기능 역할별 권한 안내",
        question: "출결을 기록하거나 수정할 수 없어요. 권한이 없다고 나와요.",
        answer:
          "출결 기록 및 수정은 수영장 관리자와 강사만 가능합니다. " +
          "학부모는 자녀의 출결 내역을 조회할 수 있지만 변경할 수 없습니다. " +
          "출결 삭제는 관리자만 가능합니다.",
        content:
          "출결 권한 구조: " +
          "관리자(pool_admin) — 기록·수정·삭제 모두 가능. " +
          "강사(teacher) — 기록·수정 가능, 삭제 불가. " +
          "학부모(parent_account) — 자신과 연결된 자녀 출결 조회만 가능. " +
          "출결 데이터는 자신이 속한 수영장 범위로 제한됩니다.",
        affected_roles: ["pool_admin", "teacher", "parent_account"],
        affected_modes: ["normal", "x"],
        frontend_screen_id: "ADMIN_ATTENDANCE",
        source_type: "CODE_POLICY",
        source_ref: "attendance.ts (requireAuth + pool resolver) / students.ts:1424-1591 (role guards)",
      },

      // ══════════════════════════════════════════════════════════
      // P0: NOTIFICATION_PERMISSION_OS (iOS + Android 분리)
      // Source: _layout.tsx:319-401 (PushTokenSync + requestPermissionsAsync)
      // ══════════════════════════════════════════════════════════

      {
        id: "ki_cs12_notification_permission_ios",
        item_type: "FAQ",
        category: "NOTIFICATION",
        feature: "OS_PERMISSION",
        title: "iPhone 알림 권한 설정 방법",
        question: "iPhone에서 스윔노트 알림이 안 와요. 어떻게 켜나요?",
        answer:
          "iPhone 설정 앱 > 스윔노트 > 알림을 열어 '알림 허용'을 켜주세요. " +
          "이후 스윔노트를 재실행하면 알림이 정상 등록됩니다.",
        content:
          "iOS 알림 허용 경로: 설정 > 스윔노트 > 알림 > '알림 허용' 토글 ON. " +
          "알림 스타일·배지·소리도 이 화면에서 설정 가능. " +
          "설정 후 앱 재실행 권장.",
        affected_roles: ["pool_admin", "teacher", "parent_account"],
        affected_modes: ["normal", "x"],
        frontend_screen_id: null,
        source_type: "CODE_POLICY",
        source_ref: "_layout.tsx:372-401 (PushTokenSync / requestPermissionsAsync iOS)",
      },

      {
        id: "ki_cs12_notification_permission_android",
        item_type: "FAQ",
        category: "NOTIFICATION",
        feature: "OS_PERMISSION",
        title: "Android 알림 권한 설정 방법",
        question: "안드로이드폰에서 스윔노트 알림이 안 와요. 어떻게 켜나요?",
        answer:
          "휴대폰 설정 > 앱 관리(또는 앱) > 스윔노트 > 알림에서 알림을 허용해 주세요. " +
          "설정 경로는 제조사·Android 버전에 따라 다를 수 있습니다.",
        content:
          "Android 알림 허용 경로: 설정 > 앱(또는 앱 관리) > 스윔노트 > 알림 > 허용. " +
          "삼성 One UI: 설정 > 알림 > 앱 알림에서도 확인 가능. " +
          "설정 후 앱 재실행 권장. Android 채널(스윔노트_알림)이 자동 생성됩니다.",
        affected_roles: ["pool_admin", "teacher", "parent_account"],
        affected_modes: ["normal", "x"],
        frontend_screen_id: null,
        source_type: "CODE_POLICY",
        source_ref: "_layout.tsx:319-369 (Android channel setup) + :372-401 (requestPermissionsAsync)",
      },

      // ══════════════════════════════════════════════════════════
      // P0: DATA_NOT_VISIBLE_ROLE_MISMATCH
      // Source: middlewares/auth.ts + parent.ts + attendance.ts (role scope)
      // ══════════════════════════════════════════════════════════

      {
        id: "ki_cs12_data_role_mismatch",
        item_type: "SOLUTION",
        category: "DATA_VISIBILITY",
        feature: "ROLE_MISMATCH",
        title: "역할 불일치로 데이터가 안 보이는 경우 해결",
        question: "데이터가 있어야 하는데 목록에 아무것도 안 보여요. 역할 문제인가요?",
        answer:
          "역할(관리자·강사·학부모)에 따라 볼 수 있는 데이터 범위가 다릅니다. " +
          "학부모는 연결된 자녀의 데이터만, 강사는 담당 반 데이터만 조회할 수 있습니다.",
        content:
          "증상: 특정 데이터가 목록에 없음. " +
          "확인 사항: " +
          "1) 현재 로그인 역할 확인 " +
          "2) 학부모 — 자녀 연결 여부 확인 " +
          "3) 강사 — 담당 반 배정 여부 확인 " +
          "4) 로그아웃 후 재로그인으로 토큰 갱신.",
        affected_roles: ["teacher", "parent_account"],
        affected_modes: ["normal", "x"],
        frontend_screen_id: null,
        source_type: "CODE_POLICY",
        source_ref:
          "middlewares/auth.ts (pool resolver + role guard) / " +
          "attendance.ts:32-47 (parent-linked branch) / parent.ts (child scope)",
        solution_steps: [
          "현재 로그인된 계정 역할(관리자/강사/학부모)을 확인합니다.",
          "학부모인 경우 자녀가 수영장에 등록되고 연결되어 있는지 확인합니다.",
          "강사인 경우 해당 반에 배정되어 있는지 관리자에게 확인합니다.",
          "로그아웃 후 재로그인하여 토큰을 갱신합니다.",
          "문제가 지속되면 수영장 관리자에게 문의합니다.",
        ],
      },

      // ══════════════════════════════════════════════════════════
      // P0: DATA_NOT_VISIBLE_FILTER
      // Source: attendance.tsx / diary.tsx / photos.tsx (filter UI)
      // ══════════════════════════════════════════════════════════

      {
        id: "ki_cs12_data_filter_check",
        item_type: "FAQ",
        category: "DATA_VISIBILITY",
        feature: "FILTER",
        title: "필터·날짜 설정으로 데이터가 안 보이는 경우 확인",
        question: "데이터가 없는 것처럼 보이는데 실제로는 있을 수 있나요?",
        answer:
          "날짜 범위, 반(class), 상태 필터 설정에 따라 데이터가 보이지 않을 수 있습니다. " +
          "날짜를 오늘 또는 전체 기간으로, 반 필터를 '전체'로 변경해 다시 확인해 보세요.",
        content:
          "필터 확인 방법: " +
          "1) 날짜 필터 — 조회 기간을 오늘 또는 전체 기간으로 변경 " +
          "2) 반 필터 — '전체 반'으로 변경 " +
          "3) 상태 필터 — 전체 상태로 변경. " +
          "필터가 화면마다 별도로 유지되므로 각 화면에서 직접 확인 필요.",
        affected_roles: ["pool_admin", "teacher", "parent_account"],
        affected_modes: ["normal", "x"],
        frontend_screen_id: null,
        source_type: "FRONTEND_MAP",
        source_ref:
          "attendance.tsx (date/class filter UI) / " +
          "diary.tsx (date filter) / photos.tsx (filter UI)",
      },

      // ══════════════════════════════════════════════════════════
      // P0: KNOWN_ISSUE_SERVER_API (FAQ — troubleshoot; no fake incident)
      // Source: support-resolver.ts (KNOWN_ISSUE layer + escalation contract)
      // ══════════════════════════════════════════════════════════

      {
        id: "ki_cs12_server_error_triage",
        item_type: "FAQ",
        category: "KNOWN_ISSUE",
        feature: "SERVER_API",
        title: "서버 오류 발생 시 확인 방법",
        question: "앱에서 '서버 오류' 또는 '연결 실패' 메시지가 떠요.",
        answer:
          "잠시 후 다시 시도해 보세요. 인터넷 연결을 확인하고, 앱을 재실행해도 지속되면 " +
          "스윔노트 고객센터로 문의해 주세요.",
        content:
          "서버 오류 확인 순서: " +
          "1) 인터넷 연결 확인(Wi-Fi/LTE) " +
          "2) 앱 재실행 " +
          "3) 잠시(5분) 후 재시도 " +
          "4) 지속 시 고객센터 문의 — 오류 화면 스크린샷 첨부 권장. " +
          "일시적 서버 점검 또는 네트워크 문제일 수 있습니다.",
        affected_roles: ["pool_admin", "teacher", "parent_account"],
        affected_modes: ["normal", "x"],
        frontend_screen_id: null,
        source_type: "CODE_POLICY",
        source_ref:
          "support-resolver.ts (KNOWN_ISSUE layer + NO_MATCH escalation) / " +
          "support-trace.ts (error observation stages)",
      },

      // ══════════════════════════════════════════════════════════
      // P0: KNOWN_ISSUE_AI_PROVIDER (FAQ — troubleshoot; no fake incident)
      // Source: diary.ts AI generate route / support-resolver.ts
      // ══════════════════════════════════════════════════════════

      {
        id: "ki_cs12_ai_error_triage",
        item_type: "FAQ",
        category: "KNOWN_ISSUE",
        feature: "AI_PROVIDER",
        title: "AI 기능 오류 발생 시 확인 방법",
        question: "AI 일지 생성이나 성장 리포트가 안 돼요. 오류가 떠요.",
        answer:
          "AI 서비스는 일시적으로 지연되거나 중단될 수 있습니다. " +
          "잠시 후 다시 시도하거나 직접 일지를 작성할 수 있습니다. " +
          "반복 발생 시 고객센터로 문의해 주세요.",
        content:
          "AI 오류 확인: " +
          "1) 잠시(5-10분) 후 재시도 " +
          "2) AI 없이 직접 일지 작성 가능 " +
          "3) 성장 리포트는 분석 큐에 들어간 경우 잠시 후 갱신됨 " +
          "4) 반복 오류 시 고객센터 문의 + 오류 내용 첨부. " +
          "AI 일지 생성 실패 시 직접 입력으로 대체 가능합니다.",
        affected_roles: ["pool_admin", "teacher"],
        affected_modes: ["normal", "x"],
        frontend_screen_id: "TEACHER_DIARY", // CS19: screen_id 수정 (frontend-map.v1 실제 TEACHER_DIARY)
        source_type: "CODE_POLICY",
        source_ref:
          "diary.ts (AI generate route) / " +
          "ai-engine-template-pipeline (ai-engine-template-pipeline.md) / " +
          "support-resolver.ts (AI_PROVIDER KNOWN_ISSUE layer)",
      },

      // ══════════════════════════════════════════════════════════
      // P0: KNOWN_ISSUE_PUSH (SOLUTION — push token troubleshoot)
      // Source: _layout.tsx:372-401 (PushTokenSync) / push-token route
      // ══════════════════════════════════════════════════════════

      {
        id: "ki_cs12_push_not_working",
        item_type: "SOLUTION",
        category: "NOTIFICATION",
        feature: "PUSH_FAILURE",
        title: "알림 권한은 켜져 있는데 알림이 오지 않는 경우 해결",
        question: "알림 권한은 켜져 있는데 알림이 하나도 안 와요.",
        answer:
          "OS 알림 권한 외에도 앱 내 알림 토큰 등록이 필요합니다. " +
          "앱을 재실행하면 토큰이 자동으로 등록됩니다. " +
          "해결되지 않으면 로그아웃 후 재로그인을 시도하세요.",
        content:
          "증상: OS 알림 권한 ON 상태인데 알림 미수신. " +
          "원인: 푸시 토큰 미등록 또는 만료. " +
          "해결: 앱 재실행 → 로그아웃 후 재로그인. " +
          "Expo Go 앱 사용 중이면 실제 앱(스토어 설치본)에서만 동작합니다.",
        affected_roles: ["pool_admin", "teacher", "parent_account"],
        affected_modes: ["normal", "x"],
        frontend_screen_id: null,
        source_type: "CODE_POLICY",
        source_ref: "_layout.tsx:372-401 (PushTokenSync) / push-token route",
        solution_steps: [
          "OS 알림 권한이 켜져 있는지 확인합니다 (iOS 설정 > 스윔노트 > 알림 / Android 앱 알림).",
          "스윔노트 앱을 완전히 종료 후 재실행합니다.",
          "여전히 알림이 오지 않으면 로그아웃 후 재로그인합니다.",
          "Expo Go 앱이면 앱스토어/플레이스토어 설치본으로 확인합니다.",
          "해결되지 않으면 고객센터로 문의해 주세요.",
        ],
      },

      // ══════════════════════════════════════════════════════════
      // P0: KNOWN_ISSUE_BILLING (FAQ — billing error troubleshoot)
      // Source: billing.ts (RevenueCat) / app/(admin)/billing.tsx
      // ══════════════════════════════════════════════════════════

      {
        id: "ki_cs12_billing_error_triage",
        item_type: "FAQ",
        category: "BILLING",
        feature: "BILLING_ERROR",
        title: "결제·구독 오류 발생 시 확인 방법",
        question: "결제/구독 화면에서 오류가 발생했어요.",
        answer:
          "결제는 앱스토어(Apple) 또는 플레이스토어(Google)를 통해 처리됩니다. " +
          "카드 잔액·한도, 스토어 결제 수단 설정을 확인하고 잠시 후 다시 시도해 보세요.",
        content:
          "결제 오류 확인: " +
          "1) 앱스토어/플레이스토어 결제 수단 유효성 확인 " +
          "2) 카드 한도·잔액 확인 " +
          "3) 잠시 후 재시도 " +
          "4) 스토어 외 환불/취소 문의는 각 스토어 고객센터 이용. " +
          "스윔노트 구독은 스토어 인앱 결제로만 처리됩니다.",
        affected_roles: ["pool_admin"],
        affected_modes: ["normal", "x"],
        frontend_screen_id: "ADMIN_BILLING",
        source_type: "CODE_POLICY",
        source_ref: "billing.ts (RevenueCat webhook + subscribe route) / app/(admin)/billing.tsx",
      },

      // ══════════════════════════════════════════════════════════
      // P1: DIARY_AI_FAILED (PARTIAL → SOLUTION)
      // Source: diary.ts (AI generate) / ai-engine-template-pipeline
      // ══════════════════════════════════════════════════════════

      {
        id: "ki_cs12_diary_ai_failed",
        item_type: "SOLUTION",
        category: "DIARY",
        feature: "AI_GENERATION",
        title: "AI 일지 자동 생성 실패 해결",
        question: "AI로 일지 자동 생성을 눌렀는데 오류가 나거나 내용이 안 나와요.",
        answer:
          "AI 생성은 학생 정보와 출결 데이터를 기반으로 작동합니다. " +
          "학생 이름이나 출결 기록이 없거나 AI 서비스 일시 오류 시 실패할 수 있습니다. " +
          "직접 작성하거나 잠시 후 재시도해 주세요.",
        content:
          "AI 일지 생성 실패 원인: " +
          "1) 학생 정보 미등록 " +
          "2) 당일 출결 기록 없음 " +
          "3) AI 서비스 일시 오류 " +
          "4) 타임아웃(30초 초과). " +
          "X 모드의 경우 커리큘럼 설정 완료 여부 확인 필요. " +
          "해결: 직접 일지 작성 또는 잠시 후 재시도.",
        affected_roles: ["teacher"],
        affected_modes: ["normal", "x"],
        frontend_screen_id: "TEACHER_DIARY", // CS19: screen_id 수정 (frontend-map.v1 실제 TEACHER_DIARY)
        source_type: "CODE_POLICY",
        source_ref:
          "diary.ts (AI generate route) / " +
          "ai-engine-template-pipeline (template scoring + candidate selection)",
        solution_steps: [
          "학생 정보가 등록되어 있는지 확인합니다.",
          "당일 출결 기록이 있는지 확인합니다.",
          "잠시 후 다시 'AI 생성' 버튼을 눌러봅니다.",
          "계속 실패하면 직접 일지 내용을 입력합니다.",
          "반복 발생 시 고객센터로 문의해 주세요.",
        ],
      },

      // ══════════════════════════════════════════════════════════
      // P1: DIARY_SAVE_FAILED (PARTIAL → SOLUTION)
      // Source: diary.ts (POST/PATCH diary routes)
      // ══════════════════════════════════════════════════════════

      {
        id: "ki_cs12_diary_save_failed",
        item_type: "SOLUTION",
        category: "DIARY",
        feature: "SAVE_FAILURE",
        title: "일지 저장 실패 해결",
        question: "일지를 저장하려는데 오류가 나고 저장이 안 돼요.",
        answer:
          "인터넷 연결을 확인하고 다시 시도해 보세요. " +
          "사진이 포함된 경우 파일 크기가 크면 오류가 날 수 있습니다.",
        content:
          "일지 저장 실패 원인: " +
          "1) 네트워크 연결 불안정 " +
          "2) 첨부 사진 용량 초과 " +
          "3) 서버 일시 오류. " +
          "확인: 네트워크 상태 → 재시도 → 사진 제거 후 저장 → 이후 사진 별도 추가.",
        affected_roles: ["teacher"],
        affected_modes: ["normal", "x"],
        frontend_screen_id: "TEACHER_DIARY", // CS19: screen_id 수정 (frontend-map.v1 실제 TEACHER_DIARY)
        source_type: "CODE_POLICY",
        source_ref: "diary.ts (POST /diaries + PATCH /diaries/:id routes)",
        solution_steps: [
          "인터넷 연결 상태를 확인합니다.",
          "다시 저장 버튼을 눌러봅니다.",
          "첨부 사진이 있으면 사진 없이 먼저 저장 후 사진을 추가합니다.",
          "문제가 지속되면 내용을 메모 앱에 복사해 두고 나중에 저장합니다.",
        ],
      },

      // ══════════════════════════════════════════════════════════
      // P1: DIARY_PHOTO_UPLOAD_FAILED (PARTIAL → SOLUTION)
      // Source: diary.ts (photo upload routes) / object-storage
      // ══════════════════════════════════════════════════════════

      {
        id: "ki_cs12_diary_photo_upload_failed",
        item_type: "SOLUTION",
        category: "DIARY",
        feature: "PHOTO_UPLOAD",
        title: "일지 사진 업로드 실패 해결",
        question: "일지에 사진을 첨부하려는데 업로드가 안 돼요.",
        answer:
          "인터넷 연결을 확인하고 다시 시도해 보세요. " +
          "사진 용량이 크거나 갤러리 접근 권한이 없으면 업로드가 안 될 수 있습니다.",
        content:
          "사진 업로드 실패 원인: " +
          "1) 네트워크 불안정 " +
          "2) 사진 파일 용량 과대 " +
          "3) 갤러리(사진 라이브러리) 접근 권한 미허용 " +
          "4) 서버 스토리지 오류. " +
          "확인 순서: 권한 → 네트워크 → 재시도.",
        affected_roles: ["teacher"],
        affected_modes: ["normal", "x"],
        frontend_screen_id: "TEACHER_DIARY", // CS19: screen_id 수정 (frontend-map.v1 실제 TEACHER_DIARY)
        source_type: "CODE_POLICY",
        source_ref: "diary.ts (photo upload routes) / object-storage (R2 uploads)",
        solution_steps: [
          "앱에 사진 라이브러리 접근 권한을 허용했는지 확인합니다.",
          "인터넷 연결 상태를 확인합니다.",
          "사진 파일 크기를 줄이거나 다른 사진으로 시도합니다.",
          "잠시 후 다시 업로드를 시도합니다.",
        ],
      },

      // ══════════════════════════════════════════════════════════
      // P1: BILLING_PAYMENT_FAILED (PARTIAL → SOLUTION)
      // Source: billing.ts (subscribe route + RevenueCat integration)
      // ══════════════════════════════════════════════════════════

      {
        id: "ki_cs12_billing_payment_failed",
        item_type: "SOLUTION",
        category: "BILLING",
        feature: "PAYMENT_FAILURE",
        title: "구독 결제 실패 해결",
        question: "구독을 신청했는데 결제가 안 됐어요.",
        answer:
          "앱스토어(Apple) 또는 플레이스토어(Google) 결제 수단을 확인해 주세요. " +
          "카드 잔액 부족, 한도 초과, 스토어 결제 정보 만료가 원인일 수 있습니다.",
        content:
          "결제 실패 원인: " +
          "1) 카드 잔액/한도 문제 " +
          "2) 스토어 등록 카드 만료 " +
          "3) 스토어 계정 결제 제한 " +
          "4) 일시적 스토어 오류. " +
          "해결: 스토어 결제 수단 업데이트 → 재시도. " +
          "환불은 각 스토어 고객센터 이용.",
        affected_roles: ["pool_admin"],
        affected_modes: ["normal", "x"],
        frontend_screen_id: "ADMIN_BILLING",
        source_type: "CODE_POLICY",
        source_ref: "billing.ts (subscribe route + RevenueCat webhook integration)",
        solution_steps: [
          "App Store 또는 Google Play 결제 수단(카드)이 유효한지 확인합니다.",
          "카드 잔액과 결제 한도를 확인합니다.",
          "스토어 앱에서 결제 정보를 업데이트 후 재시도합니다.",
          "문제가 지속되면 스토어 고객센터 또는 스윔노트 고객센터로 문의해 주세요.",
        ],
      },

      // ══════════════════════════════════════════════════════════
      // P1: PARENT_CHILD_NOT_LINKED (PARTIAL → SOLUTION)
      // Source: parent.ts (parent-child link) / parent home.tsx
      // ══════════════════════════════════════════════════════════

      {
        id: "ki_cs12_parent_not_linked",
        item_type: "SOLUTION",
        category: "PARENT",
        feature: "CHILD_LINK",
        title: "학부모 앱에서 자녀 정보가 안 보이는 경우",
        question: "학부모로 로그인했는데 자녀 정보가 안 보여요.",
        answer:
          "자녀가 수영장에 등록되어 있고 학부모 계정과 연결되어 있어야 정보가 표시됩니다. " +
          "수영장 관리자에게 자녀 등록 및 학부모 연결을 요청해 주세요.",
        content:
          "학부모 앱 자녀 미표시 원인: " +
          "1) 자녀가 수영장에 미등록 " +
          "2) 학부모 계정이 자녀와 미연결(관리자 승인 필요) " +
          "3) 가입한 전화번호로 자녀가 등록되지 않음. " +
          "해결: 수영장 관리자에게 등록 및 연결 요청.",
        affected_roles: ["parent_account"],
        affected_modes: ["normal", "x"],
        frontend_screen_id: "PARENT_HOME",
        source_type: "CODE_POLICY",
        source_ref: "parent.ts (parent-child link routes) / app/(parent)/home.tsx",
        solution_steps: [
          "수영장 관리자에게 자녀가 수영장에 등록되어 있는지 확인합니다.",
          "관리자에게 학부모 계정(전화번호)을 자녀와 연결해 달라고 요청합니다.",
          "연결 완료 후 앱을 재실행하면 자녀 정보가 표시됩니다.",
          "여러 자녀가 있는 경우 각 자녀별로 연결이 필요합니다.",
        ],
      },

      // ══════════════════════════════════════════════════════════
      // P1: DIARY_PARENT_NOT_VISIBLE (PARTIAL → SOLUTION)
      // Source: diary.ts:695+ (parent diary list) / parent diary screen
      // ══════════════════════════════════════════════════════════

      {
        id: "ki_cs12_parent_diary_not_visible",
        item_type: "SOLUTION",
        category: "DIARY",
        feature: "PARENT_VISIBILITY",
        title: "학부모 앱에서 수업 일지가 안 보이는 경우",
        question: "학부모 앱에서 수업 일지가 안 보여요.",
        answer:
          "강사가 일지를 작성하지 않았거나 자녀와의 연결이 해제된 경우 일지가 표시되지 않습니다. " +
          "강사에게 일지 작성 여부를 확인하거나 수영장 관리자에게 문의해 주세요.",
        content:
          "학부모 일지 미표시 원인: " +
          "1) 강사가 해당 날짜 일지 미작성 " +
          "2) 자녀-학부모 연결 해제 " +
          "3) 자녀가 해당 반에 미배정. " +
          "확인: 강사/관리자에게 일지 작성 여부 문의.",
        affected_roles: ["parent_account"],
        affected_modes: ["normal", "x"],
        frontend_screen_id: "PARENT_DIARY",
        source_type: "CODE_POLICY",
        source_ref: "diary.ts:695+ (parent diary list query) / app/(parent)/diary.tsx",
        solution_steps: [
          "자녀가 수업에 출석했는지 확인합니다.",
          "강사에게 해당 날짜 일지 작성 여부를 문의합니다.",
          "앱을 재실행하거나 당겨서 새로고침합니다.",
          "자녀 연결이 해제된 경우 수영장 관리자에게 재연결을 요청합니다.",
        ],
      },

      // ══════════════════════════════════════════════════════════
      // P1: X_SETUP_HOW_TO (PARTIAL → FAQ)
      // Source: x-setup.ts:127-454 / app/(admin)/x-setup.tsx
      // ══════════════════════════════════════════════════════════

      {
        id: "ki_cs12_x_setup_howto",
        item_type: "FAQ",
        category: "X_MODE",
        feature: "SETUP",
        title: "X 모드 자료 제출 방법",
        question: "X 모드 신청을 위한 자료는 어떻게 제출하나요?",
        answer:
          "관리자 앱 > X 설정 화면에서 커리큘럼(DOCX), 로고, 홍보 사진 등을 업로드하고 제출하면 됩니다. " +
          "제출 후 스윔노트 팀이 검토하며 승인 시 X 모드가 활성화됩니다.",
        content:
          "X 모드 자료 제출 절차: " +
          "1) 관리자 > X 설정 진입 " +
          "2) 커리큘럼 DOCX 파일 업로드 " +
          "3) 수영장 로고 업로드 " +
          "4) 홍보 사진 최대 10장 업로드 " +
          "5) 제출 버튼 클릭 → 팀 검토 시작. " +
          "제출 후 상태는 X 설정 화면에서 확인 가능합니다.",
        affected_roles: ["pool_admin"],
        affected_modes: ["normal", "x"],
        frontend_screen_id: "ADMIN_X_SETUP",
        source_type: "CODE_POLICY",
        source_ref:
          "x-setup.ts:127-454 (GET status + upload curriculum/logo/photo + submit routes) / " +
          "app/(admin)/x-setup.tsx",
      },

      // ══════════════════════════════════════════════════════════
      // P1: AI_GROWTH_REPORT_HOW_TO (PARTIAL → FAQ)
      // Source: growth-report-analyze.ts / publish-growth-report.ts
      // ══════════════════════════════════════════════════════════

      {
        id: "ki_cs12_growth_report_pending",
        item_type: "FAQ",
        category: "GROWTH_REPORT",
        feature: "GENERATION",
        title: "성장 리포트 생성 대기 및 확인 방법",
        question: "성장 리포트가 아직 안 만들어졌어요. 언제 볼 수 있나요?",
        answer:
          // CS19: affected_modes normal 제거. PARENT_GROWTH_REPORT available_modes=["x"], permissions=["x_entitlement"].
          // X 모드 전용 기능임을 answer에 명시.
          "성장 리포트는 스윔노트X(X 모드)가 활성화된 수영장에서만 이용할 수 있습니다. " +
          "수업 데이터를 분석해 자동으로 생성되며, 강사 검토·승인 후 학부모에게 공개됩니다. " +
          "생성에 시간이 걸릴 수 있으니 잠시 후 새로고침해 주세요.",
        content:
          "성장 리포트는 스윔노트X(X 모드) 전용 기능입니다. " +
          "성장 리포트 생성 흐름: " +
          "1) 수업/출결 데이터 누적 " +
          "2) AI 분석 실행(X 모드 엔진) " +
          "3) 강사 검토 및 승인 " +
          "4) 학부모 공개. " +
          "생성 중이면 '분석 중' 상태가 표시되며, " +
          "강사가 아직 승인하지 않은 경우 학부모에게는 보이지 않습니다.",
        affected_roles: ["pool_admin", "teacher", "parent_account"],
        affected_modes: ["x"], // CS19: x-only 수정 — PARENT_GROWTH_REPORT available_modes=[x]
        frontend_screen_id: "PARENT_GROWTH_REPORT",
        source_type: "CODE_POLICY",
        source_ref:
          "growth-report-analyze.ts / publish-growth-report.ts / " +
          "x-growth.ts / app/(parent)/growth-report.tsx",
      },

      // ══════════════════════════════════════════════════════════
      // P1: ATTENDANCE_SAVE_FAILED (PARTIAL → SOLUTION)
      // Source: attendance.ts (POST route) / students.ts:1424-1591
      // ══════════════════════════════════════════════════════════

      {
        id: "ki_cs12_attendance_save_failed",
        item_type: "SOLUTION",
        category: "ATTENDANCE",
        feature: "SAVE_FAILURE",
        title: "출결 저장 실패 해결",
        question: "출결을 기록하려는데 저장이 안 돼요.",
        answer:
          "인터넷 연결을 확인하고 다시 시도해 보세요. " +
          "권한이 없거나 이미 해당 학생의 출결이 기록된 경우 저장이 제한될 수 있습니다.",
        content:
          "출결 저장 실패 원인: " +
          "1) 네트워크 오류 " +
          "2) 권한 부족(학부모는 저장 불가) " +
          "3) 이미 처리된 출결 중복 시도 " +
          "4) 서버 오류. " +
          "확인 순서: 권한 → 네트워크 → 재시도.",
        affected_roles: ["pool_admin", "teacher"],
        affected_modes: ["normal", "x"],
        frontend_screen_id: "ADMIN_ATTENDANCE",
        source_type: "CODE_POLICY",
        source_ref:
          "attendance.ts (POST route) / students.ts:1424-1591 (role guards for attendance subroutes)",
        solution_steps: [
          "인터넷 연결 상태를 확인합니다.",
          "강사 또는 관리자 권한 계정인지 확인합니다 (학부모는 출결 저장 불가).",
          "해당 학생의 출결이 이미 기록된 상태인지 확인합니다.",
          "다시 저장을 시도합니다.",
          "문제가 지속되면 수영장 관리자에게 문의합니다.",
        ],
      },
    ];

    // ── Idempotent insert (WHERE NOT EXISTS) ────────────────────────────────
    for (const seed of seeds) {
      try {
        const rolesJson = seed.affected_roles
          ? `ARRAY[${seed.affected_roles.map((r) => `'${r}'`).join(",")}]::text[]`
          : "NULL";
        const modesJson = seed.affected_modes
          ? `ARRAY[${seed.affected_modes.map((m) => `'${m}'`).join(",")}]::text[]`
          : "NULL";
        const stepsJson = seed.solution_steps
          ? `'${JSON.stringify(seed.solution_steps).replace(/'/g, "''")}'::jsonb`
          : "NULL";

        await superAdminDb.execute(sql.raw(`
          INSERT INTO support_knowledge_items (
            id, item_type, scope, category, feature,
            title, content, question, answer,
            affected_roles, affected_modes,
            frontend_screen_id, source_type, source_ref,
            solution_steps,
            status, revision, created_at, updated_at
          )
          SELECT
            '${seed.id}',
            '${seed.item_type}',
            'global',
            ${seed.category ? `'${seed.category}'` : "NULL"},
            ${seed.feature   ? `'${seed.feature}'`   : "NULL"},
            '${esc(seed.title)}',
            '${esc(seed.content)}',
            ${seed.question  ? `'${esc(seed.question)}'`  : "NULL"},
            ${seed.answer    ? `'${esc(seed.answer)}'`    : "NULL"},
            ${rolesJson},
            ${modesJson},
            ${seed.frontend_screen_id ? `'${seed.frontend_screen_id}'` : "NULL"},
            ${seed.source_type ? `'${seed.source_type}'` : "NULL"},
            ${seed.source_ref  ? `'${esc(seed.source_ref)}'`  : "NULL"},
            ${stepsJson},
            'pending', 1, NOW(), NOW()
          WHERE NOT EXISTS (
            SELECT 1 FROM support_knowledge_items WHERE id = '${seed.id}'
          )
        `));
      } catch (e: any) {
        console.error(`[cs-12-seed] ${seed.id} failed:`, e?.message);
      }
    }

    console.log("[cs-12] migration complete — 21 candidates seeded (status=pending)");
  } catch (e: any) {
    console.error("[cs-12] migration error:", e?.message);
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/'/g, "''");
}

interface Cs12SeedItem {
  id: string;
  item_type: "FAQ" | "SOLUTION";
  category: string | null;
  feature: string | null;
  title: string;
  content: string;
  question?: string;
  answer?: string;
  affected_roles?: string[];
  affected_modes?: string[];
  frontend_screen_id?: string | null;
  source_type?: string;
  source_ref?: string;
  solution_steps?: string[];
}

// ── Candidate registry (used by tests) ───────────────────────────────────────

export const CS12_CANDIDATE_IDS = [
  // P0 — AUTH_ACCOUNT_WITHDRAWAL
  "ki_cs12_account_withdrawal",
  "ki_cs12_pool_admin_withdrawal_deferred",
  // P0 — AUTH_POOL_ACCESS_DENIED
  "ki_cs12_pool_access_denied",
  // P0 — ATTENDANCE_PERMISSION_DENIED
  "ki_cs12_attendance_permission",
  // P0 — NOTIFICATION_PERMISSION_OS
  "ki_cs12_notification_permission_ios",
  "ki_cs12_notification_permission_android",
  // P0 — DATA_NOT_VISIBLE_ROLE_MISMATCH
  "ki_cs12_data_role_mismatch",
  // P0 — DATA_NOT_VISIBLE_FILTER
  "ki_cs12_data_filter_check",
  // P0 — KNOWN_ISSUE_SERVER_API
  "ki_cs12_server_error_triage",
  // P0 — KNOWN_ISSUE_AI_PROVIDER
  "ki_cs12_ai_error_triage",
  // P0 — KNOWN_ISSUE_PUSH
  "ki_cs12_push_not_working",
  // P0 — KNOWN_ISSUE_BILLING
  "ki_cs12_billing_error_triage",
  // P1 — DIARY_AI_FAILED
  "ki_cs12_diary_ai_failed",
  // P1 — DIARY_SAVE_FAILED
  "ki_cs12_diary_save_failed",
  // P1 — DIARY_PHOTO_UPLOAD_FAILED
  "ki_cs12_diary_photo_upload_failed",
  // P1 — BILLING_PAYMENT_FAILED
  "ki_cs12_billing_payment_failed",
  // P1 — PARENT_CHILD_NOT_LINKED
  "ki_cs12_parent_not_linked",
  // P1 — DIARY_PARENT_NOT_VISIBLE
  "ki_cs12_parent_diary_not_visible",
  // P1 — X_SETUP_HOW_TO
  "ki_cs12_x_setup_howto",
  // P1 — AI_GROWTH_REPORT_HOW_TO
  "ki_cs12_growth_report_pending",
  // P1 — ATTENDANCE_SAVE_FAILED
  "ki_cs12_attendance_save_failed",
] as const;

export type Cs12CandidateId = (typeof CS12_CANDIDATE_IDS)[number];

/** CS12 P0 coverage record → candidate mapping */
export const CS12_P0_COVERAGE_MAP = {
  AUTH_ACCOUNT_WITHDRAWAL:      ["ki_cs12_account_withdrawal", "ki_cs12_pool_admin_withdrawal_deferred"],
  AUTH_POOL_ACCESS_DENIED:      ["ki_cs12_pool_access_denied"],
  ATTENDANCE_PERMISSION_DENIED: ["ki_cs12_attendance_permission"],
  NOTIFICATION_PERMISSION_OS:   ["ki_cs12_notification_permission_ios", "ki_cs12_notification_permission_android"],
  DATA_NOT_VISIBLE_ROLE_MISMATCH: ["ki_cs12_data_role_mismatch"],
  DATA_NOT_VISIBLE_FILTER:      ["ki_cs12_data_filter_check"],
  KNOWN_ISSUE_SERVER_API:       ["ki_cs12_server_error_triage"],
  KNOWN_ISSUE_AI_PROVIDER:      ["ki_cs12_ai_error_triage"],
  KNOWN_ISSUE_PUSH:             ["ki_cs12_push_not_working"],
  KNOWN_ISSUE_BILLING:          ["ki_cs12_billing_error_triage"],
} as const;

/** SOLUTION candidates (have solution_steps) */
export const CS12_SOLUTION_IDS = CS12_CANDIDATE_IDS.filter((id) =>
  [
    "ki_cs12_pool_access_denied",
    "ki_cs12_data_role_mismatch",
    "ki_cs12_push_not_working",
    "ki_cs12_diary_ai_failed",
    "ki_cs12_diary_save_failed",
    "ki_cs12_diary_photo_upload_failed",
    "ki_cs12_billing_payment_failed",
    "ki_cs12_parent_not_linked",
    "ki_cs12_parent_diary_not_visible",
    "ki_cs12_attendance_save_failed",
  ].includes(id)
);

/** FAQ candidates */
export const CS12_FAQ_IDS = CS12_CANDIDATE_IDS.filter(
  (id) => !CS12_SOLUTION_IDS.includes(id as any)
);
