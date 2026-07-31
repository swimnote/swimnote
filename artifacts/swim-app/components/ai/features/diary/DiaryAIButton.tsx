/**
 * DiaryAIButton — SwimNote AI UI Framework V2.0 / Phase 4
 * 일지 작성/수정 화면에 주입되는 자기완결형 AI 버튼
 *
 * 역할:
 *   - "AI 작성" 버튼 렌더링
 *   - 탭 시 DiaryAIModalV2 오픈
 *   - AI 결과 삽입 시 onInsert(DiaryInsertResult) 콜백 호출
 *
 * V2 변경 사항:
 *   - BaseAIModal + DiaryAIContent → DiaryAIModalV2 (단일 컴포넌트)
 *   - lockDismiss 상태 불필요 (DiaryAIModalV2 내부 isLocked로 처리)
 *   - AIProvider / AIContext 불필요
 *
 * 롤백 방법:
 *   - V1 섹션 주석 해제, V2 섹션 주석 처리
 *   - 기존 파일(BaseAIModal, DiaryAIContent 등)은 삭제되지 않음
 *
 * 사용:
 *   <DiaryAIButton
 *     onInsert={(result) => { setCommonContent(result.commonDiary); ... }}
 *     themeColor={themeColor}
 *     existingContent={commonContent}
 *   />
 */

import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { Sparkles } from 'lucide-react-native';

// ── V2 (현재 활성) ─────────────────────────────────────────────────────────────
import DiaryAIModalV2 from './DiaryAIModalV2';
import type { DiaryInsertResult, StudentContext } from '../../services/DiaryAIService';

// ── V1 (보존 — 검증 완료 후 제거) ──────────────────────────────────────────────
// import BaseAIModal    from '../../core/BaseAIModal';
// import DiaryAIContent from './DiaryAIContent';
// import type { DiaryInsertResult, StudentContext } from './useDiaryAI';

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
  const [visible, setVisible] = useState(false);

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

      {/* ── V2 모달 (현재 활성) ────────────────────────────────────────────── */}
      <DiaryAIModalV2
        visible={visible}
        onInsert={handleInsert}
        onClose={() => setVisible(false)}
        existingContent={existingContent}
        token={token}
        teacherId={teacherId}
        classId={classId}
        date={date}
        students={students}
        poolId={poolId}
      />

      {/* ── V1 모달 (보존 — 검증 완료 후 제거) ────────────────────────────── */}
      {/* <BaseAIModal
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
      /> */}
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
