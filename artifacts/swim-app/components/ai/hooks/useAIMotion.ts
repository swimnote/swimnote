/**
 * useAIMotion — SwimNote AI UI Framework V1.0
 * 현재 State에 맞는 Motion 프리셋 제공
 *
 * 의존: AIContext, AIMotionPreset, AIPersonality
 * 사용: AI 컴포넌트들
 *
 * TODO: Reanimated 4 SharedValue 실제 연결
 */

import { useAIContext } from '../core/AIContext';
import {
  buttonMotion,
  cardMotion,
  feedbackMotion,
  loadingMotion,
  modalMotion,
  sectionMotion,
} from '../motion/AIMotionPreset';

export function useAIMotion() {
  const { state } = useAIContext();

  return {
    // 현재 상태 기반으로 어떤 모션을 써야 하는지 제공
    modal:    modalMotion,
    section:  sectionMotion,
    card:     cardMotion,
    button:   buttonMotion,
    loading:  loadingMotion,
    feedback: feedbackMotion,

    // TODO: Reanimated SharedValue 연결
    // modalScale:   useSharedValue(0.92),
    // inputHeight:  useSharedValue(INPUT_DEFAULT_HEIGHT),
    // resultHeight: useSharedValue(0),
    // backdropOpacity: useSharedValue(0),

    /** 현재 State에서 입력창이 보여야 하는가 */
    showInput:  ['INPUT', 'RECORDING', 'EDITING'].includes(state),
    /** 현재 State에서 결과창이 보여야 하는가 */
    showResult: ['RESULT', 'EDITING', 'COMPLETE'].includes(state),
    /** 현재 State에서 로딩이 보여야 하는가 */
    showLoading: ['PROCESSING', 'UPLOADING'].includes(state),
  };
}
