// seed/backups.ts — 백업 스냅샷 시드
// 이름 규칙: [수영장이름]_스냅샷_[YYYY-MM-DD]_[HH-mm]

import type { BackupSnapshot, SnapshotType } from '../domain/types'

const daysAgo = (d: number, h = 0) =>
  new Date(Date.now() - d * 86400000 - h * 3600000).toISOString()

function makeSnapName(operatorName: string, iso: string): string {
  const dt = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${operatorName}_스냅샷_${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}_${pad(dt.getHours())}-${pad(dt.getMinutes())}`
}

const DEFAULT_INCLUDES = [
  'operator_info', 'member_core', 'subscription', 'credit',
  'policy_docs', 'attendance', 'journal_text', 'logs', 'permissions', 'feature_flags',
]

function snap(
  id: string,
  scope: 'platform' | 'operator',
  operatorId: string,
  operatorName: string,
  createdAt: string,
  note: string,
  sizeMb: number,
  snapshotType: SnapshotType = 'auto',
  includes = DEFAULT_INCLUDES,
): BackupSnapshot {
  return {
    id,
    bucket: scope === 'platform' ? 'platform_shadow_backup' : 'operator_snapshot',
    scope,
    operatorId,
    operatorName,
    snapshotName: makeSnapName(operatorName, createdAt),
    snapshotType,
    createdAt,
    createdBy: snapshotType === 'auto' ? '시스템' : '슈퍼관리자',
    includes,
    checksum: `sha256:mock-${id}`,
    note,
    sizeMb,
    status: 'done',
  }
}

export const SEED_BACKUPS: BackupSnapshot[] = [
  // 플랫폼 전체 스냅샷 (auto)
  snap('snap-001', 'platform', '', '전체플랫폼', daysAgo(7),  '주간 정기 전체 스냅샷. 운영자 14개.', 2048, 'auto'),
  snap('snap-002', 'platform', '', '전체플랫폼', daysAgo(14), '주간 정기 전체 스냅샷.',             1920, 'auto'),
  snap('snap-003', 'platform', '', '전체플랫폼', daysAgo(21), '주간 정기 전체 스냅샷.',             1790, 'auto'),

  // 운영자별 스냅샷
  snap('snap-004', 'operator', 'op-004', '분당스포츠센터', daysAgo(5), 'Grace 기간 전 안전 스냅샷.',    512, 'manual',
    ['operator_info', 'member_core', 'subscription', 'credit', 'attendance', 'journal_text']),

  snap('snap-005', 'operator', 'op-010', '울산마스터즈',  daysAgo(1),    '자동 스냅샷 (1시간 주기)', 394, 'auto'),

  snap('snap-006', 'operator', 'op-005', '인천수영학원',  daysAgo(3),    '해지 처리 전 스냅샷.',     218, 'before_delete',
    ['operator_info', 'member_core', 'subscription', 'credit', 'policy_docs']),

  snap('snap-007', 'operator', 'op-003', '강남아쿠아스쿨', daysAgo(2),  '결제 실패 처리 전 스냅샷.',  342, 'manual',
    ['operator_info', 'member_core', 'subscription', 'credit']),

  snap('snap-008', 'operator', 'op-010', '울산마스터즈',  daysAgo(0, 6), '킬스위치 실행 직전 강제 스냅샷. 복구 불가 경고 확인됨.', 396, 'before_delete'),

  // op-001 (송파수영장) 스냅샷 — 관리자 화면에서 볼 스냅샷
  snap('snap-009', 'operator', 'op-001', '송파수영장', daysAgo(0, 1), '자동 스냅샷 (1시간 주기)', 185, 'auto'),
  snap('snap-010', 'operator', 'op-001', '송파수영장', daysAgo(0, 2), '자동 스냅샷 (1시간 주기)', 184, 'auto'),
  snap('snap-011', 'operator', 'op-001', '송파수영장', daysAgo(1),   '수동 스냅샷',             190, 'manual'),
  snap('snap-012', 'operator', 'op-001', '송파수영장', daysAgo(2),   '자동 스냅샷 (1시간 주기)', 182, 'auto'),

  // op-002 (서울아쿠아클럽) 스냅샷
  snap('snap-013', 'operator', 'op-002', '서울아쿠아클럽', daysAgo(0, 0.5), '자동 스냅샷 (1시간 주기)', 210, 'auto'),
  snap('snap-014', 'operator', 'op-002', '서울아쿠아클럽', daysAgo(0, 1),    '자동 스냅샷 (1시간 주기)', 208, 'auto'),
]
