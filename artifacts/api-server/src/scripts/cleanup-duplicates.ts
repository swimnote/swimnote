import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

const targets = [
  { id: "dtl_1781806361905_iuims46j", name: "평영킥·파란레벨테스트", keep: 30 },
  { id: "dtl_1781832810244_nc2nys6j", name: "수영질서·빨간레벨테스트", keep: 30 },
  { id: "dtl_1781833752393_qjzgbr65", name: "스프린트·레벨테스트",    keep: 35 },
];

async function main() {
  for (const lv of targets) {
    const rows = await superAdminDb.execute(sql`
      SELECT id FROM diary_templates
      WHERE level_id = ${lv.id}
      ORDER BY id ASC
    `);

    const all = rows.rows as { id: string }[];
    const excess = all.length - lv.keep;

    if (excess <= 0) {
      console.log(`${lv.name}: 초과 없음, 스킵`);
      continue;
    }

    const toDelete = all.slice(0, excess).map(r => r.id);
    for (const delId of toDelete) {
      await superAdminDb.execute(sql`DELETE FROM diary_templates WHERE id = ${delId}`);
    }
    console.log(`${lv.name}: ${excess}개 삭제 완료 → 잔여 ${lv.keep}개`);
  }

  console.log("---");
  console.log("중복 정리 완료");
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
