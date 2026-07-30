/**
 * DiaryAIModalV2 — SwimNote AI UI Framework V2.0
 * 일지 AI 작성 모달 (레이아웃·렌더링 전담)
 *
 * 주요 개선 (V1 대비):
 *   - AIProvider / AIContext 의존 없음
 *   - CLOSED/OPENING 중간 상태 없음 → 열리면 즉시 INPUT
 *   - useAIStateMachine 중복 구독 없음
 *   - default case 빈 View (파란 닫기 버튼 노출 버그 제거)
 *   - SEARCHING/GENERATING 분리 로딩 화면 (메시지 별도 관리)
 *   - AIPermissionViewV2 / AIErrorViewV2 — Context 불필요
 *
 * ★ 비즈니스 로직 없음. 모든 동작은 useDiaryAIV2로 위임합니다.
 *
 * 의존: useDiaryAIV2, AIProgressMessages, AIInputArea, AILoading,
 *       AIResultArea, AIPermissionViewV2, AIErrorViewV2,
 *       DiaryAIActionBarV2, AITheme
 * 사용: DiaryAIButton (2단계에서 연결)
 */

import React, { useEffect } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import AIInputArea  from '../../components/AIInputArea';
import AILoading    from '../../components/AILoading';
import AIResultArea from '../../components/AIResultArea';
import AIPermissionViewV2 from '../../components/AIPermissionViewV2';
import AIErrorViewV2      from '../../components/AIErrorViewV2';
import DiaryAIActionBarV2 from './DiaryAIActionBarV2';

import type { AIState }   from '../../core/AIContracts';
import { DIARY_AI_PROGRESS } from '../../config/AIProgressMessages';
import {
  AIThemeColor,
  AIThemeRadius,
  AIThemeSpacing,
  AIThemeTypography,
} from '../../theme/AITheme';

import {
  useDiaryAIV2,
  type UseDiaryAIV2Options,
} from './useDiaryAIV2';
import type { DiaryAIStateV2, StudentDiaryNote } from '../../services/DiaryAIService';

// ─── V2 State → 레거시 AIState 매핑 ─────────────────────────────────────────
// AIInputArea / AILoading / AIResultArea가 AIState 타입을 기대하므로 변환 필요

const V2_TO_AI_STATE: Record<DiaryAIStateV2, AIState> = {
  INPUT:       'INPUT',
  RECORDING:   'RECORDING',
  TRANSCRIBING:'UPLOADING',
  PERMISSION:  'PERMISSION',
  SEARCHING:   'PROCESSING',
  GENERATING:  'PROCESSING',
  RESULT:      'EDITING', // AIResultArea를 항상 편집 가능 모드로 표시
  ERROR:       'ERROR',
};

// ─── Props ────────────────────────────────────────────────────────────────────

export type DiaryAIModalV2Props = UseDiaryAIV2Options & {
  visible: boolean;
};

// ─── DiaryAIModalV2 ───────────────────────────────────────────────────────────

