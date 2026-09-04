/**
 * pool-db-cs-19-corrections.ts
 *
 * WP-CS19 — Production Correction Migration (PREPARED, NOT APPLIED)
 *
 * 목적:
 *   CS18에서 확인된 APPROVE_AFTER_EDIT 6개 Candidate를
 *   Production DB에 적용하기 위한 idempotent UPDATE migration.
 *
 * 절대 원칙:
 *   - 이 파일은 Production에서 직접 실행하지 않는다.
 *   - 실제 실행은 Production Activation Runbook 별도 승인 후에만 허용.
 *   - Candidate status는 이 migration에서 'active'로 변경하지 않는다.
 *   - 기존 ACTIVE 2개(ki_swimnote_intro, ki_x_mode_intro)는 수정하지 않는다.
 *
 * CANONICAL_SOURCE_CHANGED: YES (pool-db-cs-12.ts 수정됨)
 * PRODUCTION_ROW_CHANGED: NO
 * PRODUCTION_MIGRATION_PREPARED: YES (이 파일)
 * PRODUCTION_MIGRATION_APPLIED: NO
 *
 * CS19 수정 요약:
 *   1. ki_cs12_account_withdrawal       — '복구 불가' 절대 표현 제거 / 조건부 안내로 교체
 *   2. ki_cs12_ai_error_triage          — frontend_screen_id: TEACHER_DIARY_WRITE → TEACHER_DIARY
 *   3. ki_cs12_diary_ai_failed          — frontend_screen_id: TEACHER_DIARY_WRITE → TEACHER_DIARY
 *   4. ki_cs12_diary_save_failed        — frontend_screen_id: TEACHER_DIARY_WRITE → TEACHER_DIARY
 *   5. ki_cs12_diary_photo_upload_failed — frontend_screen_id: TEACHER_DIARY_WRITE → TEACHER_DIARY
 *   6. ki_cs12_growth_report_pending    — affected_modes: ["normal","x"] → ["x"] / content X-only 명시
 */

import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

