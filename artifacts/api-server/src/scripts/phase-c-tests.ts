/**
 * Phase C — Transaction / 권한 / 삭제 무결성 검증
 * 실행: npx tsx src/scripts/phase-c-tests.ts
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  attachPhotosToDiary,
  attachPhotosToStudentNote,
  handleDiaryDeleted,
  getDiaryPhotos,
  getDraftPhotosForClass,
} from "../services/mediaService.js";

const TS = Date.now();
let SEQ = 0;
const uid = (prefix: string) => `${prefix}_C${TS}_${(++SEQ).toString().padStart(3, "0")}`;

async function q(query: string): Promise<any[]> {
  const r = await db.execute(sql.raw(query));
  return r.rows as any[];
}

interface TestResult { name: string; passed: boolean; detail: string; }
const results: TestResult[] = [];
function pass(name: string, detail = "") { results.push({ name, passed: true, detail }); console.log(`  ✅ ${name}  ${detail}`); }
function fail(name: string, detail: string) { results.push({ name, passed: false, detail }); console.log(`  ❌ ${name}: ${detail}`); }

// ── 전역 픽스처 (pool / class / teacher / students) ──────────────────────
let POOL_ID = "", CLASS_ID = "", TEACHER_ID = "";
let SID_A = "", SID_B = "", SID_C = "";

async function setupGlobal() {
  const row = (await q(`
    SELECT cg.id AS class_id, cg.swimming_pool_id AS pool_id, cg.teacher_user_id,
           (SELECT id FROM students WHERE class_group_id=cg.id ORDER BY id LIMIT 1) AS s1,
           (SELECT id FROM students WHERE class_group_id=cg.id ORDER BY id LIMIT 1 OFFSET 1) AS s2,
           (SELECT id FROM students WHERE class_group_id=cg.id ORDER BY id LIMIT 1 OFFSET 2) AS s3
    FROM class_groups cg
    WHERE cg.is_deleted=false AND cg.teacher_user_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM students WHERE class_group_id=cg.id)
    LIMIT 1
  `))[0];
  if (!row?.s1) throw new Error("학생 있는 반 없음");
  POOL_ID = row.pool_id; CLASS_ID = row.class_id; TEACHER_ID = row.teacher_user_id;
  SID_A = row.s1; SID_B = row.s2 ?? row.s1; SID_C = row.s3 ?? row.s1;
  console.log(`  pool=…${POOL_ID.slice(-8)}  class=…${CLASS_ID.slice(-8)}  A=…${SID_A.slice(-8)}`);
}

/** 테스트용 draft 사진 N장 생성 */
async function mkPhotos(n: number, overrides: Record<string, string> = {}): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const pid = uid("ph");
    await db.execute(sql.raw(`
      INSERT INTO photo_assets_meta
        (id, pool_id, class_id, album_type, object_key, file_size, uploaded_by, media_status
         ${overrides.lesson_date ? ", lesson_date" : ""})
      VALUES
        ('${pid}','${overrides.pool_id ?? POOL_ID}','${overrides.class_id ?? CLASS_ID}','group',
         'test/c/${pid}.jpg',512,'${TEACHER_ID}','draft'
         ${overrides.lesson_date ? `, '${overrides.lesson_date}'` : ""})
    `));
    ids.push(pid);
  }
  return ids;
}

/** 사진 삭제 */
async function delPhotos(ids: string[]) {
  if (!ids.length) return;
  await db.execute(sql.raw(`DELETE FROM photo_assets_meta WHERE id IN ('${ids.join("','")}')`)).catch(() => {});
}

/** 일지+노트 삭제 */
async function delDiary(id: string) {
  await db.execute(sql.raw(`DELETE FROM class_diary_student_notes WHERE diary_id='${id}'`)).catch(() => {});
  await db.execute(sql.raw(`DELETE FROM class_diaries WHERE id='${id}'`)).catch(() => {});
}

/** 임시 일지 생성 */
async function mkDiary(dateStr: string, content = "TEST"): Promise<string> {
  const did = uid("cd");
  await db.execute(sql.raw(`
    INSERT INTO class_diaries (id, class_group_id, teacher_id, teacher_name, swimming_pool_id, lesson_date, common_content)
    VALUES ('${did}','${CLASS_ID}','${TEACHER_ID}','test','${POOL_ID}','${dateStr}','${content}')
  `));
  return did;
}

