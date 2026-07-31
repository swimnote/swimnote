/**
 * DiaryAIModalV2 — SwimNote AI UI Framework V2.1
 * 일지 AI 작성 모달 (레이아웃·렌더링 전담)
 *
 * ── 레이아웃 구조 (V2.1 재구성) ─────────────────────────────────────────────
 *
 *   Modal
 *   └─ Overlay (flex:1, justify:flex-end)
 *      ├─ Backdrop (absoluteFill)
 *      └─ KeyboardAvoidingView [react-native-keyboard-controller]
 *         │   behavior="padding" (iOS) / "height" (Android)
 *         │   역할: Sheet 전체를 키보드 위로 올림
 *         └─ Sheet (flex:0, maxHeight = screenH - safeTop - 16)
 *            ├─ Handle                    고정
 *            ├─ Header                    고정
 *            ├─ KeyboardAwareScrollView   단일 세로 스크롤 소유자
 *            │  │   역할: 포커스된 TextInput을 키보드 위로 자동 스크롤
 *            │  └─ 모든 상태 콘텐츠 (RESULT 포함 — 중첩 ScrollView 없음)
 *            └─ actionBarContainer        고정, paddingBottom = insets.bottom
 *               └─ DiaryAIActionBarV2
 *
 * ── 제거된 패턴 (V2.0 → V2.1) ───────────────────────────────────────────────
 *   - content 영역 maxHeight: 460 하드코딩
 *   - RESULT 전용 중첩 ScrollView
 *   - sheet.paddingBottom: insets.bottom (→ actionBarContainer로 이동)
 *   - RN 기본 KeyboardAvoidingView
 *
 * ★ 비즈니스 로직 없음. 모든 동작은 useDiaryAIV2로 위임합니다.
 *
 * 의존: useDiaryAIV2, AIProgressMessages, AIInputArea, AILoading,
 *       AIResultArea, AIPermissionViewV2, AIErrorViewV2,
 *       DiaryAIActionBarV2, AITheme,
 *       react-native-keyboard-controller
 * 수정 금지: useDiaryAIV2, DiaryAIService, API, 상태 전이, retry, requestId, AbortController
 */

import React, { useEffect, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  KeyboardAvoidingView,
  KeyboardAwareScrollView,
} from 'react-native-keyboard-controller';

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
// AIInputArea / AILoading / AIResultArea가 AIState 타입을 기대하므로 변환 필요

