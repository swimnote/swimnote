import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

// Deliberately hardcoded isolated target; never fall back to an environment URL.
export const xGrantPool = new pg.Pool({
  host: "127.0.0.1", port: 55482, user: "runner", database: "swimnote_xgrant_fixture",
  // Queue fixture reads behind the handler's transaction commit. Its HTTP
  // response is written inside the transaction; response completion alone
  // is not a commit barrier for a second database connection.
  max: 1, connectionTimeoutMillis: 5000,
});
export const xGrantDb = drizzle(xGrantPool);
