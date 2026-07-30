/**
 * AIPermissionView — SwimNote AI UI Framework V1.0
 * PERMISSION State: 권한 요청 안내 화면
 *
 * 의존: AITheme, useAIStateMachine, AIContracts
 * 사용: Feature Content 컴포넌트
 *
 * TODO: permissionMotion.backdropPush 애니메이션
 * TODO: 실제 expo-av / expo-camera 권한 요청 연결
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { AIPermissionType } from '../core/AIContracts';
import { useAIStateMachine } from '../hooks/useAIStateMachine';
import { AIThemeColor, AIThemeRadius, AIThemeSpacing, AIThemeTypography } from '../theme/AITheme';

const PERMISSION_LABELS: Record<AIPermissionType, { icon: string; title: string; desc: string }> = {
  microphone:   { icon: '🎤', title: '마이크 권한',       desc: '음성 입력을 위해 마이크 접근이 필요합니다.' },
  camera:       { icon: '📷', title: '카메라 권한',       desc: '영상/사진 분석을 위해 카메라 접근이 필요합니다.' },
  mediaLibrary: { icon: '🖼️', title: '사진 라이브러리 권한', desc: '사진/영상 업로드를 위해 라이브러리 접근이 필요합니다.' },
};

interface AIPermissionViewProps {
  types: AIPermissionType[];
  onClose: () => void;
}

export default function AIPermissionView({ types, onClose }: AIPermissionViewProps) {
  const { grantPermission, setError } = useAIStateMachine();

  const handleRequest = async () => {
    try {
      // 마이크 권한 요청 (expo-audio)
      if (types.includes('microphone')) {
        const { requestRecordingPermissionsAsync } = await import('expo-audio');
        const { granted } = await requestRecordingPermissionsAsync();
        if (!granted) {
          setError({
            origin:      'PERMISSION',
            message:     '마이크 권한이 거부되었습니다. 설정 앱에서 직접 허용해 주세요.',
            retryTarget: 'PERMISSION',
          });
          return;
        }
      }
      // 카메라/사진 라이브러리 권한은 향후 추가
      grantPermission();
    } catch (e: any) {
      if (__DEV__) console.error('[AIPermissionView] 권한 요청 오류:', e?.message ?? e);
      setError({
        origin:      'PERMISSION',
        message:     '권한 요청 중 오류가 발생했습니다.',
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
