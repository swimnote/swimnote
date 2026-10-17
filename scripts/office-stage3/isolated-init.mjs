import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
if (!process.argv.includes("--isolated-only")) throw new Error("Isolated-only flag required");
const { Client } = createRequire(new URL("../package.json", import.meta.url))("pg");
const client = new Client({ host: "127.0.0.1", port: 55440, database: "office_stage3_acceptance", user: "office_fixture" });
try {
  await client.connect();
  const row = (await client.query("SELECT current_database() AS db,inet_server_addr()::text AS host")).rows[0];
  if (row.db !== "office_stage3_acceptance" || row.host !== "127.0.0.1/32") throw new Error("Not isolated");
  // Existing schema is an error, not an automatic reset or deletion.
  await client.query("BEGIN");
  await client.query(await readFile(new URL("./seed-isolated.sql", import.meta.url), "utf8"));
  await client.query(await readFile(new URL("./receipts.draft.sql", import.meta.url), "utf8"));
  await client.query("COMMIT");
} finally { await client.end(); }
