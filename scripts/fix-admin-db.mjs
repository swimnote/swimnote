import { readFileSync, writeFileSync } from 'fs';

let src = readFileSync('artifacts/api-server/src/routes/admin.ts', 'utf8');

// 1. import 교체
src = src.replace(
  'import { db } from "@workspace/db";',
  'import { db, superAdminDb } from "@workspace/db";'
);

const superTables = [
  'swimmingPoolsTable',
  'usersTable',
  'subscriptionsTable',
  'studentRegistrationRequestsTable',
  'parentPoolRequestsTable',
];

for (const tbl of superTables) {
  // await db.select/insert/update/delete(...).from(table  — single line
  src = src.replace(
    new RegExp(`await db\\.(select|insert|update|delete)(\\([^)]*\\))\\.from\\(${tbl}`, 'g'),
    `await superAdminDb.$1$2.from(${tbl}`
  );
  // db.insert(tbl) / db.update(tbl)
  src = src.replace(
    new RegExp(`\\bdb\\.(insert|update)\\(${tbl}\\)`, 'g'),
    `superAdminDb.$1(${tbl})`
  );
  // multiline: db.select({...})\n  .from(superTable
  src = src.replace(
    new RegExp(`await db\\.select\\(\\{([^}]*)\\}\\)\\s*\\n(\\s*)\\.from\\(${tbl}`, 'g'),
    `await superAdminDb.select({$1})\n$2.from(${tbl}`
  );
}

// raw SQL super DB tables
const rawSuperTables = ['swimming_pools', 'users', 'subscriptions', 'student_registration_requests', 'parent_pool_requests', 'teacher_invites', 'push_logs'];
for (const t of rawSuperTables) {
  src = src.replace(
    new RegExp(`(await )db\\.execute\\(sql\`([^\`]*(?:FROM|UPDATE|INTO|DELETE FROM)\\s+${t}[^\`]*)\`\\)`, 'g'),
    `$1superAdminDb.execute(sql\`$2\`)`
  );
}

writeFileSync('artifacts/api-server/src/routes/admin.ts', src);
console.log('admin.ts 변환 완료');

const after = readFileSync('artifacts/api-server/src/routes/admin.ts', 'utf8');
const superCount = (after.match(/superAdminDb\./g) || []).length;
const dbCount = (after.match(/\bdb\./g) || []).length;
console.log(`superAdminDb. 사용: ${superCount} / db. (poolDb) 사용: ${dbCount}`);

const lines = after.split('\n');
const missed = lines.filter(l => /\bdb\./.test(l) && superTables.some(t => l.includes(t)));
if (missed.length > 0) {
  console.log('여전히 수정 필요:');
  missed.slice(0, 10).forEach(l => console.log(' ', l.trim()));
} else {
  console.log('모든 super DB 테이블 참조 정상!');
}
