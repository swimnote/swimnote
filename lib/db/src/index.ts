import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

const supabaseUrl = process.env.SUPABASE_DATABASE_URL;
const supabasePassword = process.env.SUPABASE_DB_PASSWORD;
const fallbackUrl = process.env.DATABASE_URL;

if (!supabaseUrl && !fallbackUrl) {
  throw new Error(
    "SUPABASE_DATABASE_URL (또는 DATABASE_URL) 환경변수가 설정되지 않았습니다.",
  );
}

function buildPoolConfig() {
  if (supabaseUrl) {
    const u = new URL(supabaseUrl);
    return {
      host: u.hostname,
      port: parseInt(u.port || "5432", 10),
      user: decodeURIComponent(u.username),
      password: supabasePassword || decodeURIComponent(u.password),
      database: u.pathname.replace(/^\//, ""),
      ssl: { rejectUnauthorized: false },
    };
  }
  return { connectionString: fallbackUrl! };
}

export const pool = new Pool(buildPoolConfig());
export const db = drizzle(pool, { schema });

export * from "./schema";
