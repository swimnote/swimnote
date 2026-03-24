/**
 * drizzle.pool.config.ts — 수영장 운영 DB (pool ops, ap-northeast-2)
 *
 * 사용: pnpm --filter @workspace/db exec drizzle-kit push --config ./drizzle.pool.config.ts
 */
import { defineConfig } from "drizzle-kit";
import path from "path";

const rawUrl = process.env.POOL_DATABASE_URL;

if (!rawUrl) {
  throw new Error("POOL_DATABASE_URL 환경변수가 설정되지 않았습니다.");
}

const u = new URL(rawUrl);
if (process.env.POOL_DB_PASSWORD) {
  u.password = encodeURIComponent(process.env.POOL_DB_PASSWORD);
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: {
    url: u.toString(),
    ssl: true,
  },
});
