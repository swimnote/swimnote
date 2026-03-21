/**
 * adapters/dbAdapter.ts
 * DB 어댑터 인터페이스 — 현재는 mock 구현
 * 나중에 Supabase 연결 시 이 파일만 교체
 */

import type { Operator, AuditLog, SupportTicket, FeatureFlag, BackupSnapshot } from '../domain/types'
import { SEED_OPERATORS } from '../seed/operators'
import { SEED_AUDIT_LOGS } from '../seed/auditLogs'
import { SEED_SUPPORT_TICKETS } from '../seed/supportTickets'
import { SEED_FEATURE_FLAGS } from '../seed/featureFlags'
import { SEED_BACKUPS } from '../seed/backups'

// mock delay simulation
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export const dbAdapter = {
  async getOperators(): Promise<Operator[]> {
    await delay(200)
    return [...SEED_OPERATORS]
  },

  async saveOperator(op: Operator): Promise<Operator> {
    await delay(150)
    return op
  },

  async listAuditLogs(): Promise<AuditLog[]> {
    await delay(200)
    return [...SEED_AUDIT_LOGS]
  },

  async saveAuditLog(log: AuditLog): Promise<AuditLog> {
    await delay(100)
    return log
  },

  async listTickets(): Promise<SupportTicket[]> {
    await delay(200)
    return [...SEED_SUPPORT_TICKETS]
  },

  async saveTicket(ticket: SupportTicket): Promise<SupportTicket> {
    await delay(150)
    return ticket
  },

  async listFeatureFlags(): Promise<FeatureFlag[]> {
    await delay(150)
    return [...SEED_FEATURE_FLAGS]
  },

  async saveFeatureFlag(flag: FeatureFlag): Promise<FeatureFlag> {
    await delay(100)
    return flag
  },

  async listBackups(): Promise<BackupSnapshot[]> {
    await delay(200)
    return [...SEED_BACKUPS]
  },

  async saveBackup(snap: BackupSnapshot): Promise<BackupSnapshot> {
    await delay(150)
    return snap
  },
}
