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

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
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
  GestureHandlerRootView,
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
  visible:      boolean;
  onClose:      () => void;
  featureType:  AIFeatureType;
  title:        string;
  credit?:      AICreditInfo;
  /** Feature별 본문 컴포넌트 */
  content:      React.ReactNode;
  /** Feature별 ActionBar 컴포넌트 */
  actionBar?:   React.ReactNode;
  /**
   * true일 때 백드롭 탭·스와이프 dismiss를 차단합니다.
   * [원칙 1·5] PROCESSING / RECORDING / RESULT / EDITING 중에는
   * 작업공간이 사라지지 않도록 Feature 컴포넌트가 제어합니다.
   */
  lockDismiss?: boolean;
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
  lockDismiss = false,
}: BaseAIModalProps) {
  const insets       = useSafeAreaInsets();
  const reducedMotion = useAIReducedMotion();

  // ── 디버그: 인스턴스 고유 ID ─────────────────────────────────────────────
  const instanceId = useId();

  // ── 마운트 / 언마운트 로그 ───────────────────────────────────────────────
  useEffect(() => {
    console.log(`[UI-LAYER-MOUNT] BaseAIModal id=${instanceId} title="${title}" visible=${visible}`);
    return () => {
      console.log(`[UI-LAYER-UNMOUNT] BaseAIModal id=${instanceId} title="${title}"`);
    };
  }, []);

  // ── 내부 렌더 상태 (애니메이션 완료 후 언마운트) ─────────────────────────
  const [rendered, setRendered] = useState(false);

  // rendered 변경 추적
  useEffect(() => {
    console.log(`[UI-LAYER-VISIBLE] BaseAIModal id=${instanceId} rendered=${rendered} (visible prop=${visible})`);
  }, [rendered]);

  // ── Shared Values ─────────────────────────────────────────────────────────
  const translateY    = useSharedValue(SCREEN_HEIGHT);
  const backdropOpacity = useSharedValue(0);

  // ── 외부 visible 변경 감지 ────────────────────────────────────────────────
  useEffect(() => {
    if (visible && !rendered) {
      console.log('[MODAL-EFFECT] visible=true → setRendered(true)');
      setRendered(true);
    }
    if (!visible && rendered) {
      console.log('[MODAL-EFFECT] visible=false → doClose() 호출');
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
    // ── 비교 실험: animateModalClose 우회 — 즉시 닫기 ──────────────────────
    // 목적: 모달 슬라이드 닫기 애니메이션이 크래시 원인인지 격리
    // 복원: 실험 완료 후 아래 블록 제거, 원래 코드 복원
    console.log('[MODAL-CLOSE-CALL] doClose() 진입');
    console.log('[MODAL-BYPASS-1] 즉시 닫기 시작');
    cancelAnimation(translateY);
    cancelAnimation(backdropOpacity);
    console.log('[MODAL-BYPASS-2] setRendered false 호출');
    setRendered(false);
    onClose();
    console.log('[MODAL-BYPASS-3] onClose 호출 완료');
  }, [onClose]);

  // ── Swipe Down 제스처 (핸들 영역만 — ScrollView 충돌 없음) ───────────────
  // [원칙 1·5] lockDismiss=true 구간에서는 스와이프 dismiss 차단
  const panGesture = Gesture.Pan()
    .activeOffsetY(8)          // 아래 방향으로 8px 이상 이동 시 활성
    .failOffsetY(-5)           // 위 방향이면 즉시 실패 (스크롤 우선)
    .onUpdate((e) => {
      if (lockDismiss) return; // 작업 중 스와이프 드래그 자체를 무시
      applySwipeDrag(translateY, backdropOpacity, e.translationY);
    })
    .onEnd((e) => {
      if (lockDismiss) {
        console.log('[BACK-EVENT] panGesture 스와이프 — lockDismiss=true, dismiss 차단');
        animateSwipeCancel(translateY, backdropOpacity);
        return;
      }
      const dismissed =
        e.translationY > AIThemeGesture.swipeDismissDistance ||
        e.velocityY    > AIThemeGesture.swipeDismissVelocity;
      if (dismissed) {
        console.log('[BACK-EVENT] panGesture 스와이프 dismiss — translationY:', e.translationY, 'velocityY:', e.velocityY);
        animateModalClose(translateY, backdropOpacity, SCREEN_HEIGHT, reducedMotion, () => {
          setRendered(false);
          // runOnJS 내부에서 호출됐으므로 JS 스레드
          console.log('[MODAL-CLOSE-CALL] panGesture animateModalClose 콜백');
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
      onRequestClose={() => {
          console.log('[BACK-EVENT] onRequestClose 수신 (iOS 하드웨어 back / 시스템 닫기)');
          doClose();
        }}
    >
      {/*
       * GestureHandlerRootView는 반드시 Modal 내부에도 있어야 합니다.
       * React Native Modal은 앱 메인 트리와 분리된 별도 native root에서
       * 렌더링되므로, _layout.tsx의 GestureHandlerRootView가 적용되지 않습니다.
       * GestureDetector(panGesture)가 이 트리 안에 있으므로 여기서 감싸야 합니다.
       */}
      <GestureHandlerRootView style={StyleSheet.absoluteFill}>
        {/* ── 백드롭 ── */}
        <Animated.View style={[styles.backdrop, backdropStyle]} pointerEvents="none" />
        {/* [원칙 1·5] lockDismiss=true 구간에서는 백드롭 탭으로 닫기 차단 */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => {
            if (lockDismiss) {
              console.log('[BACK-EVENT] 백드롭 탭 — lockDismiss=true, dismiss 차단');
              return;
            }
            console.log('[BACK-EVENT] 백드롭 탭 — doClose() 호출');
            doClose();
          }}
        />

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
      </GestureHandlerRootView>
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
  debugBanner: {
    fontSize:        10,
    fontFamily:      'monospace',
    color:           '#FF0000',
    backgroundColor: '#FFEEEE',
    textAlign:       'center',
    paddingVertical: 2,
    marginTop:       4,
    borderRadius:    4,
  },
});
