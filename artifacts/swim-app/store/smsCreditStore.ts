/**
 * store/smsCreditStore.ts
 * SMS 선불 충전형 크레딧 시스템 — 운영자별 잔액 관리
 * 단가: ₩9.9/건, 무료 기본 제공: 500건/월
 */
import { create } from 'zustand'
import { useAuditLogStore } from './auditLogStore'

const now = () => new Date().toISOString()
const daysAgo = (d: number) => new Date(Date.now() - d * 86400000).toISOString()

export interface SmsCreditPurchase {
  id: string
  operatorId: string
  operatorName: string
  packageName: string
  creditCount: number
  price: number
  purchasedAt: string
  actorName: string
  note?: string
}

export interface SmsCreditAccount {
  operatorId: string
  operatorName: string
  freeQuotaMonthly: number
  freeUsedMonthly: number
  creditBalance: number
  creditPurchasedTotal: number
  creditUsedTotal: number
  smsBlocked: boolean
  allowOverage: boolean
  typesCount: { invite: number; auth: number; notice: number; warning: number }
  purchaseHistory: SmsCreditPurchase[]
}

export interface SmsCreditPackage {
  id: string
  name: string
  creditCount: number
  price: number
  isActive: boolean
}

export const SMS_UNIT_PRICE = 9.9
export const SMS_FREE_DEFAULT = 500

export const CREDIT_PACKAGES: SmsCreditPackage[] = [
  { id: 'pkg-100',  name: '기본 패키지',    creditCount: 100,  price: 990,   isActive: true },
  { id: 'pkg-500',  name: '스탠다드 패키지', creditCount: 500,  price: 4950,  isActive: true },
  { id: 'pkg-1000', name: '프리미엄 패키지', creditCount: 1000, price: 9900,  isActive: true },
  { id: 'pkg-3000', name: '대용량 패키지',    creditCount: 3000, price: 27000, isActive: true },
]

const SEED_PURCHASE = (opId: string, opName: string, cnt: number, days: number): SmsCreditPurchase => ({
  id: `purch-${opId}-${days}`,
  operatorId: opId,
  operatorName: opName,
  packageName: cnt >= 1000 ? '프리미엄 패키지' : cnt >= 500 ? '스탠다드 패키지' : '기본 패키지',
  creditCount: cnt,
  price: cnt * 9.9,
  purchasedAt: daysAgo(days),
  actorName: opName + ' 관리자',
})

const SEED_ACCOUNTS: SmsCreditAccount[] = [
  {
    operatorId: 'op-001', operatorName: '송파수영아카데미',
    freeQuotaMonthly: 500, freeUsedMonthly: 320,
    creditBalance: 0, creditPurchasedTotal: 0, creditUsedTotal: 0,
    smsBlocked: false, allowOverage: false,
    typesCount: { invite: 120, auth: 180, notice: 20, warning: 0 },
    purchaseHistory: [],
  },
  {
    operatorId: 'op-002', operatorName: '강남수영클럽',
    freeQuotaMonthly: 500, freeUsedMonthly: 500,
    creditBalance: 847, creditPurchasedTotal: 1500, creditUsedTotal: 653,
    smsBlocked: false, allowOverage: true,
    typesCount: { invite: 280, auth: 450, notice: 370, warning: 53 },
    purchaseHistory: [
      SEED_PURCHASE('op-002', '강남수영클럽', 1000, 35),
      SEED_PURCHASE('op-002', '강남수영클럽', 500, 12),
    ],
  },
  {
    operatorId: 'op-003', operatorName: '목동스위밍센터',
    freeQuotaMonthly: 500, freeUsedMonthly: 500,
    creditBalance: 12, creditPurchasedTotal: 500, creditUsedTotal: 488,
    smsBlocked: false, allowOverage: false,
    typesCount: { invite: 150, auth: 300, notice: 90, warning: 10 },
    purchaseHistory: [SEED_PURCHASE('op-003', '목동스위밍센터', 500, 20)],
  },
  {
    operatorId: 'op-004', operatorName: '분당아쿠아클럽',
    freeQuotaMonthly: 500, freeUsedMonthly: 500,
    creditBalance: 0, creditPurchasedTotal: 0, creditUsedTotal: 0,
    smsBlocked: true, allowOverage: false,
    typesCount: { invite: 45, auth: 210, notice: 25, warning: 5 },
    purchaseHistory: [],
  },
  {
    operatorId: 'op-005', operatorName: '한강수영학원',
    freeQuotaMonthly: 500, freeUsedMonthly: 210,
    creditBalance: 2340, creditPurchasedTotal: 3000, creditUsedTotal: 660,
    smsBlocked: false, allowOverage: true,
    typesCount: { invite: 390, auth: 280, notice: 150, warning: 50 },
    purchaseHistory: [SEED_PURCHASE('op-005', '한강수영학원', 3000, 60)],
  },
  {
    operatorId: 'op-006', operatorName: '마포수영센터',
    freeQuotaMonthly: 1000, freeUsedMonthly: 880,
    creditBalance: 450, creditPurchasedTotal: 1000, creditUsedTotal: 550,
    smsBlocked: false, allowOverage: false,
    typesCount: { invite: 200, auth: 620, notice: 80, warning: 30 },
    purchaseHistory: [SEED_PURCHASE('op-006', '마포수영센터', 1000, 45)],
  },
  {
    operatorId: 'op-007', operatorName: '해지된수영장',
    freeQuotaMonthly: 500, freeUsedMonthly: 0,
    creditBalance: 0, creditPurchasedTotal: 200, creditUsedTotal: 200,
    smsBlocked: true, allowOverage: false,
    typesCount: { invite: 0, auth: 0, notice: 0, warning: 0 },
    purchaseHistory: [],
  },
]

