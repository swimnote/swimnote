import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

const levels = [
  { id: "dtl_1781806361547_vsash65p", name: "물적응·호흡" },
  { id: "dtl_1781806361689_552un8hx", name: "배영" },
  { id: "dtl_1781806361780_qwy1z2pm", name: "자유형" },
  { id: "dtl_1781806361905_iuims46j", name: "평영킥·파란레벨테스트" },
  { id: "dtl_1781832210456_a3ldrgsx", name: "평영스트로크" },
  { id: "dtl_1781832586915_wv7bmpw6", name: "접영스트로크" },
  { id: "dtl_1781832810244_nc2nys6j", name: "수영질서·빨간레벨테스트" },
  { id: "dtl_1781833239294_iuhs9vqy", name: "풀·글라이드" },
  { id: "dtl_1781833425841_f9ewksm7", name: "롤링·스트림라인" },
  { id: "dtl_1781833752393_qjzgbr65", name: "스프린트·레벨테스트" },
];

async function main() {
  let total = 0;
  for (const lv of levels) {
    const r = await superAdminDb.execute(sql`SELECT COUNT(*) as cnt FROM diary_templates WHERE level_id = ${lv.id}`);
    const cnt = Number((r.rows[0] as any).cnt);
    total += cnt;
    console.log(`${lv.name}: ${cnt}개`);
  }
  console.log("---");
  console.log(`전체 합계: ${total}개`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
