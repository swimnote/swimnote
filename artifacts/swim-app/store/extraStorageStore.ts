/**
 * store/extraStorageStore.ts
 * 추가 용량 상품 + 운영자 구매 관리
 * 구독 플랜과 별개 상품 — 가격/용량 독립 관리
 */
import { create } from 'zustand'
import { useAuditLogStore } from './auditLogStore'

const now = () => new Date().toISOString()
const daysAgo = (d: number) => new Date(Date.now() - d * 86400000).toISOString()

export type VideoUnlockReason = 'extra_storage' | 'manual' | 'none'

export interface ExtraStorageProduct {
  id: string
  name: string
  extraStorageMb: number
  price: number
  isActive: boolean
  note?: string
  createdAt: string
  updatedAt: string
}

export interface ExtraStoragePurchase {
  id: string
  operatorId: string
  operatorName: string
  productId: string
  productName: string
  extraStorageMb: number
  price: number
  purchasedAt: string
  actorName: string
}

export interface OperatorStorageAccount {
  operatorId: string
  operatorName: string
  extraStoragePurchasedMb: number
  purchasedProductIds: string[]
  videoUploadUnlocked: boolean
  videoUnlockReason: VideoUnlockReason
  videoUnlockNote?: string
}

const SEED_PRODUCTS: ExtraStorageProduct[] = [
  {
    id: 'estorage-001',
    name: '추가 10GB',
    extraStorageMb: 10240,
    price: 9900,
    isActive: true,
    note: '사진/영상 추가 저장 10GB. 영상 업로드 잠금 해제.',
    createdAt: daysAgo(90),
    updatedAt: daysAgo(30),
  },
  {
    id: 'estorage-002',
    name: '추가 30GB',
    extraStorageMb: 30720,
    price: 24900,
    isActive: true,
    note: '사진/영상 추가 저장 30GB. 최대 절약 패키지.',
    createdAt: daysAgo(90),
    updatedAt: daysAgo(30),
  },
  {
    id: 'estorage-003',
    name: '추가 50GB',
    extraStorageMb: 51200,
    price: 39900,
    isActive: true,
    note: '대규모 운영 전용 50GB. 무제한 영상 업로드.',
    createdAt: daysAgo(90),
    updatedAt: daysAgo(14),
  },
  {
    id: 'estorage-004',
    name: '추가 100GB',
    extraStorageMb: 102400,
    price: 69900,
    isActive: false,
    note: '엔터프라이즈 전용 상품. 현재 비활성.',
    createdAt: daysAgo(60),
    updatedAt: daysAgo(5),
  },
]

const SEED_PURCHASES: ExtraStoragePurchase[] = [
  {
    id: 'epurch-001',
    operatorId: 'op-002', operatorName: '강남수영클럽',
    productId: 'estorage-002', productName: '추가 30GB',
    extraStorageMb: 30720, price: 24900,
    purchasedAt: daysAgo(45), actorName: '강남 관리자',
  },
  {
    id: 'epurch-002',
    operatorId: 'op-005', operatorName: '한강수영학원',
    productId: 'estorage-003', productName: '추가 50GB',
    extraStorageMb: 51200, price: 39900,
    purchasedAt: daysAgo(20), actorName: '한강 관리자',
  },
  {
    id: 'epurch-003',
    operatorId: 'op-002', operatorName: '강남수영클럽',
    productId: 'estorage-001', productName: '추가 10GB',
    extraStorageMb: 10240, price: 9900,
    purchasedAt: daysAgo(10), actorName: '강남 관리자',
  },
]

const SEED_OP_ACCOUNTS: OperatorStorageAccount[] = [
  { operatorId: 'op-001', operatorName: '송파수영아카데미', extraStoragePurchasedMb: 0, purchasedProductIds: [], videoUploadUnlocked: false, videoUnlockReason: 'none' },
  { operatorId: 'op-002', operatorName: '강남수영클럽', extraStoragePurchasedMb: 40960, purchasedProductIds: ['estorage-002','estorage-001'], videoUploadUnlocked: true, videoUnlockReason: 'extra_storage' },
  { operatorId: 'op-003', operatorName: '목동스위밍센터', extraStoragePurchasedMb: 0, purchasedProductIds: [], videoUploadUnlocked: false, videoUnlockReason: 'none' },
  { operatorId: 'op-004', operatorName: '분당아쿠아클럽', extraStoragePurchasedMb: 0, purchasedProductIds: [], videoUploadUnlocked: true, videoUnlockReason: 'manual', videoUnlockNote: '슈퍼관리자 예외 허용' },
  { operatorId: 'op-005', operatorName: '한강수영학원', extraStoragePurchasedMb: 51200, purchasedProductIds: ['estorage-003'], videoUploadUnlocked: true, videoUnlockReason: 'extra_storage' },
  { operatorId: 'op-006', operatorName: '마포수영센터', extraStoragePurchasedMb: 0, purchasedProductIds: [], videoUploadUnlocked: false, videoUnlockReason: 'none' },
  { operatorId: 'op-007', operatorName: '해지된수영장', extraStoragePurchasedMb: 0, purchasedProductIds: [], videoUploadUnlocked: false, videoUnlockReason: 'none' },
]

let idCnt = 1

interface ExtraStorageState {
  products: ExtraStorageProduct[]
  purchases: ExtraStoragePurchase[]
  opAccounts: OperatorStorageAccount[]

  getOpAccount: (operatorId: string) => OperatorStorageAccount | undefined
  getOpPurchases: (operatorId: string) => ExtraStoragePurchase[]

