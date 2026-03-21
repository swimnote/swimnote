/**
 * store/smsStore.ts
 * 초대/SMS 관리 스토어 — adapter 패턴 (mock provider)
 */
import { create } from 'zustand'
import type { SmsRecord, SmsTemplate, InviteRecord, SmsType, InviteRole } from '../domain/types'

const now = () => new Date().toISOString()
const daysAgo = (d: number) => new Date(Date.now() - d * 86400000).toISOString()
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600000).toISOString()
const daysLater = (d: number) => new Date(Date.now() + d * 86400000).toISOString()

const SEED_TEMPLATES: SmsTemplate[] = [
  { id: 'tpl-001', type: 'teacher_invite', name: '선생님 초대', body: '[스윔노트] {name}님을 {pool}에 초대합니다. 링크: {link} (유효기간 7일)', isActive: true, updatedAt: daysAgo(30), updatedBy: '슈퍼관리자' },
  { id: 'tpl-002', type: 'parent_connect', name: '학부모 연결 요청', body: '[스윔노트] {pool}에서 학부모 계정 연결을 요청했습니다. 링크: {link}', isActive: true, updatedAt: daysAgo(30), updatedBy: '슈퍼관리자' },
  { id: 'tpl-003', type: 'phone_verify', name: '휴대폰 인증', body: '[스윔노트] 인증번호: {code} (5분 유효)', isActive: true, updatedAt: daysAgo(14), updatedBy: '슈퍼관리자' },
  { id: 'tpl-004', type: 'policy_reconfirm', name: '정책 재확인', body: '[스윔노트] 이용약관 개정 안내. 재동의 필요: {link}', isActive: true, updatedAt: daysAgo(7), updatedBy: '슈퍼관리자' },
  { id: 'tpl-005', type: 'payment_fail', name: '결제 실패 안내', body: '[스윔노트] {pool} 결제가 실패했습니다. 결제 수단을 확인해 주세요: {link}', isActive: true, updatedAt: daysAgo(5), updatedBy: '슈퍼관리자' },
  { id: 'tpl-006', type: 'storage_warn', name: '저장공간 경고', body: '[스윔노트] {pool} 저장공간이 {pct}% 사용되었습니다. 추가 구매: {link}', isActive: true, updatedAt: daysAgo(10), updatedBy: '슈퍼관리자' },
  { id: 'tpl-007', type: 'deletion_notice', name: '삭제 예정 고지', body: '[스윔노트] {pool} 데이터가 {date}에 삭제 예정입니다. 문의: {link}', isActive: true, updatedAt: daysAgo(3), updatedBy: '슈퍼관리자' },
]

const SEED_SMS_RECORDS: SmsRecord[] = [
  { id: 'sms-001', type: 'teacher_invite', recipientName: '박선생', recipientPhone: '010-1111-2222', operatorId: 'op-002', operatorName: '강남수영클럽', status: 'sent', sentAt: hoursAgo(3), sentBy: '슈퍼관리자', templateId: 'tpl-001', message: '[스윔노트] 박선생님을 강남수영클럽에 초대합니다. 링크: https://swimnote.kr/invite/abc123', failReason: null },
  { id: 'sms-002', type: 'payment_fail', recipientName: '김운영자', recipientPhone: '010-3333-4444', operatorId: 'op-003', operatorName: '목동스위밍센터', status: 'sent', sentAt: hoursAgo(6), sentBy: '슈퍼관리자', templateId: 'tpl-005', message: '[스윔노트] 목동스위밍센터 결제가 실패했습니다.', failReason: null },
  { id: 'sms-003', type: 'storage_warn', recipientName: '이관리자', recipientPhone: '010-5555-6666', operatorId: 'op-004', operatorName: '분당아쿠아클럽', status: 'failed', sentAt: hoursAgo(12), sentBy: '슈퍼관리자', templateId: 'tpl-006', message: '[스윔노트] 분당아쿠아클럽 저장공간이 82% 사용되었습니다.', failReason: '수신거부' },
  { id: 'sms-004', type: 'phone_verify', recipientName: '최신규', recipientPhone: '010-7777-8888', operatorId: 'op-001', operatorName: '송파수영아카데미', status: 'sent', sentAt: daysAgo(1), sentBy: '슈퍼관리자', templateId: 'tpl-003', message: '[스윔노트] 인증번호: 483920 (5분 유효)', failReason: null },
  { id: 'sms-005', type: 'deletion_notice', recipientName: '정해지운영자', recipientPhone: '010-9999-0000', operatorId: 'op-007', operatorName: '해지된수영장', status: 'sent', sentAt: daysAgo(2), sentBy: '슈퍼관리자', templateId: 'tpl-007', message: '[스윔노트] 해지된수영장 데이터가 30일 후 삭제 예정입니다.', failReason: null },
]

