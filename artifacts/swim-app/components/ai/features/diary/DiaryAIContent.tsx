/**
 * DiaryAIContent — SwimNote AI UI Framework V1.0 / Feature: Diary
 * AI 일지 작성 Content 컴포넌트 (State 반응형 레이아웃)
 * Phase 4: onInsert 콜백 + DiaryAIActionBar 내장
 *
 * 의존: useDiaryAI, AI 컴포넌트들, Reanimated
 * 사용: <BaseAIModal content={<DiaryAIContent onInsert={...} onClose={...} />} />
 */

import React, { useCallback, useEffect } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAIContext } from '../../core/AIContext';
import AIErrorView from '../../components/AIErrorView';
import AIInputArea from '../../components/AIInputArea';
import AILoading from '../../components/AILoading';
import AIPermissionView from '../../components/AIPermissionView';
import AIResultArea from '../../components/AIResultArea';
import DiaryAIActionBar from './DiaryAIActionBar';
import { AIThemeColor, AIThemeRadius, AIThemeSpacing, AIThemeTypography } from '../../theme/AITheme';
import { useDiaryAI } from './useDiaryAI';

import type { DiaryInsertResult, StudentContext, StudentDiaryNote } from './useDiaryAI';

// ─── Props ────────────────────────────────────────────────────────────────────

interface DiaryAIContentProps {
  /** [원칙 6] 최종 삽입 시 commonDiary + students[] 단일 구조체로 전달 */
  onInsert?:        (result: DiaryInsertResult) => void;
  onClose:          () => void;
  /**
   * [원칙 1·5] machine.state 변화 시 호출됩니다.
   * true → dismiss 차단 (PROCESSING/RECORDING/RESULT/EDITING)
   * false → dismiss 허용 (INPUT/PERMISSION/ERROR/COMPLETE)
   */
  onLockChange?:    (locked: boolean) => void;
  existingContent?: string;
  // ── [원칙 2] 앱 화면이 공급하는 컨텍스트 데이터 ────────────────────────
  token?:           string;
  teacherId?:       string;
  classId?:         string;
  date?:            string;
  students?:        StudentContext[];
  poolId?:          string;
}

// ─── 상단 입력 요약 (RESULT/EDITING 상태) ─────────────────────────────────────

