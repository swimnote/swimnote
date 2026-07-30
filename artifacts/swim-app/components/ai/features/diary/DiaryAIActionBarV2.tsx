/**
 * DiaryAIActionBarV2 — SwimNote AI UI Framework V2.0
 * 모달 하단 액션 버튼 영역
 *
 * V1 DiaryAIActionBar와의 차이:
 *   - DiaryAIStateV2 기반 (CLOSED/OPENING case 없음)
 *   - useAIStateMachine() Context 의존 없음
 *   - props로 핸들러 수신
 *   - default case: 빈 View (파란 닫기 버튼 노출 버그 제거)
 *
 * 상태별 버튼 구성:
 *   INPUT        — [음성 입력] + [AI 작성]
 *   RECORDING    — [중지]
 *   TRANSCRIBING — 없음 (로딩 중)
 *   PERMISSION   — (AIPermissionViewV2가 자체 버튼 포함)
 *   SEARCHING    — 없음 (로딩 중)
 *   GENERATING   — 없음 (로딩 중)
 *   RESULT       — [수정하기] + [다시 생성] + [일지에 삽입]
 *   ERROR        — (AIErrorViewV2가 자체 버튼 포함)
 *
 * 의존: AITheme, useDiaryAIV2(타입만)
 * 사용: DiaryAIModalV2
 */

import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { AIThemeColor, AIThemeRadius, AIThemeSpacing, AIThemeTypography } from '../../theme/AITheme';
import type { DiaryAIStateV2 } from '../../services/DiaryAIService';

export interface DiaryAIActionBarV2Props {
  v2State:       DiaryAIStateV2;
  inputText:     string;
  insertDone:    boolean;
  onSubmit:      () => void;
  onVoicePress:  () => void;
  onInsert:      () => void;
  onRewrite:     () => void;
  onEditResult:  () => void;
  onClose:       () => void;
}

export default function DiaryAIActionBarV2({
  v2State,
  inputText,
  insertDone,
  onSubmit,
  onVoicePress,
  onInsert,
  onRewrite,
  onEditResult,
  onClose,
}: DiaryAIActionBarV2Props) {
  switch (v2State) {
    // ── INPUT: 음성 입력 + AI 작성 ──────────────────────────────────────────
    case 'INPUT': {
      const hasText = inputText.trim().length > 0;
      return (
        <View style={styles.row}>
          <Pressable style={styles.secondaryButton} onPress={onVoicePress}>
            <Text style={styles.secondaryLabel}>🎤 음성 입력</Text>
          </Pressable>
          <Pressable
            style={[styles.primaryButton, !hasText && styles.primaryDisabled]}
            onPress={onSubmit}
            disabled={!hasText}
          >
            <Text style={styles.primaryLabel}>✨ AI 작성</Text>
          </Pressable>
        </View>
      );
    }

    // ── RECORDING: 녹음 중지 ───────────────────────────────────────────────
    case 'RECORDING': {
      return (
        <View style={styles.row}>
          <Pressable style={styles.stopButton} onPress={onVoicePress}>
            <View style={styles.stopIcon} />
            <Text style={styles.stopLabel}>녹음 중지</Text>
          </Pressable>
        </View>
      );
    }

    // ── TRANSCRIBING / SEARCHING / GENERATING: 진행 중, 버튼 없음 ───────────
    case 'TRANSCRIBING':
    case 'SEARCHING':
    case 'GENERATING': {
      return (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={AIThemeColor.primary} />
        </View>
      );
    }

    // ── RESULT: 수정 + 다시 생성 + 삽입 ───────────────────────────────────
    case 'RESULT': {
      return (
        <View style={styles.resultColumn}>
          <View style={styles.row}>
            <Pressable style={styles.secondaryButton} onPress={onEditResult}>
              <Text style={styles.secondaryLabel}>수정하기</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={onRewrite}>
              <Text style={styles.secondaryLabel}>다시 생성</Text>
            </Pressable>
          </View>
          <Pressable
            style={[styles.insertButton, insertDone && styles.insertDone]}
            onPress={onInsert}
            disabled={insertDone}
          >
            {insertDone ? (
              <Text style={styles.insertLabel}>✓ 일지에 반영됨</Text>
            ) : (
              <Text style={styles.insertLabel}>일지에 삽입</Text>
            )}
          </Pressable>
        </View>
      );
    }

    // ── PERMISSION / ERROR: 해당 View가 자체 버튼 포함 ─────────────────────
    case 'PERMISSION':
    case 'ERROR':
      return null;

    // ── default: 빈 View (버그 방지 — V1 파란 닫기 버튼 노출 제거) ────────
    default:
      return <View />;
  }
}

const styles = StyleSheet.create({
  row: {
    flexDirection:  'row',
    gap:            AIThemeSpacing.tight,
    paddingHorizontal: AIThemeSpacing.section,
    paddingVertical:   AIThemeSpacing.element,
  },
  resultColumn: {
    gap:            AIThemeSpacing.tight,
    paddingHorizontal: AIThemeSpacing.section,
    paddingBottom:  AIThemeSpacing.element,
  },
  loadingRow: {
    height:         56,
    alignItems:     'center',
    justifyContent: 'center',
  },

  // ── 공통 버튼 ─────────────────────────────────────────────────────────────
  secondaryButton: {
    flex:            1,
    height:          48,
    borderRadius:    AIThemeRadius.button,
    backgroundColor: AIThemeColor.surfaceLight,
    borderWidth:     1,
    borderColor:     AIThemeColor.border,
    alignItems:      'center',
    justifyContent:  'center',
  },
  secondaryLabel: {
    ...AIThemeTypography.label,
    color: AIThemeColor.textSub,
  },

  primaryButton: {
    flex:            1,
    height:          48,
    borderRadius:    AIThemeRadius.button,
    backgroundColor: AIThemeColor.primary,
    alignItems:      'center',
    justifyContent:  'center',
  },
  primaryDisabled: {
    opacity: 0.4,
  },
  primaryLabel: {
    ...AIThemeTypography.label,
    color:      '#FFFFFF',
    fontWeight: '600',
  },

  // ── 녹음 중지 ─────────────────────────────────────────────────────────────
  stopButton: {
    flex:            1,
    height:          48,
    borderRadius:    AIThemeRadius.button,
    backgroundColor: '#FF3B30',
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'center',
    gap:             8,
  },
  stopIcon: {
    width:           12,
    height:          12,
    borderRadius:    2,
    backgroundColor: '#FFFFFF',
  },
  stopLabel: {
    ...AIThemeTypography.label,
    color:      '#FFFFFF',
    fontWeight: '600',
  },

  // ── 삽입 버튼 ─────────────────────────────────────────────────────────────
  insertButton: {
    height:          52,
    borderRadius:    AIThemeRadius.button,
    backgroundColor: AIThemeColor.primary,
    alignItems:      'center',
    justifyContent:  'center',
  },
  insertDone: {
    backgroundColor: AIThemeColor.textSub,
    opacity:         0.7,
  },
  insertLabel: {
    ...AIThemeTypography.label,
    color:      '#FFFFFF',
    fontWeight: '700',
    fontSize:   15,
  },
});
