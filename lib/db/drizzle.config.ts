import { defineConfig } from "drizzle-kit";
import path from "path";

const rawUrl =
  process.env.SUPABASE_DATABASE_URL ??
  process.env.DATABASE_URL;

if (!rawUrl) {
  throw new Error(
    "SUPABASE_DATABASE_URL (또는 DATABASE_URL) 환경변수가 설정되지 않았습니다.",
  );
}

const u = new URL(rawUrl);
if (process.env.SUPABASE_DB_PASSWORD) {
  u.password = encodeURIComponent(process.env.SUPABASE_DB_PASSWORD);
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: {
    url: u.toString(),
    ssl: true,
  },
});
