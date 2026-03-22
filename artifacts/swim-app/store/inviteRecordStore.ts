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
  targetName: string        // 대상 이름
  targetPhone: string       // 대상 휴대폰 번호
  studentName?: string      // 학부모 안내 시 자녀 이름
  messageBody: string       // 문자 본문 (재안내 시 재사용)
  callCount: number         // 호출 횟수
  createdAt: string         // 안내 생성 시각
  lastReSentAt?: string     // 마지막 재안내 시각
}

// ── 공용 앱 링크 (수영장별 아님) ────────────────────────────────
const APP_IOS     = 'https://apps.apple.com/app/swimnote/id0000000000'
const APP_ANDROID = 'https://play.google.com/store/apps/details?id=com.swimnote'

// ── 학부모 초대 문자 템플릿 ───────────────────────────────────────
export function buildGuardianMessage(operatorName: string, studentName: string): string {
  return `[스윔노트] 안녕하세요.
${operatorName}에서 초대드립니다.

📱 스윔노트 설치:
• iPhone: ${APP_IOS}
• Android: ${APP_ANDROID}

앱 설치 후 수영장 검색에서 "${operatorName}"을 찾아 가입해 주세요.

✅ 학부모 승인 기준 (수영장 등록 정보와 동일하게 입력):
• 자녀 이름: ${studentName}
• 자녀 생년월일
• 보호자 휴대폰 번호`
}

// ── 선생님 초대 문자 템플릿 ───────────────────────────────────────
export function buildTeacherMessage(operatorName: string, phone: string): string {
  return `[스윔노트] 안녕하세요.
${operatorName} 선생님으로 등록하셨습니다.

📱 스윔노트 설치:
• iPhone: ${APP_IOS}
• Android: ${APP_ANDROID}

가입 시 이 번호(${phone})로 등록하시고,
앱에서 "${operatorName}"을 검색하여 가입해 주세요.

✅ 가입 완료 후 수영장 관리자 승인 또는 자동 연결됩니다.`
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
  addRecord: (rec: Omit<InviteRecord, 'id' | 'createdAt' | 'callCount'>) => InviteRecord
  reNotify: (id: string) => void
}

export const useInviteRecordStore = create<InviteRecordState>((set) => ({
  records: SEED,

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
