/**
 * AIProgressMessages — SwimNote AI UI Framework V2.0
 * 로딩 진행 단계별 메시지 설정
 *
 * 모달 컴포넌트 내부에 하드코딩하지 말고 이 파일에서 관리하십시오.
 * 향후 일지 AI 외에도 학부모 AI / 성장리포트 / 영상분석에서 동일 구조를 사용합니다.
 *
 * 의존: 없음 (leaf node)
 * 사용: DiaryAIModalV2, 향후 ParentAIModal, GrowthReportModal 등
 */

// ─── 공통 진행 단계 타입 ──────────────────────────────────────────────────────

export type AIProgressPhase =
  | 'TRANSCRIBING'
  | 'SEARCHING'
  | 'GENERATING';

export interface AIProgressMessage {
  /** 사용자에게 표시할 주 메시지 */
  message: string;
  /** 보조 설명 (선택) */
  subtext?: string;
}

// ─── 일지 AI 전용 메시지 ──────────────────────────────────────────────────────

export const DIARY_AI_PROGRESS: Record<AIProgressPhase, AIProgressMessage> = {
  TRANSCRIBING: {
    message: '음성을 변환하고 있습니다...',
  },
  SEARCHING: {
    message: '관련 정보를 검색하고 있습니다...',
    subtext: '수업 내용과 커리큘럼을 확인합니다',
  },
  GENERATING: {
    message: '일지를 작성하고 있습니다...',
    subtext: 'AI가 개인화된 일지를 생성합니다',
  },
};
