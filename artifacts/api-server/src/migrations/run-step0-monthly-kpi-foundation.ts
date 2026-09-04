/**
 * Runner: STEP 0 Monthly KPI Foundation
 * Run: ALLOW_TEST_DB_MUTATIONS=true npx tsx src/migrations/run-step0-monthly-kpi-foundation.ts
 */
import { up } from "./step0-monthly-kpi-foundation.js";
import { runWithMigrationDb } from "../lib/migration-db.js";

runWithMigrationDb("step0-monthly-kpi", up)
  .catch((e) => {
    console.error("[STEP0] Migration FAILED");
    console.error("message:", e.message);
    console.error("cause:", e.cause);
    console.error("stack:", e.stack);
    process.exit(1);
  });
