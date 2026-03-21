/**
 * store/securityStore.ts
 * 슈퍼관리자 보안관리 스토어 — 계정/세션/2FA/잠금
 */
import { create } from 'zustand'
import type { SuperAdminAccount, SuperAdminRole } from '../domain/types'

const now = () => new Date().toISOString()
const hoursLater = (h: number) => new Date(Date.now() + h * 3600000).toISOString()
const daysAgo = (d: number) => new Date(Date.now() - d * 86400000).toISOString()
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600000).toISOString()

const SEED_ACCOUNTS: SuperAdminAccount[] = [
  {
    id: 'sa-001',
    name: '김슈퍼',
    email: 'super@swimnote.kr',
    role: 'super_admin',
    twoFactorEnabled: true,
    lastLoginAt: hoursAgo(2),
    lastLoginIp: '203.244.10.5',
    loginFailCount: 0,
    lockedUntil: null,
    isActive: true,
    createdAt: daysAgo(180),
    devices: [
      { id: 'dev-001', label: 'MacBook Pro', os: 'macOS 14', browser: 'Chrome 122', lastUsedAt: hoursAgo(2), isCurrent: true },
      { id: 'dev-002', label: 'iPhone 15 Pro', os: 'iOS 17', browser: 'Safari', lastUsedAt: daysAgo(1), isCurrent: false },
    ],
    sessions: [
      { id: 'sess-001', adminId: 'sa-001', ip: '203.244.10.5', device: 'MacBook Pro', startedAt: hoursAgo(2), expiresAt: hoursLater(6), isActive: true },
    ],
  },
  {
    id: 'sa-002',
    name: '이시니어',
    email: 'senior@swimnote.kr',
    role: 'senior_admin',
    twoFactorEnabled: false,
    lastLoginAt: daysAgo(3),
    lastLoginIp: '211.109.21.88',
    loginFailCount: 2,
    lockedUntil: null,
    isActive: true,
    createdAt: daysAgo(90),
    devices: [
      { id: 'dev-003', label: 'Windows PC', os: 'Windows 11', browser: 'Edge 121', lastUsedAt: daysAgo(3), isCurrent: false },
    ],
    sessions: [],
  },
  {
    id: 'sa-003',
    name: '박읽기전용',
    email: 'readonly@swimnote.kr',
    role: 'read_only_admin',
    twoFactorEnabled: true,
    lastLoginAt: daysAgo(7),
    lastLoginIp: '125.178.40.3',
    loginFailCount: 5,
    lockedUntil: hoursLater(12),
    isActive: true,
    createdAt: daysAgo(45),
    devices: [
      { id: 'dev-004', label: 'iPad Air', os: 'iPadOS 17', browser: 'Safari', lastUsedAt: daysAgo(7), isCurrent: false },
    ],
    sessions: [],
  },
  {
    id: 'sa-004',
    name: '최비활성',
    email: 'inactive@swimnote.kr',
    role: 'senior_admin',
    twoFactorEnabled: false,
    lastLoginAt: daysAgo(60),
    lastLoginIp: '59.10.120.4',
    loginFailCount: 0,
    lockedUntil: null,
    isActive: false,
    createdAt: daysAgo(200),
    devices: [],
    sessions: [],
  },
]

interface SecurityState {
  accounts: SuperAdminAccount[]
  forceTwoFactor: (adminId: string, actorName: string) => void
  terminateSession: (adminId: string, sessionId: string, actorName: string) => void
  lockAccount: (adminId: string, hours: number, actorName: string) => void
  unlockAccount: (adminId: string, actorName: string) => void
  changeRole: (adminId: string, role: SuperAdminRole, actorName: string) => void
  toggleActive: (adminId: string, actorName: string) => void
  resetFailCount: (adminId: string) => void
}

export const useSecurityStore = create<SecurityState>((set, get) => ({
  accounts: SEED_ACCOUNTS,

  forceTwoFactor: (adminId) =>
    set(s => ({
      accounts: s.accounts.map(a =>
        a.id === adminId ? { ...a, twoFactorEnabled: true } : a
      ),
    })),

  terminateSession: (adminId, sessionId) =>
    set(s => ({
      accounts: s.accounts.map(a =>
        a.id === adminId
          ? { ...a, sessions: a.sessions.map(sess => sess.id === sessionId ? { ...sess, isActive: false } : sess) }
          : a
      ),
    })),

  lockAccount: (adminId, hours) =>
    set(s => ({
      accounts: s.accounts.map(a =>
        a.id === adminId ? { ...a, lockedUntil: hoursLater(hours), sessions: a.sessions.map(sess => ({ ...sess, isActive: false })) } : a
      ),
    })),

  unlockAccount: (adminId) =>
    set(s => ({
      accounts: s.accounts.map(a =>
        a.id === adminId ? { ...a, lockedUntil: null, loginFailCount: 0 } : a
      ),
    })),

  changeRole: (adminId, role) =>
    set(s => ({
      accounts: s.accounts.map(a =>
        a.id === adminId ? { ...a, role } : a
      ),
    })),

  toggleActive: (adminId) =>
    set(s => ({
      accounts: s.accounts.map(a =>
        a.id === adminId ? { ...a, isActive: !a.isActive, sessions: !a.isActive ? a.sessions : a.sessions.map(sess => ({ ...sess, isActive: false })) } : a
      ),
    })),

  resetFailCount: (adminId) =>
    set(s => ({
      accounts: s.accounts.map(a =>
        a.id === adminId ? { ...a, loginFailCount: 0 } : a
      ),
    })),
}))
