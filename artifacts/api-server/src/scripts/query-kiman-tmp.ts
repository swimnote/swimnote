import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

const STUDENT_ID = "student_1782281587669_3ymitoo2x";

async function main() {
  const db = superAdminDb;

  // pool_event_logs 컬럼 확인
  const cols = await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'pool_event_logs' ORDER BY ordinal_position
  `);
  console.log("pool_event_logs 컬럼:", cols.rows.map((r: any) => r.column_name).join(", "));

  // pool_event_logs 조회
  const evtCols = cols.rows.map((r: any) => r.column_name as string);
  const hasEntity = evtCols.includes("entity_id");
  const hasPayload = evtCols.includes("payload");

  if (hasEntity) {
    const events = await db.execute(sql`
      SELECT event_type, created_at, ${hasPayload ? sql.raw("payload") : sql.raw("'{}'")}
      FROM pool_event_logs
      WHERE entity_id = ${STUDENT_ID}
      ORDER BY created_at DESC
      LIMIT 10
    `);
    console.log(`\npool_event_logs (${events.rows.length}건):`);
    for (const e of events.rows) {
      console.log(JSON.stringify({
        event_type: (e as any).event_type,
        created_at: (e as any).created_at,
      }));
    }
  }

  // data_change_logs 조회
  const dcCols = await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'data_change_logs' ORDER BY ordinal_position
  `);
  console.log("\ndata_change_logs 컬럼:", dcCols.rows.map((r: any) => r.column_name).join(", "));

  const dcRecs = await db.execute(sql`
    SELECT * FROM data_change_logs
    WHERE record_id = ${STUDENT_ID}
    ORDER BY created_at DESC
    LIMIT 5
  `);
  console.log(`\ndata_change_logs (${dcRecs.rows.length}건):`);
  for (const r of dcRecs.rows) {
    console.log(JSON.stringify({
      change_type: (r as any).change_type,
      created_at: (r as any).created_at,
    }));
  }
}

main().then(() => process.exit(0)).catch(e => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