let idCnt = 1

interface SmsCreditState {
  accounts: SmsCreditAccount[]
  unitPrice: number

  getAccount: (operatorId: string) => SmsCreditAccount | undefined

  chargeCredit: (operatorId: string, packageId: string, actorName: string) => boolean
  deductCredit: (operatorId: string, count: number, type: 'invite' | 'auth' | 'notice' | 'warning') => 'free' | 'paid' | 'blocked'
  setBlocked: (operatorId: string, blocked: boolean, actorName: string) => void
  setAllowOverage: (operatorId: string, allow: boolean, actorName: string) => void
  setFreeQuota: (operatorId: string, quota: number, actorName: string) => void
  setUnitPrice: (price: number, actorName: string) => void
  resetMonthlyFree: () => void
}

export const useSmsCreditStore = create<SmsCreditState>((set, get) => ({
  accounts: SEED_ACCOUNTS,
  unitPrice: SMS_UNIT_PRICE,

  getAccount: (operatorId) => get().accounts.find(a => a.operatorId === operatorId),

  chargeCredit: (operatorId, packageId, actorName) => {
    const pkg = CREDIT_PACKAGES.find(p => p.id === packageId)
    if (!pkg) return false
    const account = get().accounts.find(a => a.operatorId === operatorId)
    if (!account) return false

    const purchase: SmsCreditPurchase = {
      id: `purch-${Date.now()}-${++idCnt}`,
      operatorId,
      operatorName: account.operatorName,
      packageName: pkg.name,
      creditCount: pkg.creditCount,
      price: pkg.price,
      purchasedAt: now(),
      actorName,
    }

    set(s => ({
      accounts: s.accounts.map(a =>
        a.operatorId === operatorId
          ? {
              ...a,
              creditBalance: a.creditBalance + pkg.creditCount,
              creditPurchasedTotal: a.creditPurchasedTotal + pkg.creditCount,
              smsBlocked: false,
              purchaseHistory: [purchase, ...a.purchaseHistory],
            }
          : a
      ),
    }))

    useAuditLogStore.getState().createLog({
      category: 'sms',
      title: 'SMS 크레딧 충전',
      detail: `${account.operatorName} — ${pkg.name} ${pkg.creditCount}건 충전 (₩${pkg.price.toLocaleString()})`,
      actorName,
      impact: 'low',
      operatorId,
      operatorName: account.operatorName,
    })
    return true
  },

  deductCredit: (operatorId, count, type) => {
    const account = get().accounts.find(a => a.operatorId === operatorId)
    if (!account) return 'blocked'
    if (account.smsBlocked) return 'blocked'

    const freeRemaining = account.freeQuotaMonthly - account.freeUsedMonthly

    if (freeRemaining >= count) {
      set(s => ({
        accounts: s.accounts.map(a =>
          a.operatorId === operatorId
            ? { ...a, freeUsedMonthly: a.freeUsedMonthly + count, typesCount: { ...a.typesCount, [type]: a.typesCount[type] + count } }
            : a
        ),
      }))
      return 'free'
    }

    if (account.creditBalance >= count) {
      set(s => ({
        accounts: s.accounts.map(a =>
          a.operatorId === operatorId
            ? {
                ...a,
                freeUsedMonthly: Math.min(a.freeUsedMonthly + freeRemaining, a.freeQuotaMonthly),
                creditBalance: a.creditBalance - (count - freeRemaining),
                creditUsedTotal: a.creditUsedTotal + (count - freeRemaining),
                typesCount: { ...a.typesCount, [type]: a.typesCount[type] + count },
              }
            : a
        ),
      }))
      return 'paid'
    }

    if (!account.allowOverage) {
      set(s => ({
        accounts: s.accounts.map(a =>
          a.operatorId === operatorId ? { ...a, smsBlocked: true } : a
        ),
      }))
      return 'blocked'
    }

    set(s => ({
      accounts: s.accounts.map(a =>
        a.operatorId === operatorId
          ? { ...a, typesCount: { ...a.typesCount, [type]: a.typesCount[type] + count } }
          : a
      ),
    }))
    return 'paid'
  },

  setBlocked: (operatorId, blocked, actorName) => {
    const account = get().accounts.find(a => a.operatorId === operatorId)
    if (!account) return
    set(s => ({
      accounts: s.accounts.map(a =>
        a.operatorId === operatorId ? { ...a, smsBlocked: blocked } : a
      ),
    }))
    useAuditLogStore.getState().createLog({
      category: 'sms',
      title: `SMS ${blocked ? '차단' : '차단 해제'}`,
      detail: `${account.operatorName} SMS 발송 ${blocked ? '차단' : '해제'}`,
      actorName,
      impact: blocked ? 'high' : 'medium',
      operatorId,
      operatorName: account.operatorName,
    })
  },

  setAllowOverage: (operatorId, allow, actorName) => {
    const account = get().accounts.find(a => a.operatorId === operatorId)
    if (!account) return
    set(s => ({
      accounts: s.accounts.map(a =>
        a.operatorId === operatorId ? { ...a, allowOverage: allow } : a
      ),
    }))
    useAuditLogStore.getState().createLog({
      category: 'sms',
      title: 'SMS 초과 허용 변경',
      detail: `${account.operatorName} 크레딧 초과 허용 → ${allow ? 'ON' : 'OFF'}`,
      actorName,
      impact: 'low',
      operatorId,
      operatorName: account.operatorName,
    })
  },

  setFreeQuota: (operatorId, quota, actorName) => {
    const account = get().accounts.find(a => a.operatorId === operatorId)
    if (!account) return
    set(s => ({
      accounts: s.accounts.map(a =>
        a.operatorId === operatorId ? { ...a, freeQuotaMonthly: quota } : a
      ),
    }))
    useAuditLogStore.getState().createLog({
      category: 'sms',
      title: '무료 제공량 변경',
      detail: `${account.operatorName} 월 무료 SMS → ${quota}건`,
      actorName,
      impact: 'medium',
      operatorId,
      operatorName: account.operatorName,
    })
  },

  setUnitPrice: (price, actorName) => {
    set({ unitPrice: price })
    useAuditLogStore.getState().createLog({
      category: 'sms',
      title: 'SMS 단가 변경',
      detail: `SMS 단가 → ₩${price}/건`,
      actorName,
      impact: 'high',
    })
  },

  resetMonthlyFree: () => {
    set(s => ({
      accounts: s.accounts.map(a => ({ ...a, freeUsedMonthly: 0 })),
    }))
  },
}))
