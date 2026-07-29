/**
 * AIContracts — SwimNote AI UI Framework V1.0
 * 모든 타입, 인터페이스, 상수 계약 정의
 *
 * 의존: 없음 (leaf node)
 * 사용: Framework 전체
 */

// ─── State Machine ──────────────────────────────────────────────────────────

export type AIState =
  | 'CLOSED'
  | 'OPENING'
  | 'PERMISSION'
  | 'INPUT'
  | 'RECORDING'
  | 'UPLOADING'
  | 'PROCESSING'
  | 'RESULT'
  | 'EDITING'
  | 'COMPLETE'
  | 'ERROR';

export type AIErrorOrigin =
  | 'PERMISSION'
  | 'NETWORK'
  | 'CREDIT'
  | 'TIMEOUT'
  | 'UNKNOWN';

export interface AIErrorInfo {
  origin: AIErrorOrigin;
  message: string;
  /** 재시도 시 복귀할 State. null이면 CLOSED */
  retryTarget: AIState | null;
}

// ─── Feature 타입 ────────────────────────────────────────────────────────────

export type AIFeatureType =
  | 'diary'
  | 'video'
  | 'photo'
  | 'consult'
  | 'qa';

/** 각 Feature가 사용하는 State 목록 선언 */
export type AIFeatureStates = Partial<Record<AIState, boolean>>;

// ─── Content 컴포넌트 계약 ────────────────────────────────────────────────────

export interface AIContentProps {
  state: AIState;
  onStateChange: (next: AIState) => void;
  onError: (error: AIErrorInfo) => void;
  onComplete: () => void;
}

// ─── ActionBar 계약 ──────────────────────────────────────────────────────────

export interface AIActionBarProps {
  state: AIState;
  onPrimary: () => void;
  onSecondary?: () => void;
  primaryLabel?: string;
  secondaryLabel?: string;
  primaryDisabled?: boolean;
}

// ─── Credit 계약 ─────────────────────────────────────────────────────────────

export interface AICreditInfo {
  available: number;
  required: number;
  sufficient: boolean;
}

// ─── Permission 계약 ─────────────────────────────────────────────────────────

export type AIPermissionType = 'microphone' | 'camera' | 'mediaLibrary';

export interface AIPermissionRequest {
  types: AIPermissionType[];
}
