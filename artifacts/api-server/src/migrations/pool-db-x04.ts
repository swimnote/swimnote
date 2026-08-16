/**
 * WP-X04 — X Setup Document Structuring tables
 *
 * 3계층 원칙: ORIGINAL ≠ STRUCTURED ≠ GENERATED
 * 이 migration은 STRUCTURED 계층 DB를 생성한다.
 * 원본 파일(x_setup_files)은 절대 수정하지 않는다.
 */
import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

// Structuring pipeline statuses
export const STRUCTURING_STATUS = {
  NOT_PROCESSED:    "NOT_PROCESSED",
  PROCESSING:       "PROCESSING",
  STRUCTURED:       "STRUCTURED",
  REVIEW_REQUIRED:  "REVIEW_REQUIRED",
  APPROVED:         "APPROVED",
  FAILED:           "FAILED",
} as const;

export async function runX04Migration(): Promise<void> {
  try {
    // ── x_curriculum_profiles ─────────────────────────────────────────────────
    await superAdminDb.execute(sql`
      CREATE TABLE IF NOT EXISTS x_curriculum_profiles (
        id                 UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
        pool_id            TEXT        NOT NULL REFERENCES swimming_pools(id),
        submission_id      TEXT        REFERENCES x_setup_submissions(id),
        source_version     INTEGER     NOT NULL DEFAULT 1,
        template_version   TEXT        NOT NULL DEFAULT '1.0',
        status             TEXT        NOT NULL DEFAULT 'NOT_PROCESSED',
        basic_info         JSONB       NOT NULL DEFAULT '{}',
        teaching_summary   JSONB       NOT NULL DEFAULT '{}',
        total_declared_levels INTEGER,
        structured_at      TIMESTAMPTZ,
        reviewed_at        TIMESTAMPTZ,
        reviewed_by        TEXT,
        edited_at          TIMESTAMPTZ,
        edited_by          TEXT,
        parse_error        TEXT,
        created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(pool_id)
      )
    `);

    // ── x_curriculum_levels ───────────────────────────────────────────────────
    await superAdminDb.execute(sql`
      CREATE TABLE IF NOT EXISTS x_curriculum_levels (
        id                 UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
        profile_id         UUID        NOT NULL REFERENCES x_curriculum_profiles(id) ON DELETE CASCADE,
        level_order        INTEGER     NOT NULL,
        level_name         TEXT,
        level_color        TEXT,
        target_students    TEXT,
        strokes            TEXT,
        skills             TEXT,
        learning_contents  TEXT,
        objectives         TEXT,
        promotion_criteria TEXT,
        test_method        TEXT,
        detailed_skills    TEXT,
        common_errors      TEXT,
        correction_methods TEXT,
        drills             TEXT,
        age_notes          TEXT,
        teaching_focus     TEXT,
        notes              TEXT,
        created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(profile_id, level_order)
      )
    `);

    // ── x_website_profiles ────────────────────────────────────────────────────
    await superAdminDb.execute(sql`
      CREATE TABLE IF NOT EXISTS x_website_profiles (
        id                    UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
        pool_id               TEXT        NOT NULL REFERENCES swimming_pools(id),
        submission_id         TEXT        REFERENCES x_setup_submissions(id),
        source_version        INTEGER     NOT NULL DEFAULT 1,
        template_version      TEXT        NOT NULL DEFAULT '1.0',
        status                TEXT        NOT NULL DEFAULT 'NOT_PROCESSED',
        basic_info            JSONB       NOT NULL DEFAULT '{}',
        brand                 JSONB       NOT NULL DEFAULT '{}',
        strengths             JSONB       NOT NULL DEFAULT '[]',
        differentiation       JSONB       NOT NULL DEFAULT '{}',
        philosophy            JSONB       NOT NULL DEFAULT '{}',
        programs              JSONB       NOT NULL DEFAULT '[]',
        level_system          JSONB       NOT NULL DEFAULT '[]',
        education_process     JSONB       NOT NULL DEFAULT '{}',
        facilities            JSONB       NOT NULL DEFAULT '{}',
        safety                JSONB       NOT NULL DEFAULT '{}',
        vehicle_location      JSONB       NOT NULL DEFAULT '{}',
        usage_information     JSONB       NOT NULL DEFAULT '{}',
        coaches               JSONB       NOT NULL DEFAULT '[]',
        trust_credentials     JSONB       NOT NULL DEFAULT '{}',
        faq                   JSONB       NOT NULL DEFAULT '[]',
        website_preferences   JSONB       NOT NULL DEFAULT '{}',
        restricted_information TEXT,
        free_notes            TEXT,
        structured_at         TIMESTAMPTZ,
        reviewed_at           TIMESTAMPTZ,
        reviewed_by           TEXT,
        edited_at             TIMESTAMPTZ,
        edited_by             TEXT,
        parse_error           TEXT,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(pool_id)
      )
    `);

    // ── x_website_packages ────────────────────────────────────────────────────
    await superAdminDb.execute(sql`
      CREATE TABLE IF NOT EXISTS x_website_packages (
        id                       UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
        pool_id                  TEXT        NOT NULL REFERENCES swimming_pools(id),
        profile_id               UUID        NOT NULL REFERENCES x_website_profiles(id),
        package_version          INTEGER     NOT NULL DEFAULT 1,
        package_name             TEXT        NOT NULL,
        r2_key                   TEXT        NOT NULL,
        source_submission_version INTEGER,
        generated_by             TEXT,
        generated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Indexes
    await superAdminDb.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_x_curriculum_profiles_pool ON x_curriculum_profiles(pool_id)
    `);
    await superAdminDb.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_x_curriculum_levels_profile ON x_curriculum_levels(profile_id, level_order)
    `);
    await superAdminDb.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_x_website_profiles_pool ON x_website_profiles(pool_id)
    `);
    await superAdminDb.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_x_website_packages_pool ON x_website_packages(pool_id, generated_at DESC)
    `);

    console.log("[x04-migration] x04 structuring tables OK");
  } catch (err) {
    console.error("[x04-migration] migration error:", err);
    throw err;
  }
}
