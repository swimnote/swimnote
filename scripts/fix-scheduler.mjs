import { readFileSync, writeFileSync } from 'fs';

let src = readFileSync('artifacts/api-server/src/jobs/push-scheduler.ts', 'utf8');

// Multiline SQL: db.execute(sql`...super_table...`) → superAdminDb.execute(sql`...`)
// We process the entire file content and replace multiline backtick template strings

const SUPER_TABLES = ['swimming_pools', 'push_scheduled_sent', 'push_logs', 'users', 'subscriptions'];

// Match all db.execute(sql`...`) blocks (multiline)
src = src.replace(/\bdb\.execute\(sql`([\s\S]*?)`\)/g, (match, sqlBody) => {
  const tableMatches = SUPER_TABLES.some(t => new RegExp('\\b' + t + '\\b').test(sqlBody));
  if (tableMatches) {
    return match.replace('db.execute', 'superAdminDb.execute');
  }
  return match;
});

writeFileSync('artifacts/api-server/src/jobs/push-scheduler.ts', src);
console.log('push-scheduler.ts 변환 완료');

const after = readFileSync('artifacts/api-server/src/jobs/push-scheduler.ts', 'utf8');
const sc = (after.match(/superAdminDb\./g) || []).length;
const dc = (after.match(/\bdb\./g) || []).length;
console.log(`superAdminDb: ${sc}, db: ${dc}`);

// Also fix push-service.ts and readonlyGuard.ts
const libs = [
  'artifacts/api-server/src/lib/push-service.ts',
  'artifacts/api-server/src/lib/readonlyGuard.ts',
];
for (const f of libs) {
  let content = readFileSync(f, 'utf8');
  const orig = content;
  content = content.replace(/\bdb\.execute\(sql`([\s\S]*?)`\)/g, (match, sqlBody) => {
    const tableMatches = SUPER_TABLES.some(t => new RegExp('\\b' + t + '\\b').test(sqlBody));
    if (tableMatches) {
      return match.replace('db.execute', 'superAdminDb.execute');
    }
    return match;
  });
  if (content !== orig) {
    writeFileSync(f, content);
    const sc2 = (content.match(/superAdminDb\./g) || []).length;
    const dc2 = (content.match(/\bdb\./g) || []).length;
    console.log(`FIXED: ${f} (superAdminDb:${sc2}, db:${dc2})`);
  } else {
    console.log(`SKIP: ${f}`);
  }
}
