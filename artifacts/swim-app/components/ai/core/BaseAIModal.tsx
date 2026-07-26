/**
 * BaseAIModal — SwimNote AI UI Framework V1.0
 * 모든 AI 기능의 공통 모달 컨테이너
 *
 * 책임:
 *   1. 모달 열기/닫기 (제스처 포함)
 *   2. AIProvider로 Context 주입
 *   3. Content 영역 렌더링 (Feature별 Content 주입받음)
 *   4. 공통 Header / ActionBar 렌더링
 *
 * 의존: AIContext(AIProvider), AIContracts, AITheme
 * 사용: 각 Feature 화면에서 <BaseAIModal content={<DiaryAIContent />} ... />
 *
 * TODO: Reanimated 4 모달 등장/퇴장 애니메이션
 * TODO: GestureHandler 스와이프 다운 닫기
 * TODO: expo-blur 백드롭
 */

import React from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { AICreditInfo, AIFeatureType } from './AIContracts';
import { AIProvider } from './AIContext';
import { AIThemeColor, AIThemeRadius, AIThemeSpacing, AIThemeZIndex } from '../theme/AITheme';
import AIHeader from '../components/AIHeader';

interface BaseAIModalProps {
  visible: boolean;
  onClose: () => void;
  featureType: AIFeatureType;
  title: string;
  credit?: AICreditInfo;
  /** Feature별 본문 컴포넌트 */
  content: React.ReactNode;
  /** Feature별 ActionBar 컴포넌트 (없으면 기본 닫기만) */
  actionBar?: React.ReactNode;
}

export default function BaseAIModal({
  visible,
  onClose,
  featureType,
  title,
  credit,
  content,
  actionBar,
}: BaseAIModalProps) {
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      animationType="none"   // TODO: Reanimated로 교체
      transparent
      statusBarTranslucent
      onRequestClose={onClose}
    >
      {/* Backdrop */}
      <Pressable style={styles.backdrop} onPress={onClose} />

      {/* Modal Sheet */}
      <View style={[styles.sheet, { paddingBottom: insets.bottom + AIThemeSpacing.section }]}>
        <AIProvider featureType={featureType} credit={credit}>

          {/* Header */}
          <AIHeader title={title} onClose={onClose} />

          {/* Content 영역 — Feature별 컴포넌트 주입 */}
          <View style={styles.content}>
            {content}
          </View>

          {/* ActionBar — Feature별 또는 기본 */}
          {actionBar && (
            <View style={styles.actionBar}>
              {actionBar}
            </View>
          )}

        </AIProvider>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
    zIndex: AIThemeZIndex.backdrop,
  },
  sheet: {
    position:        'absolute',
    left:             0,
    right:            0,
    bottom:           0,
    top:              0,             // 풀스크린
    backgroundColor:  AIThemeColor.background,
    borderTopLeftRadius:  AIThemeRadius.modal,
    borderTopRightRadius: AIThemeRadius.modal,
    zIndex:           AIThemeZIndex.modal,
    // TODO: Reanimated animated style 적용
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