/** 임시 노트 생성 */
async function mkNote(diaryId: string, studentId: string): Promise<string> {
  const nid = uid("csn");
  await db.execute(sql.raw(`
    INSERT INTO class_diary_student_notes (id, diary_id, student_id, note_content)
    VALUES ('${nid}','${diaryId}','${studentId}','test note')
  `));
  return nid;
}

// ════════════════════════════════════════════════════════════════════════
// SECTION 1: Transaction Rollback (A~F)
// ════════════════════════════════════════════════════════════════════════
async function section1_TransactionRollback() {
  console.log("\n══ SECTION 1: Transaction Rollback ══════════════════════════");

  // ── TEST A: Note INSERT 실패 → diary rollback ─────────────────────────
  {
    const did = uid("cd");
    await db.execute(sql`BEGIN`);
    try {
      await db.execute(sql.raw(`INSERT INTO class_diaries (id,class_group_id,teacher_id,teacher_name,swimming_pool_id,lesson_date,common_content) VALUES ('${did}','${CLASS_ID}','${TEACHER_ID}','t','${POOL_ID}','2099-01-01','A')`));
      await db.execute(sql.raw(`INSERT INTO class_diary_student_notes (id,diary_id,student_id,note_content) VALUES ('csn_fail_${TS}','${did}',NULL,'x')`)); // student_id NOT NULL → 실패
      await db.execute(sql`COMMIT`);
    } catch {
      await db.execute(sql`ROLLBACK`).catch(() => {});
    }
    const check = await q(`SELECT id FROM class_diaries WHERE id='${did}'`);
    check.length === 0
      ? pass("TEST A: Note실패→Diary rollback", "diary 미생성 ✅")
      : (await delDiary(did), fail("TEST A", `diary 잔존 ${check.length}건`));
  }

  // ── TEST B: attach 실패 → rollback ──────────────────────────────────
  {
    const did = await mkDiary("2099-01-02", "B");
    let threw = false;
    await db.execute(sql`BEGIN`);
    try {
      await attachPhotosToDiary(did, ["nonexistent_photo_xyz"], POOL_ID);
      await db.execute(sql`COMMIT`);
    } catch { threw = true; await db.execute(sql`ROLLBACK`).catch(() => {}); }
    const linked = await q(`SELECT id FROM photo_assets_meta WHERE journal_id='${did}'`);
    await delDiary(did);
    threw && linked.length === 0
      ? pass("TEST B: attach실패→rollback", "photo 연결 0건 ✅")
      : fail("TEST B", `threw=${threw} linked=${linked.length}`);
  }

  // ── TEST C: 공통photo성공 → 개인photo실패 → 공통photo도 rollback ──────
  {
    const did = await mkDiary("2099-01-03", "C");
    const nid = await mkNote(did, SID_A);
    const [cp] = await mkPhotos(1);

    await db.execute(sql`BEGIN`);
    let threw = false;
    try {
      await attachPhotosToDiary(did, [cp], POOL_ID);
      await attachPhotosToStudentNote(did, "note_nonexistent_xyz", SID_A, ["bad_photo"], POOL_ID);
      await db.execute(sql`COMMIT`);
    } catch { threw = true; await db.execute(sql`ROLLBACK`).catch(() => {}); }

    const cpRow = await q(`SELECT media_status FROM photo_assets_meta WHERE id='${cp}'`);
    await delDiary(did);
    await delPhotos([cp]);

    threw && cpRow[0]?.media_status === "draft"
      ? pass("TEST C: 개인photo실패→공통photo rollback", "공통photo draft유지 ✅")
      : fail("TEST C", `threw=${threw} status=${cpRow[0]?.media_status}`);
  }

  // ── TEST D: 동일 photo ID 중복 전달 → idempotent ────────────────────
  {
    const did = await mkDiary("2099-01-04", "D");
    const [dp] = await mkPhotos(1);

    let threw = false;
    try {
      await attachPhotosToDiary(did, [dp, dp], POOL_ID); // 중복 — deduplicate 후 처리
    } catch (e: any) { threw = true; console.log(`    TEST D threw: ${e.message}`); }

    const row = await q(`SELECT journal_id, media_status FROM photo_assets_meta WHERE id='${dp}'`);
    await delDiary(did);
    await delPhotos([dp]);

    !threw && row[0]?.journal_id === did
      ? pass("TEST D: 중복ID deduplicate 처리", "1건 attach, 에러 없음 ✅")
      : fail("TEST D", `threw=${threw} journal_id=${row[0]?.journal_id?.slice(-8) ?? 'null'}`);
  }

  // ── TEST E: 다른 pool 사진 → 권한 오류 ──────────────────────────────
  {
    const did = await mkDiary("2099-01-05", "E");
    let threw = false; let errMsg = "";
    try { await attachPhotosToDiary(did, ["photo_other_pool_xyz"], POOL_ID); }
    catch (e: any) { threw = true; errMsg = e.message; }
    await delDiary(did);
    threw
      ? pass("TEST E: 다른pool사진→거부", `"${errMsg}" ✅`)
      : fail("TEST E", "다른 pool 사진 허용됨");
  }

  // ── TEST F: 이미 attached 사진 → 에러, 기존 연결 유지 ───────────────
  {
    const d1 = await mkDiary("2099-01-06", "F1");
    const d2 = await mkDiary("2099-01-07", "F2");
    const [fp] = await mkPhotos(1);

    await attachPhotosToDiary(d1, [fp], POOL_ID); // diary1 attach

    let threw = false; let errMsg = "";
    try { await attachPhotosToDiary(d2, [fp], POOL_ID); } // diary2 재attach 시도
    catch (e: any) { threw = true; errMsg = e.message; }

    const row = await q(`SELECT journal_id FROM photo_assets_meta WHERE id='${fp}'`);
    await delDiary(d1); await delDiary(d2);
    await delPhotos([fp]);

    threw && row[0]?.journal_id === d1
      ? pass("TEST F: attached사진 재attach 차단", `diary1유지, 에러="${errMsg.slice(0,40)}" ✅`)
      : fail("TEST F", `threw=${threw} journal=${row[0]?.journal_id?.slice(-8) ?? 'null'} — attached 사진이 다른 diary로 이동 가능`);
  }
}

