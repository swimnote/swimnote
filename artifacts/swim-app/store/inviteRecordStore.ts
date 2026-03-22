import { create } from 'zustand'

export type InviteMethod = 'sms_app' | 'copy_link'
export type InviteStatus = 'opened_sms_app' | 'copied_link' | 'signup_requested' | 'approved'
export type InvitePhoneLabel = 'guardian1' | 'guardian2' | 'primary'

export interface InviteRecord {
  id: string
  operatorId: string
  senderUserId: string
  senderName: string
  senderRole: 'operator' | 'teacher'
  studentId: string
  studentName: string
  guardianPhone: string
  guardianPhoneLabel: InvitePhoneLabel
  method: InviteMethod
  messageBody: string
  status: InviteStatus
  createdAt: string
  relatedParentUserId?: string
}

function np(p: string) { return p.replace(/\D/g, '') }
const dAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString()

const SEED: InviteRecord[] = [
  {
    id: 'inv-001', operatorId: 'op-002', senderUserId: 'u-admin-01', senderName: '관리자',
    senderRole: 'operator', studentId: 'stu-001', studentName: '김민수',
    guardianPhone: '010-1234-5678', guardianPhoneLabel: 'primary',
    method: 'sms_app', messageBody: '[스윔노트] 안녕하세요, 서울아쿠아클럽입니다. 김민수 학부모님, 앱 초대코드: SWIM01',
    status: 'approved', createdAt: dAgo(4), relatedParentUserId: 'usr-p01',
  },
  {
    id: 'inv-002', operatorId: 'op-002', senderUserId: 'u-admin-01', senderName: '관리자',
    senderRole: 'operator', studentId: 'stu-002', studentName: '이지수',
    guardianPhone: '010-9876-5432', guardianPhoneLabel: 'primary',
    method: 'copy_link', messageBody: '[스윔노트] 안녕하세요, 서울아쿠아클럽입니다. 이지수 학부모님, 앱 초대코드: SWIM02',
    status: 'approved', createdAt: dAgo(6), relatedParentUserId: 'usr-p02',
  },
  {
    id: 'inv-003', operatorId: 'op-002', senderUserId: 'u-teach-01', senderName: '박선생님',
    senderRole: 'teacher', studentId: 'stu-p03', studentName: '박예린',
    guardianPhone: '010-3333-4444', guardianPhoneLabel: 'primary',
    method: 'sms_app', messageBody: '[스윔노트] 안녕하세요, 서울아쿠아클럽입니다. 박예린 학부모님, 앱 초대코드: SWIM03',
    status: 'signup_requested', createdAt: dAgo(2),
  },
  {
    id: 'inv-004', operatorId: 'op-002', senderUserId: 'u-admin-01', senderName: '관리자',
    senderRole: 'operator', studentId: 'stu-004', studentName: '최준혁',
    guardianPhone: '010-5555-6666', guardianPhoneLabel: 'primary',
    method: 'sms_app', messageBody: '[스윔노트] 안녕하세요, 서울아쿠아클럽입니다. 최준혁 학부모님, 앱 초대코드: SWIM04',
    status: 'opened_sms_app', createdAt: dAgo(1),
  },
  {
    id: 'inv-005', operatorId: 'op-002', senderUserId: 'u-admin-01', senderName: '관리자',
    senderRole: 'operator', studentId: 'stu-005', studentName: '정다은',
    guardianPhone: '010-1234-5678', guardianPhoneLabel: 'primary',
    method: 'copy_link', messageBody: '[스윔노트] 안녕하세요, 서울아쿠아클럽입니다. 정다은 학부모님, 앱 초대코드: SWIM05',
    status: 'approved', createdAt: dAgo(5), relatedParentUserId: 'usr-p01',
  },
]

interface InviteRecordState {
  records: InviteRecord[]
  addRecord: (rec: Omit<InviteRecord, 'id' | 'createdAt'>) => InviteRecord
  linkToJoinRequest: (guardianPhone: string, parentUserId: string) => void
  markApproved: (guardianPhone: string, parentUserId?: string) => void
}

export const useInviteRecordStore = create<InviteRecordState>((set) => ({
  records: SEED,

  addRecord(rec) {
    const newRec: InviteRecord = { ...rec, id: `inv-${Date.now()}`, createdAt: new Date().toISOString() }
    set(s => ({ records: [newRec, ...s.records] }))
    return newRec
  },

  linkToJoinRequest(guardianPhone, parentUserId) {
    const normalized = np(guardianPhone)
    set(s => ({
      records: s.records.map(r => {
        if (
          np(r.guardianPhone) === normalized &&
          (r.status === 'opened_sms_app' || r.status === 'copied_link')
        ) {
          return { ...r, status: 'signup_requested', relatedParentUserId: parentUserId }
        }
        return r
      }),
    }))
  },

  markApproved(guardianPhone, parentUserId) {
    const normalized = np(guardianPhone)
    set(s => ({
      records: s.records.map(r => {
        if (np(r.guardianPhone) === normalized && r.status !== 'approved') {
          return { ...r, status: 'approved', relatedParentUserId: parentUserId ?? r.relatedParentUserId }
        }
        return r
      }),
    }))
  },
}))
