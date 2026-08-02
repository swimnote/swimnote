/**
 * DiaryAIButton — SwimNote AI UI Framework V2.0 / Phase 4
 * 일지 작성/수정 화면에 주입되는 자기완결형 AI 버튼
 *
 * V2.1 추가: 최초 1회 온보딩 모달 (AsyncStorage 기반)
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  Modal, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { Sparkles } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// ── V2 (현재 활성) ─────────────────────────────────────────────────────────────
import DiaryAIModalV2 from './DiaryAIModalV2';
import type { DiaryInsertResult, StudentContext } from '../../services/DiaryAIService';

// ─── 상수 ─────────────────────────────────────────────────────────────────────
const ONBOARD_KEY = '@swimnote:ai_diary_onboard_seen';

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
  const [aiVisible,       setAiVisible]       = useState(false);
  const [onboardVisible,  setOnboardVisible]  = useState(false);
  const [onboardChecked,  setOnboardChecked]  = useState(false);

  // 온보딩 완료 여부 로드
  useEffect(() => {
    AsyncStorage.getItem(ONBOARD_KEY).then(v => {
      setOnboardChecked(v === '1');
    }).catch(() => { setOnboardChecked(true); });
  }, []);

  const handleButtonPress = useCallback(() => {
    if (!onboardChecked) {
      setOnboardVisible(true);
    } else {
      setAiVisible(true);
    }
  }, [onboardChecked]);

  const handleOnboardStart = useCallback(async () => {
    await AsyncStorage.setItem(ONBOARD_KEY, '1').catch(() => {});
    setOnboardChecked(true);
    setOnboardVisible(false);
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

      {/* 온보딩 모달 */}
      <DiaryAIOnboardModal
        visible={onboardVisible}
        onStart={handleOnboardStart}
      />

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

// ─── 온보딩 모달 ──────────────────────────────────────────────────────────────

function DiaryAIOnboardModal({
  visible,
  onStart,
}: {
  visible:  boolean;
  onStart:  () => void;
}) {
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      statusBarTranslucent
    >
      <View style={ob.overlay}>
        <View style={[ob.sheet, { paddingBottom: insets.bottom + 16 }]}>
          {/* 헤더 */}
          <View style={ob.header}>
            <Sparkles size={18} color="#2EC4B6" />
            <Text style={ob.title}>AI 일지 사용법</Text>
          </View>

          {/* 내용 스크롤 */}
          <ScrollView
            style={ob.scroll}
            contentContainerStyle={ob.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <Text style={ob.intro}>
              SWIMNOTE AI는 간단한 메모만으로도{'\n'}
              수업일지를 자동으로 완성합니다.
            </Text>

            {/* ① */}
            <View style={ob.stepBlock}>
              <Text style={ob.stepNum}>①  전체 내용을 먼저 말하세요.</Text>
              <View style={ob.exampleBox}>
                <Text style={ob.exampleLabel}>예)</Text>
                <Text style={ob.exampleText}>"오늘은 자유형 호흡과 팔돌리기를 연습했습니다."</Text>
              </View>
              <Text style={ob.arrow}>↓</Text>
              <Text style={ob.result}>공통 일지로 작성됩니다.</Text>
            </View>

            {/* ② */}
            <View style={ob.stepBlock}>
              <Text style={ob.stepNum}>②  학생 이름을 말한 뒤 내용을 말하세요.</Text>
              <View style={ob.exampleBox}>
                <Text style={ob.exampleLabel}>예)</Text>
                <Text style={ob.exampleText}>"서태웅 호흡 타이밍이 많이 좋아졌어요."</Text>
              </View>
              <Text style={ob.arrow}>↓</Text>
              <Text style={ob.result}>서태웅 학생의 개인 일지에만 작성됩니다.</Text>
            </View>

            {/* ③ */}
            <View style={ob.stepBlock}>
              <Text style={ob.stepNum}>③  다시 "전체"라고 말하면{'\n'}    공통 일지 작성으로 전환됩니다.</Text>
              <View style={ob.exampleBox}>
                <Text style={ob.exampleLabel}>예)</Text>
                <Text style={ob.exampleText}>
                  {"\"전체\"\n\"마무리 스트레칭까지 진행했습니다.\""}
                </Text>
              </View>
              <Text style={ob.arrow}>↓</Text>
              <Text style={ob.result}>다시 공통 일지에 작성됩니다.</Text>
            </View>

            {/* 하단 안내 */}
            <View style={ob.noteBox}>
              <Text style={ob.noteText}>
                SWIMNOTE AI는{'\n'}
                교육 커리큘럼과 템플릿을 우선 활용하여{'\n'}
                일지를 생성합니다.{'\n\n'}
                커리큘럼이나 템플릿에 없는 내용은{'\n'}
                새로운 수영 내용을 만들어내지 않고{'\n\n'}
                선생님이 입력한 내용을{'\n'}
                자연스럽고 읽기 좋은 문장으로만 정리합니다.
              </Text>
            </View>
          </ScrollView>

          {/* 시작하기 버튼 */}
          <Pressable
            style={({ pressed }) => [ob.startBtn, { opacity: pressed ? 0.85 : 1 }]}
            onPress={onStart}
          >
            <Text style={ob.startBtnText}>시작하기</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
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

