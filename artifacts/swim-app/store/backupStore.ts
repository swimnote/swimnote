/**
 * store/backupStore.ts
 * 백업/스냅샷/복구 상태 관리
 */

import { create } from 'zustand'
import type { BackupSnapshot, RestoreJob, SnapshotType } from '../domain/types'
import { SEED_BACKUPS } from '../seed/backups'

function makeSnapshotName(operatorName: string, dt: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const name = (operatorName || '전체플랫폼').replace(/\s+/g, '')
  return `${name}_스냅샷_${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}_${pad(dt.getHours())}-${pad(dt.getMinutes())}`
}

const DEFAULT_INCLUDES = [
  'operator_info', 'member_core', 'subscription', 'credit',
  'policy_docs', 'attendance', 'journal_text', 'logs', 'permissions', 'feature_flags',
]

interface BackupState {
  snapshots: BackupSnapshot[]
  restoreJobs: RestoreJob[]
  loading: boolean

  // selectors
  getOperatorSnapshots: (operatorId?: string) => BackupSnapshot[]
  getPlatformSnapshots: () => BackupSnapshot[]
  getLatestPlatformSnapshot: () => BackupSnapshot | undefined

  // actions
  createSnapshot: (params: {
    scope: 'platform' | 'operator'
    operatorId?: string
    operatorName?: string
    note?: string
    actorName: string
    snapshotType?: SnapshotType
  }) => BackupSnapshot
  createForcedSnapshotBeforeKillSwitch: (operatorId: string, operatorName: string, actorName: string) => BackupSnapshot
  createForcedSnapshotBeforeRestore: (operatorId: string, operatorName: string, actorName: string) => BackupSnapshot
  deleteSnapshot: (id: string) => void
  updateSnapshot: (id: string, patch: Partial<BackupSnapshot>) => void
  createRestoreJob: (params: {
    snapshotId: string
    operatorId: string
    operatorName: string
    mode: 'single' | 'dual_compare'
    note: string
    actorName: string
  }) => RestoreJob
  updateRestoreJob: (id: string, patch: Partial<RestoreJob>) => void
  startRestoreSimulation: (jobId: string) => void
}

let idCounter = 100

export const useBackupStore = create<BackupState>((set, get) => ({
  snapshots: [...SEED_BACKUPS].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  ),
  restoreJobs: [],
  loading: false,

  getOperatorSnapshots: (operatorId) => {
    const snaps = get().snapshots
    if (operatorId) return snaps.filter(s => s.scope === 'operator' && s.operatorId === operatorId)
    return snaps.filter(s => s.scope === 'operator')
  },

  getPlatformSnapshots: () =>
    get().snapshots.filter(s => s.scope === 'platform'),

  getLatestPlatformSnapshot: () => {
    const snaps = get().getPlatformSnapshots()
    return snaps[0]
  },

  createSnapshot: (params) => {
    const now = new Date()
    const opName = params.operatorName ?? (params.scope === 'platform' ? '전체플랫폼' : '')
    const snap: BackupSnapshot = {
      id: `snap-${Date.now()}-${++idCounter}`,
      bucket: params.scope === 'platform' ? 'platform_shadow_backup' : 'operator_snapshot',
      scope: params.scope,
      operatorId: params.operatorId ?? '',
      operatorName: opName,
      snapshotName: makeSnapshotName(opName, now),
      snapshotType: params.snapshotType ?? 'manual',
      createdAt: now.toISOString(),
      createdBy: params.actorName,
      includes: DEFAULT_INCLUDES,
      checksum: `sha256:mock-${Date.now()}`,
      note: params.note ?? '수동 스냅샷',
      sizeMb: Math.floor(Math.random() * 500 + 100),
      status: 'done',
    }
    set(s => ({ snapshots: [snap, ...s.snapshots] }))
    return snap
  },

  createForcedSnapshotBeforeKillSwitch: (operatorId, operatorName, actorName) =>
    get().createSnapshot({
      scope: 'operator', operatorId, operatorName, actorName,
      note: '킬스위치 실행 직전 강제 스냅샷 — 복구 불가 경고 확인됨',
      snapshotType: 'before_delete',
    }),

  createForcedSnapshotBeforeRestore: (operatorId, operatorName, actorName) =>
    get().createSnapshot({
      scope: 'operator', operatorId, operatorName, actorName,
      note: '복구 실행 직전 현재 상태 보존 스냅샷',
      snapshotType: 'before_restore',
    }),

  deleteSnapshot: (id) => set(s => ({
    snapshots: s.snapshots.filter(snap => snap.id !== id),
  })),

  updateSnapshot: (id, patch) => set(s => ({
    snapshots: s.snapshots.map(snap => snap.id === id ? { ...snap, ...patch } : snap),
  })),

  createRestoreJob: (params) => {
    const job: RestoreJob = {
      id: `restore-${Date.now()}-${++idCounter}`,
      snapshotId: params.snapshotId,
      operatorId: params.operatorId,
      operatorName: params.operatorName,
      createdAt: new Date().toISOString(),
      createdBy: params.actorName,
      status: 'pending',
      mode: params.mode,
      note: params.note,
    }
    set(s => ({ restoreJobs: [job, ...s.restoreJobs] }))
    return job
  },

  updateRestoreJob: (id, patch) => set(s => ({
    restoreJobs: s.restoreJobs.map(j => j.id === id ? { ...j, ...patch } : j),
  })),

  startRestoreSimulation: (jobId) => {
    get().updateRestoreJob(jobId, { status: 'running' })
    setTimeout(() => {
      get().updateRestoreJob(jobId, { status: 'done' })
    }, 2000)
  },
}))