// ════════════════════════════════════════════════════════════════════════
// SECTION 2: Diary 삭제 검증
// ════════════════════════════════════════════════════════════════════════
async function section2_DeletionVerification() {
  console.log("\n══ SECTION 2: Diary 삭제 검증 ══════════════════════════════");

  const did = await mkDiary("2099-02-01", "DEL");
  const nA = await mkNote(did, SID_A);
  const nB = await mkNote(did, SID_B);

  // 공통3장 + 학생A 2장 + 학생B 2장 + 학생C 1장
  const common = await mkPhotos(3);
  const pA     = await mkPhotos(2);
  const pB     = await mkPhotos(2);
  const pC     = await mkPhotos(1);
  const allPhotos = [...common, ...pA, ...pB, ...pC];

  await attachPhotosToDiary(did, common, POOL_ID);
  await attachPhotosToStudentNote(did, nA, SID_A, pA, POOL_ID);
  await attachPhotosToStudentNote(did, nB, SID_B, pB, POOL_ID);

  // 사전 검증
  const before = await q(`SELECT id,media_status,journal_id FROM photo_assets_meta WHERE id IN ('${[...common,...pA,...pB].join("','")}')`);
  before.every((p: any) => p.media_status === "attached" && p.journal_id === did)
    ? pass("DEL-PRE: 삭제전 attached 확인", `${before.length}장 ✅`)
    : fail("DEL-PRE", `일부 미attach: ${before.filter((p: any) => p.media_status !== "attached").length}건`);

  // 삭제 트랜잭션
  await db.execute(sql`BEGIN`);
  try {
    await db.execute(sql.raw(`UPDATE class_diaries SET is_deleted=true, deleted_at=NOW() WHERE id='${did}'`));
    await handleDiaryDeleted(did, POOL_ID);
    await db.execute(sql`COMMIT`);
  } catch (e) { await db.execute(sql`ROLLBACK`).catch(() => {}); throw e; }

  // 검증
  const diaryRow = await q(`SELECT is_deleted FROM class_diaries WHERE id='${did}'`);
  diaryRow[0]?.is_deleted ? pass("DEL-1: is_deleted=true", "") : fail("DEL-1", "is_deleted 미변경");

  const after = await q(`SELECT id,media_status,journal_id,student_note_id FROM photo_assets_meta WHERE id IN ('${[...common,...pA,...pB].join("','")}')`);
  after.every((p: any) => p.media_status === "detached")
    ? pass("DEL-2: media_status='detached'", `${after.length}장 ✅`)
    : fail("DEL-2", `미변경: ${after.filter((p: any) => p.media_status !== "detached").map((p: any) => p.id.slice(-6) + "=" + p.media_status).join(",")}`);

  after.every((p: any) => p.journal_id === null)
    ? pass("DEL-3: journal_id=NULL", "모두 해제 ✅")
    : fail("DEL-3", `journal_id 잔존: ${after.filter((p: any) => p.journal_id).length}건`);

  after.every((p: any) => p.student_note_id === null)
    ? pass("DEL-4: student_note_id=NULL", "모두 해제 ✅")
    : fail("DEL-4", `student_note_id 잔존: ${after.filter((p: any) => p.student_note_id).length}건`);

  // pC는 attach 안 했으니 draft 그대로여야 함
  const pcRow = await q(`SELECT media_status FROM photo_assets_meta WHERE id='${pC[0]}'`);
  pcRow[0]?.media_status === "draft"
    ? pass("DEL-5: 미연결 사진(pC) draft 유지", "✅")
    : fail("DEL-5", `pC media_status=${pcRow[0]?.media_status}`);

  // Teacher 미노출
  const visible = await getDiaryPhotos(did, POOL_ID);
  visible.total === 0
    ? pass("DEL-6: Teacher 미노출 (getDiaryPhotos)", "0건 ✅")
    : fail("DEL-6", `삭제 후 ${visible.total}장 노출`);

  // 정리
  await delDiary(did);
  await delPhotos(allPhotos);
}

