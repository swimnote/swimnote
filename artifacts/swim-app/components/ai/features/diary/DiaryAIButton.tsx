/**
 * DiaryAIButton — SwimNote AI UI Framework V2.0 / Phase 4
 * 일지 작성/수정 화면에 주입되는 자기완결형 AI 버튼
 *
 * V2.1 추가: 최초 1회 온보딩 모달 (AsyncStorage 기반)
 */

import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { Sparkles } from 'lucide-react-native';

// ── V2 (현재 활성) ─────────────────────────────────────────────────────────────
import DiaryAIModalV2 from './DiaryAIModalV2';
import type { DiaryInsertResult, StudentContext } from '../../services/DiaryAIService';

// ─── Props ────────────────────────────────────────────────────────────────────

interface DiaryAIButtonProps {
  onInsert:         (result: DiaryInsertResult) => void;
  themeColor:       string;
  existingContent?: string;
  token?:           string;
  teacherId?:       string;
  classId?:         string;
  date?:            string;
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
  const [aiVisible, setAiVisible] = useState(false);

  // AI Diary 첫 사용 안내(구 onboard modal) — 비노출 처리 (새 온보딩 작업에서 재작성 예정)

  const handleButtonPress = useCallback(() => {
    setAiVisible(true);
  }, []);

  const handleInsert = useCallback((result: DiaryInsertResult) => {
    onInsert(result);
  }, [onInsert]);

  return (
    <>
      {/* AI 작성 버튼 */}
      <Pressable
        style={[styles.btn, { borderColor: themeColor }]}
        onPress={handleButtonPress}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      >
        <Sparkles size={13} color={themeColor} />
        <Text style={[styles.btnText, { color: themeColor }]}>AI 작성</Text>
      </Pressable>

      {/* AI 작성 모달 */}
      <DiaryAIModalV2
        visible={aiVisible}
        onInsert={handleInsert}
        onClose={() => setAiVisible(false)}
        existingContent={existingContent}
        token={token}
        teacherId={teacherId}
        classId={classId}
        date={date}
        students={students}
        poolId={poolId}
      />
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  btn: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               4,
    paddingHorizontal: 10,
    paddingVertical:   5,
    borderRadius:      8,
    borderWidth:       1.5,
    backgroundColor:   '#F0FDF4',
  },
  btnText: {
    fontSize:   12,
    fontFamily: 'Pretendard-Regular',
  },
});

// (구 DiaryAIOnboardModal 스타일 제거됨)
