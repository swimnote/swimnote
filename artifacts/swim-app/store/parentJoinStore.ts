import { create } from 'zustand'
import { useInviteRecordStore } from './inviteRecordStore'

export type ParentRelation = '부' | '모' | '조부' | '조모' | '기타'
export type MatchStatus   = 'full_match' | 'phone_only' | 'no_match'
export type JoinStatus    = 'pending' | 'auto_approved' | 'approved' | 'on_hold' | 'rejected'

export interface ChildInfo {
  name: string
  birthDate: string
}

export interface ParentJoinRequest {
  id: string
  operatorId: string
  operatorName: string
  parentId: string
  parentName: string
  parentPhone: string
  relation: ParentRelation
  displayName: string
  children: ChildInfo[]
  status: JoinStatus
  matchStatus: MatchStatus
  matchedStudentIds: string[]
  createdAt: string
  reviewedAt?: string
  reviewedBy?: string
  rejectReason?: string
}

interface MockStudent {
  id: string
  operatorId: string
  name: string
  birthDate: string
  parentPhone: string
}

const MOCK_STUDENTS: MockStudent[] = [
  { id: 'stu-001', operatorId: 'op-002', name: '김민수', birthDate: '20150315', parentPhone: '01012345678' },
  { id: 'stu-002', operatorId: 'op-002', name: '이지수', birthDate: '20170720', parentPhone: '01098765432' },
  { id: 'stu-003', operatorId: 'op-003', name: '박현우', birthDate: '20141105', parentPhone: '01055551234' },
  { id: 'stu-004', operatorId: 'op-004', name: '최서연', birthDate: '20160602', parentPhone: '01077778888' },
  { id: 'stu-005', operatorId: 'op-002', name: '정다은', birthDate: '20180910', parentPhone: '01012345678' },
]

function np(phone: string) { return phone.replace(/\D/g, '') }
function nd(date: string)  { return date.replace(/\D/g, '') }

export function checkAutoApproval(
  operatorId: string,
  parentPhone: string,
  children: ChildInfo[]
): { status: JoinStatus; matchStatus: MatchStatus; matchedStudentIds: string[] } {
  const phoneMatches = MOCK_STUDENTS.filter(
    s => s.operatorId === operatorId && np(s.parentPhone) === np(parentPhone)
  )
  if (phoneMatches.length === 0) {
    return { status: 'pending', matchStatus: 'no_match', matchedStudentIds: [] }
  }
  const allChildMatch = children.length > 0 && children.every(c =>
    phoneMatches.some(s => s.name === c.name.trim() && nd(s.birthDate) === nd(c.birthDate))
  )
  if (allChildMatch) {
    return { status: 'auto_approved', matchStatus: 'full_match', matchedStudentIds: phoneMatches.map(s => s.id) }
  }
  return { status: 'pending', matchStatus: 'phone_only', matchedStudentIds: phoneMatches.map(s => s.id) }
}

const now   = () => new Date().toISOString()
const dAgo  = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString()