const V2_TO_AI_STATE: Record<DiaryAIStateV2, AIState> = {
  INPUT:        'INPUT',
  RECORDING:    'RECORDING',
  TRANSCRIBING: 'UPLOADING',
  PERMISSION:   'PERMISSION',
  SEARCHING:    'PROCESSING',
  GENERATING:   'PROCESSING',
  RESULT:       'EDITING', // AIResultArea를 편집 가능 모드로 표시 (autoFocus={false} 필수)
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
  const insets               = useSafeAreaInsets();
  const { height: screenH }  = useWindowDimensions();
  const hook                 = useDiaryAIV2(hookOptions);

  // 모달이 열릴 때마다 상태 초기화 (이전 결과 / 오류 잔상 제거)
  useEffect(() => {
    if (visible) hook.reset();
    // hook.reset은 useCallback으로 안정화 — dep 포함 안전
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const aiState  = V2_TO_AI_STATE[hook.v2State];
  // Sheet 최대 높이: 상단 Safe Area + 여유 16px를 제외한 화면 높이
  const sheetMaxH = screenH - insets.top - 16;

  // ── 콘텐츠 영역 (KeyboardAwareScrollView 안에 위치) ──────────────────────
  const renderContent = () => {
    switch (hook.v2State) {

      // ── INPUT / RECORDING ──────────────────────────────────────────────────
      case 'INPUT':
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

      // ── TRANSCRIBING ───────────────────────────────────────────────────────
      case 'TRANSCRIBING':
        return (
          <View style={styles.loadingCenter}>
            <AILoading
              state={aiState}
              message={DIARY_AI_PROGRESS.TRANSCRIBING.message}
            />
          </View>
        );

      // ── SEARCHING ─────────────────────────────────────────────────────────
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

      // ── GENERATING ────────────────────────────────────────────────────────
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

      // ── RESULT ────────────────────────────────────────────────────────────
      // 중첩 ScrollView 없음 — KeyboardAwareScrollView가 단일 스크롤 소유자
      case 'RESULT':
        return (
          <View style={styles.contentPad}>
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
          </View>
        );

      // ── PERMISSION ────────────────────────────────────────────────────────
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

      // ── ERROR ─────────────────────────────────────────────────────────────
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

        {/* 백드롭 — 잠금 중 탭 무시 */}
        <Pressable
          style={styles.backdrop}
          onPress={() => { if (!hook.isLocked) hook.handleClose(); }}
        />

        {/*
         * KeyboardAvoidingView (react-native-keyboard-controller)
         * 역할: 키보드가 올라올 때 Sheet 전체를 키보드 위로 올림
         * behavior="padding": iOS에서 KAV 하단에 키보드 높이만큼 padding 추가 → Sheet 상승
         * behavior="height": Android에서 KAV 자체 높이 축소
         *
         * ⚠️ 이 KAV와 KeyboardAwareScrollView의 역할은 분리됨:
         *    KAV = Sheet 위치 조정
         *    KASV = 포커스된 TextInput 자동 스크롤
         *    중복 보정 금지
         */}
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.kavWrapper}
        >
          {/* Sheet */}
          <View style={[styles.sheet, { maxHeight: sheetMaxH }]}>

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
             * KeyboardAwareScrollView (react-native-keyboard-controller)
             * 역할: 포커스된 TextInput이 키보드 위에 보이도록 자동 스크롤
             * — 단일 세로 스크롤 소유자: 내부에 ScrollView 중첩 금지
             * — bottomOffset: TextInput과 키보드 사이 여백
             * — extraKeyboardSpace: 0 (ActionBar가 Sheet 외부에 있으므로 추가 공간 불필요)
             */}
            <KeyboardAwareScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
              showsVerticalScrollIndicator={false}
              bottomOffset={16}
              extraKeyboardSpace={0}
            >
              {renderContent()}
            </KeyboardAwareScrollView>

            {/*
             * ActionBar 컨테이너 — 고정 (스크롤되지 않음)
             * paddingBottom = insets.bottom: 홈 인디케이터와 겹침 방지
             * ⚠️ sheet에는 paddingBottom 없음 (이곳에만 적용)
             */}
            <View style={[styles.actionBarContainer, { paddingBottom: insets.bottom }]}>
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
  // scrollEnabled={false} + onContentSizeChange: TextInput이 내용에 따라 동적으로 높이 증가
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
    justifyContent:  'flex-end',
    backgroundColor: 'transparent',
  },

  // 백드롭
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },

  // KeyboardAvoidingView 래퍼: Sheet를 flex-end로 유지
  kavWrapper: {
    justifyContent: 'flex-end',
  },

  // 모달 시트
  // flex: 0 — 콘텐츠 높이만큼 자연스럽게 성장, maxHeight 초과 불가
  // maxHeight는 컴포넌트에서 동적으로 적용 (screenH - safeTop - 16)
  // paddingBottom 없음 — actionBarContainer에만 insets.bottom 적용
  sheet: {
    flex:            0,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius:  AIThemeRadius.modal ?? 20,
    borderTopRightRadius: AIThemeRadius.modal ?? 20,
    overflow: 'hidden',
    // iOS 그림자
    shadowColor:   '#000',
    shadowOffset:  { width: 0, height: -2 },
    shadowOpacity: 0.12,
    shadowRadius:  8,
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

  // KeyboardAwareScrollView
  // flex: 1 + minHeight: 0 → Sheet 내에서 가변 공간을 모두 차지
  scroll: {
    flex:      1,
    minHeight: 0,
  },
  scrollContent: {
    // 하단 여백: ActionBar 위 내용이 잘리지 않도록 여유 공간
    paddingBottom: AIThemeSpacing.section,
  },

  // 콘텐츠 공통 패딩 (모든 상태에서 동일)
  contentPad: {
    paddingHorizontal: AIThemeSpacing.section,
    paddingTop:        AIThemeSpacing.element,
  },

  // 로딩 상태: 세로 중앙 정렬 + 최소 높이 확보
  loadingCenter: {
    alignItems:      'center',
    justifyContent:  'center',
    minHeight:       180,
    paddingVertical: AIThemeSpacing.section,
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
  },
  sectionLabel: {
    ...AIThemeTypography.label,
    color:        AIThemeColor.textSub,
    fontWeight:   '600',
    marginBottom: 4,
  },

  // ActionBar 컨테이너 (고정, 스크롤 외부)
  // paddingBottom은 컴포넌트에서 insets.bottom으로 동적 적용
  actionBarContainer: {
    borderTopWidth: 1,
    borderTopColor: AIThemeColor.border ?? '#F0F0F0',
    backgroundColor: '#FFFFFF',
  },
});
