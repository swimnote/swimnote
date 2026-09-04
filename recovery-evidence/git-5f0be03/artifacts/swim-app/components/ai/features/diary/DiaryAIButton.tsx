/**
 * DiaryAIButton — SwimNote AI UI Framework V1.0 / Phase 4
 * 일지 작성/수정 화면에 주입되는 자기완결형 AI 버튼
 *
 * 역할:
 *   - "AI 작성" 버튼 렌더링
 *   - 탭 시 BaseAIModal 오픈
 *   - AI 결과 COMPLETE 시 onInsert(text) 콜백 호출
 *
 * 사용:
 *   <DiaryAIButton
 *     onInsert={(text) => setCommonContent(text)}
 *     themeColor={themeColor}
 *     existingContent={commonContent}
 *   />
 */

import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { Sparkles } from 'lucide-react-native';
import BaseAIModal from '../../core/BaseAIModal';
import DiaryAIContent from './DiaryAIContent';
import type { DiaryInsertResult, StudentContext } from './useDiaryAI';

// ─── Props ────────────────────────────────────────────────────────────────────

interface DiaryAIButtonProps {
  /**
   * [원칙 6] AI 작업이 완전히 확정된 시점에만 호출됩니다.
   * commonDiary → 공통 일지, students[] → 학생별 일지 (studentId 기준)
   */
  onInsert:         (result: DiaryInsertResult) => void;
  /** 버튼 색상 (수업 테마 컬러) */
  themeColor:       string;
  /** 이미 입력된 일지 내용 (AI 컨텍스트 참고용) */
  existingContent?: string;
  // ── [원칙 2] 앱 화면이 공급하는 데이터 ──────────────────────────────────
  token?:           string;
  teacherId?:       string;
  classId?:         string;
  date?:            string;
  /** 학생목록 (studentId + studentName) */
  students?:        StudentContext[];
  poolId?:          string;
}

// ─── DiaryAIButton ────────────────────────────────────────────────────────────

export default function DiaryAIButton({
  onInsert,
  themeColor,
  existingContent,
  token,
  teacherId,
  classId,
  date,
  students,
  poolId,
}: DiaryAIButtonProps) {
  const [visible,     setVisible]     = useState(false);
  /**
   * [원칙 1·5] AI 작업 중 백드롭·스와이프로 작업공간이 사라지지 않도록 제어합니다.
   * useDiaryAI가 machine.state 변화에 따라 onLockChange를 호출합니다.
   */
  const [lockDismiss, setLockDismiss] = useState(false);

  const handleInsert = useCallback((result: DiaryInsertResult) => {
    onInsert(result);
  }, [onInsert]);

  return (
    <>
      {/* AI 작성 버튼 */}
      <Pressable
        style={[styles.btn, { borderColor: themeColor }]}
        onPress={() => setVisible(true)}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      >
        <Sparkles size={13} color={themeColor} />
        <Text style={[styles.btnText, { color: themeColor }]}>AI 작성</Text>
      </Pressable>

      {/* AI 모달 — [원칙 1] lockDismiss=true 구간에서 닫기 차단 */}
      <BaseAIModal
        visible={visible}
        featureType="diary"
        title="AI 일지 작성"
        onClose={() => setVisible(false)}
        lockDismiss={lockDismiss}
        content={
          <DiaryAIContent
            onInsert={handleInsert}
            onClose={() => setVisible(false)}
            onLockChange={setLockDismiss}
            existingContent={existingContent}
            token={token}
            teacherId={teacherId}
            classId={classId}
            date={date}
            students={students}
            poolId={poolId}
          />
        }
        // actionBar는 DiaryAIContent 내부에 포함됨
      />
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  btn: {
    flexDirection:    'row',
    alignItems:       'center',
    gap:              4,
    paddingHorizontal: 10,
    paddingVertical:   5,
    borderRadius:     8,
    borderWidth:      1.5,
    backgroundColor:  '#F0FDF4',
  },
  btnText: {
    fontSize:    12,
    fontFamily:  'Pretendard-Regular',
  },
});
