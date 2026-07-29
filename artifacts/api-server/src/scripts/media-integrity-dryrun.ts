/**
 * Media Engine Phase 1 — 데이터 정합성 Dry-Run (읽기 전용)
 * 실행: npx tsx src/scripts/media-integrity-dryrun.ts
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

async function q(query: string): Promise<any[]> {
  try {
    const res = await db.execute(sql.raw(query));
    return res.rows as any[];
  } catch (e: any) {
    console.error(`  [SQL ERROR] ${e.message?.split("\n")[0]}`);
    return [];
  }
}

interface Check {
  id: number;
  title: string;
  rows: any[];
  sample: string[];
  cause: string;
  autoFix: boolean;
  manual: boolean;
  fix: string;
  rollback: string;
}

async function main() {
  console.log("════════════════════════════════════════════════════════════");
  console.log("  Media Engine Phase 1 — 데이터 정합성 Dry-Run");
  console.log(`  ${new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}`);
  console.log("════════════════════════════════════════════════════════════\n");

  const checks: Check[] = [];

  // ─── 1. 삭제된 일지를 journal_id로 참조하는 사진 ────────────────────────
  const r1 = await q(`
    SELECT pam.id, pam.media_status, pam.journal_id, pam.pool_id
    FROM photo_assets_meta pam
    JOIN class_diaries cd ON cd.id = pam.journal_id
    WHERE pam.journal_id IS NOT NULL AND cd.is_deleted = true
    LIMIT 200
  `);
  checks.push({
    id: 1, title: "삭제된 일지를 journal_id로 참조하는 사진",
    rows: r1,
    sample: r1.slice(0,5).map(r => `id=${r.id}  status=${r.media_status}  diary=${r.journal_id}`),
    cause: "일지 삭제 시 handleDiaryDeleted가 실행되지 않았거나 Media Engine 도입 이전 삭제 데이터",
    autoFix: true, manual: false,
    fix: "journal_id=NULL, student_note_id=NULL, media_status='detached'",
    rollback: "audit 테이블 기반 journal_id/media_status 원복"
  });

  // ─── 2. student_note_id 있으나 student_id가 NULL인 사진 ─────────────────
  const r2 = await q(`
    SELECT pam.id, pam.student_note_id, pam.journal_id, pam.pool_id
    FROM photo_assets_meta pam
    WHERE pam.student_note_id IS NOT NULL AND pam.student_id IS NULL
    LIMIT 200
  `);
  checks.push({
    id: 2, title: "student_note_id 있으나 student_id가 NULL",
    rows: r2,
    sample: r2.slice(0,5).map(r => `id=${r.id}  note=${r.student_note_id}  diary=${r.journal_id ?? 'NULL'}`),
    cause: "버그 3 — note-attach 레거시 코드가 student_id를 설정하지 않음",
    autoFix: true, manual: false,
    fix: "class_diary_student_notes에서 student_id 조회 후 UPDATE",
    rollback: "student_id=NULL로 원복"
  });

  // ─── 3. photo.journal_id vs note.diary_id 불일치 ─────────────────────────
  const r3 = await q(`
    SELECT pam.id, pam.journal_id, sn.diary_id AS note_diary_id, pam.student_note_id
    FROM photo_assets_meta pam
    JOIN class_diary_student_notes sn ON sn.id = pam.student_note_id
    WHERE pam.student_note_id IS NOT NULL
      AND pam.journal_id IS NOT NULL
      AND pam.journal_id != sn.diary_id
    LIMIT 200
  `);
  checks.push({
    id: 3, title: "photo.journal_id vs note.diary_id 불일치",
    rows: r3,
    sample: r3.slice(0,5).map(r => `id=${r.id}  photo_diary=${r.journal_id}  note_diary=${r.note_diary_id}`),
    cause: "note attach 시 journal_id를 별도 설정하거나 note가 다른 일지로 이동된 경우",
    autoFix: true, manual: false,
    fix: "photo.journal_id = note.diary_id로 동기화",
    rollback: "원래 journal_id 원복"
  });

  // ─── 4. photo.student_id vs note.student_id 불일치 ─────────────────────
  const r4 = await q(`
    SELECT pam.id, pam.student_id AS photo_s, sn.student_id AS note_s, pam.student_note_id
    FROM photo_assets_meta pam
    JOIN class_diary_student_notes sn ON sn.id = pam.student_note_id
    WHERE pam.student_note_id IS NOT NULL
      AND pam.student_id IS NOT NULL
      AND pam.student_id != sn.student_id
    LIMIT 200
  `);
  checks.push({
    id: 4, title: "photo.student_id vs note.student_id 불일치",
    rows: r4,
    sample: r4.slice(0,5).map(r => `id=${r.id}  photo_s=${r.photo_s}  note_s=${r.note_s}`),
    cause: "버그 3 변형 — 다른 student의 사진이 note에 잘못 연결된 경우",
    autoFix: true, manual: true,
    fix: "photo.student_id = note.student_id로 정합성 복구",
    rollback: "원래 student_id 원복"
  });

  // ─── 5. media_status='attached'이지만 journal_id가 NULL ──────────────────
  const r5 = await q(`
    SELECT id, pool_id, album_type, student_note_id, media_status,
           created_at::date AS created_date
    FROM photo_assets_meta
    WHERE media_status = 'attached' AND journal_id IS NULL
    LIMIT 200
  `);
  checks.push({
    id: 5, title: "media_status='attached'이지만 journal_id가 NULL",
    rows: r5,
    sample: r5.slice(0,5).map(r => `id=${r.id}  note=${r.student_note_id ?? 'NULL'}  type=${r.album_type}  date=${r.created_date}`),
    cause: "백필 로직 불완전 또는 attach 처리 중 journal_id 설정 누락",
    autoFix: false, manual: true,
    fix: "근거 있으면 journal_id 복구, 없으면 media_status='detached'",
    rollback: "media_status='attached'로 원복"
  });

  // ─── 6. media_status='draft'이지만 journal_id가 존재 ────────────────────
  const r6 = await q(`
    SELECT pam.id, pam.journal_id, pam.media_status, cd.is_deleted AS diary_deleted
    FROM photo_assets_meta pam
    LEFT JOIN class_diaries cd ON cd.id = pam.journal_id
    WHERE pam.media_status = 'draft' AND pam.journal_id IS NOT NULL
    LIMIT 200
  `);
  checks.push({
    id: 6, title: "media_status='draft'이지만 journal_id가 존재",
    rows: r6,
    sample: r6.slice(0,5).map(r => `id=${r.id}  diary=${r.journal_id}  diary_deleted=${r.diary_deleted}`),
    cause: "백필이 일부만 적용됐거나 attach 상태 전환이 누락된 경우",
    autoFix: true, manual: false,
    fix: "활성 diary 참조 → attached로, 삭제된 diary → detached+journal_id=NULL",
    rollback: "media_status='draft' 원복"
  });

  // ─── 7. media_status='detached'이지만 journal_id 또는 note 잔존 ─────────
  const r7 = await q(`
    SELECT id, pool_id, journal_id, student_note_id, media_status
    FROM photo_assets_meta
    WHERE media_status = 'detached'
      AND (journal_id IS NOT NULL OR student_note_id IS NOT NULL)
    LIMIT 200
  `);
  checks.push({
    id: 7, title: "media_status='detached'이지만 journal_id/student_note_id 잔존",
    rows: r7,
    sample: r7.slice(0,5).map(r => `id=${r.id}  diary=${r.journal_id ?? 'NULL'}  note=${r.student_note_id ?? 'NULL'}`),
    cause: "detach 처리 중 참조 해제가 누락된 경우",
    autoFix: true, manual: false,
    fix: "journal_id=NULL, student_note_id=NULL",
    rollback: "원래 값으로 원복"
  });

  // ─── 8. 물리적으로 존재하지 않는 diary를 참조하는 사진 ──────────────────
  const r8 = await q(`
    SELECT pam.id, pam.pool_id, pam.journal_id, pam.media_status
    FROM photo_assets_meta pam
    LEFT JOIN class_diaries cd ON cd.id = pam.journal_id
    WHERE pam.journal_id IS NOT NULL AND cd.id IS NULL
    LIMIT 200
  `);
  checks.push({
    id: 8, title: "존재하지 않는 diary 참조 (orphan)",
    rows: r8,
    sample: r8.slice(0,5).map(r => `id=${r.id}  orphan_diary=${r.journal_id}`),
    cause: "diary 물리 삭제(드물) 또는 pool 마이그레이션 ID 불일치",
    autoFix: true, manual: false,
    fix: "journal_id=NULL, media_status='detached'",
    rollback: "journal_id 원복 (diary 없으므로 실질 영향 없음)"
  });

  // ─── 9. 존재하지 않는 student note를 참조하는 사진 ──────────────────────
  const r9 = await q(`
    SELECT pam.id, pam.pool_id, pam.student_note_id, pam.media_status
    FROM photo_assets_meta pam
    LEFT JOIN class_diary_student_notes sn ON sn.id = pam.student_note_id
    WHERE pam.student_note_id IS NOT NULL AND sn.id IS NULL
    LIMIT 200
  `);
  checks.push({
    id: 9, title: "존재하지 않는 student note 참조 (orphan)",
    rows: r9,
    sample: r9.slice(0,5).map(r => `id=${r.id}  orphan_note=${r.student_note_id}`),
    cause: "note 물리 삭제 또는 소프트삭제 후 조회 누락",
    autoFix: true, manual: false,
    fix: "student_note_id=NULL, student_id=NULL, media_status='detached'",
    rollback: "student_note_id 원복"
  });

  // ─── 10. 존재하지 않는 student를 참조하는 사진 ──────────────────────────
  const r10 = await q(`
    SELECT pam.id, pam.pool_id, pam.student_id, pam.media_status
    FROM photo_assets_meta pam
    LEFT JOIN students s ON s.id = pam.student_id
    WHERE pam.student_id IS NOT NULL AND s.id IS NULL
    LIMIT 200
  `);
  checks.push({
    id: 10, title: "존재하지 않는 student 참조 (orphan)",
    rows: r10,
    sample: r10.slice(0,5).map(r => `id=${r.id}  orphan_student=${r.student_id}`),
    cause: "학생 삭제 후 photo의 student_id 참조 잔존",
    autoFix: false, manual: true,
    fix: "student_id=NULL (학부모 노출 차단), media_status 유지",
    rollback: "student_id 원복"
  });

  // ─── 11. 동일 object_key 중복 레코드 ─────────────────────────────────────
  const r11 = await q(`
    SELECT object_key,
           COUNT(*) AS cnt,
           array_agg(id ORDER BY created_at) AS ids,
           array_agg(media_status ORDER BY created_at) AS statuses
    FROM photo_assets_meta
    WHERE object_key IS NOT NULL
    GROUP BY object_key
    HAVING COUNT(*) > 1
    ORDER BY cnt DESC
    LIMIT 30
  `);
  checks.push({
    id: 11, title: "동일 object_key 중복 레코드",
    rows: r11,
    sample: r11.slice(0,5).map(r => `key=...${r.object_key?.slice(-20)}  cnt=${r.cnt}  statuses=${r.statuses}`),
    cause: "업로드 재시도 중 중복 INSERT 또는 마이그레이션 충돌",
    autoFix: false, manual: true,
    fix: "최신 레코드 유지, 나머지 media_status='archived'",
    rollback: "archived 레코드 원상복구"
  });

  // ─── 12. 허용되지 않은 media_status 값 또는 NULL ─────────────────────────
  const r12 = await q(`
    SELECT id, pool_id, media_status, journal_id IS NOT NULL AS has_diary
    FROM photo_assets_meta
    WHERE media_status NOT IN ('draft', 'attached', 'detached', 'archived')
       OR media_status IS NULL
    LIMIT 200
  `);
  checks.push({
    id: 12, title: "허용 외 media_status 값 또는 NULL",
    rows: r12,
    sample: r12.slice(0,5).map(r => `id=${r.id}  status=${r.media_status ?? 'NULL'}  has_diary=${r.has_diary}`),
    cause: "백필 미적용(NULL) 또는 허용 외 값이 직접 INSERT된 경우",
    autoFix: true, manual: false,
    fix: "journal_id 있으면 'attached', 없으면 'draft'로 기본 설정",
    rollback: "원래 값 원복"
  });

  // ─── 13. 동일 photo가 논리적으로 두 일지에 연결될 수 있는 상태 ───────────
  const r13 = await q(`
    SELECT pam.id, pam.journal_id, sn.diary_id AS note_diary_id
    FROM photo_assets_meta pam
    JOIN class_diary_student_notes sn ON sn.id = pam.student_note_id
    WHERE pam.journal_id IS NOT NULL
      AND sn.diary_id IS NOT NULL
      AND pam.journal_id != sn.diary_id
      AND pam.media_status = 'attached'
    LIMIT 200
  `);
  checks.push({
    id: 13, title: "attached 상태에서 journal_id와 note.diary_id가 다른 사진 (이중 노출 위험)",
    rows: r13,
    sample: r13.slice(0,5).map(r => `id=${r.id}  journal=${r.journal_id}  note_diary=${r.note_diary_id}`),
    cause: "레거시 attach에서 journal_id와 student_note_id가 별도로 설정된 경우",
    autoFix: true, manual: false,
    fix: "photo.journal_id = note.diary_id로 동기화",
    rollback: "원래 journal_id 원복"
  });

  // ─── 14. photo.pool_id vs diary.swimming_pool_id 불일치 ────────────────
  const r14 = await q(`
    SELECT pam.id, pam.pool_id AS photo_pool, cd.swimming_pool_id AS diary_pool, pam.journal_id
    FROM photo_assets_meta pam
    JOIN class_diaries cd ON cd.id = pam.journal_id
    WHERE pam.journal_id IS NOT NULL
      AND pam.pool_id != cd.swimming_pool_id
    LIMIT 200
  `);
  checks.push({
    id: 14, title: "photo.pool_id vs diary.swimming_pool_id 불일치 (cross-pool)",
    rows: r14,
    sample: r14.slice(0,5).map(r => `id=${r.id}  photo_pool=${r.photo_pool}  diary_pool=${r.diary_pool}`),
    cause: "pool 마이그레이션 또는 cross-pool 권한 우회",
    autoFix: false, manual: true,
    fix: "journal_id=NULL, media_status='detached'",
    rollback: "journal_id 원복"
  });

  // ─── 15. media_status='attached' + student_note_id 있는데 student_id가 다른 note와 불일치 ─
  // 추가: note 소프트삭제 되어 있는데 photo는 attached인 경우
  const r15 = await q(`
    SELECT pam.id, pam.media_status, pam.student_note_id, sn.is_deleted AS note_deleted
    FROM photo_assets_meta pam
    JOIN class_diary_student_notes sn ON sn.id = pam.student_note_id
    WHERE pam.media_status = 'attached'
      AND sn.is_deleted = true
    LIMIT 200
  `);
  checks.push({
    id: 15, title: "attached 사진이 소프트삭제된 note를 참조",
    rows: r15,
    sample: r15.slice(0,5).map(r => `id=${r.id}  note=${r.student_note_id}  note_deleted=${r.note_deleted}`),
    cause: "note 소프트삭제 후 photo의 media_status 전환이 누락된 경우",
    autoFix: true, manual: false,
    fix: "student_note_id=NULL, media_status='detached'",
    rollback: "student_note_id 원복, media_status='attached'"
  });

  // ─── 요약 출력 ────────────────────────────────────────────────────────────
  console.log("┌─────────────────────────────────────────────────────────────────┐");
  console.log("│                      Dry-Run 결과 요약                           │");
  console.log("└─────────────────────────────────────────────────────────────────┘\n");

  let totalIssues = 0;
  for (const c of checks) {
    totalIssues += c.rows.length;
    const icon = c.rows.length === 0 ? "✅" : c.rows.length < 5 ? "⚠️ " : "🔴";
    console.log(`${icon} [${String(c.rows.length).padStart(3)}건] #${c.id}. ${c.title}`);
    if (c.rows.length > 0) {
      console.log(`         원인: ${c.cause}`);
      console.log(`         수정: ${c.fix}`);
      console.log(`         자동수정=${c.autoFix ? "O" : "X"}  수동확인=${c.manual ? "필요" : "-"}`);
      for (const s of c.sample) console.log(`         → ${s}`);
    }
  }

  const issues = checks.filter(c => c.rows.length > 0);
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`총 발견: ${totalIssues}건 (${issues.length}개 항목)`);
  if (issues.length > 0) {
    console.log(`자동 수정 가능: 체크 ${issues.filter(c => c.autoFix).map(c => c.id).join(", ")}`);
    console.log(`수동 확인 필요: 체크 ${issues.filter(c => c.manual).map(c => c.id).join(", ")}`);
  }

  // ─── EXPLAIN ANALYZE ───────────────────────────────────────────────────
  console.log("\n\n══════════════════════════════════════════════════════════════════");
  console.log("  EXPLAIN ANALYZE — 인덱스 사용 검증");
  console.log("══════════════════════════════════════════════════════════════════");

  // 실제 diary/class 샘플 확보
  const sampleDiary = await q(`SELECT id, swimming_pool_id, class_group_id FROM class_diaries WHERE is_deleted=false LIMIT 1`);
  const sampleClass = await q(`SELECT id FROM class_groups LIMIT 1`);
  const sampleStudent = await q(`SELECT id FROM students LIMIT 1`);

  const diaryId   = sampleDiary[0]?.id ?? "NO_DATA";
  const poolId    = sampleDiary[0]?.swimming_pool_id ?? "NO_DATA";
  const classId   = sampleDiary[0]?.class_group_id ?? sampleClass[0]?.id ?? "NO_DATA";
  const studentId = sampleStudent[0]?.id ?? "NO_DATA";

  const explains = [
    {
      label: "①  diary_id 기준 일지 사진 조회 (getDiaryPhotos)",
      q: `EXPLAIN (ANALYZE, FORMAT TEXT)
          SELECT pam.id, pam.media_status, pam.student_id
          FROM photo_assets_meta pam
          JOIN class_diaries cd ON cd.id = pam.journal_id AND cd.is_deleted = false
          WHERE pam.journal_id = '${diaryId}' AND pam.media_status = 'attached'
          ORDER BY pam.created_at ASC`
    },
    {
      label: "②  class_id + draft 사진 조회 (getDraftPhotosForClass)",
      q: `EXPLAIN (ANALYZE, FORMAT TEXT)
          SELECT id, class_id, media_status
          FROM photo_assets_meta
          WHERE class_id = '${classId}' AND media_status = 'draft'
          ORDER BY created_at ASC`
    },
    {
      label: "③  student_note_id 기준 개인사진 조회",
      q: `EXPLAIN (ANALYZE, FORMAT TEXT)
          SELECT id, student_note_id, student_id
          FROM photo_assets_meta
          WHERE student_id = '${studentId}' AND media_status = 'attached'
          ORDER BY created_at ASC`
    },
    {
      label: "④  Teacher 그룹 사진 조회 (GET /photos/group/:classId)",
      q: `EXPLAIN (ANALYZE, FORMAT TEXT)
          SELECT sp.id, sp.media_status
          FROM photo_assets_meta sp
          JOIN class_diaries cd ON cd.id = sp.journal_id AND cd.is_deleted = false
          WHERE cd.class_group_id = '${classId}' AND sp.album_type = 'group' AND sp.media_status = 'attached'
          ORDER BY sp.created_at DESC`
    },
    {
      label: "⑤  Parent 일지 목록 조회 (ROW_NUMBER DISTINCT)",
      q: `EXPLAIN (ANALYZE, FORMAT TEXT)
          SELECT id, lesson_date, is_makeup_diary FROM (
            SELECT cd.id, cd.lesson_date,
                   CASE WHEN ms.id IS NOT NULL THEN true ELSE false END AS is_makeup_diary,
                   ROW_NUMBER() OVER (PARTITION BY cd.id ORDER BY ms.id NULLS LAST) AS rn
            FROM class_diaries cd
            LEFT JOIN student_class_history sch
              ON sch.class_group_id = cd.class_group_id
              AND sch.student_id = '${studentId}'
              AND sch.enrolled_at <= cd.lesson_date::date
              AND (sch.left_at IS NULL OR sch.left_at > cd.lesson_date::date)
            LEFT JOIN makeup_sessions ms
              ON ms.assigned_class_group_id = cd.class_group_id
              AND ms.student_id = '${studentId}'
              AND ms.assigned_date = cd.lesson_date AND ms.status = 'completed'
            WHERE cd.is_deleted = false AND (sch.id IS NOT NULL OR ms.id IS NOT NULL)
          ) sub WHERE rn=1
          ORDER BY lesson_date DESC LIMIT 40`
    },
    {
      label: "⑥  삭제되지 않은 class_diaries 조회",
      q: `EXPLAIN (ANALYZE, FORMAT TEXT)
          SELECT id, lesson_date
          FROM class_diaries
          WHERE is_deleted = false AND class_group_id = '${classId}'
          ORDER BY lesson_date DESC LIMIT 100`
    },
    {
      label: "⑦  Parent 일지 사진 조회 (media_status=attached + is_deleted JOIN)",
      q: `EXPLAIN (ANALYZE, FORMAT TEXT)
          SELECT pam.id, pam.student_id, pam.media_status
          FROM photo_assets_meta pam
          JOIN class_diaries cd ON cd.id = pam.journal_id AND cd.is_deleted = false
          WHERE pam.journal_id = '${diaryId}' AND pam.pool_id = '${poolId}'
            AND pam.media_status = 'attached'
          ORDER BY pam.created_at ASC`
    }
  ];

  for (const ex of explains) {
    console.log(`\n── ${ex.label}`);
    if (diaryId === "NO_DATA" && ex.q.includes("NO_DATA")) {
      console.log("  [SKIP] 샘플 데이터 없음");
      continue;
    }
    const rows = await q(ex.q);
    if (rows.length === 0) { console.log("  [SKIP] 결과 없음"); continue; }
    const plan = rows.map((r: any) => Object.values(r)[0]).join("\n");
    // 핵심 라인만 출력 (Index Scan, Seq Scan, actual time, rows)
    const lines = plan.split("\n");
    for (const line of lines) {
      if (
        /Seq Scan|Index Scan|Index Only|Bitmap|actual time|Planning Time|Execution Time|rows=|loops=/.test(line)
      ) {
        console.log("  " + line);
      }
    }
  }

  console.log("\n\n════════════════════════════════════════════════════════════");
  console.log("  Dry-Run 완료 — 실제 수정은 Phase B Cleanup에서만 수행");
  console.log("════════════════════════════════════════════════════════════");
  process.exit(0);
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
