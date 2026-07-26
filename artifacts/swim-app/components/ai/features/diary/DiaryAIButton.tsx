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

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { Sparkles } from 'lucide-react-native';
import BaseAIModal from '../../core/BaseAIModal';
import DiaryAIContent from './DiaryAIContent';

// ─── Props ────────────────────────────────────────────────────────────────────

interface DiaryAIButtonProps {
  /** AI 결과 텍스트를 받아 일지 textarea에 삽입하는 콜백 */
  onInsert:         (text: string) => void;
  /** 버튼 색상 (수업 테마 컬러) */
  themeColor:       string;
  /** 이미 입력된 일지 내용 (AI 컨텍스트 참고용) */
  existingContent?: string;
  /** 학생/수업 컨텍스트 (향후 API 연결용) */
  studentId?:       string;
  classId?:         string;
  poolId?:          string;
}

// ─── DiaryAIButton ────────────────────────────────────────────────────────────

export default function DiaryAIButton({
  onInsert,
  themeColor,
  existingContent,
  studentId,
  classId,
  poolId,
}: DiaryAIButtonProps) {
  const [visible, setVisible] = useState(false);

  const handleInsert = (text: string) => {
    onInsert(text);
    // 모달은 COMPLETE 애니메이션 후 자동으로 닫힘
  };

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

      {/* AI 모달 */}
      <BaseAIModal
        visible={visible}
        featureType="diary"
        title="AI 일지 작성"
        onClose={() => setVisible(false)}
        content={
          <DiaryAIContent
            onInsert={handleInsert}
            onClose={() => setVisible(false)}
            existingContent={existingContent}
            studentId={studentId}
            classId={classId}
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
