/**
 * BaseAIModal — SwimNote AI UI Framework V1.0
 * 모든 AI 기능의 공통 모달 컨테이너
 *
 * 책임:
 *   1. 모달 열기/닫기 + Reanimated 슬라이드/백드롭 애니메이션
 *   2. Swipe Down 닫기 (핸들 영역만, ScrollView 충돌 없음)
 *   3. AIProvider로 Context 주입
 *   4. Content / ActionBar 렌더링 (Feature 코드 없음)
 *
 * 의존: AIContext, AIMotionPreset, AITheme, GestureHandler, Reanimated
 * 사용: 각 Feature 화면에서 <BaseAIModal content={...} actionBar={...} />
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Dimensions,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import {
  Gesture,
  GestureDetector,
} from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { AICreditInfo, AIFeatureType } from './AIContracts';
import { AIProvider } from './AIContext';
import {
  animateModalClose,
  animateModalOpen,
  animateSwipeCancel,
  applySwipeDrag,
} from '../motion/AIMotionPreset';
import { useAIReducedMotion } from '../hooks/useAIReducedMotion';
import { AIThemeColor, AIThemeGesture, AIThemeRadius, AIThemeSpacing, AIThemeZIndex } from '../theme/AITheme';

const SCREEN_HEIGHT = Dimensions.get('window').height;

// ─── Props ────────────────────────────────────────────────────────────────────

interface BaseAIModalProps {
  visible:     boolean;
  onClose:     () => void;
  featureType: AIFeatureType;
  title:       string;
  credit?:     AICreditInfo;
  /** Feature별 본문 컴포넌트 */
  content:     React.ReactNode;
  /** Feature별 ActionBar 컴포넌트 */
  actionBar?:  React.ReactNode;
}

// ─── BaseAIModal ──────────────────────────────────────────────────────────────

export default function BaseAIModal({
  visible,
  onClose,
  featureType,
  title,
  credit,
  content,
  actionBar,
}: BaseAIModalProps) {
  const insets       = useSafeAreaInsets();
  const reducedMotion = useAIReducedMotion();

  // ── 내부 렌더 상태 (애니메이션 완료 후 언마운트) ─────────────────────────
  const [rendered, setRendered] = useState(false);

  // ── Shared Values ─────────────────────────────────────────────────────────
  const translateY    = useSharedValue(SCREEN_HEIGHT);
  const backdropOpacity = useSharedValue(0);

  // ── 외부 visible 변경 감지 ────────────────────────────────────────────────
  useEffect(() => {
    if (visible && !rendered) {
      setRendered(true);
    }
    if (!visible && rendered) {
      // 외부에서 직접 visible=false로 바꾼 경우 (COMPLETE 등)
      doClose();
    }
  }, [visible]);

  // ── 모달 진입 애니메이션 ──────────────────────────────────────────────────
  useEffect(() => {
    if (!rendered) return;
    translateY.value = SCREEN_HEIGHT;
    backdropOpacity.value = 0;
    animateModalOpen(translateY, backdropOpacity, reducedMotion);
  }, [rendered]);

  // ── 닫기 애니메이션 → 실제 onClose 호출 ──────────────────────────────────
  const doClose = useCallback(() => {
    cancelAnimation(translateY);
    cancelAnimation(backdropOpacity);
    animateModalClose(translateY, backdropOpacity, SCREEN_HEIGHT, reducedMotion, () => {
      setRendered(false);
      onClose();
    });
  }, [reducedMotion, onClose]);

  // ── Swipe Down 제스처 (핸들 영역만 — ScrollView 충돌 없음) ───────────────
  const panGesture = Gesture.Pan()
    .activeOffsetY(8)          // 아래 방향으로 8px 이상 이동 시 활성
    .failOffsetY(-5)           // 위 방향이면 즉시 실패 (스크롤 우선)
    .onUpdate((e) => {
      applySwipeDrag(translateY, backdropOpacity, e.translationY);
    })
    .onEnd((e) => {
      const dismissed =
        e.translationY > AIThemeGesture.swipeDismissDistance ||
        e.velocityY    > AIThemeGesture.swipeDismissVelocity;
      if (dismissed) {
        animateModalClose(translateY, backdropOpacity, SCREEN_HEIGHT, reducedMotion, () => {
          setRendered(false);
          // runOnJS 내부에서 호출됐으므로 JS 스레드
          onClose();
        });
      } else {
        animateSwipeCancel(translateY, backdropOpacity);
      }
    });

  // ── Animated Style ────────────────────────────────────────────────────────
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }));

  if (!rendered) return null;

  return (
    <Modal
      visible={rendered}
      animationType="none"
      transparent
      statusBarTranslucent
      onRequestClose={doClose}
    >
      {/* ── 백드롭 ── */}
      <Animated.View style={[styles.backdrop, backdropStyle]} pointerEvents="none" />
      <Pressable style={StyleSheet.absoluteFill} onPress={doClose} />

      {/* ── 모달 시트 ── */}
      <Animated.View style={[styles.sheet, sheetStyle]}>
        <AIProvider featureType={featureType} credit={credit}>
          <KeyboardAvoidingView
            style={styles.flex}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={0}
          >
            {/* 핸들 + 타이틀 — 여기에만 Swipe 제스처 적용 */}
            <GestureDetector gesture={panGesture}>
              <View style={styles.header}>
                <View style={styles.handle} />
                <Text style={styles.title}>{title}</Text>
              </View>
            </GestureDetector>

            {/* Content 영역 — Feature별 컴포넌트 */}
            <View style={styles.content}>
              {content}
            </View>

            {/* ActionBar — Feature별 */}
            {actionBar && (
              <View
                style={[
                  styles.actionBar,
                  { paddingBottom: insets.bottom + AIThemeSpacing.element },
                ]}
              >
                {actionBar}
              </View>
            )}
          </KeyboardAvoidingView>
        </AIProvider>
      </Animated.View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
    zIndex: AIThemeZIndex.backdrop,
  },
  sheet: {
    position:   'absolute',
    left:        0,
    right:       0,
    bottom:      0,
    top:         0,                      // 풀스크린
    backgroundColor:          AIThemeColor.background,
    borderTopLeftRadius:      AIThemeRadius.modal,
    borderTopRightRadius:     AIThemeRadius.modal,
    zIndex:                   AIThemeZIndex.modal,
    overflow:                 'hidden',
  },
  header: {
    paddingTop:        AIThemeSpacing.element,
    paddingHorizontal: AIThemeSpacing.section,
    paddingBottom:     AIThemeSpacing.tight,
  },
  handle: {
    width:           40,
    height:           4,
    borderRadius:     2,
    backgroundColor: AIThemeColor.border,
    alignSelf:       'center',
    marginBottom:    AIThemeSpacing.element,
  },
  title: {
    fontSize:   17,
    fontWeight: '600',
    color:      AIThemeColor.text,
    textAlign:  'center',
  },
  content: {
    flex: 1,
    paddingHorizontal: AIThemeSpacing.section,
  },
  actionBar: {
    paddingHorizontal: AIThemeSpacing.section,
    paddingTop:        AIThemeSpacing.element,
  },
});