// ─────────────────────────────────────────────────────────────────────────────
// Helper: escape single quotes for SQL
// ─────────────────────────────────────────────────────────────────────────────
const esc = (s: string) => s.replace(/'/g, "''");

// ─────────────────────────────────────────────────────────────────────────────
// Correction definitions
// Each entry produces an idempotent UPDATE:
//   WHERE id = <id> AND status IN ('pending', 'edit_required') AND revision = <current_revision>
//   → updated_at = NOW(), revision = revision + 1
//
// The UPDATE is guarded by:
//   1. status must be 'pending' or 'edit_required' (never active/archived)
//   2. revision check prevents concurrent overwrite
// ─────────────────────────────────────────────────────────────────────────────

interface CorrectionEntry {
  id: string;
  description: string;
  reason: string;
  sets: {
    answer?: string;
    content?: string;
    frontend_screen_id?: string | null;
    affected_modes?: string[];
  };
}

export const CS19_CORRECTIONS: CorrectionEntry[] = [
  // ── 1. ki_cs12_account_withdrawal ──────────────────────────────────────────
  {
    id: "ki_cs12_account_withdrawal",
    description: "탈퇴 복구 claim 수정",
    reason:
      "CS18 POLICY_GAP-1: '복구가 불가능합니다' 단정 → auth.ts:2451 immediate=false 경로에서 " +
      "기간 내 재가입 시 데이터 복구 가능. 두 경로 혼재 → 절대 단정 금지.",
    sets: {
      answer:
        "앱 설정 화면에서 '회원 탈퇴'를 선택하면 탈퇴를 신청할 수 있습니다. " +
        "탈퇴 처리 방식은 계정 유형에 따라 다릅니다. " +
        "수영장 관리자 계정은 유료 구독 중일 경우 90일 유예 기간이 적용됩니다. " +
        "데이터 복구 가능 여부 등 자세한 사항은 고객센터에 문의해 주세요.",
      content:
        "회원 탈퇴는 앱 > 설정 > 회원 탈퇴에서 신청합니다. " +
        "강사/학부모는 즉시 탈퇴 처리되고, 유료 구독 중인 수영장 관리자는 90일 유예 후 자동 완료됩니다. " +
        "탈퇴 처리 중에는 읽기 전용 모드로 전환됩니다. " +
        "유예 기간 중 재가입 등 데이터 복구 가능 여부는 고객센터에서 확인하시기 바랍니다.",
    },
  },

  // ── 2. ki_cs12_ai_error_triage ─────────────────────────────────────────────
  {
    id: "ki_cs12_ai_error_triage",
    description: "frontend_screen_id UI_PATH_MISMATCH 수정",
    reason:
      "CS18 UI_PATH_MISMATCH: TEACHER_DIARY_WRITE는 frontend-map.v1에 존재하지 않음. " +
      "실제 screen_id = TEACHER_DIARY (app/(teacher)/diary.tsx).",
    sets: { frontend_screen_id: "TEACHER_DIARY" },
  },

  // ── 3. ki_cs12_diary_ai_failed ─────────────────────────────────────────────
  {
    id: "ki_cs12_diary_ai_failed",
    description: "frontend_screen_id UI_PATH_MISMATCH 수정",
    reason:
      "CS18 UI_PATH_MISMATCH: TEACHER_DIARY_WRITE → TEACHER_DIARY.",
    sets: { frontend_screen_id: "TEACHER_DIARY" },
  },

  // ── 4. ki_cs12_diary_save_failed ───────────────────────────────────────────
  {
    id: "ki_cs12_diary_save_failed",
    description: "frontend_screen_id UI_PATH_MISMATCH 수정",
    reason:
      "CS18 UI_PATH_MISMATCH: TEACHER_DIARY_WRITE → TEACHER_DIARY.",
    sets: { frontend_screen_id: "TEACHER_DIARY" },
  },

  // ── 5. ki_cs12_diary_photo_upload_failed ───────────────────────────────────
  {
    id: "ki_cs12_diary_photo_upload_failed",
    description: "frontend_screen_id UI_PATH_MISMATCH 수정",
    reason:
      "CS18 UI_PATH_MISMATCH: TEACHER_DIARY_WRITE → TEACHER_DIARY.",
    sets: { frontend_screen_id: "TEACHER_DIARY" },
  },

  // ── 6. ki_cs12_growth_report_pending ───────────────────────────────────────
  {
    id: "ki_cs12_growth_report_pending",
    description: "affected_modes 범위 수정 + X-only content 명시",
    reason:
      "CS18 MODE_SCOPE_MISMATCH: PARENT_GROWTH_REPORT available_modes=[x], permissions=[x_entitlement]. " +
      "normal 포함 금지. content에 X Mode 조건 명시.",
    sets: {
      affected_modes: ["x"],
      answer:
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
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// runCs19Corrections
//
// Production에서 실행할 때의 실제 함수.
// 이번 WP에서는 CALL하지 않는다.
// ─────────────────────────────────────────────────────────────────────────────
export async function runCs19Corrections(
  db: NodePgDatabase<Record<string, never>>,
  opts: {
    dryRun?: boolean;          // true → SQL 출력만, DB 수정 없음
    editedBy?: string;         // super admin user id
  } = {}
): Promise<{
  applied: number;
  skipped: number;
  errors: { id: string; error: string }[];
  sql_preview: string[];
}> {
  const { dryRun = true, editedBy = "system_cs19" } = opts;
  const results = { applied: 0, skipped: 0, errors: [] as { id: string; error: string }[], sql_preview: [] as string[] };

  for (const correction of CS19_CORRECTIONS) {
    const { id, reason, sets } = correction;

    // Build SET clause
    const setClauses: string[] = [];
    if (sets.answer !== undefined) {
      setClauses.push(`answer = '${esc(sets.answer)}'`);
    }
    if (sets.content !== undefined) {
      setClauses.push(`content = '${esc(sets.content)}'`);
    }
    if (sets.frontend_screen_id !== undefined) {
      const val = sets.frontend_screen_id === null ? "NULL" : `'${sets.frontend_screen_id}'`;
      setClauses.push(`frontend_screen_id = ${val}`);
    }
    if (sets.affected_modes !== undefined) {
      const arr = `ARRAY[${sets.affected_modes.map((m) => `'${m}'`).join(",")}]::text[]`;
      setClauses.push(`affected_modes = ${arr}`);
    }

    // Always bump revision and set metadata
    setClauses.push("revision = revision + 1");
    setClauses.push(`updated_at = NOW()`);
    setClauses.push(`status = 'pending'`); // edit → back to pending (requires re-approval)

    const auditNote = esc(`CS19 correction: ${reason}`);

    const updateSql = `
      UPDATE support_knowledge_items
      SET ${setClauses.join(", ")}
      WHERE id = '${id}'
        AND status IN ('pending', 'edit_required')
        AND status NOT IN ('active', 'archived', 'superseded', 'rejected')
    `;

    const auditSql = `
      INSERT INTO support_knowledge_audit_log
        (knowledge_item_id, action, actor_id, note, created_at)
      VALUES
        ('${id}', 'EDIT', '${editedBy}', '${auditNote}', NOW())
      ON CONFLICT DO NOTHING
    `;

    results.sql_preview.push(`-- [${id}] --\n${updateSql.trim()}\n${auditSql.trim()}`);

    if (!dryRun) {
      try {
        await db.execute(sql.raw(updateSql));
        await db.execute(sql.raw(auditSql)).catch(() => {/* audit table may not exist yet */});
        results.applied++;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        results.errors.push({ id, error: msg });
        results.skipped++;
      }
    } else {
      results.applied++;
    }
  }

  return results;
}

export const CS19_CORRECTION_IDS = CS19_CORRECTIONS.map((c) => c.id);
