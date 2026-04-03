// domain/formatters.ts — 안전 유틸 (undefined/Invalid Date 절대 금지)

export function safeText(value: unknown, fallback = '-'): string {
  if (value === null || value === undefined) return fallback
  const str = String(value).trim()
  return str.length ? str : fallback
}

export function formatDateSafe(value?: string | null, fallback = '-'): string {
  if (!value) return fallback
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return fallback
  return d.toLocaleString('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

export function formatDateOnly(value?: string | null, fallback = '-'): string {
  if (!value) return fallback
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return fallback
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

export function formatRelative(value?: string | null, fallback = '-'): string {
  if (!value) return fallback
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return fallback
  const diff = Date.now() - d.getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return '방금 전'
  if (min < 60) return `${min}분 전`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}시간 전`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day}일 전`
  const mo = Math.floor(day / 30)
  if (mo < 12) return `${mo}개월 전`
  return `${Math.floor(mo / 12)}년 전`
}

export function calcPercent(used: number, total: number): number {
  if (!total || total <= 0) return 0
  return Math.min(999, Math.round((used / total) * 100))
}

export function fmtBytes(mb: number): string {
  if (!mb || mb <= 0) return '0 MB'
  if (mb < 1024) return `${mb.toFixed(0)} MB`
  return `${(mb / 1024).toFixed(1)} GB`
}

export function fmtMoney(amount: number): string {
  if (!amount && amount !== 0) return '-'
  return `${amount.toLocaleString('ko-KR')}원`
}

export function fmtNumber(n: number, fallback = '0'): string {
  if (n === null || n === undefined || Number.isNaN(n)) return fallback
  return n.toLocaleString('ko-KR')
}

import type { OperatorType, OperatorStatus, BillingStatus, PaymentStatus, SupportStatus, SupportType, RiskLevel, ImpactLevel } from './types'

export const OPERATOR_TYPE_LABEL: Record<OperatorType, string> = {
  franchise: '프랜차이즈',
  swimming_pool: '수영장',
  rental_team: '임대팀',
  solo_coach: '1인코치',
  weekend_coach: '주말코치',
}

export const OPERATOR_STATUS_LABEL: Record<OperatorStatus, string> = {
  pending: '승인대기',
  active: '활성',
  rejected: '반려',
  restricted: '제한',
  readonly: '읽기전용',
  suspended: '정지',
}

export const BILLING_STATUS_LABEL: Record<BillingStatus, string> = {
  trial: '체험',
  active: '구독',
  payment_failed: '결제실패',
  grace: 'grace',
  readonly: '읽기전용',
  cancelled: '해지',
  auto_delete_scheduled: '자동삭제예정',
}

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  success: '성공',
  failed: '실패',
  pending: '대기',
  refunded: '환불',
  disputed: '분쟁',
}

export const SUPPORT_TYPE_LABEL: Record<SupportType, string> = {
  payment: '결제문제',
  chargeback: '차지백',
  account: '계정문제',
  data_delete: '데이터삭제',
  upload_error: '업로드오류',
  app_bug: '앱버그',
  policy: '정책문의',
  refund: '환불요청',
  dispute: '분쟁대응',
  login_permission: '로그인/권한',
  recovery: '계정복구',
  security: '보안문의',
  etc: '기타',
}

export const SUPPORT_STATUS_LABEL: Record<SupportStatus, string> = {
  received: '접수',
  in_progress: '처리중',
  resolved: '해결',
  on_hold: '보류',
  refund_linked: '환불연동',
  policy_sent: '정책안내완료',
  need_recheck: '재확인필요',
  escalated_to_tech: '기술팀전달',
}

export const RISK_LEVEL_COLOR: Record<RiskLevel, { bg: string; text: string }> = {
  low:      { bg: '#D1FAE5', text: '#065F46' },
  medium:   { bg: '#FEF3C7', text: '#92400E' },
  high:     { bg: '#FEE2E2', text: '#991B1B' },
  critical: { bg: '#7F1D1D', text: '#FEE2E2' },
}

export const IMPACT_COLOR: Record<ImpactLevel, { bg: string; text: string }> = {
  low:      { bg: '#1F2937', text: '#9CA3AF' },
  medium:   { bg: '#92400E', text: '#FDE68A' },
  high:     { bg: '#7F1D1D', text: '#FCA5A5' },
  critical: { bg: '#4C1D95', text: '#DDD6FE' },
}
