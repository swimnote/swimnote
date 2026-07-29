/**
 * AIVoiceWaveform — SwimNote AI UI Framework V1.0
 * RECORDING State 전용 음성 파형 시각화 컴포넌트
 *
 * - 실제 녹음 데이터 없이 가상 amplitude로 동작 (Phase 2)
 * - Phase 3에서 expo-av metering 값으로 amplitudes prop 교체 예정
 * - Reanimated 4 UI Thread 애니메이션
 * - RECORDING 상태에서만 실행, State 종료 시 정리
 * - SVG 미사용 (Skia 설치 금지), Animated View 막대 방식
 *
 * 의존: AITheme, react-native-reanimated
 * 사용: AIInputArea
 *
 * @param amplitudes  실제 metering 값 배열 (0..1). 없으면 자동 애니메이션.
 * @param active      true일 때만 애니메이션 실행 (state === 'RECORDING')
 * @param reducedMotion true이면 정적 막대 표시
 */

import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { AIThemeColor } from '../theme/AITheme';

// ─── 상수 ─────────────────────────────────────────────────────────────────────

const BAR_COUNT    = 16;
const BAR_WIDTH    = 4;
const BAR_GAP      = 4;
const BAR_MIN_H    = 4;
const BAR_MAX_H    = 44;
const CYCLE_MS     = 1100; // 파형 1 사이클 시간

// ─── WaveBar — 독립 컴포넌트 (useAnimatedStyle를 안전하게 호출) ───────────────

interface WaveBarProps {
  index:        number;
  phase:        SharedValue<number>;   // 0 ~ 2π 반복
  amplitude?:   number;                          // 0..1 실측값 (없으면 자동)
  active:       boolean;
  reducedMotion:boolean;
}

function WaveBar({ index, phase, amplitude, active, reducedMotion }: WaveBarProps) {
  const animatedStyle = useAnimatedStyle(() => {
    if (!active || reducedMotion) {
      return { height: BAR_MIN_H + (BAR_MAX_H - BAR_MIN_H) * 0.25 };
    }
    // 실측값 있으면 사용, 없으면 사인파
    const normalized =
      amplitude !== undefined
        ? Math.min(1, Math.max(0, amplitude))
        : Math.abs(Math.sin(phase.value + index * (Math.PI / (BAR_COUNT / 2))));
    return { height: BAR_MIN_H + normalized * (BAR_MAX_H - BAR_MIN_H) };
  });

  return <Animated.View style={[styles.bar, animatedStyle]} />;
}

// ─── AIVoiceWaveform ──────────────────────────────────────────────────────────

interface AIVoiceWaveformProps {
  amplitudes?:   number[];   // 0..1 배열 (Phase 3에서 expo-av metering으로 교체)
  active:        boolean;
  reducedMotion?:boolean;
}

export default function AIVoiceWaveform({
  amplitudes,
  active,
  reducedMotion = false,
}: AIVoiceWaveformProps) {
  const phase = useSharedValue(0);

  useEffect(() => {
    if (active && !reducedMotion) {
      phase.value = 0;
      phase.value = withRepeat(
        withTiming(Math.PI * 2, { duration: CYCLE_MS, easing: Easing.linear }),
        -1,
        false,
      );
    } else {
      cancelAnimation(phase);
      phase.value = 0;
    }
    return () => cancelAnimation(phase);
  }, [active, reducedMotion]);

  const indices = Array.from({ length: BAR_COUNT }, (_, i) => i);

  return (
    <View style={styles.container}>
      {indices.map((i) => (
        <WaveBar
          key={i}
          index={i}
          phase={phase}
          amplitude={amplitudes?.[i]}
          active={active}
          reducedMotion={reducedMotion}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'center',
    gap:             BAR_GAP,
    height:          BAR_MAX_H + 8,
  },
  bar: {
    width:        BAR_WIDTH,
    borderRadius: BAR_WIDTH / 2,
    backgroundColor: AIThemeColor.primary,
  },
});
