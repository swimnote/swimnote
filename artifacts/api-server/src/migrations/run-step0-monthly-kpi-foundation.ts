/**
 * Runner: STEP 0 Monthly KPI Foundation
 * Run: node_modules/.bin/tsx src/migrations/run-step0-monthly-kpi-foundation.ts
 */
import { up } from "./step0-monthly-kpi-foundation.js";

up()
  .then(() => { console.log("[STEP0] Migration COMPLETE"); process.exit(0); })
  .catch((e) => {
    console.error("[STEP0] Migration FAILED");
    console.error("message:", e.message);
    console.error("cause:", e.cause);
    console.error("detail:", e.detail);
    console.error("stack:", e.stack);
    process.exit(1);
  });
