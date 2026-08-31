import { sql } from 'drizzle-orm';

export async function runMigration(db: any) {
  await db.execute(sql`ALTER TABLE students ADD COLUMN IF NOT EXISTS membership_end_at DATE`);
  await db.execute(sql`ALTER TABLE students ADD COLUMN IF NOT EXISTS payment_status TEXT`);
}