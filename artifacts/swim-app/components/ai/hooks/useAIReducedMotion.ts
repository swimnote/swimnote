/**
 * useAIReducedMotion — SwimNote AI UI Framework V1.0
 * 접근성: 사용자 기기의 모션 축소 설정 감지
 *
 * 의존: 없음 (React Native AccessibilityInfo)
 * 사용: useAIMotion, AI 컴포넌트들
 */

import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export function useAIReducedMotion(): boolean {
  const [isReduced, setIsReduced] = useState(false);

  useEffect(() => {
    // 초기값 조회
    AccessibilityInfo.isReduceMotionEnabled().then(setIsReduced);

    // 변경 감지
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setIsReduced,
    );
    return () => subscription.remove();
  }, []);

  return isReduced;
}