const SEED_INVITES: InviteRecord[] = [
  { id: 'inv-001', role: 'teacher', recipientName: '박선생', recipientPhone: '010-1111-2222', operatorId: 'op-002', operatorName: '강남수영클럽', status: 'pending', createdAt: hoursAgo(3), expiresAt: daysLater(7), acceptedAt: null, sentBy: '슈퍼관리자', note: '신규 코치 채용' },
  { id: 'inv-002', role: 'parent', recipientName: '이학부모', recipientPhone: '010-2222-3333', operatorId: 'op-002', operatorName: '강남수영클럽', status: 'accepted', createdAt: daysAgo(3), expiresAt: daysLater(4), acceptedAt: daysAgo(2), sentBy: '슈퍼관리자', note: '' },
  { id: 'inv-003', role: 'operator', recipientName: '한신규사장', recipientPhone: '010-4444-5555', operatorId: '', operatorName: '—', status: 'pending', createdAt: daysAgo(1), expiresAt: daysLater(6), acceptedAt: null, sentBy: '슈퍼관리자', note: '신규 운영자 온보딩' },
  { id: 'inv-004', role: 'teacher', recipientName: '조코치', recipientPhone: '010-6666-7777', operatorId: 'op-003', operatorName: '목동스위밍센터', status: 'expired', createdAt: daysAgo(10), expiresAt: daysAgo(3), acceptedAt: null, sentBy: '슈퍼관리자', note: '기간 만료 — 재발송 필요' },
]

let idCnt = 100

interface SmsState {
  records: SmsRecord[]
  templates: SmsTemplate[]
  invites: InviteRecord[]

  sendSms: (params: {
    type: SmsType
    recipientName: string
    recipientPhone: string
    operatorId: string
    operatorName: string
    actorName: string
    templateId?: string
    message?: string
  }) => SmsRecord

  resendInvite: (inviteId: string, actorName: string) => void
  cancelInvite: (inviteId: string, actorName: string) => void

  createInvite: (params: {
    role: InviteRole
    recipientName: string
    recipientPhone: string
    operatorId: string
    operatorName: string
    actorName: string
    note: string
  }) => InviteRecord

  updateTemplate: (id: string, patch: Partial<Pick<SmsTemplate, 'body' | 'isActive'>>, actorName: string) => void
}

export const useSmsStore = create<SmsState>((set, get) => ({
  records: SEED_SMS_RECORDS,
  templates: SEED_TEMPLATES,
  invites: SEED_INVITES,

  sendSms: (params) => {
    const tpl = get().templates.find(t => t.type === params.type)
    const record: SmsRecord = {
      id: `sms-${Date.now()}-${++idCnt}`,
      type: params.type,
      recipientName: params.recipientName,
      recipientPhone: params.recipientPhone,
      operatorId: params.operatorId,
      operatorName: params.operatorName,
      status: 'sent',
      sentAt: now(),
      sentBy: params.actorName,
      templateId: params.templateId ?? tpl?.id ?? '',
      message: params.message ?? tpl?.body ?? '',
      failReason: null,
    }
    set(s => ({ records: [record, ...s.records] }))
    return record
  },

  resendInvite: (inviteId) => {
    set(s => ({
      invites: s.invites.map(inv =>
        inv.id === inviteId
          ? { ...inv, status: 'pending', expiresAt: daysLater(7), createdAt: now() }
          : inv
      ),
    }))
  },

  cancelInvite: (inviteId) => {
    set(s => ({
      invites: s.invites.map(inv =>
        inv.id === inviteId ? { ...inv, status: 'cancelled' } : inv
      ),
    }))
  },

  createInvite: (params) => {
    const invite: InviteRecord = {
      id: `inv-${Date.now()}-${++idCnt}`,
      role: params.role,
      recipientName: params.recipientName,
      recipientPhone: params.recipientPhone,
      operatorId: params.operatorId,
      operatorName: params.operatorName,
      status: 'pending',
      createdAt: now(),
      expiresAt: daysLater(7),
      acceptedAt: null,
      sentBy: params.actorName,
      note: params.note,
    }
    set(s => ({ invites: [invite, ...s.invites] }))
    return invite
  },

  updateTemplate: (id, patch, actorName) => {
    set(s => ({
      templates: s.templates.map(t =>
        t.id === id ? { ...t, ...patch, updatedAt: now(), updatedBy: actorName } : t
      ),
    }))
  },
}))
