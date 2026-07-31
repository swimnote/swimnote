/**
 * AIPermissionViewV2 — SwimNote AI UI Framework V2.0
 * PERMISSION State: 권한 요청 안내 화면
 *
 * V1 AIPermissionView와의 차이:
 *   - useAIStateMachine() Context 의존 제거
 *   - onGrant / onError 콜백을 props로 수신
 *   - Context 없이 어디서든 사용 가능
 *
 * 의존: AITheme
 * 사용: DiaryAIModalV2
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { AIPermissionType } from '../core/AIContracts';
import type { DiaryServiceError } from '../services/DiaryAIService';
import { AIThemeColor, AIThemeRadius, AIThemeSpacing, AIThemeTypography } from '../theme/AITheme';

const PERMISSION_LABELS: Record<AIPermissionType, { icon: string; title: string; desc: string }> = {
  microphone: {
    icon:  '🎤',
    title: '마이크 권한',
    desc:  '음성 입력을 위해 마이크 접근이 필요합니다.',
  },
  camera: {
    icon:  '📷',
    title: '카메라 권한',
    desc:  '영상/사진 분석을 위해 카메라 접근이 필요합니다.',
  },
  mediaLibrary: {
    icon:  '🖼️',
    title: '사진 라이브러리 권한',
    desc:  '사진/영상 업로드를 위해 라이브러리 접근이 필요합니다.',
  },
};

interface AIPermissionViewV2Props {
  types:   AIPermissionType[];
  /** 권한 허용 후 → INPUT 복귀 */
  onGrant: () => void;
  /** 권한 거부 또는 오류 → ERROR 전환 */
  onError: (error: DiaryServiceError) => void;
  /** 취소 → 모달 닫기 */
  onClose: () => void;
}

export default function AIPermissionViewV2({
  types,
  onGrant,
  onError,
  onClose,
}: AIPermissionViewV2Props) {
  const handleRequest = async () => {
    try {
      if (types.includes('microphone')) {
        const { requestRecordingPermissionsAsync } = await import('expo-audio');
        const { granted } = await requestRecordingPermissionsAsync();
        if (!granted) {
          onError({
            origin:      'PERMISSION',
            message:     '마이크 권한이 거부되었습니다. 설정 앱에서 직접 허용해 주세요.',
            retryable:   false,
            retryTarget: 'PERMISSION',
          });
          return;
        }
      }
      // 카메라/사진 라이브러리 권한은 향후 추가
      onGrant();
    } catch (e: any) {
      if (__DEV__) console.error('[AIPermissionViewV2] 권한 요청 오류:', e?.message ?? e);
      onError({
        origin:      'PERMISSION',
        message:     '권한 요청 중 오류가 발생했습니다.',
        retryable:   false,
        retryTarget: 'PERMISSION',
      });
    }
  };

  const primary = PERMISSION_LABELS[types[0]] ?? PERMISSION_LABELS.microphone;

  return (
    <View style={styles.container}>
      <Text style={styles.icon}>{primary.icon}</Text>
      <Text style={styles.title}>{primary.title}</Text>
      <Text style={styles.desc}>{primary.desc}</Text>

      <View style={styles.buttonRow}>
        <Pressable style={styles.cancelButton} onPress={onClose}>
          <Text style={styles.cancelLabel}>취소</Text>
        </Pressable>
        <Pressable style={styles.allowButton} onPress={handleRequest}>
          <Text style={styles.allowLabel}>허용</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex:           1,
    alignItems:     'center',
    justifyContent: 'center',
    gap:            AIThemeSpacing.element,
    padding:        AIThemeSpacing.section,
  },
  icon: {
    fontSize: 56,
  },
  title: {
    ...AIThemeTypography.heading,
    color: AIThemeColor.text,
  },
  desc: {
    ...AIThemeTypography.result,
    color:     AIThemeColor.textSub,
    textAlign: 'center',
  },
  buttonRow: {
    flexDirection: 'row',
    gap:           AIThemeSpacing.tight,
    marginTop:     AIThemeSpacing.element,
    width:         '100%',
  },
  cancelButton: {
    flex:            1,
    height:          48,
    borderRadius:    AIThemeRadius.button,
    backgroundColor: AIThemeColor.surfaceLight,
    borderWidth:     1,
    borderColor:     AIThemeColor.border,
    alignItems:      'center',
    justifyContent:  'center',
  },
  cancelLabel: {
    ...AIThemeTypography.label,
    color: AIThemeColor.textSub,
  },
  allowButton: {
    flex:            1,
    height:          48,
    borderRadius:    AIThemeRadius.button,
    backgroundColor: AIThemeColor.primary,
    alignItems:      'center',
    justifyContent:  'center',
  },
  allowLabel: {
    ...AIThemeTypography.label,
    color:      '#FFFFFF',
    fontWeight: '600',
  },
});
