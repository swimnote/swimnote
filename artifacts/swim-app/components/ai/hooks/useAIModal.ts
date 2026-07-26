/**
 * useAIModal — SwimNote AI UI Framework V1.0
 * 모달 열기/닫기 및 크레딧 확인 로직
 *
 * 의존: AIContext, useAIStateMachine
 * 사용: 모달을 띄우는 화면 컴포넌트
 */

import { useCallback, useState } from 'react';
import type { AICreditInfo, AIFeatureType } from '../core/AIContracts';

interface UseAIModalOptions {
  featureType: AIFeatureType;
  /** TODO: 실제 크레딧 API 연결 */
  creditRequired?: number;
}

export function useAIModal({ featureType, creditRequired = 1 }: UseAIModalOptions) {
  const [visible, setVisible] = useState(false);
  const [credit, setCredit] = useState<AICreditInfo | null>(null);

  const open = useCallback(async () => {
    // TODO: 크레딧 잔여 조회 API 호출
    // const info = await fetchCredit();
    // if (!info.sufficient) { showCreditAlert(); return; }
    // setCredit(info);
    setCredit({ available: 999, required: creditRequired, sufficient: true });
    setVisible(true);
  }, [creditRequired]);

  const close = useCallback(() => {
    setVisible(false);
    setCredit(null);
  }, []);

  return {
    visible,
    credit,
    featureType,
    open,
    close,
  };
}
