import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export async function stripOneulun() {
  try {
    const result = await db.execute(sql`
      UPDATE diary_templates
      SET template_text = REGEXP_REPLACE(template_text, '^오늘은 ', '')
      WHERE template_text LIKE '오늘은 %'
    `);
    const count = (result as any).rowCount ?? 0;
    if (count > 0) {
      console.log(`[strip-oneulun] ${count}개 템플릿에서 "오늘은 " 접두사 제거 완료`);
    }
  } catch (e: any) {
    console.error("[strip-oneulun] DB 오류:", e?.message);
  }
}