const SEED: ParentJoinRequest[] = [
  {
    id: 'pjr-001', operatorId: 'op-002', operatorName: '서울아쿠아클럽',
    parentId: 'usr-p01', parentName: '김영희', parentPhone: '010-1234-5678',
    relation: '모', displayName: '민수엄마',
    children: [{ name: '김민수', birthDate: '2015-03-15' }, { name: '정다은', birthDate: '2018-09-10' }],
    status: 'auto_approved', matchStatus: 'full_match',
    matchedStudentIds: ['stu-001', 'stu-005'],
    createdAt: dAgo(3), reviewedAt: dAgo(3), reviewedBy: '시스템 자동승인',
  },
  {
    id: 'pjr-002', operatorId: 'op-002', operatorName: '서울아쿠아클럽',
    parentId: 'usr-p02', parentName: '이철수', parentPhone: '010-9876-5432',
    relation: '부', displayName: '지수아빠',
    children: [{ name: '이지수', birthDate: '2017-07-20' }],
    status: 'auto_approved', matchStatus: 'full_match',
    matchedStudentIds: ['stu-002'],
    createdAt: dAgo(5), reviewedAt: dAgo(5), reviewedBy: '시스템 자동승인',
  },
  {
    id: 'pjr-003', operatorId: 'op-002', operatorName: '서울아쿠아클럽',
    parentId: 'usr-p03', parentName: '박수진', parentPhone: '010-3333-4444',
    relation: '모', displayName: '예린엄마',
    children: [{ name: '박예린', birthDate: '2016-11-01' }],
    status: 'pending', matchStatus: 'no_match', matchedStudentIds: [],
    createdAt: dAgo(1),
  },
  {
    id: 'pjr-004', operatorId: 'op-002', operatorName: '서울아쿠아클럽',
    parentId: 'usr-p04', parentName: '최민호', parentPhone: '010-5555-6666',
    relation: '부', displayName: '준혁아빠',
    children: [{ name: '최준혁', birthDate: '2015-04-22' }, { name: '최민지', birthDate: '2018-01-08' }],
    status: 'pending', matchStatus: 'no_match', matchedStudentIds: [],
    createdAt: dAgo(2),
  },
  {
    id: 'pjr-005', operatorId: 'op-003', operatorName: '부산수영센터',
    parentId: 'usr-p05', parentName: '강지현', parentPhone: '010-7777-8888',
    relation: '기타', displayName: '할머니',
    children: [{ name: '강지민', birthDate: '2014-09-15' }],
    status: 'on_hold', matchStatus: 'phone_only', matchedStudentIds: ['stu-003'],
    createdAt: dAgo(4),
  },
  {
    id: 'pjr-006', operatorId: 'op-004', operatorName: '인천아쿠아파크',
    parentId: 'usr-p06', parentName: '정미경', parentPhone: '010-2222-9999',
    relation: '모', displayName: '서연엄마',
    children: [{ name: '최서연', birthDate: '2016-06-02' }],
    status: 'rejected', matchStatus: 'no_match', matchedStudentIds: [],
    createdAt: dAgo(7), reviewedAt: dAgo(6), reviewedBy: '관리자', rejectReason: '자녀 정보 불일치',
  },
]

interface ParentJoinState {
  requests: ParentJoinRequest[]
  currentParentRequestId: string | null
  submitRequest: (req: Omit<ParentJoinRequest, 'id' | 'createdAt'>) => ParentJoinRequest
  approveRequest: (id: string, reviewedBy: string) => void
  rejectRequest:  (id: string, reason: string, reviewedBy: string) => void
  holdRequest:    (id: string, reviewedBy: string) => void
  setCurrentParentRequestId: (id: string | null) => void
}

export const useParentJoinStore = create<ParentJoinState>((set) => ({
  requests: SEED,
  currentParentRequestId: null,

  setCurrentParentRequestId(id) {
    set({ currentParentRequestId: id })
  },

  submitRequest(req) {
    const newReq: ParentJoinRequest = { ...req, id: `pjr-${Date.now()}`, createdAt: now() }
    set(s => ({ requests: [newReq, ...s.requests], currentParentRequestId: newReq.id }))
    useInviteRecordStore.getState().linkToJoinRequest(req.parentPhone, req.parentId)
    return newReq
  },

  approveRequest(id, reviewedBy) {
    const req = useParentJoinStore.getState().requests.find(r => r.id === id)
    if (req) useInviteRecordStore.getState().markApproved(req.parentPhone, req.parentId)
    set(s => ({
      requests: s.requests.map(r =>
        r.id === id ? { ...r, status: 'approved', reviewedAt: now(), reviewedBy } : r
      ),
    }))
  },

  rejectRequest(id, reason, reviewedBy) {
    set(s => ({
      requests: s.requests.map(r =>
        r.id === id ? { ...r, status: 'rejected', rejectReason: reason, reviewedAt: now(), reviewedBy } : r
      ),
    }))
  },

  holdRequest(id, reviewedBy) {
    set(s => ({
      requests: s.requests.map(r =>
        r.id === id ? { ...r, status: 'on_hold', reviewedAt: now(), reviewedBy } : r
      ),
    }))
  },
}))
