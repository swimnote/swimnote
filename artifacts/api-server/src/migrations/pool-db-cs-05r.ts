/**
 * WP-CS-05R Migration — Support Knowledge + FAQ Foundation
 *
 * support_knowledge_items 최소 확장:
 *   + question TEXT           (FAQ 전용 질문 원문)
 *   + answer  TEXT            (FAQ 전용 검증 답변)
 *   + frontend_screen_id TEXT (CS-04R Frontend Map 연결)
 *   + source_type TEXT        (FRONTEND_MAP/CODE_POLICY/EXISTING_HELP/X_SETUP/MANUAL_ADMIN/OTHER)
 *   + source_ref  TEXT        (source 파일명·섹션 등)
 *   + revision INT DEFAULT 1  (변경 추적; Cache invalidation용)
 *   + affected_roles TEXT[]   (기존 affected_role 단수 대신 배열; 기존 컬럼 유지)
 *   + affected_modes TEXT[]   (기존 affected_mode 단수 대신 배열; 기존 컬럼 유지)
 *
 * Status 추가 허용값: inactive, archived  (기존: pending/active/deprecated 유지)
 *
 * Seed: 검증된 최소 초기 Knowledge (repository 사실 기반만, status=pending)
 *       Super Admin 승인 후에만 active — AI 자동 승인 금지.
 */

import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

let ran = false;

