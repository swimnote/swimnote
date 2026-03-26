import { create } from 'zustand'

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
  rejectReason?: string | null
  rejectedAt?: string
  rejectedBy?: string
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

const SEED: ParentJoinRequest[] = []

interface ParentJoinState {
  requests: ParentJoinRequest[]
  currentParentRequestId: string | null
  submitRequest: (req: Omit<ParentJoinRequest, 'id' | 'createdAt'>) => ParentJoinRequest
  approveRequest:   (id: string, reviewedBy: string) => void
  rejectRequest:    (id: string, reason: string | null, reviewedBy: string) => void
  reApproveRequest: (id: string, reviewedBy: string) => void
  holdRequest:      (id: string, reviewedBy: string) => void
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
    return newReq
  },

  approveRequest(id, reviewedBy) {
    set(s => ({
      requests: s.requests.map(r =>
        r.id === id ? { ...r, status: 'approved', reviewedAt: now(), reviewedBy } : r
      ),
    }))
  },

  rejectRequest(id, reason, reviewedBy) {
    const ts = now()
    set(s => ({
      requests: s.requests.map(r =>
        r.id === id
          ? { ...r, status: 'rejected', rejectReason: reason ?? null, reviewedAt: ts, reviewedBy, rejectedAt: ts, rejectedBy: reviewedBy }
          : r
      ),
    }))
  },

  reApproveRequest(id, reviewedBy) {
    set(s => ({
      requests: s.requests.map(r =>
        r.id === id
          ? { ...r, status: 'approved', reviewedAt: now(), reviewedBy, rejectedAt: undefined, rejectedBy: undefined, rejectReason: null }
          : r
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
