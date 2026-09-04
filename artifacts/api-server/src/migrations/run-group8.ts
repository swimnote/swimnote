/**
 * PHASE 2 execution wrapper for group8-curriculum-multi-conversation migration.
 * Run: node_modules/.bin/tsx src/migrations/run-group8.ts
 */
import { runGroup8CurriculumMultiConversationMigration } from "./group8-curriculum-multi-conversation.js";

runGroup8CurriculumMultiConversationMigration()
  .then(() => { console.log("Migration COMPLETE"); process.exit(0); })
  .catch(e => { console.error("Migration FAILED:", e.message); process.exit(1); });
