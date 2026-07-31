/**
 * DiaryAIModalV2 — SwimNote AI UI Framework V2.3
 * 일지 AI 작성 모달 (레이아웃·렌더링 전담)
 *
 * ── 레이아웃 구조 (V2.3) ─────────────────────────────────────────────────────
 *
 *   Modal (transparent, slide)
 *   └─ View [overlay] (flex:1)
 *      ├─ Pressable [backdrop] (absoluteFill)
 *      └─ View [sheet] (position:absolute, bottom:0, height:screenH×0.94)
 *         ├─ Handle                  고정
 *         ├─ Header                  고정
 *         └─ ScrollView (flex:1)     단일 스크롤 소유자
 *            ├─ INPUT 상태: TextInput + AI작성버튼 + 음성버튼 (인라인)
 *            ├─ 기타 상태: renderContent() + DiaryAIActionBarV2
 *            └─ 하단 여백
 *
 * ── V2.2 → V2.3 변경 ─────────────────────────────────────────────────────────
 *   - useReanimatedKeyboardAnimation 제거
 *     (height SharedValue가 음수로 전달돼 시트 높이가 오히려 증가하는 버그)
 *   - Animated.View → 일반 View (고정 height: screenH × 0.94)
 *   - KeyboardAwareScrollView → 일반 RN ScrollView
 *   - actionBarContainer(고정 하단 푸터) 제거 → ScrollView 내부로 이동
 *   - INPUT 상태: TextInput + AI작성 + 음성 버튼을 순서대로 인라인 배치
 *     (AIInputArea 내부 음성 버튼과 ActionBar 버튼의 겹침/레이아웃 충돌 원천 제거)
 *   - AI 작성 버튼: opacity 항상 1 (disabled는 기능만 막음, 시각적 반투명 없음)
 *
 * ★ 비즈니스 로직 없음. 모든 동작은 useDiaryAIV2로 위임합니다.
 *
 * 수정 금지: useDiaryAIV2, DiaryAIService, API, 상태 전이, retry, requestId, AbortController
 */