  purchaseProduct: (operatorId: string, productId: string, actorName: string) => boolean
  manualUnlockVideo: (operatorId: string, unlock: boolean, note: string, actorName: string) => void

  createProduct: (data: Omit<ExtraStorageProduct, 'id' | 'createdAt' | 'updatedAt'>, actorName: string) => void
  updateProduct: (id: string, patch: Partial<Omit<ExtraStorageProduct, 'id' | 'createdAt'>>, actorName: string) => void
  toggleProductActive: (id: string, actorName: string) => void
}

export const useExtraStorageStore = create<ExtraStorageState>((set, get) => ({
  products: SEED_PRODUCTS,
  purchases: SEED_PURCHASES,
  opAccounts: SEED_OP_ACCOUNTS,

  getOpAccount: (operatorId) => {
    const existing = get().opAccounts.find(a => a.operatorId === operatorId)
    if (existing) return existing
    return undefined
  },

  getOpPurchases: (operatorId) => get().purchases.filter(p => p.operatorId === operatorId),

  purchaseProduct: (operatorId, productId, actorName) => {
    const product = get().products.find(p => p.id === productId && p.isActive)
    if (!product) return false

    const existingAccount = get().opAccounts.find(a => a.operatorId === operatorId)
    const opName = existingAccount?.operatorName ?? operatorId

    const purchase: ExtraStoragePurchase = {
      id: `epurch-${Date.now()}-${++idCnt}`,
      operatorId,
      operatorName: opName,
      productId,
      productName: product.name,
      extraStorageMb: product.extraStorageMb,
      price: product.price,
      purchasedAt: now(),
      actorName,
    }

    set(s => {
      const updatedPurchases = [purchase, ...s.purchases]
      const updatedAccounts = s.opAccounts.map(a => {
        if (a.operatorId !== operatorId) return a
        const newMb = a.extraStoragePurchasedMb + product.extraStorageMb
        return {
          ...a,
          extraStoragePurchasedMb: newMb,
          purchasedProductIds: [...a.purchasedProductIds, productId],
          videoUploadUnlocked: true,
          videoUnlockReason: 'extra_storage' as VideoUnlockReason,
        }
      })
      if (!s.opAccounts.find(a => a.operatorId === operatorId)) {
        updatedAccounts.push({
          operatorId,
          operatorName: opName,
          extraStoragePurchasedMb: product.extraStorageMb,
          purchasedProductIds: [productId],
          videoUploadUnlocked: true,
          videoUnlockReason: 'extra_storage',
        })
      }
      return { purchases: updatedPurchases, opAccounts: updatedAccounts }
    })

    useAuditLogStore.getState().createLog({
      category: 'storage',
      title: '추가 용량 구매',
      detail: `${opName} — ${product.name} (${(product.extraStorageMb / 1024).toFixed(0)}GB) 구매 ₩${product.price.toLocaleString()}`,
      actorName,
      impact: 'low',
      operatorId,
      operatorName: opName,
    })
    return true
  },

  manualUnlockVideo: (operatorId, unlock, note, actorName) => {
    const account = get().opAccounts.find(a => a.operatorId === operatorId)
    const opName = account?.operatorName ?? operatorId
    set(s => ({
      opAccounts: s.opAccounts.map(a =>
        a.operatorId === operatorId
          ? {
              ...a,
              videoUploadUnlocked: unlock,
              videoUnlockReason: unlock ? 'manual' : 'none',
              videoUnlockNote: unlock ? note : undefined,
            }
          : a
      ),
    }))
    useAuditLogStore.getState().createLog({
      category: 'storage',
      title: `영상 업로드 ${unlock ? '잠금 해제' : '잠금'}`,
      detail: `${opName} 수동 ${unlock ? '잠금 해제' : '잠금'}${note ? ' — ' + note : ''}`,
      actorName,
      impact: 'medium',
      operatorId,
      operatorName: opName,
    })
  },

  createProduct: (data, actorName) => {
    const product: ExtraStorageProduct = {
      id: `estorage-${Date.now()}-${++idCnt}`,
      ...data,
      createdAt: now(),
      updatedAt: now(),
    }
    set(s => ({ products: [...s.products, product] }))
    useAuditLogStore.getState().createLog({
      category: 'storage',
      title: '추가 용량 상품 생성',
      detail: `${data.name} ${(data.extraStorageMb / 1024).toFixed(0)}GB ₩${data.price.toLocaleString()} 생성`,
      actorName,
      impact: 'medium',
    })
  },

  updateProduct: (id, patch, actorName) => {
    const product = get().products.find(p => p.id === id)
    if (!product) return
    set(s => ({
      products: s.products.map(p =>
        p.id === id ? { ...p, ...patch, updatedAt: now() } : p
      ),
    }))
    useAuditLogStore.getState().createLog({
      category: 'storage',
      title: '추가 용량 상품 수정',
      detail: `${product.name} 수정`,
      actorName,
      impact: 'low',
    })
  },

  toggleProductActive: (id, actorName) => {
    const product = get().products.find(p => p.id === id)
    if (!product) return
    const next = !product.isActive
    set(s => ({
      products: s.products.map(p =>
        p.id === id ? { ...p, isActive: next, updatedAt: now() } : p
      ),
    }))
    useAuditLogStore.getState().createLog({
      category: 'storage',
      title: `상품 ${next ? '활성화' : '비활성화'}`,
      detail: `${product.name} → ${next ? '판매중' : '비활성'}`,
      actorName,
      impact: 'medium',
    })
  },
}))