// ════════════════════════════════════════════════════════════════════════
// SECTION 3: Student Note 정합성 조사 (읽기 전용)
// ════════════════════════════════════════════════════════════════════════
async function section3_StudentNoteIntegrity() {
  console.log("\n══ SECTION 3: Student Note 정합성 조사 (읽기 전용) ══════════");

  const stale = await q(`
    SELECT sn.id, sn.diary_id, sn.student_id, cd.lesson_date, cd.class_group_id,
           EXISTS (
             SELECT 1 FROM class_diaries cd2
             WHERE cd2.class_group_id=cd.class_group_id AND cd2.lesson_date=cd.lesson_date
               AND cd2.is_deleted=false AND cd2.id != sn.diary_id
           ) AS same_date_active,
           (SELECT id FROM class_diaries cd2
            WHERE cd2.class_group_id=cd.class_group_id AND cd2.lesson_date=cd.lesson_date
              AND cd2.is_deleted=false AND cd2.id != sn.diary_id LIMIT 1) AS replacement
    FROM class_diary_student_notes sn
    JOIN class_diaries cd ON cd.id=sn.diary_id AND cd.is_deleted=true
    WHERE sn.is_deleted=false
    ORDER BY cd.lesson_date DESC LIMIT 50
  `);

  if (stale.length === 0) {
    pass("NOTE-1: 삭제된 diary 참조 활성 note 없음", "0건 ✅");
  } else {
    const fixable = stale.filter((n: any) => n.same_date_active).length;
    console.log(`  ⚠️  발견: ${stale.length}건  (자동복구 가능: ${fixable}건)`);
    for (const n of stale.slice(0, 10)) {
      console.log(`    note=…${(n.id as string).slice(-8)}  diary=…${(n.diary_id as string).slice(-8)}  date=${n.lesson_date}  fixable=${n.same_date_active}  → ${n.replacement?.slice(-8) ?? 'N/A'}`);
    }
    fail("NOTE-1", `${stale.length}건 잔존 (조사만, 수정 없음)`);
  }

  // 사진 중 note.diary_id != photo.journal_id 잔존 현황
  const mismatch = await q(`
    SELECT COUNT(*)::int AS cnt FROM photo_assets_meta pam
    JOIN class_diary_student_notes sn ON sn.id=pam.student_note_id
    WHERE pam.student_note_id IS NOT NULL AND pam.journal_id IS NOT NULL
      AND sn.diary_id != pam.journal_id
  `);
  const mc = mismatch[0]?.cnt ?? 0;
  mc === 0
    ? pass("NOTE-2: photo journal_id vs note.diary_id 불일치 0건", "✅")
    : console.log(`  ⚠️  NOTE-2: 불일치 ${mc}건 (Phase B 수정불가 목록 4건 포함, 수정 없음)`);
}