import React, { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import AIInputArea        from '../../components/AIInputArea';
import AILoading          from '../../components/AILoading';
import AIResultArea       from '../../components/AIResultArea';
import AIPermissionViewV2 from '../../components/AIPermissionViewV2';
import AIErrorViewV2      from '../../components/AIErrorViewV2';
import DiaryAIActionBarV2 from './DiaryAIActionBarV2';

import type { AIState }       from '../../core/AIContracts';
import { DIARY_AI_PROGRESS }  from '../../config/AIProgressMessages';
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

const V2_TO_AI_STATE: Record<DiaryAIStateV2, AIState> = {
  INPUT:        'INPUT',
  RECORDING:    'RECORDING',
  TRANSCRIBING: 'UPLOADING',
  PERMISSION:   'PERMISSION',
  SEARCHING:    'PROCESSING',
  GENERATING:   'PROCESSING',
  RESULT:       'EDITING',
  ERROR:        'ERROR',
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
  const insets              = useSafeAreaInsets();
  const { height: screenH } = useWindowDimensions();
  const hook                = useDiaryAIV2(hookOptions);

  // 모달이 열릴 때마다 상태 초기화
  useEffect(() => {
    if (visible) hook.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const aiState = V2_TO_AI_STATE[hook.v2State];

  // 시트 고정 높이: 화면의 94%
  // 콘텐츠 길이에 따라 높이가 줄어들지 않도록 고정값 사용
  const sheetHeight = Math.round(screenH * 0.94);

  // ── INPUT 상태 인라인 렌더 ─────────────────────────────────────────────────
  // AI작성 버튼과 음성 버튼을 순서대로 배치 (겹침 방지)
  // AIInputArea 내장 음성 버튼과 ActionBar 버튼의 레이아웃 충돌 원천 제거
  const renderInputState = () => {
    const hasText = hook.inputText.trim().length > 0;
    return (
      <View style={styles.contentPad}>
        {/* 텍스트 입력창 */}
        <TextInput
          style={styles.mainInput}
          value={hook.inputText}
          onChangeText={hook.setInputText}
          multiline
          placeholder="수업에서 있었던 일, 학생들의 특징이나 개선점 등을 자유롭게 입력해주세요."
          placeholderTextColor={AIThemeColor.textSub}
          textAlignVertical="top"
          autoCorrect={false}
        />

        {/* 버튼 영역 — 순서: AI작성 → 음성 (절대 겹치지 않음) */}
        <View style={styles.inputActionContainer}>
          {/* AI 작성 버튼 — 항상 불투명, disabled는 기능만 막음 */}
          <Pressable
            style={styles.aiSubmitButton}
            onPress={hook.handleSubmit}
            disabled={!hasText}
          >
            <Text style={styles.aiSubmitLabel}>✨ AI 작성</Text>
          </Pressable>

          {/* 음성 버튼 — AI 작성 버튼과 별도, 아래에 독립 배치 */}
          <Pressable
            style={styles.voiceInputButton}
            onPress={hook.handleVoicePress}
          >
            <Text style={styles.voiceInputLabel}>🎤 음성</Text>
          </Pressable>
        </View>
      </View>
    );
  };

  // ── 기타 상태 렌더 ────────────────────────────────────────────────────────
  const renderContent = () => {
    switch (hook.v2State) {

      // INPUT: 인라인 렌더 사용 (위 renderInputState)
      case 'INPUT':
        return renderInputState();

      // RECORDING: AIInputArea 내장 파형+중단 버튼
      case 'RECORDING':
        return (
          <View style={styles.contentPad}>
            <AIInputArea
              value={hook.inputText}
              onChangeText={hook.setInputText}
              state={aiState}
              placeholder="수업에서 있었던 일, 학생들의 특징이나 개선점 등을 자유롭게 입력해주세요."
              onVoicePress={hook.handleVoicePress}
            />
          </View>
        );

      // TRANSCRIBING
      case 'TRANSCRIBING':
        return (
          <View style={styles.loadingCenter}>
            <AILoading
              state={aiState}
              message={DIARY_AI_PROGRESS.TRANSCRIBING.message}
            />
          </View>
        );

      // SEARCHING
      case 'SEARCHING':
        return (
          <View style={styles.loadingCenter}>
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

      // GENERATING
      case 'GENERATING':
        return (
          <View style={styles.loadingCenter}>
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

      // RESULT — 중첩 ScrollView 없음
      case 'RESULT':
        return (
          <View style={styles.contentPad}>
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
          </View>
        );

      // PERMISSION
      case 'PERMISSION':
        return (
          <View style={styles.contentPad}>
            <AIPermissionViewV2
              types={['microphone']}
              onGrant={() => hook.handleRetry('INPUT')}
              onError={(err) => hook.handleSetError(err)}
              onClose={hookOptions.onClose ?? (() => {})}
            />
          </View>
        );

      // ERROR
      case 'ERROR':
        return (
          <View style={styles.contentPad}>
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
        return <View style={styles.contentPad} />;
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

        {/* 백드롭 */}
        <Pressable
          style={styles.backdrop}
          onPress={() => { if (!hook.isLocked) hook.handleClose(); }}
        />

        {/*
         * Sheet — position:absolute, bottom:0, height:94%
         * 고정 높이: 콘텐츠 길이에 따라 줄어들지 않음
         * 키보드가 열리면 키보드가 시트 하단을 가리고, 내부 ScrollView로 스크롤 가능
         */}
        <View style={[styles.sheet, { height: sheetHeight }]}>

          {/* 핸들 바 */}
          <View style={styles.handleContainer}>
            <View style={styles.handle} />
          </View>

          {/* 헤더 — 고정 (스크롤되지 않음) */}
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

          {/*
           * ScrollView — 단일 세로 스크롤 소유자
           * - INPUT: renderContent() = TextInput + AI작성버튼 + 음성버튼 (인라인)
           * - 기타: renderContent() + DiaryAIActionBarV2 (순서대로, 겹침 없음)
           * - 키보드가 열려 버튼이 가려지면 아래로 스크롤해서 확인 가능
           */}
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={[
              styles.scrollContent,
              { paddingBottom: insets.bottom + 40 },
            ]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator
            nestedScrollEnabled
          >
            {renderContent()}

            {/* ActionBar — INPUT 제외한 상태에서 ScrollView 내에 배치
                INPUT: renderContent()에 이미 버튼 포함
                RECORDING: DiaryAIActionBarV2(RECORDING)=null
                기타: 각 상태별 버튼 표시 */}
            {hook.v2State !== 'INPUT' && (
              <View style={styles.actionBarInScroll}>
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
            )}
          </ScrollView>

        </View>
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
  const [inputHeight, setInputHeight] = useState(STUDENT_NOTE_MIN_H);

  return (
    <View style={cardStyles.container}>
      <Text style={cardStyles.name}>{student.studentName}</Text>
      <TextInput
        style={[cardStyles.noteInput, { height: Math.max(STUDENT_NOTE_MIN_H, inputHeight) }]}
        value={student.note}
        onChangeText={onChange}
        multiline
        scrollEnabled={false}
        autoFocus={false}
        placeholder="학생별 일지 내용"
        placeholderTextColor={AIThemeColor.textSub}
        textAlignVertical="top"
        onContentSizeChange={(e) =>
          setInputHeight(e.nativeEvent.contentSize.height)
        }
      />
    </View>
  );
}

const STUDENT_NOTE_MIN_H = 60;

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
    color: AIThemeColor.text,
  },
});

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // 전체 오버레이
  overlay: {
    flex:            1,
    backgroundColor: 'transparent',
  },

  // 백드롭
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },

  // 시트 — position:absolute로 하단 고정, height는 인라인으로 screenH×0.94 적용
  // paddingBottom 없음 — scrollContent의 paddingBottom(insets.bottom+40)에서 처리
  sheet: {
    position:             'absolute',
    bottom:               0,
    left:                 0,
    right:                0,
    backgroundColor:      '#FFFFFF',
    borderTopLeftRadius:  AIThemeRadius.modal ?? 20,
    borderTopRightRadius: AIThemeRadius.modal ?? 20,
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
    alignItems:    'center',
    paddingTop:    10,
    paddingBottom: 4,
  },
  handle: {
    width:           40,
    height:           4,
    borderRadius:     2,
    backgroundColor: AIThemeColor.border ?? '#E0E0E0',
  },

  // 헤더 (고정)
  header: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
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
    fontSize:   18,
    color:      AIThemeColor.textSub,
    lineHeight: 22,
  },

  // ScrollView
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow:      1,
    paddingTop:    AIThemeSpacing.element,
  },

  // 콘텐츠 공통 패딩
  contentPad: {
    paddingHorizontal: AIThemeSpacing.section,
  },

  // ── INPUT 상태 전용 스타일 ─────────────────────────────────────────────────

  // 텍스트 입력창
  // minHeight:180, maxHeight:260 — 모달 전체 높이를 밀어내지 않음
  mainInput: {
    width:             '100%',
    minHeight:         180,
    maxHeight:         260,
    borderRadius:      14,
    backgroundColor:   '#FFFFFF',
    borderWidth:       1,
    borderColor:       '#D9E1EC',
    padding:           16,
    ...AIThemeTypography.input,
    color:             AIThemeColor.text,
    textAlignVertical: 'top',
  },

  // 버튼 컨테이너 — 세로 순서: AI작성 → 음성 (절대 겹치지 않음)
  // position:absolute/transform/zIndex 없음
  inputActionContainer: {
    width:     '100%',
    gap:       12,
    marginTop: 16,
  },

  // AI 작성 버튼 — 항상 불투명(opacity:1), disabled 상태도 시각적 투명 없음
  // disabled 기능(hasText=false)은 Pressable disabled prop으로만 처리
  aiSubmitButton: {
    width:           '100%',
    minHeight:       56,
    borderRadius:    14,
    backgroundColor: AIThemeColor.primary,
    alignItems:      'center',
    justifyContent:  'center',
    opacity:         1,
  },
  aiSubmitLabel: {
    ...AIThemeTypography.label,
    color:      '#FFFFFF',
    fontWeight: '700',
    fontSize:   15,
  },

  // 음성 버튼 — AI 작성 버튼과 완전히 분리된 독립 버튼
  voiceInputButton: {
    width:           '100%',
    minHeight:       52,
    borderRadius:    14,
    backgroundColor: '#FFFFFF',
    borderWidth:     1,
    borderColor:     '#D9E1EC',
    alignItems:      'center',
    justifyContent:  'center',
  },
  voiceInputLabel: {
    ...AIThemeTypography.label,
    color: AIThemeColor.textSub,
  },

  // ── 기타 상태 스타일 ────────────────────────────────────────────────────────

  // 로딩 상태: 세로 중앙 정렬
  loadingCenter: {
    alignItems:        'center',
    justifyContent:    'center',
    minHeight:         180,
    paddingVertical:   AIThemeSpacing.section,
    paddingHorizontal: AIThemeSpacing.section,
  },
  loadingSubtext: {
    ...AIThemeTypography.label,
    color:     AIThemeColor.textSub,
    textAlign: 'center',
    marginTop: AIThemeSpacing.tight,
    opacity:   0.75,
  },

  // RESULT 내 섹션
  resultSection: {
    gap:          AIThemeSpacing.tight,
    marginBottom: AIThemeSpacing.element,
    paddingHorizontal: AIThemeSpacing.section,
  },
  sectionLabel: {
    ...AIThemeTypography.label,
    color:        AIThemeColor.textSub,
    fontWeight:   '600',
    marginBottom: 4,
  },

  // ActionBar (ScrollView 내부, INPUT 제외)
  actionBarInScroll: {
    marginTop: AIThemeSpacing.element,
  },
});