export async function runCs05rMigration() {
  if (ran) return;
  ran = true;

  try {
    // ── 1. 컬럼 추가 (IF NOT EXISTS 대신 예외 무시 패턴) ─────────────────────
    const alterCols = [
      `ALTER TABLE support_knowledge_items ADD COLUMN IF NOT EXISTS question           TEXT`,
      `ALTER TABLE support_knowledge_items ADD COLUMN IF NOT EXISTS answer             TEXT`,
      `ALTER TABLE support_knowledge_items ADD COLUMN IF NOT EXISTS frontend_screen_id TEXT`,
      `ALTER TABLE support_knowledge_items ADD COLUMN IF NOT EXISTS source_type        TEXT`,
      `ALTER TABLE support_knowledge_items ADD COLUMN IF NOT EXISTS source_ref         TEXT`,
      `ALTER TABLE support_knowledge_items ADD COLUMN IF NOT EXISTS revision           INT NOT NULL DEFAULT 1`,
      `ALTER TABLE support_knowledge_items ADD COLUMN IF NOT EXISTS affected_roles     TEXT[]`,
      `ALTER TABLE support_knowledge_items ADD COLUMN IF NOT EXISTS affected_modes     TEXT[]`,
    ];
    for (const stmt of alterCols) {
      try { await superAdminDb.execute(sql.raw(stmt)); } catch { /* already exists */ }
    }

    // ── 2. 인덱스 ────────────────────────────────────────────────────────────
    const indexes = [
      `CREATE INDEX IF NOT EXISTS support_knowledge_category_idx       ON support_knowledge_items(category)`,
      `CREATE INDEX IF NOT EXISTS support_knowledge_screen_idx         ON support_knowledge_items(frontend_screen_id)`,
      `CREATE INDEX IF NOT EXISTS support_knowledge_source_type_idx    ON support_knowledge_items(source_type)`,
    ];
    for (const stmt of indexes) {
      try { await superAdminDb.execute(sql.raw(stmt)); } catch { /* already exists */ }
    }

    // ── 3. 초기 Global Knowledge Seed (status=pending, revision=1) ───────────
    //     repository에서 확인된 사실만. AI 창작 금지.
    //     Super Admin이 검토 후 active로 전환 필요.
    //
    //     각 id 형식: ki_seed_<slug> — idempotent INSERT.
    const seeds: SeedItem[] = [
      // ── ACCOUNT / LOGIN ──────────────────────────────────────────────────────
      {
        id: "ki_seed_login_method",
        item_type: "FAQ",
        category: "ACCOUNT",
        feature: null,
        title: "스윔노트 로그인 방법",
        question: "스윔노트에 어떻게 로그인하나요?",
        answer: "스윔노트는 휴대폰 번호 인증(SMS 6자리 코드)으로 로그인합니다. 앱을 열어 번호를 입력하면 인증 문자가 발송됩니다.",
        content: "스윔노트 로그인은 휴대폰 번호 SMS 인증 방식을 사용합니다. 관리자/강사/학부모 모두 동일한 방식으로 로그인하며, 역할은 수영장 초대 코드(QR) 또는 관리자 등록에 따라 결정됩니다.",
        scope: "global",
        affected_roles: ["pool_admin", "sub_admin", "teacher", "parent"],
        affected_modes: ["normal", "x"],
        frontend_screen_id: "AUTH_LOGIN",
        source_type: "FRONTEND_MAP",
        source_ref: "frontend-map.v1.ts/AUTH_LOGIN",
        priority: 10,
      },
      {
        id: "ki_seed_role_invite_qr",
        item_type: "FAQ",
        category: "ACCOUNT",
        feature: null,
        title: "강사/학부모 초대 방법 (QR 코드)",
        question: "강사나 학부모를 어떻게 초대하나요?",
        answer: "대시보드 → 초대 QR에서 역할별 QR 코드를 확인하거나 초대 링크를 공유하세요. 상대방이 코드를 스캔하면 해당 수영장 구성원으로 등록됩니다.",
        content: "관리자는 초대 QR 화면에서 강사/학부모 초대를 위한 QR 코드를 생성·공유할 수 있습니다.",
        scope: "global",
        affected_roles: ["pool_admin", "sub_admin"],
        affected_modes: ["normal", "x"],
        frontend_screen_id: "ADMIN_INVITE_QR",
        source_type: "FRONTEND_MAP",
        source_ref: "frontend-map.v1.ts/ADMIN_INVITE_QR",
        priority: 9,
      },

      // ── ATTENDANCE ──────────────────────────────────────────────────────────
      {
        id: "ki_seed_attendance_record",
        item_type: "FAQ",
        category: "ATTENDANCE",
        feature: null,
        title: "출결 기록 방법",
        question: "학생 출결을 어떻게 기록하나요?",
        answer: "강사는 오늘의 수업 화면 또는 수업 관리에서 학생별 출석/결석/지각을 기록할 수 있습니다.",
        content: "출결은 강사가 수업 당일 기록하며, 관리자도 관리자 화면에서 확인 및 수정할 수 있습니다.",
        scope: "global",
        affected_roles: ["teacher", "pool_admin", "sub_admin"],
        affected_modes: ["normal", "x"],
        frontend_screen_id: "TEACHER_ATTENDANCE",
        source_type: "FRONTEND_MAP",
        source_ref: "frontend-map.v1.ts/TEACHER_ATTENDANCE",
        priority: 9,
      },
      {
        id: "ki_seed_attendance_parent_view",
        item_type: "FAQ",
        category: "ATTENDANCE",
        feature: null,
        title: "학부모 출결 확인",
        question: "자녀의 출결 현황을 어떻게 확인하나요?",
        answer: "학부모 앱 홈 화면에서 자녀의 이번 달 출결 현황을 확인할 수 있습니다.",
        content: "학부모는 앱 홈에서 자녀별 출결 현황을 볼 수 있습니다.",
        scope: "global",
        affected_roles: ["parent"],
        affected_modes: ["normal", "x"],
        frontend_screen_id: "PARENT_HOME",
        source_type: "FRONTEND_MAP",
        source_ref: "frontend-map.v1.ts/PARENT_HOME",
        priority: 7,
      },

      // ── MAKEUP (보강) ───────────────────────────────────────────────────────
      {
        id: "ki_seed_makeup_request",
        item_type: "FAQ",
        category: "ATTENDANCE",
        feature: null,
        title: "보강 신청 방법",
        question: "보강은 어떻게 신청하나요?",
        answer: "학부모가 앱에서 보강을 신청하거나, 관리자·강사가 직접 보강 수업을 등록할 수 있습니다. 보강은 결석 수업에 대해 대체 수업으로 처리됩니다.",
        content: "보강 신청은 학부모 앱 또는 관리자 화면에서 가능합니다. 보강 수업은 기존 스케줄 외 추가 수업으로 등록됩니다.",
        scope: "global",
        affected_roles: ["parent", "pool_admin", "sub_admin", "teacher"],
        affected_modes: ["normal", "x"],
        frontend_screen_id: "ADMIN_MAKEUP_MGMT",
        source_type: "FRONTEND_MAP",
        source_ref: "frontend-map.v1.ts/ADMIN_MAKEUP_MGMT",
        priority: 8,
      },
      {
        id: "ki_seed_makeup_expiry",
        item_type: "FAQ",
        category: "ATTENDANCE",
        feature: null,
        title: "보강 유효기간",
        question: "보강 신청은 언제까지 유효한가요?",
        answer: "보강 유효기간은 수영장별 설정에 따라 다릅니다. 만료된 보강은 자동으로 처리됩니다.",
        content: "보강 유효기간은 수영장 설정에서 관리됩니다. 유효기간 경과 시 미사용 보강은 자동 만료됩니다.",
        scope: "global",
        affected_roles: ["pool_admin", "parent"],
        affected_modes: ["normal", "x"],
        frontend_screen_id: "ADMIN_SETTINGS",
        source_type: "CODE_POLICY",
        source_ref: "extra-classes/makeup-expiry",
        priority: 6,
      },

      // ── DIARY ───────────────────────────────────────────────────────────────
      {
        id: "ki_seed_diary_teacher_write",
        item_type: "FAQ",
        category: "DIARY",
        feature: null,
        title: "수업 일지 작성",
        question: "수업 일지는 어디서 작성하나요?",
        answer: "강사는 수업 일지 화면에서 수업 일지를 작성할 수 있습니다. 날짜와 그룹을 선택한 후 내용을 입력하세요.",
        content: "강사 전용 수업 일지 작성 화면에서 날짜·그룹별로 일지를 기록합니다.",
        scope: "global",
        affected_roles: ["teacher"],
        affected_modes: ["normal", "x"],
        frontend_screen_id: "TEACHER_DIARY_WRITE",
        source_type: "FRONTEND_MAP",
        source_ref: "frontend-map.v1.ts/TEACHER_DIARY_WRITE",
        priority: 8,
      },
      {
        id: "ki_seed_diary_parent_view",
        item_type: "FAQ",
        category: "DIARY",
        feature: null,
        title: "학부모 일지 확인",
        question: "자녀의 수업 일지는 어디서 볼 수 있나요?",
        answer: "학부모 앱 하단의 일지 탭에서 자녀의 수업 일지를 확인할 수 있습니다.",
        content: "학부모는 앱 일지 탭에서 강사가 작성한 자녀 수업 일지를 확인합니다.",
        scope: "global",
        affected_roles: ["parent"],
        affected_modes: ["normal", "x"],
        frontend_screen_id: "PARENT_DIARY",
        source_type: "FRONTEND_MAP",
        source_ref: "frontend-map.v1.ts/PARENT_DIARY",
        priority: 7,
      },

      // ── AI DIARY ────────────────────────────────────────────────────────────
      {
        id: "ki_seed_ai_diary_generate",
        item_type: "FAQ",
        category: "AI_DIARY",
        feature: "ai-diary",
        title: "AI 일지 자동 생성",
        question: "AI로 일지를 자동 작성할 수 있나요?",
        answer: "네. 일지 작성 화면에서 AI 일지 생성 버튼을 탭하면 수업 정보를 바탕으로 초안이 자동 생성됩니다. 내용을 검토 후 수정해서 저장하세요.",
        content: "AI 일지 기능은 수업 그룹 정보를 기반으로 일지 초안을 생성합니다. 강사가 검토·수정 후 최종 저장합니다.",
        scope: "global",
        affected_roles: ["teacher"],
        affected_modes: ["normal", "x"],
        frontend_screen_id: "TEACHER_DIARY_WRITE",
        source_type: "CODE_POLICY",
        source_ref: "ai-v1/diary-generate",
        priority: 8,
      },

      // ── CURRICULUM ──────────────────────────────────────────────────────────
      {
        id: "ki_seed_curriculum_chat_parent",
        item_type: "FAQ",
        category: "CURRICULUM",
        feature: "parent-curriculum",
        title: "커리큘럼 Q&A 기능",
        question: "자녀의 수영 수준이나 커리큘럼에 대해 질문할 수 있나요?",
        answer: "학부모 앱 내 커리큘럼 Q&A 화면에서 자녀의 수준에 맞는 커리큘럼과 수영 레벨에 대해 질문할 수 있습니다.",
        content: "학부모용 커리큘럼 Q&A는 AI 기반으로 자녀의 수영 레벨과 관련 커리큘럼 정보를 안내합니다.",
        scope: "global",
        affected_roles: ["parent"],
        affected_modes: ["normal", "x"],
        frontend_screen_id: "PARENT_CURRICULUM_CHAT",
        source_type: "FRONTEND_MAP",
        source_ref: "frontend-map.v1.ts/PARENT_CURRICULUM_CHAT",
        priority: 7,
      },

      // ── GROWTH REPORT ───────────────────────────────────────────────────────
      {
        id: "ki_seed_growth_report_what",
        item_type: "FAQ",
        category: "GROWTH_REPORT",
        feature: null,
        title: "성장 리포트란?",
        question: "성장 리포트가 무엇인가요?",
        answer: "성장 리포트는 학생의 수영 실력 발전 과정을 AI가 분석하여 학부모에게 제공하는 리포트입니다. 강사 검토 후 학부모에게 공개됩니다.",
        content: "성장 리포트는 AI 분석 → 강사 검토 → 학부모 공개 순서로 진행됩니다. 리포트에는 학생의 수준 변화와 향후 과제가 포함됩니다.",
        scope: "global",
        affected_roles: ["pool_admin", "teacher", "parent"],
        affected_modes: ["x"],
        frontend_screen_id: "PARENT_GROWTH_REPORT",
        source_type: "CODE_POLICY",
        source_ref: "growth-report/publish-flow",
        priority: 8,
      },
      {
        id: "ki_seed_growth_report_where",
        item_type: "FAQ",
        category: "GROWTH_REPORT",
        feature: null,
        title: "성장 리포트 확인 위치",
        question: "성장 리포트는 어디서 볼 수 있나요?",
        answer: "학부모는 앱 하단 리포트 탭 또는 홈 화면의 성장 리포트 카드를 통해 확인할 수 있습니다. 강사는 성장 리포트 검토 화면에서 확인 및 승인을 합니다.",
        content: "학부모는 앱에서, 강사/관리자는 관리 화면에서 성장 리포트를 확인합니다.",
        scope: "global",
        affected_roles: ["parent", "teacher", "pool_admin"],
        affected_modes: ["x"],
        frontend_screen_id: "PARENT_GROWTH_REPORT",
        source_type: "FRONTEND_MAP",
        source_ref: "frontend-map.v1.ts/PARENT_GROWTH_REPORT",
        priority: 7,
      },

      // ── PHOTO / VIDEO ───────────────────────────────────────────────────────
      {
        id: "ki_seed_photo_album",
        item_type: "FAQ",
        category: "PHOTO_VIDEO",
        feature: null,
        title: "수업 사진 확인 방법",
        question: "수업 사진은 어디서 볼 수 있나요?",
        answer: "학부모 앱의 앨범 탭에서 강사가 업로드한 수업 사진을 확인할 수 있습니다.",
        content: "강사가 업로드한 수업 사진은 학부모 앱 앨범 탭에서 날짜별로 확인 가능합니다.",
        scope: "global",
        affected_roles: ["parent", "teacher"],
        affected_modes: ["normal", "x"],
        frontend_screen_id: "PARENT_ALBUM",
        source_type: "FRONTEND_MAP",
        source_ref: "frontend-map.v1.ts/PARENT_ALBUM",
        priority: 6,
      },

      // ── NOTIFICATION ────────────────────────────────────────────────────────
      {
        id: "ki_seed_push_notification",
        item_type: "FAQ",
        category: "NOTIFICATION",
        feature: null,
        title: "푸시 알림 설정",
        question: "앱 알림이 오지 않아요",
        answer: "스마트폰 설정 → 스윔노트 → 알림에서 알림 권한이 허용되어 있는지 확인하세요. 허용되어 있다면 앱 내 알림 설정 화면에서 항목별 알림 수신 여부를 확인하세요.",
        content: "알림 미수신 시 OS 알림 권한과 앱 내 알림 설정 두 곳을 모두 확인해야 합니다.",
        scope: "global",
        affected_roles: ["pool_admin", "teacher", "parent"],
        affected_modes: ["normal", "x"],
        frontend_screen_id: "COMMON_NOTIFICATION_SETTINGS",
        source_type: "FRONTEND_MAP",
        source_ref: "frontend-map.v1.ts/COMMON_NOTIFICATION_SETTINGS",
        priority: 7,
      },

      // ── SUBSCRIPTION / BILLING ──────────────────────────────────────────────
      {
        id: "ki_seed_subscription_what",
        item_type: "FAQ",
        category: "SUBSCRIPTION",
        feature: null,
        title: "스윔노트 요금제 안내",
        question: "스윔노트 요금제는 어떻게 되나요?",
        answer: "스윔노트는 기본(Normal) 무료 플랜과 X(프리미엄) 구독 플랜을 제공합니다. X 구독은 AI 성장 리포트, AI 커리큘럼 분석 등 고급 기능을 포함합니다.",
        content: "스윔노트 Normal 플랜은 기본 기능(출결·일지·사진)을 무료로 제공합니다. X 구독은 AI 성장 리포트 등 프리미엄 기능을 포함합니다.",
        scope: "global",
        affected_roles: ["pool_admin"],
        affected_modes: ["normal", "x"],
        frontend_screen_id: "ADMIN_SUBSCRIPTION",
        source_type: "CODE_POLICY",
        source_ref: "x-billing/plan-description",
        priority: 9,
      },
      {
        id: "ki_seed_subscription_x_features",
        item_type: "FAQ",
        category: "X_MODE",
        feature: null,
        title: "X 구독 포함 기능",
        question: "X 구독에는 어떤 기능이 포함되나요?",
        answer: "X 구독은 AI 성장 리포트, AI 커리큘럼 Q&A, 성장 이벤트 기록, AI 분석 등 프리미엄 AI 기능을 포함합니다.",
        content: "X Mode 활성화 시 AI 성장 리포트, 커리큘럼 Q&A, Growth Board 등의 프리미엄 기능이 활성화됩니다.",
        scope: "global",
        affected_roles: ["pool_admin", "parent"],
        affected_modes: ["x"],
        frontend_screen_id: "ADMIN_SUBSCRIPTION",
        source_type: "CODE_POLICY",
        source_ref: "x02-billing/x-features",
        priority: 8,
      },

      // ── TECH SUPPORT ────────────────────────────────────────────────────────
      {
        id: "ki_seed_support_chat",
        item_type: "FAQ",
        category: "TECH_SUPPORT",
        feature: null,
        title: "고객센터 문의 방법",
        question: "도움이 필요할 때 어떻게 문의하나요?",
        answer: "앱 내 고객센터 메뉴를 통해 문의하실 수 있습니다. 메뉴 → 고객센터 → 문의하기를 선택하세요.",
        content: "스윔노트 고객센터는 앱 내 채팅 문의를 통해 이용할 수 있습니다.",
        scope: "global",
        affected_roles: ["pool_admin", "teacher", "parent"],
        affected_modes: ["normal", "x"],
        frontend_screen_id: "COMMON_SUPPORT_CHAT",
        source_type: "FRONTEND_MAP",
        source_ref: "frontend-map.v1.ts/COMMON_SUPPORT_CHAT",
        priority: 9,
      },

      // ── ADMIN ───────────────────────────────────────────────────────────────
      {
        id: "ki_seed_admin_student_register",
        item_type: "FAQ",
        category: "ADMIN",
        feature: null,
        title: "학생 등록 방법",
        question: "학생은 어떻게 등록하나요?",
        answer: "관리자 화면 → 학생 관리 → 학생 추가에서 학생 정보를 입력하여 등록합니다. 학부모를 연결하려면 학부모 초대 QR을 공유하세요.",
        content: "학생 등록은 관리자 화면 학생 관리 섹션에서 가능합니다.",
        scope: "global",
        affected_roles: ["pool_admin", "sub_admin"],
        affected_modes: ["normal", "x"],
        frontend_screen_id: "ADMIN_STUDENTS",
        source_type: "FRONTEND_MAP",
        source_ref: "frontend-map.v1.ts/ADMIN_STUDENTS",
        priority: 8,
      },
      {
        id: "ki_seed_admin_schedule",
        item_type: "FAQ",
        category: "ADMIN",
        feature: null,
        title: "수업 스케줄 관리",
        question: "수업 시간표는 어떻게 설정하나요?",
        answer: "관리자 → 스케줄 관리에서 수업 그룹별 요일·시간·강사를 설정할 수 있습니다.",
        content: "수업 스케줄은 관리자 스케줄 화면에서 그룹별로 설정합니다.",
        scope: "global",
        affected_roles: ["pool_admin", "sub_admin"],
        affected_modes: ["normal", "x"],
        frontend_screen_id: "ADMIN_SCHEDULE",
        source_type: "FRONTEND_MAP",
        source_ref: "frontend-map.v1.ts/ADMIN_SCHEDULE",
        priority: 7,
      },

      // ── X MODE ──────────────────────────────────────────────────────────────
      {
        id: "ki_seed_x_mode_activate",
        item_type: "FAQ",
        category: "X_MODE",
        feature: null,
        title: "X 모드 활성화",
        question: "X 모드를 어떻게 활성화하나요?",
        answer: "X 구독을 결제하면 X 모드가 활성화됩니다. 관리자 대시보드 → 구독 → X 구독 시작을 선택하세요.",
        content: "X 모드는 X 구독 결제 완료 즉시 활성화됩니다. 관리자만 구독을 시작할 수 있습니다.",
        scope: "global",
        affected_roles: ["pool_admin"],
        affected_modes: ["normal"],
        frontend_screen_id: "ADMIN_SUBSCRIPTION",
        source_type: "CODE_POLICY",
        source_ref: "p0-x-pool-wide/x-activation",
        priority: 8,
      },
    ];

    for (const seed of seeds) {
      try {
        const rolesJson = seed.affected_roles
          ? `ARRAY[${seed.affected_roles.map((r) => `'${r}'`).join(",")}]::text[]`
          : "NULL";
        const modesJson = seed.affected_modes
          ? `ARRAY[${seed.affected_modes.map((m) => `'${m}'`).join(",")}]::text[]`
          : "NULL";

        await superAdminDb.execute(sql.raw(`
          INSERT INTO support_knowledge_items (
            id, item_type, scope, category, feature,
            title, content, question, answer,
            affected_roles, affected_modes,
            frontend_screen_id, source_type, source_ref,
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
            'pending', 1, NOW(), NOW()
          WHERE NOT EXISTS (
            SELECT 1 FROM support_knowledge_items WHERE id = '${seed.id}'
          )
        `));
      } catch (e: any) {
        console.error(`[cs-05r-seed] ${seed.id} failed:`, e?.message);
      }
    }

    console.log("[cs-05r] migration complete");
  } catch (e: any) {
    console.error("[cs-05r] migration error:", e?.message);
  }
}

// ── helpers ────────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/'/g, "''");
}

interface SeedItem {
  id: string;
  item_type: string;
  category: string | null;
  feature: string | null;
  title: string;
  content: string;
  question?: string;
  answer?: string;
  scope?: string;
  affected_roles?: string[];
  affected_modes?: string[];
  frontend_screen_id?: string;
  source_type?: string;
  source_ref?: string;
  priority?: number;
}
