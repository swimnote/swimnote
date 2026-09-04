/**
 * PHASE 2 execution wrapper for group8-curriculum-multi-conversation migration.
 * Run: ALLOW_TEST_DB_MUTATIONS=true npx tsx src/migrations/run-group8.ts
 */
import { runGroup8CurriculumMultiConversationMigration } from "./group8-curriculum-multi-conversation.js";
import { runWithMigrationDb } from "../lib/migration-db.js";

runWithMigrationDb("run-group8", runGroup8CurriculumMultiConversationMigration)
  .catch(e => { console.error("Migration FAILED:", e.message); process.exit(1); });