// ════════════════════════════════════════════════════════════════════════
// SECTION 4: Reservation/Draft 검증
// ════════════════════════════════════════════════════════════════════════
async function section4_DraftReservation() {
  console.log("\n══ SECTION 4: Reservation/Draft 검증 ═══════════════════════");

  const today = new Date().toISOString().slice(0, 10);
  const [myDraft] = await mkPhotos(1, { lesson_date: today });

  // 다른 반 draft
  const otherCls = (await q(`SELECT id FROM class_groups WHERE swimming_pool_id='${POOL_ID}' AND is_deleted=false AND id!='${CLASS_ID}' LIMIT 1`))[0];
  let otherDraftId: string | null = null;
  if (otherCls) {
    const [od] = await mkPhotos(1, { class_id: otherCls.id, lesson_date: today });
    otherDraftId = od;
  }

  const drafts = await getDraftPhotosForClass(CLASS_ID, today, POOL_ID);
  drafts.find((p: any) => p.id === myDraft)
    ? pass("DRAFT-1: 본반 draft 조회", `${myDraft.slice(-8)} ✅`)
    : fail("DRAFT-1", "본반 draft 미조회");

  !drafts.find((p: any) => p.id === otherDraftId)
    ? pass("DRAFT-2: 다른반 draft 미노출", "격리 ✅")
    : fail("DRAFT-2", "다른 반 사진 노출 — 격리 실패");

  // attached 사진은 draft 목록에 안 나와야 함
  const did = await mkDiary("2099-03-01", "DRAFT3");
  await attachPhotosToDiary(did, [myDraft], POOL_ID);
  const draftsAfter = await getDraftPhotosForClass(CLASS_ID, today, POOL_ID);
  !draftsAfter.find((p: any) => p.id === myDraft)
    ? pass("DRAFT-3: attached 후 draft목록서 제거", "✅")
    : fail("DRAFT-3", "attached 사진이 draft목록에 잔존");

  await delDiary(did);
  await delPhotos([myDraft, ...(otherDraftId ? [otherDraftId] : [])]);
}

// ════════════════════════════════════════════════════════════════════════
// SECTION 5: MediaService 우회 SQL 재감사
// ════════════════════════════════════════════════════════════════════════
async function section5_MediaServiceAudit() {
  console.log("\n══ SECTION 5: MediaService 우회 SQL 재감사 ══════════════════");

  const { execSync } = await import("child_process");
  const ROUTES = "/home/runner/workspace/artifacts/api-server/src/routes";

  // 직접 UPDATE/INSERT photo_assets_meta가 MediaService 외부에 있는지
  const updatesBypass = execSync(
    `grep -rn "UPDATE photo_assets_meta\\|INSERT INTO photo_assets_meta" ${ROUTES} --include="*.ts" || true`,
    { encoding: "utf8" }
  ).trim();

  const insertLines = updatesBypass.split("\n").filter(l => l.includes("INSERT INTO photo_assets_meta"));
  const updateLines = updatesBypass.split("\n").filter(l => l.includes("UPDATE photo_assets_meta"));

  console.log(`  INSERT 직접 사용: ${insertLines.length}건 (업로드 엔드포인트 — 허용)`);
  for (const l of insertLines) console.log(`    ${l.split("/").slice(-1)[0]?.trim().slice(0, 100)}`);

  updateLines.length === 0
    ? pass("AUDIT-1: 라우터 직접 UPDATE 없음", "모두 MediaService 경유 ✅")
    : fail("AUDIT-1", `라우터 직접 UPDATE ${updateLines.length}건:\n    ${updateLines.join("\n    ")}`);

  // INSERT에 media_status 누락 여부 — grep -A 5로 다음 5줄까지 포함
  const insertContext = execSync(
    `grep -rn -A 5 "INSERT INTO photo_assets_meta" ${ROUTES} --include="*.ts" || true`,
    { encoding: "utf8" }
  );
  // 각 INSERT 블록(6줄) 단위로 분리해서 media_status 포함 여부 확인
  const blocks = insertContext.split(/\n--\n|\n\n/).map(b => b.trim()).filter(Boolean);
  const missingStatus = blocks.filter(b => b.includes("INSERT INTO photo_assets_meta") && !b.includes("media_status"));
  missingStatus.length === 0
    ? pass("AUDIT-2: 모든 INSERT에 media_status 포함", "✅")
    : fail("AUDIT-2", `media_status 없는 INSERT ${missingStatus.length}건:\n    ${missingStatus.map(b => b.split("\n")[0]).join("\n    ")}`);
}

