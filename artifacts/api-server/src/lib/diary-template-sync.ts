/**
 * diary-template-sync.ts
 *
 * 수영장 diary_templates(scope='global', is_active=true)를
 * curriculum_items로 materialize/sync.
 *
 * 설계 원칙:
 *  - Pool 완전 격리: 한 pool의 sync가 다른 pool curriculum_items에 영향 없음
 *  - 멱등: 반복 호출 안전 (ON CONFLICT upsert)
 *  - 1:1 매핑: 1 diary_template → 1 curriculum_item
 *  - Effective template = scope='global' AND is_active=true
 *    (diary admin 화면이 보여주는 집합과 동일)
 *  - Teacher override / x_global / archived 제외
 *  - source_template_id 추적: curriculum_item → diary_template 역방향 연결
 *
 * 금지:
 *  - Toykids 특정 ID/조건 하드코딩
 *  - 다른 pool template 혼입
 *  - artificial split / inflation
 *  - 빈 내용 생성
 */

import { superAdminDb } from "@workspace/db";
import { sql }          from "drizzle-orm";

/** diary-template 기반 managed version 이름 (DOCX 기반 x-curriculum-v1 과 구분) */
export const DIARY_TEMPLATE_VERSION_NAME = "diary-templates-v1";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SyncResult {
  poolId:      string;
  versionId:   string;
  synced:      number;  // active curriculum_items after sync
  deactivated: number;  // items that were active but no longer in effective set
}

// ─── Effective template selector ──────────────────────────────────────────────

/**
 * 특정 pool의 effective diary templates 조회.
 *
 * "effective" = diary admin 화면(관리자 뷰)이 보여주는 집합:
 *   scope = 'global'  AND  is_active = true
 *
 * teacher override / scope='teacher' / scope='x_global' 는 제외.
 * 다른 pool 데이터는 swimming_pool_id 조건으로 완전 차단.
 */
async function fetchEffectiveTemplates(poolId: string): Promise<Array<{
  templateId:   string;
  templateText: string;
  sortOrder:    number;
  levelName:    string | null;
}>> {
  const res = await superAdminDb.execute(sql`
    SELECT
      dt.id            AS template_id,
      dt.template_text,
      dt.sort_order,
      dtl.level_name
    FROM diary_templates dt
    LEFT JOIN diary_template_levels dtl ON dtl.id = dt.level_id
    WHERE dt.swimming_pool_id = ${poolId}
      AND dt.scope            = 'global'
      AND dt.is_active        = true
    ORDER BY dt.sort_order ASC, dt.created_at ASC
  `);

  return (res as any).rows.map((r: any) => ({
    templateId:   r.template_id   as string,
    templateText: r.template_text as string,
    sortOrder:    r.sort_order    as number,
    levelName:    r.level_name    as string | null,
  }));
}

// ─── Managed version helper ────────────────────────────────────────────────────

/**
 * 해당 pool의 diary-template managed curriculum_version 확보 (upsert).
 * Returns version id.
 */
async function ensureDiaryTemplateVersion(poolId: string): Promise<string> {
  // Upsert: exists → update timestamps; not exists → insert
  await superAdminDb.execute(sql`
    INSERT INTO curriculum_versions
      (swimming_pool_id, version_name, is_active, activated_at)
    VALUES
      (${poolId}, ${DIARY_TEMPLATE_VERSION_NAME}, true, NOW())
    ON CONFLICT (swimming_pool_id, version_name) DO UPDATE SET
      is_active    = true,
      activated_at = COALESCE(curriculum_versions.activated_at, NOW()),
      updated_at   = NOW()
  `);

  const res = await superAdminDb.execute(sql`
    SELECT id
    FROM curriculum_versions
    WHERE swimming_pool_id = ${poolId}
      AND version_name     = ${DIARY_TEMPLATE_VERSION_NAME}
    LIMIT 1
  `);

  const versionId = (res as any).rows?.[0]?.id as string | undefined;
  if (!versionId) {
    throw new Error(
      `[diary-template-sync] curriculum_version 생성 실패 (pool=${poolId})`,
    );
  }
  return versionId;
}