const ob = StyleSheet.create({
  overlay: {
    flex:            1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent:  'center',
    alignItems:      'center',
    paddingHorizontal: 20,
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderRadius:    20,
    width:           '100%',
    maxHeight:       '88%',
    paddingTop:      24,
    paddingHorizontal: 20,
    gap:             16,
    shadowColor:     '#000',
    shadowOffset:    { width: 0, height: 4 },
    shadowOpacity:   0.15,
    shadowRadius:    12,
    elevation:       10,
  },
  header: {
    flexDirection:  'row',
    alignItems:     'center',
    gap:            8,
  },
  title: {
    fontSize:   18,
    fontFamily: 'Pretendard-Regular',
    color:      '#0F172A',
  },
  scroll: {
    flexShrink: 1,
  },
  scrollContent: {
    gap: 16,
    paddingBottom: 4,
  },
  intro: {
    fontSize:   14,
    fontFamily: 'Pretendard-Regular',
    color:      '#334155',
    lineHeight: 22,
  },
  stepBlock: {
    gap: 6,
    backgroundColor: '#F8FAFC',
    borderRadius:    12,
    padding:         14,
    borderLeftWidth: 3,
    borderLeftColor: '#2EC4B6',
  },
  stepNum: {
    fontSize:   14,
    fontFamily: 'Pretendard-Regular',
    color:      '#0F172A',
    lineHeight: 22,
  },
  exampleBox: {
    flexDirection: 'row',
    gap:           6,
    paddingLeft:   4,
  },
  exampleLabel: {
    fontSize:   12,
    fontFamily: 'Pretendard-Regular',
    color:      '#64748B',
    marginTop:  2,
  },
  exampleText: {
    flex:       1,
    fontSize:   13,
    fontFamily: 'Pretendard-Regular',
    color:      '#1B3A70',
    lineHeight: 20,
    fontStyle:  'italic',
  },
  arrow: {
    fontSize:   16,
    color:      '#2EC4B6',
    textAlign:  'center',
    marginVertical: 2,
  },
  result: {
    fontSize:   13,
    fontFamily: 'Pretendard-Regular',
    color:      '#2EC4B6',
    textAlign:  'center',
  },
  noteBox: {
    backgroundColor: '#F1F5F9',
    borderRadius:    12,
    padding:         14,
  },
  noteText: {
    fontSize:   13,
    fontFamily: 'Pretendard-Regular',
    color:      '#475569',
    lineHeight: 22,
  },
  startBtn: {
    backgroundColor: '#1B3A70',
    borderRadius:    14,
    height:          50,
    alignItems:      'center',
    justifyContent:  'center',
  },
  startBtnText: {
    fontSize:   16,
    fontFamily: 'Pretendard-Regular',
    color:      '#FFFFFF',
  },
});
