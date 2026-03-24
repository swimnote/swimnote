import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

const connectionString = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "SUPABASE_DATABASE_URL (또는 DATABASE_URL) 환경변수가 설정되지 않았습니다.",
  );
}

function parsePoolConfig(connStr: string) {
  try {
    const u = new URL(connStr);
    return {
      host: u.hostname,
      port: parseInt(u.port || "5432", 10),
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: u.pathname.replace(/^\//, ""),
      ssl: { rejectUnauthorized: false },
    };
  } catch {
    return { connectionString: connStr, ssl: { rejectUnauthorized: false } };
  }
}

const poolConfig = process.env.SUPABASE_DATABASE_URL
  ? parsePoolConfig(process.env.SUPABASE_DATABASE_URL)
  : { connectionString: process.env.DATABASE_URL! };

export const pool = new Pool(poolConfig);
export const db = drizzle(pool, { schema });

export * from "./schema";