function InputSummary({ text, onEdit }: { text: string; onEdit: () => void }) {
  return (
    <View style={styles.summaryBox}>
      <Text style={styles.summaryLabel}>입력 내용</Text>
      <View style={styles.summaryRow}>
        <Text style={styles.summaryText} numberOfLines={1} ellipsizeMode="tail">
          {text || '(없음)'}
        </Text>
        <Pressable onPress={onEdit} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.summaryEdit}>수정하기</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ─── 학생별 Draft 섹션 ────────────────────────────────────────────────────────

function StudentDraftSection({
  students,
  onUpdate,
}: {
  students: StudentDiaryNote[];
  onUpdate: (updated: StudentDiaryNote[]) => void;
}) {
  if (students.length === 0) return null;
  return (
    <View style={styles.studentSection}>
      <Text style={styles.studentSectionLabel}>학생별 일지</Text>
      {students.map((s) => (
        <View key={s.studentId} style={styles.studentCard}>
          <Text style={styles.studentName}>{s.studentName}</Text>
          <TextInput
            style={styles.studentInput}
            value={s.note}
            onChangeText={(text) => {
              // studentId 기반 업데이트 — index 의존 없이 올바른 학생 노트만 변경
              onUpdate(students.map(student =>
                student.studentId === s.studentId ? { ...student, note: text } : student
              ));
            }}
            multiline
            textAlignVertical="top"
            placeholder="학생 일지 없음"
            placeholderTextColor={AIThemeColor.textSub}
          />
        </View>
      ))}
    </View>
  );
}

// ─── DiaryAIContent ───────────────────────────────────────────────────────────

export default function DiaryAIContent({
  onInsert,
  onClose,
  onLockChange,
  existingContent,
  token,
  teacherId,
  classId,
  date,
  students,
  poolId,
}: DiaryAIContentProps) {
  const { state, error } = useAIContext();
  const insets = useSafeAreaInsets();

  // ── [TRACE] OTA 적용 증명 marker ─────────────────────────────────────────
  useEffect(() => {
    if (__DEV__) console.log('DIARY_ERROR_ACTIONBAR_FIX_9642537');
  }, []);

  // ── [TRACE] AI state / error 변화 추적 ────────────────────────────────────
  useEffect(() => {
    if (__DEV__) console.log(
      `[AI-CONTENT-STATE]` +
      ` time=${Date.now()}` +
      ` aiState=${state}` +
      ` hasError=${!!error}` +
      ` errorOrigin=${error?.origin ?? '?'}` +
      ` retryTarget=${error?.retryTarget ?? '?'}`
    );
  }, [state, error]);

  const {
    inputText,
    setInputText,
    resultText,
    setResultText,        // [WP5] Common Draft 편집용
    generatedStudents,
    setGeneratedStudents,
    insertDone,
    handleVoicePress,
    handleSubmit,
    handleInsert,
    machine,
  } = useDiaryAI({
    existingContent,
    token,
    teacherId,
    classId,
    date,
    students,
    poolId,
    onInsert,
    onClose,
    onLockChange,
  });

  // [WP12] §2-B: INPUT 상태에서 입력 내용이 있을 때 닫기 확인
  const handleClose = useCallback(() => {
    const hasDirtyInput = state === 'INPUT' && inputText.trim().length > 0;
    if (!hasDirtyInput) {
      onClose();
      return;
    }
    Alert.alert(
      '작성 내용이 있습니다',
      '화면을 닫으면 입력한 내용이 사라집니다.',
      [
        { text: '계속 작성', style: 'cancel' },
        { text: '닫기', style: 'destructive', onPress: onClose },
      ],
    );
  }, [state, inputText, onClose]);

  // ── 레이아웃 모드 판단 ─────────────────────────────────────────────────────
  const showInput   = ['INPUT', 'RECORDING'].includes(state);
  const showSummary = ['RESULT', 'EDITING', 'COMPLETE'].includes(state);
  const showResult  = ['RESULT', 'EDITING', 'COMPLETE'].includes(state);
  const showLoading = ['PROCESSING', 'UPLOADING'].includes(state);

  // ── 콘텐츠 영역 렌더링 ────────────────────────────────────────────────────
  const renderContent = () => {
    if (state === 'ERROR' && error) {
      return <AIErrorView error={error} onClose={onClose} />;
    }
    if (state === 'PERMISSION') {
      return <AIPermissionView types={['microphone']} onClose={onClose} />;
    }
    if (showLoading) {
      return (
        <AILoading
          state={state}
          message={state === 'UPLOADING' ? '음성을 변환하고 있습니다...' : '일지를 작성하고 있습니다...'}
        />
      );
    }
    return (
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* 상단 요약 (RESULT 이후) */}
        {showSummary && (
          <InputSummary
            text={inputText}
            onEdit={() => machine.retry('INPUT')}
          />
        )}

        {/* 입력 영역
            - showInput=false 일 때 완전히 언마운트하여 레이아웃 공간을 없앰
            - gap 기반 레이아웃에서 height:0 view도 gap을 차지하므로
              조건부 렌더링이 빈 공간 문제를 완전히 해소
            - INPUT 복귀(mount) 시 AIInputArea 내부 voiceRowHeight spring이 동작 */}
        {showInput && (
          <AIInputArea
            value={inputText}
            onChangeText={setInputText}
            state={state}
            placeholder="수업 내용을 간단히 입력하거나 음성으로 말씀하세요"
            onVoicePress={handleVoicePress}
          />
        )}

        {/* 결과 카드 — auto height, 외부 ScrollView가 전체 스크롤 담당 */}
        {showResult && (
          // [WP5] onChangeText 전달 → TextInput으로 전환하여 교사가 Common Draft 직접 수정 가능
          <AIResultArea result={resultText} state={state} onChangeText={setResultText} />
        )}

        {/* [WP갭1] 학생별 Draft — 교사 확인 및 수정 */}
        {showResult && (
          <StudentDraftSection
            students={generatedStudents}
            onUpdate={setGeneratedStudents}
          />
        )}
      </ScrollView>
    );
  };

  return (
    <View style={styles.wrapper}>
      {/* 스크롤 콘텐츠 */}
      <View style={styles.contentArea}>
        {renderContent()}
      </View>

      {/* 고정 하단 ActionBar (safe area 포함)
          - ERROR 상태는 AIErrorView 자체에 닫기·재시도 버튼이 있으므로 ActionBar 숨김
          - KeyboardAvoidingView 압축 환경(iPad 가로 + 키보드)에서 두 영역이 겹치는 현상 방지 */}
      {state !== 'ERROR' && state !== 'PERMISSION' && (
        <View style={[styles.actionBarWrap, { paddingBottom: insets.bottom + AIThemeSpacing.element }]}>
          {/* ⚠️ 임시 삽입 안내 — 최종 삽입 정책 확정 전까지 Stage A 테스트용 */}
          {insertDone && (
            <View style={styles.insertNotice}>
              <Text style={styles.insertNoticeText}>공통 일지에 임시 삽입되었습니다</Text>
            </View>
          )}
          <DiaryAIActionBar
            inputText={inputText}
            insertDone={insertDone}
            onSubmit={handleSubmit}
            onInsert={handleInsert}
            onClose={handleClose}
          />
        </View>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
  },
  contentArea: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  contentContainer: {
    gap:             AIThemeSpacing.element,
    paddingVertical: AIThemeSpacing.tight,
    flexGrow:        1,
  },
  summaryBox: {
    backgroundColor:   AIThemeColor.surfaceLight,
    borderRadius:      AIThemeRadius.badge,
    paddingHorizontal: AIThemeSpacing.element,
    paddingTop:        AIThemeSpacing.tight,
    paddingBottom:     AIThemeSpacing.tight,
    gap:               4,
  },
  summaryLabel: {
    ...AIThemeTypography.label,
    color:      AIThemeColor.textSub,
    fontWeight: '600',
    opacity:    0.6,
  },
  summaryRow: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
  },
  summaryText: {
    ...AIThemeTypography.label,
    color: AIThemeColor.text,
    flex:  1,
  },
  summaryEdit: {
    ...AIThemeTypography.label,
    color:      AIThemeColor.primary,
    marginLeft: AIThemeSpacing.tight,
  },
  // resultContainer 제거 — auto height는 wrapper View 없이 AIResultArea 직접 렌더
  actionBarWrap: {
    paddingHorizontal: AIThemeSpacing.section,
    paddingTop:        AIThemeSpacing.element,
    backgroundColor:   AIThemeColor.background,
    borderTopWidth:    1,
    borderTopColor:    AIThemeColor.border,
  },
  // ── 학생별 Draft 섹션 ────────────────────────────────────────────────────
  studentSection: {
    gap: AIThemeSpacing.tight,
  },
  studentSectionLabel: {
    ...AIThemeTypography.label,
    color:             AIThemeColor.textSub,
    fontWeight:        '600' as const,
    opacity:           0.6,
    paddingHorizontal: AIThemeSpacing.element,
  },
  studentCard: {
    backgroundColor:   AIThemeColor.surfaceLight,
    borderRadius:      AIThemeRadius.badge,
    paddingHorizontal: AIThemeSpacing.element,
    paddingTop:        AIThemeSpacing.tight,
    paddingBottom:     AIThemeSpacing.tight,
    gap:               4,
  },
  studentName: {
    ...AIThemeTypography.label,
    color:      AIThemeColor.textSub,
    fontWeight: '600' as const,
  },
  studentInput: {
    ...AIThemeTypography.result,
    color:     AIThemeColor.text,
    minHeight: 56,
    paddingTop: 0,
  },
  // ⚠️ 임시 삽입 안내 — Stage A 테스트용, 최종 삽입 정책 확정 후 교체 예정
  insertNotice: {
    backgroundColor: '#E8F5E9',
    borderRadius:    AIThemeRadius.badge,
    paddingVertical:   6,
    paddingHorizontal: AIThemeSpacing.element,
    marginBottom:      AIThemeSpacing.tight,
    alignItems:        'center',
  },
  insertNoticeText: {
    ...AIThemeTypography.label,
    color:      '#2E7D32',
    fontWeight: '500',
  },
});
