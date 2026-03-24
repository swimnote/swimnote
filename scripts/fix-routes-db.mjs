import { readFileSync, writeFileSync, existsSync } from 'fs';

const SUPER_TABLES = [
  'swimmingPoolsTable',
  'usersTable',
  'subscriptionsTable',
  'studentRegistrationRequestsTable',
  'parentPoolRequestsTable',
  'paymentLogsTable',
  'revenueLogsTable',
  'policyConsentsTable',
  'backupSnapshotsTable',
  'dataChangeLogsTable',
  'featureFlagsTable',
  'readonlyControlLogsTable',
  'pushLogsTable',
  'pushScheduledSentTable',
  'poolEventLogsTable',
  'eventRetryQueueTable',
  'deadLetterQueueTable',
  'dbServerSnapshotsTable',
];

const SUPER_RAW_TABLES = [
  'swimming_pools',
  'users',
  'subscriptions',
  'student_registration_requests',
  'parent_pool_requests',
  'payment_logs',
  'revenue_logs',
  'policy_consents',
  'backup_snapshots',
  'data_change_logs',
  'feature_flags',
  'readonly_control_logs',
  'push_logs',
  'push_scheduled_sent',
  'pool_event_logs',
  'event_retry_queue',
  'dead_letter_queue',
  'db_server_snapshots',
  'teacher_invites',
];

function transformFile(filePath) {
  if (!existsSync(filePath)) {
    console.log(`SKIP (not found): ${filePath}`);
    return;
  }
  let src = readFileSync(filePath, 'utf8');
  const originalSrc = src;

  // 1. import 교체 (이미 superAdminDb가 있으면 skip)
  if (!src.includes('superAdminDb')) {
    src = src.replace(
      /import \{ db \} from "@workspace\/db";/,
      'import { db, superAdminDb } from "@workspace/db";'
    );
    src = src.replace(
      /import \{ db, ([^}]+)\} from "@workspace\/db";/,
      'import { db, $1, superAdminDb } from "@workspace/db";'
    );
  }

  for (const tbl of SUPER_TABLES) {
    if (!src.includes(tbl)) continue;

    // Drizzle ORM: await db.(op)(...).from(tbl  — same line
    src = src.replace(
      new RegExp(`await db\\.(select|insert|update|delete)(\\([^)]*\\))\\.from\\(${tbl}`, 'g'),
      `await superAdminDb.$1$2.from(${tbl}`
    );
    // db.insert(tbl) / db.update(tbl) without await prefix
    src = src.replace(
      new RegExp(`(?<!superAdminDb)\\bdb\\.(insert|update)\\(${tbl}\\)`, 'g'),
      `superAdminDb.$1(${tbl})`
    );
    // Drizzle: await db.delete(tbl) — delete uses from differently
    src = src.replace(
      new RegExp(`await db\\.delete\\(${tbl}\\)`, 'g'),
      `await superAdminDb.delete(${tbl})`
    );
    // multiline: db.select({...}) \n  .from(tbl
    src = src.replace(
      new RegExp(`await db\\.select\\(\\{([^}]*)\\}\\)\\s*\\n([ \\t]*)\\.from\\(${tbl}`, 'g'),
      `await superAdminDb.select({$1})\n$2.from(${tbl}`
    );
  }

  // raw SQL super DB tables
  for (const t of SUPER_RAW_TABLES) {
    if (!src.includes(t)) continue;
    src = src.replace(
      new RegExp(`(await )db\\.execute\\(sql\`([^\`]*(?:FROM|UPDATE|INTO|DELETE FROM)\\s+${t}[^\`]*)\`\\)`, 'g'),
      `$1superAdminDb.execute(sql\`$2\`)`
    );
  }

  if (src !== originalSrc) {
    writeFileSync(filePath, src);
    const superCount = (src.match(/superAdminDb\./g) || []).length;
    const dbCount = (src.match(/\bdb\./g) || []).length;
    console.log(`FIXED: ${filePath} (superAdminDb:${superCount}, db:${dbCount})`);

    // 검증: super DB 테이블을 db.로 여전히 참조하는 라인
    const lines = src.split('\n');
    const missed = lines.filter(l => /\bdb\./.test(l) && SUPER_TABLES.some(t => l.includes(t)));
    if (missed.length > 0) {
      console.log('  ⚠️  여전히 수정 필요:');
      missed.slice(0, 5).forEach(l => console.log('    ', l.trim()));
    }
  } else {
    console.log(`SKIP (no changes): ${filePath}`);
  }
}

const routeDir = 'artifacts/api-server/src/routes';

const targets = [
  'auth.ts',         // 이미 처리됨 but re-run for safety
  'parent-requests.ts',
  'parent.ts',
  'teachers.ts',
  'attendance.ts',
  'class-groups.ts',
  'diary.ts',
  'members.ts',
  'students.ts',
  'messenger.ts',
  'notices.ts',
  'push-settings.ts',
  'storage.ts',
  'uploads.ts',
  'teacher-invites.ts',
  'branches.ts',
  'unregistered.ts',
  'pricing.ts',
  'kill-switch.ts',
  'settlement.ts',
  'classes.ts',
  'photos.ts',
  'videos.ts',
].map(f => `${routeDir}/${f}`);

for (const filePath of targets) {
  transformFile(filePath);
}

console.log('\n변환 완료!');
