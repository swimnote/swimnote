import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

// Never read DATABASE_URL or any production connection variable.
export const fixturePool = new pg.Pool({
  host: "127.0.0.1", port: 55441, user: "runner", database: "swimnote_push_fixture",
  max: 3, connectionTimeoutMillis: 5000,
});
export const db = drizzle(fixturePool);