export default function DiaryAIModalV2({
  visible,
  ...hookOptions
}: DiaryAIModalV2Props) {
  const insets = useSafeAreaInsets();
  const hook   = useDiaryAIV2(hookOptions);

  // 모달이 열릴 때마다 상태 초기화 (이전 결과 / 오류 잔상 제거)
  useEffect(() => {
    if (visible) {
      hook.reset();
    }
    // hook.reset은 useCallback으로 안정화되어 있으므로 dep에 포함해도 안전
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const aiState = V2_TO_AI_STATE[hook.v2State];

  // ── 콘텐츠 영역 렌더링 ──────────────────────────────────────────────────
  const renderContent = () => {
    switch (hook.v2State) {

      case 'INPUT':
      case 'RECORDING':
        return (
          <View style={styles.contentInner}>
            <AIInputArea
              value={hook.inputText}
              onChangeText={hook.setInputText}
              state={aiState}
              placeholder="수업에서 있었던 일, 학생들의 특징이나 개선점 등을 자유롭게 입력해주세요."
              onVoicePress={hook.handleVoicePress}
            />
          </View>
        );

      case 'TRANSCRIBING':
        return (
          <View style={styles.loadingInner}>
            <AILoading
              state={aiState}
              message={DIARY_AI_PROGRESS.TRANSCRIBING.message}
            />
          </View>
        );

      case 'SEARCHING':
        return (
          <View style={styles.loadingInner}>
            <AILoading
              state={aiState}
              message={DIARY_AI_PROGRESS.SEARCHING.message}
            />
            {DIARY_AI_PROGRESS.SEARCHING.subtext ? (
              <Text style={styles.loadingSubtext}>
                {DIARY_AI_PROGRESS.SEARCHING.subtext}
              </Text>
            ) : null}
          </View>
        );

      case 'GENERATING':
        return (
          <View style={styles.loadingInner}>
            <AILoading
              state={aiState}
              message={DIARY_AI_PROGRESS.GENERATING.message}
            />
            {DIARY_AI_PROGRESS.GENERATING.subtext ? (
              <Text style={styles.loadingSubtext}>
                {DIARY_AI_PROGRESS.GENERATING.subtext}
              </Text>
            ) : null}
          </View>
        );

      case 'RESULT':
        return (
          <ScrollView
            style={styles.resultScroll}
            contentContainerStyle={styles.resultScrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* 공통 일지 */}
            {hook.resultText ? (
              <View style={styles.resultSection}>
                <Text style={styles.sectionLabel}>전체 일지</Text>
                <AIResultArea
                  result={hook.resultText}
                  state={aiState}
                  onChangeText={hook.setResultText}
                />
              </View>
            ) : null}

            {/* 학생별 일지 */}
            {hook.generatedStudents.length > 0 ? (
              <View style={styles.resultSection}>
                <Text style={styles.sectionLabel}>학생별 일지</Text>
                {hook.generatedStudents.map((student, index) => (
                  <StudentNoteCard
                    key={student.studentId}
                    student={student}
                    onChange={(note) => {
                      const updated = [...hook.generatedStudents];
                      updated[index] = { ...student, note };
                      hook.setGeneratedStudents(updated);
                    }}
                  />
                ))}
              </View>
            ) : null}
          </ScrollView>
        );

      case 'PERMISSION':
        return (
          <View style={styles.contentInner}>
            <AIPermissionViewV2
              types={['microphone']}
              onGrant={() => hook.handleRetry('INPUT')}
              onError={(err) => hook.handleSetError(err)}
              onClose={hookOptions.onClose ?? (() => {})}
            />
          </View>
        );

      case 'ERROR':
        return (
          <View style={styles.contentInner}>
            {hook.currentError ? (
              <AIErrorViewV2
                error={hook.currentError}
                onRetry={hook.handleRetry}
                onClose={hookOptions.onClose ?? (() => {})}
              />
            ) : null}
          </View>
        );

      default:
        return <View style={styles.contentInner} />;
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={() => {
        if (!hook.isLocked) hook.handleClose();
      }}
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        {/* 백드롭 — 잠금 중 탭 무시 */}
        <Pressable
          style={styles.backdrop}
          onPress={() => { if (!hook.isLocked) hook.handleClose(); }}
        />

        {/* 모달 시트 */}
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.keyboardAvoid}
        >
          <View style={[styles.sheet, { paddingBottom: insets.bottom }]}>

            {/* 핸들 바 */}
            <View style={styles.handleContainer}>
              <View style={styles.handle} />
            </View>

            {/* 헤더 */}
            <View style={styles.header}>
              <Text style={styles.headerTitle}>AI 일지 작성</Text>
              {!hook.isLocked && (
                <Pressable
                  style={styles.closeButton}
                  onPress={hook.handleClose}
                  hitSlop={8}
                >
                  <Text style={styles.closeButtonText}>✕</Text>
                </Pressable>
              )}
            </View>

            {/* 콘텐츠 */}
            <View style={styles.content}>
              {renderContent()}
            </View>

            {/* 하단 ActionBar */}
            <DiaryAIActionBarV2
              v2State={hook.v2State}
              inputText={hook.inputText}
              insertDone={hook.insertDone}
              onSubmit={hook.handleSubmit}
              onInsert={hook.handleInsert}
              onRewrite={hook.handleSubmit}
              onEditResult={hook.handleEditInput}
              onClose={hook.handleClose}
            />

          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// ─── StudentNoteCard ──────────────────────────────────────────────────────────

interface StudentNoteCardProps {
  student:  StudentDiaryNote;
  onChange: (note: string) => void;
}

function StudentNoteCard({ student, onChange }: StudentNoteCardProps) {
  return (
    <View style={cardStyles.container}>
      <Text style={cardStyles.name}>{student.studentName}</Text>
      <TextInput
        style={cardStyles.noteInput}
        value={student.note}
        onChangeText={onChange}
        multiline
        scrollEnabled={false}
        placeholder="학생별 일지 내용"
        placeholderTextColor={AIThemeColor.textSub}
      />
    </View>
  );
}

const cardStyles = StyleSheet.create({
  container: {
    backgroundColor: AIThemeColor.surfaceLight,
    borderRadius:    AIThemeRadius.card,
    padding:         AIThemeSpacing.element,
    gap:             6,
    marginBottom:    AIThemeSpacing.tight,
    borderWidth:     1,
    borderColor:     AIThemeColor.border,
  },
  name: {
    ...AIThemeTypography.label,
    color:      AIThemeColor.primary,
    fontWeight: '600',
  },
  noteInput: {
    ...AIThemeTypography.result,
    color:    AIThemeColor.text,
    minHeight: 60,
    textAlignVertical: 'top',
  },
});

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: {
    flex:            1,
    justifyContent:  'flex-end',
    backgroundColor: 'transparent',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  keyboardAvoid: {
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius:  AIThemeRadius.modal ?? 20,
    borderTopRightRadius: AIThemeRadius.modal ?? 20,
    maxHeight:            '88%',
    overflow:             'hidden',
    // iOS 그림자
    shadowColor:    '#000',
    shadowOffset:   { width: 0, height: -2 },
    shadowOpacity:  0.12,
    shadowRadius:   8,
    // Android 그림자
    elevation: 8,
  },

  // 핸들
  handleContainer: {
    alignItems:     'center',
    paddingTop:     10,
    paddingBottom:  4,
  },
  handle: {
    width:           40,
    height:           4,
    borderRadius:     2,
    backgroundColor: AIThemeColor.border ?? '#E0E0E0',
  },

  // 헤더
  header: {
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'space-between',
    paddingHorizontal: AIThemeSpacing.section,
    paddingVertical:   AIThemeSpacing.tight,
    borderBottomWidth: 1,
    borderBottomColor: AIThemeColor.border ?? '#F0F0F0',
  },
  headerTitle: {
    ...AIThemeTypography.heading,
    color: AIThemeColor.text,
  },
  closeButton: {
    padding: 4,
  },
  closeButtonText: {
    fontSize:  18,
    color:     AIThemeColor.textSub,
    lineHeight: 22,
  },

  // 콘텐츠
  content: {
    flexShrink: 1,
    minHeight:  160,
    maxHeight:  460,
  },
  contentInner: {
    flex: 1,
  },

  // 로딩
  loadingInner: {
    flex:           1,
    alignItems:     'center',
    justifyContent: 'center',
    paddingVertical: AIThemeSpacing.section,
  },
  loadingSubtext: {
    ...AIThemeTypography.label,
    color:     AIThemeColor.textSub,
    textAlign: 'center',
    marginTop: AIThemeSpacing.tight,
    opacity:   0.75,
  },

  // 결과 스크롤
  resultScroll: {
    flex: 1,
  },
  resultScrollContent: {
    padding: AIThemeSpacing.section,
    gap:     AIThemeSpacing.element,
  },
  resultSection: {
    gap: AIThemeSpacing.tight,
  },
  sectionLabel: {
    ...AIThemeTypography.label,
    color:      AIThemeColor.textSub,
    fontWeight: '600',
    marginBottom: 4,
  },
});