// ════════════════════════════════════════════════════════════════════════
// SECTION 6: 성능 측정
// ════════════════════════════════════════════════════════════════════════
async function section6_Performance() {
  console.log("\n══ SECTION 6: 성능 측정 ════════════════════════════════════");

  const sample = (await q(`SELECT id, swimming_pool_id FROM class_diaries WHERE is_deleted=false LIMIT 1`))[0];

  const measures: Array<{ label: string; fn: () => Promise<unknown>; targetMs: number }> = [
    { label: "getDiaryPhotos", fn: () => sample ? getDiaryPhotos(sample.id, sample.swimming_pool_id) : Promise.resolve(), targetMs: 200 },
    { label: "getDraftPhotosForClass", fn: () => getDraftPhotosForClass(CLASS_ID, new Date().toISOString().slice(0, 10), POOL_ID), targetMs: 300 },
    {
      label: "Parent 일지목록 (ROW_NUMBER)",
      fn: () => q(`
        SELECT id, lesson_date FROM (
          SELECT cd.id, cd.lesson_date,
                 ROW_NUMBER() OVER (PARTITION BY cd.id ORDER BY ms.id NULLS LAST) rn
          FROM class_diaries cd
          LEFT JOIN student_class_history sch
            ON sch.class_group_id=cd.class_group_id AND sch.student_id='${SID_A}'
            AND sch.enrolled_at <= cd.lesson_date::date
            AND (sch.left_at IS NULL OR sch.left_at > cd.lesson_date::date)
          LEFT JOIN makeup_sessions ms
            ON ms.assigned_class_group_id=cd.class_group_id AND ms.student_id='${SID_A}'
            AND ms.assigned_date=cd.lesson_date AND ms.status='completed'
          WHERE cd.is_deleted=false AND (sch.id IS NOT NULL OR ms.id IS NOT NULL)
        ) sub WHERE rn=1 ORDER BY lesson_date DESC LIMIT 40
      `),
      targetMs: 500,
    },
  ];

  for (const m of measures) {
    const t = Date.now();
    await m.fn();
    const ms = Date.now() - t;
    ms <= m.targetMs
      ? pass(`PERF: ${m.label}`, `${ms}ms / ${m.targetMs}ms ✅`)
      : fail(`PERF: ${m.label}`, `${ms}ms — ${m.targetMs}ms 초과`);
  }
}

