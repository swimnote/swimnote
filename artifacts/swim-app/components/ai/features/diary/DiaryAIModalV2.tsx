/**
 * DiaryAIModalV2 — SwimNote AI UI Framework V2.4
 * 일지 AI 작성 모달 (레이아웃·렌더링 전담)
 *
 * ── 레이아웃 구조 (V2.4) ─────────────────────────────────────────────────────
 *
 *   Modal (transparent, slide)
 *   └─ View [overlay] (flex:1)
 *      ├─ Pressable [backdrop] (absoluteFill)
 *      └─ KeyboardAvoidingView (flex:1, pointerEvents:"box-none")
 *         │   behavior="padding"(iOS) / "height"(Android)
 *         │   역할: 키보드 올라올 때 가용 공간 축소 → Sheet 자동 수축
 *         ├─ View [spacer] (flex:1, pointerEvents:"none")
 *         │   역할: Sheet 위 투명 공간. 터치 패스스루(backdrop에 도달)
 *         └─ View [sheet] (flexBasis:maxSheetH, flexShrink:1, maxHeight:maxSheetH)
 *            │   - 키보드 닫힘: spacer가 잉여 공간 흡수 → sheet = maxSheetH
 *            │   - 키보드 열림: 가용 공간 < maxSheetH → sheet 수축 (flexShrink:1)
 *            │   - 고정 height 없음 — KAV 가용 공간에 의해 결정
 *            ├─ Handle                   고정
 *            ├─ Header                   고정 (flex 없음)
 *            ├─ KeyboardAwareScrollView  (flex:1, minHeight:0) — 단일 스크롤 소유자
 *            │  │   역할: 포커스된 TextInput을 키보드 위로 자동 스크롤
 *            │  └─ renderContent() — INPUT/RECORDING/RESULT/TRANSCRIBING 등
 *            └─ actionBarContainer       고정 푸터 (flex 없음, KASV 외부)
 *               paddingBottom = insets.bottom
 *               └─ DiaryAIActionBarV2
 *
 * ── V2.3 → V2.4 변경 ─────────────────────────────────────────────────────────
 *   - V2.3의 고정 height(94%) 제거 → flexBasis+flexShrink 방식
 *   - KeyboardAvoidingView 복원 (RNKC, behavior="padding"/"height")
 *   - KeyboardAwareScrollView 복원 (RNKC, flex:1, bottomOffset:16)
 *   - ActionBar 복원: KASV 외부 고정 푸터
 *   - INPUT 상태: AIInputArea 복원 (TextInput + 음성 버튼 포함)
 *   - V2.3의 inline TextInput 접근 제거 (AIInputArea 재활용)
 *   - spacer View 추가 (Sheet 위, KAV 안): 터치 패스스루 + Sheet 하단 고정
 *   - DiaryAIActionBarV2 INPUT 버튼 opacity:1 항상 (반투명 수정)
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

  // Sheet 최대 높이 — 상태바 + 여백 제외
  // ★ 고정 height 없음. Sheet의 실제 높이는 flexBasis + flexShrink + KAV가 결정.
  //   키보드가 열리면 KAV 가용 공간이 줄어 Sheet가 자동으로 수축함.
  const maxSheetH = Math.min(
    screenH - insets.top - 16,
    Math.round(screenH * 0.95),
  );

  // ── 콘텐츠 영역 (KeyboardAwareScrollView 안에 위치) ──────────────────────
  const renderContent = () => {
    switch (hook.v2State) {

      // ── INPUT / RECORDING ─────────────────────────────────────────────────
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
         *   - behavior="padding" (iOS): 키보드 높이만큼 paddingBottom 증가
         *     → KAV 내부 가용 공간 축소 → Sheet (flexShrink:1) 자동 수축
         *   - behavior="height" (Android): KAV 자체 height 축소
         *   - pointerEvents="box-none": KAV 자체는 터치 미감지, 자식만 감지
         *     → spacer 영역 터치 → backdrop에 도달 (닫기)
         *   - flex:1: overlay를 꽉 채워 spacer가 Sheet 위 공간을 흡수
         */}
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.kav}
          pointerEvents="box-none"
        >
          {/*
           * 투명 Spacer — Sheet 위의 빈 공간을 흡수
           * - flex:1: 남은 공간 전부 차지 → Sheet가 자동으로 하단에 고정
           * - pointerEvents="none": 터치 패스스루 → backdrop Pressable에 도달
           */}
          <View style={styles.spacer} pointerEvents="none" />

          {/*
           * Sheet — 바텀 시트 본체
           *   flexBasis: maxSheetH  → 기본적으로 maxSheetH 높이를 원함
           *   flexShrink: 1         → KAV 가용 공간 < maxSheetH 이면 수축
           *   maxHeight: maxSheetH  → 안전망 (절대 maxSheetH 초과 금지)
           *   ★ 고정 height 없음: KAV + flexShrink + spacer(flex:1)가 높이 결정
           *
           *   동작 원리:
           *   키보드 닫힘: KAV가용=screenH → spacer가 잉여(screenH-maxSheetH) 흡수
           *               → Sheet = maxSheetH ✓
           *   키보드 열림: KAV가용=screenH-kbH < maxSheetH
           *               → Sheet가 flexShrink:1로 수축 = screenH-kbH ✓
           *               → ActionBar가 키보드 위에 항상 노출 ✓
           */}
          {/* flexBasis:maxSheetH 인라인 적용 — StyleSheet에서는 동적값 불가 */}
          <View style={[styles.sheet, { flexBasis: maxSheetH, maxHeight: maxSheetH }]}>

            {/* 핸들 바 */}
            <View style={styles.handleContainer}>
              <View style={styles.handle} />
            </View>

            {/* 헤더 — 고정 (flex 없음, 자연 높이) */}
            <View style={styles.header}>
              <Text style={styles.headerTitle}>AI 일지 작성</Text>
              {/* ERROR 상태에서는 헤더 X 숨김 — AIErrorViewV2 내부 닫기 버튼 1개만 유지 */}
              {!hook.isLocked && hook.v2State !== 'ERROR' && (
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
             * - flex:1, minHeight:0: Sheet가 flexBasis로 사이즈 확정 → KASV가 남은 공간 차지
             * - 단일 세로 스크롤 소유자: 내부에 ScrollView 중첩 금지
             * - bottomOffset:16: 포커스된 TextInput과 키보드 사이 여백
             */}
            <KeyboardAwareScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
              showsVerticalScrollIndicator
              bottomOffset={16}
              extraKeyboardSpace={0}
              nestedScrollEnabled
            >
              {renderContent()}
            </KeyboardAwareScrollView>

            {/*
             * ActionBar 컨테이너 — 고정 푸터 (KASV 외부, flex 없음)
             * - paddingBottom = insets.bottom: 홈 인디케이터 겹침 방지
             * - Sheet가 키보드 높이만큼 수축하므로 ActionBar는 항상 키보드 위에 위치
             * - RESULT 긴 콘텐츠에서도 항상 접근 가능
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
  // 전체 오버레이 — Modal 내 전체 화면
  overlay: {
    flex:            1,
    backgroundColor: 'transparent',
  },

  // 백드롭 — Sheet 뒤 반투명 어두운 배경
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },

  // KeyboardAvoidingView — overlay를 꽉 채움
  // Sheet가 하단 고정되도록 flex:1 필수
  kav: {
    flex: 1,
  },

  // 투명 Spacer — Sheet 위 빈 공간
  // flex:1로 잉여 공간을 흡수하여 Sheet가 항상 하단에 위치
  spacer: {
    flex: 1,
  },

  // Sheet — 바텀 시트 본체
  // flexBasis: 코드에서 인라인으로 maxSheetH 적용
  // flexShrink:1: KAV 가용 공간 < maxSheetH 이면 자동 수축
  // maxHeight: 인라인으로 maxSheetH 적용 (안전망)
  // ★ height 고정값 없음
  sheet: {
    flexShrink:           1,
    flexBasis:            'auto',
    backgroundColor:      '#FFFFFF',
    borderTopLeftRadius:  AIThemeRadius.modal ?? 20,
    borderTopRightRadius: AIThemeRadius.modal ?? 20,
    overflow:             'hidden',
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

  // 헤더 (고정, flex 없음)
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
  // flex:1 + minHeight:0: Sheet가 flexBasis로 사이즈 확정 시 남은 공간 차지
  scroll: {
    flex:      1,
    minHeight: 0,
  },
  scrollContent: {
    flexGrow:      1,
    paddingBottom: AIThemeSpacing.section,
  },

  // 콘텐츠 공통 패딩
  contentPad: {
    paddingHorizontal: AIThemeSpacing.section,
    paddingTop:        AIThemeSpacing.element,
  },

  // 로딩 상태
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

  // RESULT 섹션
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

  // ActionBar 컨테이너 (고정 푸터, KASV 외부, flex 없음)
  // paddingBottom은 컴포넌트에서 insets.bottom으로 동적 적용
  actionBarContainer: {
    borderTopWidth:  1,
    borderTopColor:  AIThemeColor.border ?? '#F0F0F0',
    backgroundColor: '#FFFFFF',
  },
});
