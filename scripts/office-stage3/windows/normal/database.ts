import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema.js";
declare const __ISOLATED_ROOT__: string;
const index = process.argv.indexOf("--run");
if (index < 0 || !process.argv.includes("--isolated-only")) throw new Error("Isolated run required");
export const runDirectory = fs.realpathSync(process.argv[index + 1]);
const marker = JSON.parse(fs.readFileSync(path.join(runDirectory, "prepared.json"), "utf8"));
export const privateState = JSON.parse(fs.readFileSync(path.join(runDirectory, "private.json"), "utf8"));
if (marker.candidateId !== privateState.candidateId || !marker.candidateId.startsWith("OFFICE-WIN-AUTH-"))
  throw new Error("Prepared run identity mismatch");
export const candidateRoot = __ISOLATED_ROOT__;
// Never inspect an inherited DB URL, JWT key or provider credential.
process.env.JWT_SECRET = privateState.jwtKey;
process.env.NODE_ENV = "production";
if (typeof privateState.jwtKey !== "string" || privateState.jwtKey.length < 64) throw new Error("Local JWT key missing");
export const pool = new pg.Pool({
  host: "127.0.0.1", port: 55440, database: "office_stage3_acceptance", user: "office_fixture",
  password: privateState.dbPassword, max: 4, connectionTimeoutMillis: 2000,
  options: "-c search_path=office_acceptance -c client_encoding=UTF8",
});
const identity = (await pool.query("SELECT current_database() AS db,inet_server_addr()::text AS host")).rows[0];
if (identity.db !== "office_stage3_acceptance" || identity.host !== "127.0.0.1/32") throw new Error("Not isolated DB");
const isolation = await pool.query("SELECT value FROM office_acceptance.isolation_marker WHERE key='synthetic_only'");
if (isolation.rows[0]?.value !== "office-stage3-acceptance") throw new Error("Missing synthetic marker");
export const superAdminDb = drizzle(pool, { schema });
export const db = superAdminDb;