// ─── Main sync function ────────────────────────────────────────────────────────

/**
 * syncDiaryTemplatesToCurriculumItems(poolId)
 *
 * 특정 pool의 effective diary templates를 curriculum_items로 sync.
 *
 * 호출 시점:
 *  - diary template POST (admin global 추가)
 *  - diary template PATCH (admin global 수정)
 *  - diary template DELETE (admin global 삭제)
 *  - restore-default / clear-all
 *
 * 모든 호출은 fire-and-forget (.catch() 패턴). 응답 블로킹 없음.
 */
export async function syncDiaryTemplatesToCurriculumItems(
  poolId: string,
): Promise<SyncResult> {
  // 1. managed version 확보
  const versionId = await ensureDiaryTemplateVersion(poolId);

  // 2. effective templates 조회
  const templates = await fetchEffectiveTemplates(poolId);

  // 3. Upsert each → curriculum_item
  //    ON CONFLICT (swimming_pool_id, source_template_id) WHERE source_template_id IS NOT NULL
  for (const tpl of templates) {
    const title = tpl.levelName ?? "";
    await superAdminDb.execute(sql`
      INSERT INTO curriculum_items
        (curriculum_version_id, swimming_pool_id, sort_order, title, description, is_active, source_template_id)
      VALUES
        (${versionId}, ${poolId}, ${tpl.sortOrder}, ${title}, ${tpl.templateText}, true, ${tpl.templateId})
      ON CONFLICT (swimming_pool_id, source_template_id) WHERE source_template_id IS NOT NULL
      DO UPDATE SET
        curriculum_version_id = EXCLUDED.curriculum_version_id,
        sort_order            = EXCLUDED.sort_order,
        title                 = EXCLUDED.title,
        description           = EXCLUDED.description,
        is_active             = true
    `);
  }

  // 4. Deactivate items whose source_template is no longer in effective set
  //    Subquery keeps it pool-isolated and avoids any array serialization issue
  await superAdminDb.execute(sql`
    UPDATE curriculum_items
    SET is_active = false
    WHERE swimming_pool_id      = ${poolId}
      AND curriculum_version_id = ${versionId}
      AND source_template_id IS NOT NULL
      AND is_active             = true
      AND source_template_id NOT IN (
        SELECT dt.id
        FROM diary_templates dt
        WHERE dt.swimming_pool_id = ${poolId}
          AND dt.scope            = 'global'
          AND dt.is_active        = true
      )
  `);

  // 5. Count result
  const countRes = await superAdminDb.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE is_active = true)::int  AS active_count,
      COUNT(*) FILTER (WHERE is_active = false)::int AS inactive_count
    FROM curriculum_items
    WHERE swimming_pool_id      = ${poolId}
      AND curriculum_version_id = ${versionId}
  `);
  const row = (countRes as any).rows?.[0] ?? {};

  console.log(
    `[diary-template-sync] pool=${poolId} synced=${row.active_count ?? 0} deactivated=${row.inactive_count ?? 0}`,
  );

  return {
    poolId,
    versionId,
    synced:      row.active_count   ?? 0,
    deactivated: row.inactive_count ?? 0,
  };
}

/**
 * fireSyncInBackground(poolId)
 *
 * sync를 백그라운드로 실행. 응답 블로킹 없음.
 * diary template mutation 후 항상 이 함수로 호출.
 */
export function fireSyncInBackground(poolId: string): void {
  syncDiaryTemplatesToCurriculumItems(poolId).catch((err) => {
    console.error(
      `[diary-template-sync] 백그라운드 sync 실패 (pool=${poolId}):`,
      err?.message ?? err,
    );
  });
}
