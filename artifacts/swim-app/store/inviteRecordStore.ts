/**
 * store/inviteRecordStore.ts
 * 초대 안내 기록 — 관리자 전용
 * 플랫폼은 문자 전송 성공/실패를 추적하지 않음
 * 기록에는 "문자 앱 호출 시각"만 저장
 */
import { create } from 'zustand'

export type InviteTargetType = 'guardian' | 'teacher'

export interface InviteRecord {
  id: string
  operatorId: string
  operatorName: string
  senderName: string
  senderRole: 'operator' | 'teacher'
  targetType: InviteTargetType
  targetName: string
  targetPhone: string
  studentName?: string
  messageBody: string
  callCount: number
  createdAt: string
  lastReSentAt?: string
}

// ── 기본 앱 링크 ──────────────────────────────────────────────────
export const DEFAULT_IOS_LINK     = 'https://apps.apple.com/app/swimnote/id0000000000'
export const DEFAULT_ANDROID_LINK = 'https://play.google.com/store/apps/details?id=com.swimnote'

// ── 선생님 고정 템플릿 (수정 불가) ──────────────────────────────────
export const TEACHER_TEMPLATE_FIXED =
  '{수영장이름} 수영장에서 선생님으로 초대했습니다. 링크를 확인해주세요.\n{iOS링크}\n{Android링크}'

// ── 학부모 기본 템플릿 ────────────────────────────────────────────
export const DEFAULT_PARENT_TEMPLATE =
  '{수영장이름}에서 스윔노트를 이용할 수 있도록 {학생이름} 학부모님을 초대합니다.\n앱을 설치한 뒤 링크를 확인해주세요.\n{iOS링크}\n{Android링크}'

// ── 변수 치환 헬퍼 ────────────────────────────────────────────────
export function resolveTemplate(
  template: string,
  vars: {
    poolName: string
    studentName?: string
    iosLink: string
    androidLink: string
  }
): string {
  return template
    .replace(/\{수영장이름\}/g, vars.poolName)
    .replace(/\{학생이름\}/g, vars.studentName ?? '')
    .replace(/\{iOS링크\}/g, vars.iosLink)
    .replace(/\{Android링크\}/g, vars.androidLink)
}

// ── buildGuardianMessage: 저장된 템플릿 기반 (역호환) ─────────────
export function buildGuardianMessage(
  operatorName: string,
  studentName: string,
  template = DEFAULT_PARENT_TEMPLATE,
  iosLink = DEFAULT_IOS_LINK,
  androidLink = DEFAULT_ANDROID_LINK
): string {
  return resolveTemplate(template, { poolName: operatorName, studentName, iosLink, androidLink })
}

// ── buildTeacherMessage: 고정 템플릿 ─────────────────────────────
export function buildTeacherMessage(
  operatorName: string,
  _phone: string,
  iosLink = DEFAULT_IOS_LINK,
  androidLink = DEFAULT_ANDROID_LINK
): string {
  return resolveTemplate(TEACHER_TEMPLATE_FIXED, { poolName: operatorName, iosLink, androidLink })
}

const dAgo = (d: number, h = 0) =>
  new Date(Date.now() - d * 86_400_000 - h * 3_600_000).toISOString()

const SEED: InviteRecord[] = [
  {
    id: 'inv-001', operatorId: 'op-002', operatorName: '서울아쿠아클럽',
    senderName: '관리자', senderRole: 'operator',
    targetType: 'guardian', targetName: '김민수 보호자', targetPhone: '010-1234-5678',
    studentName: '김민수',
    messageBody: buildGuardianMessage('서울아쿠아클럽', '김민수'),
    callCount: 2, createdAt: dAgo(4), lastReSentAt: dAgo(2),
  },
  {
    id: 'inv-002', operatorId: 'op-002', operatorName: '서울아쿠아클럽',
    senderName: '관리자', senderRole: 'operator',
    targetType: 'guardian', targetName: '이지수 보호자', targetPhone: '010-9876-5432',
    studentName: '이지수',
    messageBody: buildGuardianMessage('서울아쿠아클럽', '이지수'),
    callCount: 1, createdAt: dAgo(6),
  },
  {
    id: 'inv-003', operatorId: 'op-002', operatorName: '서울아쿠아클럽',
    senderName: '박선생님', senderRole: 'teacher',
    targetType: 'guardian', targetName: '박예린 보호자', targetPhone: '010-3333-4444',
    studentName: '박예린',
    messageBody: buildGuardianMessage('서울아쿠아클럽', '박예린'),
    callCount: 1, createdAt: dAgo(2),
  },
  {
    id: 'inv-004', operatorId: 'op-002', operatorName: '서울아쿠아클럽',
    senderName: '관리자', senderRole: 'operator',
    targetType: 'guardian', targetName: '최준혁 보호자', targetPhone: '010-5555-6666',
    studentName: '최준혁',
    messageBody: buildGuardianMessage('서울아쿠아클럽', '최준혁'),
    callCount: 1, createdAt: dAgo(1),
  },
  {
    id: 'inv-005', operatorId: 'op-002', operatorName: '서울아쿠아클럽',
    senderName: '관리자', senderRole: 'operator',
    targetType: 'teacher', targetName: '신지영', targetPhone: '010-7777-8888',
    messageBody: buildTeacherMessage('서울아쿠아클럽', '010-7777-8888'),
    callCount: 3, createdAt: dAgo(5), lastReSentAt: dAgo(1),
  },
  {
    id: 'inv-006', operatorId: 'op-001', operatorName: '송파수영장',
    senderName: '원장님', senderRole: 'operator',
    targetType: 'guardian', targetName: '홍길동 보호자', targetPhone: '010-2222-3333',
    studentName: '홍민준',
    messageBody: buildGuardianMessage('송파수영장', '홍민준'),
    callCount: 1, createdAt: dAgo(3),
  },
]

interface InviteRecordState {
  records: InviteRecord[]

  // ── 설정 ────────────────────────────────────────────────────────
  parentTemplateBody: string
  iosLink: string
  androidLink: string

  // ── 설정 actions ─────────────────────────────────────────────────
  setParentTemplate: (body: string) => void
  resetParentTemplate: () => void
  setAppLinks: (ios: string, android: string) => void

  // ── 기록 actions ─────────────────────────────────────────────────
  addRecord: (rec: Omit<InviteRecord, 'id' | 'createdAt' | 'callCount'>) => InviteRecord
  reNotify: (id: string) => void
}

export const useInviteRecordStore = create<InviteRecordState>((set, get) => ({
  records: SEED,

  parentTemplateBody: DEFAULT_PARENT_TEMPLATE,
  iosLink: DEFAULT_IOS_LINK,
  androidLink: DEFAULT_ANDROID_LINK,

  setParentTemplate(body) {
    set({ parentTemplateBody: body })
  },

  resetParentTemplate() {
    set({ parentTemplateBody: DEFAULT_PARENT_TEMPLATE })
  },

  setAppLinks(ios, android) {
    set({ iosLink: ios, androidLink: android })
  },

  addRecord(rec) {
    const newRec: InviteRecord = {
      ...rec,
      id: `inv-${Date.now()}`,
      createdAt: new Date().toISOString(),
      callCount: 1,
    }
    set(s => ({ records: [newRec, ...s.records] }))
    return newRec
  },

  reNotify(id) {
    set(s => ({
      records: s.records.map(r =>
        r.id === id
          ? { ...r, callCount: r.callCount + 1, lastReSentAt: new Date().toISOString() }
          : r
      ),
    }))
  },
}))
