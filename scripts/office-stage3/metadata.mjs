import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
if (!process.argv.includes("--approved-metadata-only")) throw new Error("Explicit metadata-only approval flag required");
if (!process.env.OFFICE_METADATA_DATABASE_URL) throw new Error("Dedicated approved read-only DSN required; no operating fallback");
const { Client } = createRequire(new URL("../package.json", import.meta.url))("pg");
const client = new Client({ connectionString: process.env.OFFICE_METADATA_DATABASE_URL,
  options: "-c default_transaction_read_only=on -c statement_timeout=10000", connectionTimeoutMillis: 5000 });
try {
  await client.connect();
  const sql = await readFile(new URL("./metadata.sql", import.meta.url), "utf8");
  const results = await client.query(sql);
  for (const result of Array.isArray(results) ? results : [results]) {
    if (result.rows?.length) process.stdout.write(JSON.stringify(result.rows) + "\n");
  }
} catch {
  process.stderr.write("Metadata check failed; connection details and secret values suppressed.\n");
  process.exitCode = 1;
} finally { await client.end().catch(() => {}); }
