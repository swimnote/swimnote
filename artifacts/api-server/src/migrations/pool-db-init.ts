/**
 * pool-db-init.ts — 운영 테이블 초기화 DDL
 *
 * 서버 기동 시 한 번 실행: CREATE TABLE IF NOT EXISTS로 안전하게 멱등 처리
 * 20개+ 운영 테이블 생성 + 누락 컬럼 보완
 *
 * DB 단일화 이후:
 * - superAdminDb (운영 원본) — 모든 테이블 생성
 * - poolDb (백업 DB, POOL_DATABASE_URL 설정 시) — 백업 스키마 동기화
 */
import { superAdminDb, getBackupDb, isDbSeparated } from "@workspace/db";
import { sql } from "drizzle-orm";

export async function initPoolDb(): Promise<void> {
  // 운영 DB (superAdminDb)에 모든 테이블 초기화
  const db = superAdminDb;
  // 백업 DB가 분리되어 있으면 동일 스키마를 백업 DB에도 초기화
  const backupDb = isDbSeparated ? getBackupDb() : null;

  // ─── ENUM 타입 (중복 시 무시) ────────────────────────────────────────────
  await db.execute(sql.raw(`
    DO $$ BEGIN
      CREATE TYPE attendance_status AS ENUM ('present', 'absent', 'late');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    DO $$ BEGIN
      CREATE TYPE change_type AS ENUM ('create', 'update', 'delete');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    DO $$ BEGIN
      CREATE TYPE sync_status AS ENUM ('pending', 'synced', 'error');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    DO $$ BEGIN
      CREATE TYPE snapshot_type AS ENUM ('incremental', 'full');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `));

  // ─── 1. members ──────────────────────────────────────────────────────────
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS members (
      id                text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
      swimming_pool_id  text        NOT NULL,
      name              text        NOT NULL,
      phone             text        NOT NULL,
      birth_date        text,
      parent_user_id    text,
      memo              text,
      status            text        NOT NULL DEFAULT 'active',
      created_at        timestamptz NOT NULL DEFAULT now(),
      updated_at        timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE members ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
  `));

  // ─── 2. students ─────────────────────────────────────────────────────────
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS students (
      id                     text        PRIMARY KEY,
      swimming_pool_id       text        NOT NULL,
      name                   text        NOT NULL,
      phone                  text,
      birth_date             text,
      birth_year             text,
      class_group_id         text,
      assigned_class_ids     jsonb       DEFAULT '[]',
      memo                   text,
      notes                  text,
      class_schedule         jsonb       DEFAULT '[]',
      status                 text        NOT NULL DEFAULT 'active',
      registration_path      text        NOT NULL DEFAULT 'admin_created',
      parent_name            text,
      parent_phone           text,
      parent_phone2          text,
      parent_user_id         text,
      weekly_count           integer     DEFAULT 1,
      schedule_labels        text,
      invite_code            text,
      invite_status          text        NOT NULL DEFAULT 'none',
      withdrawn_at           timestamptz,
      deleted_at             timestamptz,
      archived_reason        text,
      last_class_group_name  text,
      pending_status_change  text,
      pending_effective_mode text,
      pending_effective_month text,
      created_at             timestamptz NOT NULL DEFAULT now(),
      updated_at             timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE students ADD COLUMN IF NOT EXISTS current_level_order integer;
    ALTER TABLE students ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
  `));

  // ─── 3. class_groups ─────────────────────────────────────────────────────
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS class_groups (
      id               text        PRIMARY KEY,
      swimming_pool_id text        NOT NULL,
      name             text        NOT NULL,
      schedule_days    text        NOT NULL,
      schedule_time    text        NOT NULL,
      instructor       text,
      teacher_user_id  text,
      level            text,
      capacity         integer,
      description      text,
      is_one_time      boolean     NOT NULL DEFAULT false,
      one_time_date    text,
      is_deleted       boolean     NOT NULL DEFAULT false,
      deleted_at       timestamptz,
      created_at       timestamptz NOT NULL DEFAULT now(),
      updated_at       timestamptz NOT NULL DEFAULT now()
    );
  `));
  await db.execute(sql.raw(`ALTER TABLE class_groups ADD COLUMN IF NOT EXISTS color text NOT NULL DEFAULT '#FFFFFF';`));

  // ─── 4. classes + class_members ──────────────────────────────────────────
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS classes (
      id               text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
      swimming_pool_id text        NOT NULL,
      name             text        NOT NULL,
      instructor       text        NOT NULL,
      schedule         text        NOT NULL,
      capacity         integer,
      created_at       timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS class_members (
      id         text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
      class_id   text        NOT NULL,
      member_id  text        NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `));

  // ─── 5. attendance ───────────────────────────────────────────────────────
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS attendance (
      id                  text               PRIMARY KEY,
      class_group_id      text,
      student_id          text,
      swimming_pool_id    text               NOT NULL,
      date                text               NOT NULL,
      status              attendance_status  NOT NULL DEFAULT 'absent',
      session_type        text,
      teacher_user_id     text,
      teacher_name        text,
      created_at          timestamptz        NOT NULL DEFAULT now(),
      created_by          text,
      created_by_name     text,
      updated_at          timestamptz,
      modified_by         text,
      modified_by_name    text,
      modification_reason text
    );
    ALTER TABLE attendance ADD COLUMN IF NOT EXISTS session_type    text;
    ALTER TABLE attendance ADD COLUMN IF NOT EXISTS teacher_user_id text;
    ALTER TABLE attendance ADD COLUMN IF NOT EXISTS teacher_name    text;
  `));

  // ─── 6. makeup_sessions ──────────────────────────────────────────────────
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS makeup_sessions (
      id                         text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
      swimming_pool_id           text        NOT NULL,
      student_id                 text        NOT NULL,
      student_name               text,
      original_class_group_id    text,
      original_class_group_name  text,
      original_teacher_id        text,
      original_teacher_name      text,
      absence_date               text        NOT NULL,
      absence_attendance_id      text,
      absence_time               text,
      absence_id                 text,
      source_type                text,
      can_expire                 boolean     DEFAULT true,
      status                     text        NOT NULL DEFAULT 'waiting',
      expire_at                  timestamptz,
      weekly_frequency           integer     DEFAULT 1,
      assigned_class_group_id    text,
      assigned_class_group_name  text,
      assigned_teacher_id        text,
      assigned_teacher_name      text,
      assigned_date              text,
      is_substitute              boolean     DEFAULT false,
      substitute_teacher_id      text,
      substitute_teacher_name    text,
      completed_at               timestamptz,
      completed_attendance_id    text,
      transferred_to_teacher_id   text,
      transferred_to_teacher_name text,
      transferred_at              timestamptz,
      transferred_by              text,
      transferred_by_name         text,
      cancelled_reason            text,
      cancelled_custom            text,
      cancelled_at                timestamptz,
      cancelled_by                text,
      cancelled_by_name           text,
      note                        text,
      created_at                  timestamptz NOT NULL DEFAULT now(),
      updated_at                  timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE makeup_sessions ADD COLUMN IF NOT EXISTS absence_id   text;
    ALTER TABLE makeup_sessions ADD COLUMN IF NOT EXISTS source_type  text;
    ALTER TABLE makeup_sessions ADD COLUMN IF NOT EXISTS can_expire   boolean DEFAULT true;
  `));

  // ─── 7. notices ──────────────────────────────────────────────────────────
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS notices (
      id               text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
      swimming_pool_id text        NOT NULL,
      title            text        NOT NULL,
      content          text        NOT NULL,
      author_id        text        NOT NULL,
      author_name      text        NOT NULL,
      is_pinned        boolean     NOT NULL DEFAULT false,
      notice_type      text        NOT NULL DEFAULT 'general',
      student_id       text,
      student_name     text,
      created_at       timestamptz NOT NULL DEFAULT now()
    );
  `));

  // ─── 7b. notice_reads ────────────────────────────────────────────────────
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS notice_reads (
      id         text        PRIMARY KEY,
      notice_id  text        NOT NULL REFERENCES notices(id) ON DELETE CASCADE,
      parent_id  text        NOT NULL,
      read_at    timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_notice_reads ON notice_reads (notice_id, parent_id);
  `));

  // ─── 8. teacher_schedule_notes ───────────────────────────────────────────
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS teacher_schedule_notes (
      id               text        PRIMARY KEY,
      teacher_id       text        NOT NULL,
      class_group_id   text        NOT NULL,
      swimming_pool_id text        NOT NULL,
      schedule_date    text        NOT NULL,
      note_text        text,
      audio_file_url   text,
      created_at       timestamptz NOT NULL DEFAULT now(),
      updated_at       timestamptz NOT NULL DEFAULT now()
    );
  `));

  // ─── 8b. teacher_invites ─────────────────────────────────────────────────
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS teacher_invites (
      id               text        PRIMARY KEY,
      swimming_pool_id text        NOT NULL,
      name             text        NOT NULL,
      phone            text        NOT NULL DEFAULT '',
      position         text,
      invite_token     text        UNIQUE,
      invite_status    text        NOT NULL DEFAULT 'invited'
        CHECK (invite_status IN ('invited','joinedPendingApproval','approved','rejected','inactive')),
      invited_by       text        NOT NULL,
      requested_at     timestamptz,
      approved_at      timestamptz,
      approved_by      text,
      user_id          text,
      notes            text,
      created_at       timestamptz NOT NULL DEFAULT now(),
      rejection_reason text,
      approved_role    text,
      rejected_at      timestamptz,
      rejected_by      text
    );
    CREATE INDEX IF NOT EXISTS idx_ti_pool ON teacher_invites (swimming_pool_id);
  `));

  // ─── 9. class_diaries + 관련 테이블 ─────────────────────────────────────
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS class_diaries (
      id               text        PRIMARY KEY DEFAULT ('cd_' || replace(gen_random_uuid()::text,'-','')),
      class_group_id   text        NOT NULL,
      teacher_id       text        NOT NULL,
      teacher_name     text        NOT NULL,
      swimming_pool_id text        NOT NULL,
      lesson_date      text        NOT NULL,
      common_content   text        NOT NULL,
      is_edited        boolean     NOT NULL DEFAULT false,
      edited_at        timestamptz,
      edited_by        text,
      is_deleted       boolean     NOT NULL DEFAULT false,
      deleted_at       timestamptz,
      deleted_by       text,
      created_at       timestamptz NOT NULL DEFAULT now(),
      updated_at       timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS class_diary_student_notes (
      id           text        PRIMARY KEY DEFAULT ('csn_' || replace(gen_random_uuid()::text,'-','')),
      diary_id     text        NOT NULL,
      student_id   text        NOT NULL,
      note_content text        NOT NULL,
      is_edited    boolean     NOT NULL DEFAULT false,
      edited_at    timestamptz,
      edited_by    text,
      is_deleted   boolean     NOT NULL DEFAULT false,
      deleted_at   timestamptz,
      deleted_by   text,
      created_at   timestamptz NOT NULL DEFAULT now(),
      updated_at   timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS class_diary_audit_logs (
      id               text        PRIMARY KEY DEFAULT ('cal_' || replace(gen_random_uuid()::text,'-','')),
      diary_id         text,
      student_note_id  text,
      target_type      text        NOT NULL,
      action_type      text        NOT NULL,
      before_content   text,
      after_content    text,
      actor_id         text        NOT NULL,
      actor_name       text        NOT NULL,
      actor_role       text        NOT NULL,
      swimming_pool_id text        NOT NULL,
      created_at       timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS diary_templates (
      id               text        PRIMARY KEY DEFAULT ('dt_' || replace(gen_random_uuid()::text,'-','')),
      swimming_pool_id text        NOT NULL,
      category         text        NOT NULL DEFAULT 'general',
      level            text,
      template_text    text        NOT NULL,
      created_by       text        NOT NULL,
      is_active        boolean     NOT NULL DEFAULT true,
      created_at       timestamptz NOT NULL DEFAULT now(),
      updated_at       timestamptz NOT NULL DEFAULT now()
    );
  `));

  // ─── 10. parent_accounts + parent_students + registration_requests ───────
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS parent_accounts (
      id               text        PRIMARY KEY,
      swimming_pool_id text        NOT NULL,
      phone            text        NOT NULL,
      pin_hash         text        NOT NULL,
      name             text        NOT NULL,
      login_id         text,
      nickname         text,
      gender           text,
      created_at       timestamptz NOT NULL DEFAULT now(),
      updated_at       timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS parent_students (
      id               text        PRIMARY KEY,
      parent_id        text        NOT NULL,
      student_id       text        NOT NULL,
      swimming_pool_id text        NOT NULL,
      status           text        NOT NULL DEFAULT 'pending',
      approved_by      text,
      approved_at      timestamptz,
      rejection_reason text,
      created_at       timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS student_registration_requests (
      id               text        PRIMARY KEY,
      swimming_pool_id text        NOT NULL,
      parent_id        text        NOT NULL,
      child_names      jsonb       NOT NULL DEFAULT '[]',
      memo             text,
      status           text        NOT NULL DEFAULT 'pending',
      reviewed_by      text,
      reviewed_at      timestamptz,
      rejection_reason text,
      created_at       timestamptz NOT NULL DEFAULT now()
    );
  `));

  // ─── 11. class_change_logs ───────────────────────────────────────────────
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS class_change_logs (
      id                 text        PRIMARY KEY,
      pool_id            text        NOT NULL,
      class_group_id     text        NOT NULL,
      target_student_id  text,
      change_type        text        NOT NULL,
      effective_date     text        NOT NULL,
      display_week_start text        NOT NULL,
      note               text,
      created_by         text        NOT NULL,
      is_applied         boolean     NOT NULL DEFAULT false,
      created_at         timestamptz NOT NULL DEFAULT now()
    );
  `));

  // ─── 12. push_settings + pool_push_settings ──────────────────────────────
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS push_settings (
      id                  text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
      user_id             text,
      parent_account_id   text,
      notification_type   text,
      is_enabled          boolean     DEFAULT true,
      updated_at          timestamptz DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS pool_push_settings (
      id                   text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
      pool_id              text        UNIQUE,
      prev_day_push_time   text        DEFAULT '20:00',
      same_day_push_offset integer     DEFAULT 1,
      tpl_notice           text,
      tpl_prev_day         text,
      tpl_same_day         text,
      tpl_diary            text,
      tpl_photo            text,
      updated_at           timestamptz DEFAULT now()
    );
  `));

  // pool_push_settings pool_id unique constraint (기존 테이블 보완)
  await db.execute(sql.raw(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'pool_push_settings' AND constraint_type = 'UNIQUE'
      ) THEN
        ALTER TABLE pool_push_settings ADD CONSTRAINT pool_push_settings_pool_id_unique UNIQUE (pool_id);
      END IF;
    END $$;
  `)).catch(() => {});

  // ─── 12b. push_tokens ────────────────────────────────────────────────────
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS push_tokens (
      id                 text        PRIMARY KEY,
      user_id            text,
      parent_account_id  text,
      token              text        NOT NULL UNIQUE,
      updated_at         timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_push_tokens_user_id ON push_tokens (user_id);
    CREATE INDEX IF NOT EXISTS idx_push_tokens_parent ON push_tokens (parent_account_id);
  `));

  // ─── 13. photo_assets_meta + video_assets_meta (신규 미디어 테이블) ───────
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS photo_assets_meta (
      id               text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
      pool_id          text        NOT NULL,
      student_id       text,
      class_id         text,
      journal_id       text,
      album_type       text        NOT NULL DEFAULT 'group',
      bucket_name      text        NOT NULL DEFAULT 'photos',
      object_key       text        NOT NULL,
      file_type        text,
      file_size        integer,
      uploaded_by      text        NOT NULL,
      uploaded_by_name text,
      uploaded_at      timestamptz NOT NULL DEFAULT now(),
      status           text        NOT NULL DEFAULT 'active',
      visibility       text        NOT NULL DEFAULT 'class',
      is_thumbnail     boolean     NOT NULL DEFAULT false,
      is_compressed    boolean     NOT NULL DEFAULT false,
      caption          text,
      created_at       timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS video_assets_meta (
      id               text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
      pool_id          text        NOT NULL,
      student_id       text,
      class_id         text,
      journal_id       text,
      album_type       text        NOT NULL DEFAULT 'group',
      bucket_name      text        NOT NULL DEFAULT 'videos',
      object_key       text        NOT NULL,
      file_type        text,
      file_size        bigint,
      uploaded_by      text        NOT NULL,
      uploaded_by_name text,
      uploaded_at      timestamptz NOT NULL DEFAULT now(),
      status           text        NOT NULL DEFAULT 'active',
      visibility       text        NOT NULL DEFAULT 'class',
      caption          text,
      duration_sec     integer,
      codec            text,
      resolution       text,
      created_at       timestamptz NOT NULL DEFAULT now()
    );
  `));

  // ─── 14. teacher_absences + temp_class_transfers (스키마 외 사용 테이블) ─
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS teacher_absences (
      id               text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
      pool_id          text        NOT NULL,
      teacher_user_id  text        NOT NULL,
      teacher_name     text        NOT NULL,
      class_group_id   text        NOT NULL,
      class_group_name text        NOT NULL,
      absence_date     text        NOT NULL,
      absence_time     text,
      has_temp_transfer boolean    DEFAULT false,
      created_by       text,
      created_at       timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS temp_class_transfers (
      id                  text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
      pool_id             text        NOT NULL,
      absence_id          text        NOT NULL,
      student_id          text        NOT NULL,
      student_name        text,
      from_class_group_id text,
      from_teacher_id     text,
      from_teacher_name   text,
      to_class_group_id   text        NOT NULL,
      to_teacher_id       text,
      to_teacher_name     text,
      transfer_date       text,
      transfer_time       text,
      created_at          timestamptz NOT NULL DEFAULT now()
    );
  `));

  // ─── 15. student_photos + student_videos (하위호환 스텁 테이블) ──────────
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS student_photos (
      id               text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
      swimming_pool_id text        NOT NULL,
      student_id       text,
      uploader_id      text        NOT NULL,
      file_url         text,
      file_size_bytes  bigint      DEFAULT 0,
      caption          text,
      created_at       timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS student_videos (
      id               text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
      swimming_pool_id text        NOT NULL,
      student_id       text,
      uploader_id      text        NOT NULL,
      file_url         text,
      file_size_bytes  bigint      DEFAULT 0,
      caption          text,
      created_at       timestamptz NOT NULL DEFAULT now()
    );
  `));

  // ─── 16. swim_diary + teacher_daily_memos (storage.ts 사용 테이블) ───────
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS swim_diary (
      id               text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
      swimming_pool_id text        NOT NULL,
      author_id        text        NOT NULL,
      title            text,
      lesson_content   text,
      practice_goals   text,
      good_points      text,
      next_focus       text,
      created_at       timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS teacher_daily_memos (
      id               text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
      swimming_pool_id text        NOT NULL,
      teacher_id       text        NOT NULL,
      note_text        text,
      memo_date        text,
      created_at       timestamptz NOT NULL DEFAULT now()
    );
  `));

  // ─── 17. pool_change_logs + dead_letter_queue (pool 영역 모니터링) ───────
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS pool_change_logs (
      id          text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
      pool_id     text        NOT NULL,
      event_type  text        NOT NULL,
      entity_type text        NOT NULL,
      entity_id   text,
      actor_id    text,
      actor_name  text,
      payload     jsonb,
      created_at  timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS dead_letter_queue (
      id             text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
      pool_id        text        NOT NULL,
      event_type     text        NOT NULL,
      entity_type    text        NOT NULL,
      entity_id      text,
      actor_id       text,
      actor_name     text,
      payload        jsonb,
      original_error text,
      total_retries  integer     NOT NULL DEFAULT 0,
      resolved       boolean     NOT NULL DEFAULT false,
      resolved_at    timestamptz,
      resolved_by    text,
      created_at     timestamptz NOT NULL DEFAULT now()
    );
  `));

  // ─── 18. work_messages (업무 메신저) ────────────────────────────────────
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS work_messages (
      id                text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
      pool_id           text        NOT NULL,
      sender_id         text        NOT NULL,
      sender_name       text,
      sender_role       text,
      msg_type          text        NOT NULL DEFAULT 'text',
      channel_type      text        NOT NULL DEFAULT 'talk',
      message_type      text        NOT NULL DEFAULT 'normal',
      content           text,
      target_id         text,
      target_name       text,
      photo_url         text,
      photo_key         text,
      member_transfer_id text,
      extra_data        jsonb,
      created_at        timestamptz NOT NULL DEFAULT now()
    );
  `));
  // 기존 minimal 컬럼 테이블 보완 (ADD COLUMN IF NOT EXISTS)
  await db.execute(sql.raw(`
    ALTER TABLE work_messages
      ADD COLUMN IF NOT EXISTS sender_name        text,
      ADD COLUMN IF NOT EXISTS sender_role        text,
      ADD COLUMN IF NOT EXISTS msg_type           text NOT NULL DEFAULT 'text',
      ADD COLUMN IF NOT EXISTS channel_type       text NOT NULL DEFAULT 'talk',
      ADD COLUMN IF NOT EXISTS message_type       text NOT NULL DEFAULT 'normal',
      ADD COLUMN IF NOT EXISTS target_id          text,
      ADD COLUMN IF NOT EXISTS target_name        text,
      ADD COLUMN IF NOT EXISTS photo_url          text,
      ADD COLUMN IF NOT EXISTS photo_key          text,
      ADD COLUMN IF NOT EXISTS member_transfer_id text,
      ADD COLUMN IF NOT EXISTS extra_data         jsonb;
  `));

  // ─── 19. pool_holidays (휴무일 관리) ─────────────────────────────────────
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS pool_holidays (
      id           text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
      pool_id      text        NOT NULL,
      holiday_date date        NOT NULL,
      reason       text,
      created_by   text,
      created_at   timestamptz NOT NULL DEFAULT now(),
      UNIQUE (pool_id, holiday_date)
    );
  `));

  // ─── 20. member_activity_logs (회원 활동 로그) ───────────────────────────
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS member_activity_logs (
      id             text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
      swimming_pool_id text      NOT NULL,
      student_id     text,
      parent_id      text,
      target_name    text        NOT NULL,
      action_type    text        NOT NULL,
      target_type    text        NOT NULL,
      before_value   text,
      after_value    text,
      actor_id       text        NOT NULL,
      actor_name     text        NOT NULL,
      actor_role     text        NOT NULL,
      note           text,
      created_at     timestamptz NOT NULL DEFAULT now()
    );
  `));

  // ─── 21. pool_level_settings (레벨 설정) ─────────────────────────────────
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS pool_level_settings (
      id                  text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
      pool_id             text        NOT NULL,
      level_order         integer     NOT NULL,
      level_name          text        NOT NULL DEFAULT '',
      level_description   text,
      learning_content    text,
      promotion_test_rule text,
      badge_type          text        NOT NULL DEFAULT 'text',
      badge_label         text,
      badge_color         text        NOT NULL DEFAULT '#3B82F6',
      badge_text_color    text        NOT NULL DEFAULT '#FFFFFF',
      is_active           boolean     NOT NULL DEFAULT true,
      created_at          timestamptz NOT NULL DEFAULT now(),
      updated_at          timestamptz NOT NULL DEFAULT now(),
      UNIQUE (pool_id, level_order)
    );
  `));

  // ─── 데이터 정합성: assigned_class_ids null 제거 + 중복 제거 ─────────────
  // null 값이 들어간 행 정리 (서버 버그로 null이 저장된 경우 대비)
  await db.execute(sql.raw(`
    UPDATE students
    SET assigned_class_ids = COALESCE(
      (SELECT jsonb_agg(elem)
       FROM jsonb_array_elements(COALESCE(assigned_class_ids, '[]'::jsonb)) AS elem
       WHERE elem IS NOT NULL AND elem <> 'null'::jsonb AND elem::text != 'null'),
      '[]'::jsonb
    )
    WHERE assigned_class_ids IS NOT NULL
      AND assigned_class_ids @> 'null'::jsonb;
  `));

  // 중복 ID 제거 (동일 ID가 2회 이상 들어간 경우)
  await db.execute(sql.raw(`
    UPDATE students
    SET assigned_class_ids = (
      SELECT jsonb_agg(DISTINCT elem ORDER BY elem)
      FROM jsonb_array_elements(assigned_class_ids) AS elem
    )
    WHERE (
      SELECT COUNT(DISTINCT elem)
      FROM jsonb_array_elements(assigned_class_ids) AS elem
    ) < jsonb_array_length(assigned_class_ids);
  `));

  // ─── pool_subscriptions ──────────────────────────────────────────────────
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS pool_subscriptions (
      id                    text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
      swimming_pool_id      text        NOT NULL UNIQUE,
      tier                  text        NOT NULL DEFAULT 'free',
      card_id               text,
      status                text        NOT NULL DEFAULT 'active',
      current_period_start  text,
      next_billing_at       text,
      pending_tier          text,
      downgrade_at          date,
      created_at            timestamptz NOT NULL DEFAULT now(),
      updated_at            timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_pool_subs_pool_id ON pool_subscriptions (swimming_pool_id);
  `));

  // ─── subscription_plans ──────────────────────────────────────────────────
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS subscription_plans (
      id                text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
      plan_id           text        NOT NULL DEFAULT '',
      tier              text        NOT NULL UNIQUE,
      name              text        NOT NULL,
      price_per_month   integer     NOT NULL DEFAULT 0,
      max_students      integer,
      max_teachers      integer,
      storage_mb        integer     NOT NULL DEFAULT 0,
      display_storage   text        NOT NULL DEFAULT '',
      features          jsonb       DEFAULT '[]',
      is_active         boolean     NOT NULL DEFAULT true,
      created_at        timestamptz NOT NULL DEFAULT now()
    )
  `)).catch(() => {});
  // subscription_plans 누락 컬럼 보완
  await db.execute(sql.raw(`ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS plan_id text NOT NULL DEFAULT ''`)).catch(() => {});
  await db.execute(sql.raw(`ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS member_limit integer NOT NULL DEFAULT 9999`)).catch(() => {});
  await db.execute(sql.raw(`ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS storage_mb integer NOT NULL DEFAULT 0`)).catch(() => {});
  await db.execute(sql.raw(`ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS display_storage text NOT NULL DEFAULT ''`)).catch(() => {});
  await db.execute(sql.raw(`ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true`)).catch(() => {});
  // 기본 플랜 데이터 삽입 (Solo: 사진만 / Center: 사진+영상) — 항상 최신값 유지
  await db.execute(sql.raw(`
    INSERT INTO subscription_plans (tier, plan_id, name, price_per_month, member_limit, storage_mb, display_storage)
    VALUES
      ('free',       'free_10',    'Free',       0,      10,    512,  '500MB'),
      ('starter',    'solo_30',    'Solo 30',    3500,   30,   3072,  '3GB'),
      ('basic',      'solo_50',    'Solo 50',    6500,   50,   5120,  '5GB'),
      ('standard',   'solo_100',   'Solo 100',   9500,  100,  10240,  '10GB'),
      ('center_200', 'center_200', 'Center 200', 69000, 200,  51200,  '50GB'),
      ('advance',    'center_300', 'Center 300', 99000, 300,  81920,  '80GB'),
      ('pro',        'center_500', 'Center 500', 149000,500, 133120,  '130GB'),
      ('max',        'center_1000','Center 1000',249000,1000,512000,  '500GB')
    ON CONFLICT (tier) DO UPDATE
      SET plan_id = EXCLUDED.plan_id, name = EXCLUDED.name,
          price_per_month = EXCLUDED.price_per_month, member_limit = EXCLUDED.member_limit,
          storage_mb = EXCLUDED.storage_mb, display_storage = EXCLUDED.display_storage
  `)).catch(() => {});

  // ─── payment_logs ────────────────────────────────────────────────────────
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS payment_logs (
      id                   text        PRIMARY KEY,
      swimming_pool_id     text        NOT NULL,
      amount               integer     NOT NULL DEFAULT 0,
      status               text        NOT NULL,
      method               text,
      type                 text,
      description          text,
      billing_period_start text,
      billing_period_end   text,
      paid_at              timestamptz,
      created_at           timestamptz NOT NULL DEFAULT now()
    );
  `));
  // payment_logs 누락 컬럼 보완
  await db.execute(sql.raw(`ALTER TABLE payment_logs ADD COLUMN IF NOT EXISTS type text`)).catch(() => {});
  await db.execute(sql.raw(`ALTER TABLE payment_logs ADD COLUMN IF NOT EXISTS method text`)).catch(() => {});

  // ─── notifications (인앱 알림) ────────────────────────────────────────────
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS notifications (
      id             text        PRIMARY KEY,
      recipient_id   text        NOT NULL,
      recipient_type text        NOT NULL DEFAULT 'parent_account',
      type           text        NOT NULL,
      title          text,
      body           text,
      ref_id         text,
      ref_type       text,
      pool_id        text,
      is_read        boolean     NOT NULL DEFAULT false,
      created_at     timestamptz NOT NULL DEFAULT now()
    );
  `)).catch(() => {});

  // ─── payment_cards ───────────────────────────────────────────────────────
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS payment_cards (
      id               text        PRIMARY KEY,
      swimming_pool_id text        NOT NULL,
      card_last4       text        NOT NULL,
      card_brand       text,
      billing_key      text,
      card_nickname    text,
      is_default       boolean     NOT NULL DEFAULT false,
      created_at       timestamptz NOT NULL DEFAULT now()
    );
  `));

  // ─── manual_handover_makeups (기타 보강 인계 기록) ──────────────────────
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS manual_handover_makeups (
      id                    text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
      swimming_pool_id      text        NOT NULL,
      makeup_session_id     text,
      student_id            text,
      student_name          text,
      original_class_group_name text,
      original_teacher_id   text,
      original_teacher_name text,
      absence_date          text,
      lesson_date           text        NOT NULL,
      lesson_time           text        NOT NULL,
      settlement_unit       int         NOT NULL DEFAULT 1,
      status                text        NOT NULL DEFAULT 'requested',
      note                  text,
      created_by            text,
      created_by_name       text,
      created_at            timestamptz NOT NULL DEFAULT now()
    );
  `));

  // ─── member_transfers (회원 이전 요청) ───────────────────────────────────
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS member_transfers (
      id                text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
      pool_id           text        NOT NULL,
      student_id        text        NOT NULL,
      student_name      text,
      from_user_id      text,
      from_user_name    text,
      to_user_id        text,
      to_user_name      text,
      weekly_sessions   int         NOT NULL DEFAULT 0,
      remaining_makeups int         NOT NULL DEFAULT 0,
      notes             text,
      status            text        NOT NULL DEFAULT 'pending',
      work_message_id   text,
      resolved_at       timestamptz,
      resolved_by       text,
      created_at        timestamptz NOT NULL DEFAULT now()
    );
  `));

  // ─── messenger_read_state (메신저 읽음 상태) ─────────────────────────────
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS messenger_read_state (
      id            text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
      pool_id       text        NOT NULL,
      user_id       text        NOT NULL,
      channel_type  text        NOT NULL DEFAULT 'notice',
      last_read_at  timestamptz NOT NULL DEFAULT now(),
      UNIQUE (pool_id, user_id, channel_type)
    );
  `));

  console.log("[pool-db-init] superAdminDb 운영 테이블 초기화 완료");

  // 백업 DB가 분리되어 있으면 동일 스키마 초기화 (에러 무시)
  if (backupDb) {
    try {
      await backupDb.execute(sql.raw(`
        DO $$ BEGIN
          CREATE TYPE attendance_status AS ENUM ('present', 'absent', 'late');
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;
        DO $$ BEGIN
          CREATE TYPE change_type AS ENUM ('create', 'update', 'delete');
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;
        DO $$ BEGIN
          CREATE TYPE sync_status AS ENUM ('pending', 'synced', 'error');
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;
        DO $$ BEGIN
          CREATE TYPE snapshot_type AS ENUM ('incremental', 'full');
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      `));
      // backup_logs 테이블만 생성 (백업 메타데이터 저장용)
      await backupDb.execute(sql.raw(`
        CREATE TABLE IF NOT EXISTS backup_snapshots_meta (
          id           text PRIMARY KEY,
          source_db    text NOT NULL DEFAULT 'superAdminDb',
          tables_count integer,
          row_count    integer,
          size_bytes   bigint,
          backup_type  text,
          created_by   text,
          note         text,
          created_at   timestamptz NOT NULL DEFAULT now()
        );
      `));
      console.log("[pool-db-init] pool 백업 DB 스키마 초기화 완료");
    } catch (e: any) {
      console.warn("[pool-db-init] pool 백업 DB 초기화 건너뜀:", e.message);
    }
  }

  // ── 학부모 간편가입: swimming_pool_id nullable 허용 + is_active 컬럼 추가 ──
  await db.execute(sql.raw(`ALTER TABLE parent_accounts ALTER COLUMN swimming_pool_id DROP NOT NULL`)).catch(() => {});
  await db.execute(sql.raw(`ALTER TABLE parent_accounts ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true`)).catch(() => {});

  // ── 학부모 수업 요청 테이블 (결석/보강/연기/퇴원/상담/문의) ──────────────
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS parent_student_requests (
      id               text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
      swimming_pool_id text        NOT NULL,
      student_id       text        NOT NULL,
      parent_id        text        NOT NULL,
      request_type     text        NOT NULL,
      request_date     text,
      content          text,
      status           text        NOT NULL DEFAULT 'pending',
      processed_by     text,
      processed_at     timestamptz,
      admin_note       text,
      created_at       timestamptz NOT NULL DEFAULT now(),
      updated_at       timestamptz NOT NULL DEFAULT now()
    );
  `)).catch(() => {});
}
