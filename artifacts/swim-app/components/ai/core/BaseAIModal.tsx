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
  runOnJS,
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
    if (__DEV__) console.log(`[UI-LAYER-MOUNT] BaseAIModal id=${instanceId} title="${title}" visible=${visible}`);
    return () => {
      if (__DEV__) console.log(`[UI-LAYER-UNMOUNT] BaseAIModal id=${instanceId} title="${title}"`);
    };
  }, []);

  // ── 2-phase 닫기 상태 ────────────────────────────────────────────────────
  //
  // rendered     : JS 트리 존재 여부 — false 시 if(!rendered) return null
  // nativeVisible: RN Modal의 visible prop — iOS 네이티브 UIWindow 제어
  //
  // [문제] rendered만 사용하면 두 가지 버그가 동시에 발생:
  //   • if (!rendered) return null  → Modal JS 트리 제거 → 네이티브 UIWindow
  //     정리가 느려 탭바 터치 차단 (iOS 투명 Modal 버그)
  //   • {rendered && <Modal>} 유지 → cancel 버튼 동작 불가
  //
  // [해결] 2단계 분리:
  //   Phase 1 — doClose() → nativeVisible=false
  //             React 한 사이클: <Modal visible={false}> 상태로 렌더
  //             → iOS가 네이티브 UIWindow를 먼저 제거
  //   Phase 2 — useEffect([nativeVisible]) → setRendered(false) + onClose()
  //             if (!rendered) return null → JS 트리에서 Modal 완전 제거
  //             이 시점엔 네이티브 UIWindow가 이미 사라진 상태이므로 탭바 정상

  const [rendered,      setRendered]      = useState(false);
  const [nativeVisible, setNativeVisible] = useState(false);

  // rendered 변경 추적
  useEffect(() => {
    if (__DEV__) console.log(`[UI-LAYER-VISIBLE] BaseAIModal id=${instanceId} rendered=${rendered} nativeVisible=${nativeVisible} (visible prop=${visible})`);
  }, [rendered]);

  // ── Shared Values ─────────────────────────────────────────────────────────
  const translateY      = useSharedValue(SCREEN_HEIGHT);
  const backdropOpacity = useSharedValue(0);

  // ── 외부 visible 변경 감지 ────────────────────────────────────────────────
  useEffect(() => {
    if (visible && !rendered) {
      if (__DEV__) console.log('[MODAL-EFFECT] visible=true → setRendered(true) + setNativeVisible(true)');
      setRendered(true);
      setNativeVisible(true);
    }
    if (!visible && rendered) {
      if (__DEV__) console.log('[MODAL-EFFECT] visible=false → doClose() 호출');
      doClose();
    }
  }, [visible]);

  // ── Phase 2: nativeVisible=false 후 JS 트리 제거 ─────────────────────────
  // doClose()가 nativeVisible=false만 설정한 뒤 이 Effect가 다음 사이클에서
  // rendered=false + onClose()를 실행한다.
  // onClose = () => setVisible(false) (setVisible은 stable state setter)
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  useEffect(() => {
    if (!nativeVisible && rendered) {
      if (__DEV__) console.log('[MODAL-EFFECT] nativeVisible=false → setRendered(false) + onClose()');
      setRendered(false);
      onCloseRef.current();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nativeVisible]);

  // ── 모달 진입 애니메이션 ──────────────────────────────────────────────────
  useEffect(() => {
    if (!rendered) return;
    translateY.value = SCREEN_HEIGHT;
    backdropOpacity.value = 0;
    animateModalOpen(translateY, backdropOpacity, reducedMotion);
  }, [rendered]);

  // ── 닫기 — Phase 1: 네이티브 오버레이 먼저 제거 ──────────────────────────
  // animateModalClose(withTiming 콜백)는 실기기 Hermes에서 크래시를 유발함.
  // Phase 1에서 nativeVisible=false만 설정하면 RN이 네이티브 UIWindow를 제거.
  // Phase 2(useEffect[nativeVisible])에서 rendered=false + onClose() 처리.
  const doClose = useCallback(() => {
    cancelAnimation(translateY);
    cancelAnimation(backdropOpacity);
    backdropOpacity.value = 0;   // 백드롭 즉시 투명으로
    setNativeVisible(false);      // Phase 1 — 네이티브 오버레이 제거 요청
    // Phase 2는 useEffect([nativeVisible])가 처리
  }, []);

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
        if (__DEV__) console.log('[BACK-EVENT] panGesture 스와이프 — lockDismiss=true, dismiss 차단');
        animateSwipeCancel(translateY, backdropOpacity);
        return;
      }
      const dismissed =
        e.translationY > AIThemeGesture.swipeDismissDistance ||
        e.velocityY    > AIThemeGesture.swipeDismissVelocity;
      if (dismissed) {
        if (__DEV__) console.log('[BACK-EVENT] panGesture 스와이프 dismiss');
        // panGesture.onEnd는 worklet 컨텍스트 — non-worklet 함수는 runOnJS로 호출
        runOnJS(doClose)();
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

  // ── Modal은 항상 트리에 유지 ──────────────────────────────────────────────
  //
  // [수정 이유] 기존 "if (!rendered) return null"은 iOS 투명 Modal의 네이티브
  // UIWindow가 완전히 해제되기 전에 JS 트리에서 Modal이 제거될 수 있어,
  // 하위 화면(나가기 버튼 등) 터치가 영구 차단되는 버그를 유발했다.
  //
  // [해결] Modal 컴포넌트를 항상 트리에 유지하되:
  //   - visible={nativeVisible} → iOS/Android가 네이티브 레이어를 직접 관리
  //   - 내부 콘텐츠는 {rendered && ...} 조건부 렌더로 제어
  //   Phase 1 (nativeVisible=false): iOS UIWindow 먼저 해제
  //   Phase 2 (rendered=false):      내부 콘텐츠 JS 트리에서 제거
  //
  // [보존] backdrop, swipe, lockDismiss, Android Back 동작 동일

  return (
    <Modal
      visible={nativeVisible}
      animationType="none"
      transparent
      statusBarTranslucent
      onRequestClose={() => {
        // [WP12] Android Back Button — lockDismiss=true 구간에서 차단
        if (lockDismiss) {
          if (__DEV__) console.log('[BACK-EVENT] onRequestClose — lockDismiss=true, dismiss 차단');
          return;
        }
        if (__DEV__) console.log('[BACK-EVENT] onRequestClose 수신');
        doClose();
      }}
    >
      {rendered && (
        /*
         * GestureHandlerRootView는 반드시 Modal 내부에도 있어야 합니다.
         * React Native Modal은 앱 메인 트리와 분리된 별도 native root에서
         * 렌더링되므로, _layout.tsx의 GestureHandlerRootView가 적용되지 않습니다.
         */
        <GestureHandlerRootView style={StyleSheet.absoluteFill}>
          {/* ── 백드롭 ── */}
          <Animated.View style={[styles.backdrop, backdropStyle]} pointerEvents="none" />
          {/* [원칙 1·5] lockDismiss=true 구간에서는 백드롭 탭으로 닫기 차단 */}
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => {
              if (lockDismiss) {
                return;
              }
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
      )}
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
