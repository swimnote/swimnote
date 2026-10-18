/**
 * ai-model-config.ts — AI 모델명 단일 제어점 (AI01-02)
 *
 * 원칙:
 *   - 현재 값은 Production 동작 유지용. 최적 모델이라고 가정하지 않음.
 *   - 각 AI WP에서 Quality / Latency / Cost 비교 후 변경.
 *   - 저비용/고속 후보 우선. 품질 부족할 때만 상위 모델 승격.
 *   - 기능별로 분리 유지. DEFAULT_MODEL 단일값 사용 금지.
 */

export const AI_MODEL = {
  /** OFFICE 제한 필드/열 해석: 시험 비용과 모델 식별을 고정. 기존 기능 모델은 변경하지 않음. */
  OFFICE_SIMPLE: 'gpt-4o-mini-2024-07-18',
  /** 명시적 복합 문서 요청 + 별도 실행 승인 시에만 사용. */
  OFFICE_COMPLEX: 'gpt-4.1-2025-04-14',
  /** 교사 일지 생성 */
  DIARY:   'gpt-4o-mini',
  /** 학부모 지원 AI 응답 */
  SUPPORT: 'gpt-4o-mini',
  /** 성장 리포트 / 스토리 생성 */
  STORY:   'gpt-4o-mini',
  /** Whisper STT */
  STT:     'whisper-1',
} as const;

export type AiModelKey = keyof typeof AI_MODEL;
