/**
 * store/riskStore.ts
 * 리스크 요약 — 다른 스토어에서 파생
 */

import { create } from 'zustand'
import type { RiskSummary } from '../domain/types'

export interface RiskCategory {
  key: string
  label: string
  count: number
  level: 'low' | 'medium' | 'high' | 'critical'
  description: string
}

interface RiskState {
  summary: RiskSummary
  categories: RiskCategory[]
  lastUpdated: string | null

  // refresh from other stores
  refreshFromStores: (params: {
    paymentFailCount: number
    storage95Count: number
    deletionPendingCount: number
    policyUnsignedCount: number
    slaOverdueCount: number
    securityEventCount: number
    featureErrorCount: number
    externalServiceIssues: number
    backupWarnings: number
    abuseCount: number
  }) => void

  setSummary: (s: RiskSummary) => void
}

function toLevel(count: number): 'low' | 'medium' | 'high' | 'critical' {
  if (count === 0) return 'low'
  if (count <= 1) return 'medium'
  if (count <= 3) return 'high'
  return 'critical'
}

function buildCategories(s: RiskSummary): RiskCategory[] {
  return [
    { key: 'payment', label: '결제 리스크', count: s.paymentRisk, level: toLevel(s.paymentRisk), description: '결제 실패·Grace·차지백' },
    { key: 'storage', label: '저장공간 리스크', count: s.storageRisk, level: toLevel(s.storageRisk), description: '95% 초과·80% 경고' },
    { key: 'deletion', label: '데이터 삭제 리스크', count: s.deletionPending, level: toLevel(s.deletionPending), description: '24h 내 자동삭제 예정' },
    { key: 'policy', label: '정책 미확인', count: s.policyUnsigned, level: toLevel(s.policyUnsigned), description: '환불·개인정보 정책 미확인' },
    { key: 'sla', label: '고객센터 SLA 리스크', count: s.slaOverdue, level: toLevel(s.slaOverdue), description: 'SLA 기한 초과 티켓' },
    { key: 'security', label: '보안 이벤트', count: s.securityEvents, level: toLevel(s.securityEvents), description: '차지백·분쟁·반복환불' },
    { key: 'feature', label: '기능 오류', count: s.featureErrors, level: toLevel(s.featureErrors), description: '앱 버그·업로드 오류 신고' },
    { key: 'external', label: '외부 서비스', count: s.externalServices, level: toLevel(s.externalServices), description: 'PG·R2·Supabase 이상' },
    { key: 'backup', label: '백업/동기화', count: s.backupWarnings, level: toLevel(s.backupWarnings), description: '스냅샷 미생성·실패' },
    { key: 'abuse', label: '악용/남용', count: s.abuseDetected, level: toLevel(s.abuseDetected), description: '업로드 급증·반복 민원' },
  ]
}

// 초기 summary를 seed 데이터 기준으로 계산
const INITIAL_SUMMARY: RiskSummary = {
  paymentRisk: 4,     // op-003, op-004, op-010, op-012
  storageRisk: 3,     // op-006, op-007, op-009
  deletionPending: 2, // op-005, op-010
  policyUnsigned: 2,  // op-001, op-008
  slaOverdue: 3,      // tkt-003, tkt-004, tkt-008(approx)
  securityEvents: 2,  // op-012(차지백), op-010(분쟁)
  featureErrors: 1,   // tkt-011
  externalServices: 0,
  backupWarnings: 0,
  abuseDetected: 1,   // op-006 업로드급증
}

export const useRiskStore = create<RiskState>((set) => ({
  summary: INITIAL_SUMMARY,
  categories: buildCategories(INITIAL_SUMMARY),
  lastUpdated: new Date().toISOString(),

  refreshFromStores: (params) => {
    const s: RiskSummary = {
      paymentRisk: params.paymentFailCount,
      storageRisk: params.storage95Count,
      deletionPending: params.deletionPendingCount,
      policyUnsigned: params.policyUnsignedCount,
      slaOverdue: params.slaOverdueCount,
      securityEvents: params.securityEventCount,
      featureErrors: params.featureErrorCount,
      externalServices: params.externalServiceIssues,
      backupWarnings: params.backupWarnings,
      abuseDetected: params.abuseCount,
    }
    set({ summary: s, categories: buildCategories(s), lastUpdated: new Date().toISOString() })
  },

  setSummary: (summary) => set({
    summary,
    categories: buildCategories(summary),
    lastUpdated: new Date().toISOString(),
  }),
}))
