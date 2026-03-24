import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

const SUPER_TABLES = [
  'swimming_pools', 'users', 'subscriptions', 'payment_logs', 'revenue_logs',
  'policy_consents', 'backup_snapshots', 'data_change_logs', 'feature_flags',
  'readonly_control_logs', 'push_logs', 'push_scheduled_sent', 'pool_event_logs',
  'event_retry_queue', 'dead_letter_queue', 'db_server_snapshots',
  'student_registration_requests', 'parent_pool_requests', 'teacher_invites',
];

function fixFile(filePath) {
  if (!existsSync(filePath)) return;
  let content = readFileSync(filePath, 'utf8');
  const orig = content;

  // Fix all db.execute(sql`...`) with multiline backtick strings
  content = content.replace(/\bdb\.execute\(sql`([\s\S]*?)`\)/g, (match, sqlBody) => {
    const isSuper = SUPER_TABLES.some(t => new RegExp('\\b' + t + '\\b').test(sqlBody));
    return isSuper ? match.replace(/^db\./, 'superAdminDb.') : match;
  });

  if (content !== orig) {
    writeFileSync(filePath, content);
    const sc = (content.match(/superAdminDb\./g) || []).length;
    const dc = (content.match(/\bdb\./g) || []).length;
    console.log(`FIXED: ${filePath} (superAdminDb:${sc}, db:${dc})`);
    return true;
  }
  return false;
}

// Scan all route files
const routeDir = 'artifacts/api-server/src/routes';
const routeFiles = readdirSync(routeDir).filter(f => f.endsWith('.ts'));
for (const f of routeFiles) {
  fixFile(join(routeDir, f));
}

// Scan jobs and lib
const extraFiles = [
  'artifacts/api-server/src/jobs/push-scheduler.ts',
  'artifacts/api-server/src/jobs/backup-batch.ts',
  'artifacts/api-server/src/lib/push-service.ts',
  'artifacts/api-server/src/lib/readonlyGuard.ts',
  'artifacts/api-server/src/lib/pool-event-logger.ts',
];
for (const f of extraFiles) {
  fixFile(f);
}

console.log('\n멀티라인 SQL 전체 스캔 완료!');