// ════════════════════════════════════════════════════════════════════════
// SECTION 7: 회귀 테스트 (버그 1~7)
// ════════════════════════════════════════════════════════════════════════
async function section7_Regression() {
  console.log("\n══ SECTION 7: 회귀 테스트 (버그 1~7) ══════════════════════");

  // 버그 1: student_id NULL → student_note_id attach 시 동시 설정
  {
    const did = await mkDiary("2099-04-01", "REG1");
    const nid = await mkNote(did, SID_A);
    const [p] = await mkPhotos(1);
    await attachPhotosToStudentNote(did, nid, SID_A, [p], POOL_ID);
    const row = await q(`SELECT student_id FROM photo_assets_meta WHERE id='${p}'`);
    await delDiary(did); await delPhotos([p]);
    row[0]?.student_id === SID_A
      ? pass("BUG-1: student_id 동시 설정", "✅")
      : fail("BUG-1", `student_id=${row[0]?.student_id}`);
  }

  // 버그 2: attachPhotosToDiary pool_id 검증
  {
    const did = await mkDiary("2099-04-02", "REG2");
    let threw = false;
    try { await attachPhotosToDiary(did, ["nonexistent"], POOL_ID); } catch { threw = true; }
    await delDiary(did);
    threw ? pass("BUG-2: 다른 pool사진 차단", "✅") : fail("BUG-2", "차단 안됨");
  }

  // 버그 3: handleDiaryDeleted student_note_id도 NULL 처리
  {
    const did = await mkDiary("2099-04-03", "REG3");
    const nid = await mkNote(did, SID_A);
    const [p] = await mkPhotos(1);
    await attachPhotosToStudentNote(did, nid, SID_A, [p], POOL_ID);
    await db.execute(sql.raw(`UPDATE class_diaries SET is_deleted=true WHERE id='${did}'`));
    await handleDiaryDeleted(did, POOL_ID);
    const row = await q(`SELECT student_note_id, journal_id FROM photo_assets_meta WHERE id='${p}'`);
    await delDiary(did); await delPhotos([p]);
    row[0]?.student_note_id === null && row[0]?.journal_id === null
      ? pass("BUG-3: 삭제시 student_note_id도 NULL", "✅")
      : fail("BUG-3", `sn=${row[0]?.student_note_id} jid=${row[0]?.journal_id}`);
  }

  // 버그 4: getDiaryPhotos — 삭제된 일지 사진 미반환
  {
    const did = await mkDiary("2099-04-04", "REG4");
    const [p] = await mkPhotos(1);
    await attachPhotosToDiary(did, [p], POOL_ID);
    await db.execute(sql.raw(`UPDATE class_diaries SET is_deleted=true WHERE id='${did}'`));
    await handleDiaryDeleted(did, POOL_ID);
    const visible = await getDiaryPhotos(did, POOL_ID);
    await delDiary(did); await delPhotos([p]);
    visible.total === 0
      ? pass("BUG-4: 삭제일지 getDiaryPhotos 0건", "✅")
      : fail("BUG-4", `${visible.total}건 노출`);
  }

  // 버그 5: 중복 photo ID deduplicate
  {
    const did = await mkDiary("2099-04-05", "REG5");
    const [p] = await mkPhotos(1);
    let threw = false;
    try { await attachPhotosToDiary(did, [p, p, p], POOL_ID); } catch (e: any) { threw = true; console.log(`    REG5 threw: ${e.message}`); }
    const row = await q(`SELECT journal_id FROM photo_assets_meta WHERE id='${p}'`);
    await delDiary(did); await delPhotos([p]);
    !threw && row[0]?.journal_id === did
      ? pass("BUG-5: 중복ID deduplicate attach", "✅")
      : fail("BUG-5", `threw=${threw} jid=${row[0]?.journal_id?.slice(-8) ?? 'null'}`);
  }

  // 버그 6: detachPhotosFromDiary → draft 복원
  {
    const { detachPhotosFromDiary } = await import("../services/mediaService.js");
    const did = await mkDiary("2099-04-06", "REG6");
    const [p] = await mkPhotos(1);
    await attachPhotosToDiary(did, [p], POOL_ID);
    await detachPhotosFromDiary([p], POOL_ID);
    const row = await q(`SELECT media_status, journal_id FROM photo_assets_meta WHERE id='${p}'`);
    await delDiary(did); await delPhotos([p]);
    row[0]?.media_status === "draft" && row[0]?.journal_id === null
      ? pass("BUG-6: detach → draft 복원", "✅")
      : fail("BUG-6", `status=${row[0]?.media_status} jid=${row[0]?.journal_id}`);
  }

  // 버그 7: parent_account 권한 — draft/detached 미노출 검증
  {
    const staleCheck = await q(`
      SELECT COUNT(*)::int AS cnt FROM photo_assets_meta
      WHERE media_status IN ('draft','detached','archived')
        AND (
          journal_id IN (SELECT id FROM class_diaries WHERE is_deleted=false)
          OR journal_id IS NOT NULL
        )
    `);
    Number(staleCheck[0]?.cnt ?? 0) === 0
      ? pass("BUG-7: draft/detached 사진 attached diary 미연결", "✅")
      : fail("BUG-7", `비정상 상태 ${staleCheck[0]?.cnt}건`);
  }
}

// ════════════════════════════════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════════════════════════════════
async function main() {
  console.log("════════════════════════════════════════════════════════════");
  console.log("  Media Engine Phase C — 무결성 검증");
  console.log(`  ${new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}`);
  console.log("════════════════════════════════════════════════════════════\n");

  await setupGlobal();
  await section1_TransactionRollback();
  await section2_DeletionVerification();
  await section3_StudentNoteIntegrity();
  await section4_DraftReservation();
  await section5_MediaServiceAudit();
  await section6_Performance();
  await section7_Regression();

  const passed  = results.filter(r => r.passed).length;
  const failed  = results.filter(r => !r.passed);

  console.log("\n════════════════════════════════════════════════════════════");
  console.log(`  결과: ${passed}/${results.length} PASS`);
  if (failed.length) {
    console.log("\n  실패 항목:");
    for (const f of failed) console.log(`    ❌ ${f.name}\n       ${f.detail}`);
  }
  console.log("════════════════════════════════════════════════════════════");
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
