/**
 * AI Preview — SwimNote AI UI Framework 개발 검증 화면
 *
 * ⚠️ 개발/내부 테스트 전용입니다.
 * - 프로덕션 사용자에게 노출되지 않는 (admin) 경로에 위치
 * - __DEV__ 모드 외에서는 접근 제한 메시지 표시
 * - 실제 API 호출 없음, 더미 데이터만 사용
 *
 * 검증 가능한 흐름:
 *   A: OPEN → INPUT → RECORDING → PROCESSING → RESULT → EDITING → COMPLETE → CLOSED
 *   B: OPEN → PERMISSION → ERROR → PERMISSION 재시도 → INPUT
 *   C: OPEN → INPUT → PROCESSING → NETWORK ERROR → INPUT → PROCESSING → RESULT
 *   D: OPEN → INPUT → CREDIT ERROR → CLOSED
 *   E: OPEN → RESULT → 내부 스크롤 → 최상단 → Swipe Down → CLOSED
 *   F: Reduce Motion 토글 → OPEN → PROCESSING → RESULT → COMPLETE → CLOSED
 */

import React, { useState } from 'react';
import {
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import BaseAIModal from '@/components/ai/core/BaseAIModal';
import DiaryAIContent from '@/components/ai/features/diary/DiaryAIContent';
import DiaryAIActionBar from '@/components/ai/features/diary/DiaryAIActionBar';
import { useAIContext } from '@/components/ai/core/AIContext';
import { useAIStateMachine } from '@/components/ai/hooks/useAIStateMachine';
import type { AIState } from '@/components/ai/core/AIContracts';
import { AIThemeColor, AIThemeRadius, AIThemeSpacing, AIThemeTypography } from '@/components/ai/theme/AITheme';

// ─── 프리뷰용 더미 결과 텍스트 ────────────────────────────────────────────────

const DUMMY_RESULT = `오늘 수업에서 학생은 킥 동작의 기본 자세를 집중적으로 연습했습니다. 발등을 펴고 무릎을 최소화하는 킥 패턴에서 눈에 띄는 개선이 있었으며, 리듬감도 이전 수업 대비 안정적으로 유지되었습니다.

호흡 타이밍은 아직 자연스럽지 않은 부분이 있어 다음 수업에서는 팔 동작과 호흡의 연계를 중점적으로 다룰 예정입니다.

전반적으로 집중력과 체력 면에서 긍정적인 발전을 보여주었습니다.`;

// ─── 내부 컨트롤 패널 (AIProvider 안에서 호출) ───────────────────────────────

function PreviewControls({ onClose }: { onClose: () => void }) {
  const { state } = useAIContext();
  const machine   = useAIStateMachine();

  const jumpTo = (s: AIState) => {
    // 목표 State로 직접 이동 (유효한 전환만 실행)
    switch (s) {
      case 'INPUT':      machine.grantPermission(); break;
      case 'RECORDING':  machine.startRecording();  break;
      case 'UPLOADING':  machine.startUpload();      break;
      case 'PROCESSING': machine.submit();            break;
      case 'RESULT':     machine.receiveResult();    break;
      case 'EDITING':    machine.edit();              break;
      case 'COMPLETE':   machine.complete();          break;
    }
  };

  const triggerError = (origin: 'PERMISSION' | 'NETWORK' | 'CREDIT') => {
    machine.setError({
      origin,
      message: {
        PERMISSION: '마이크 권한이 거부되었습니다.',
        NETWORK:    '네트워크 연결을 확인해주세요.',
        CREDIT:     '크레딧이 부족합니다.',
      }[origin],
      retryTarget: origin === 'CREDIT' ? null : origin === 'PERMISSION' ? 'PERMISSION' : 'INPUT',
    });
  };

  const STATE_BUTTONS: { label: string; state: AIState }[] = [
    { label: 'INPUT',      state: 'INPUT'      },
    { label: 'RECORDING',  state: 'RECORDING'  },
    { label: 'UPLOADING',  state: 'UPLOADING'  },
    { label: 'PROCESSING', state: 'PROCESSING' },
    { label: 'RESULT',     state: 'RESULT'     },
    { label: 'EDITING',    state: 'EDITING'    },
    { label: 'COMPLETE',   state: 'COMPLETE'   },
  ];

  return (
    <View style={ctrl.panel}>
      <Text style={ctrl.currentState}>현재 State: <Text style={ctrl.stateName}>{state}</Text></Text>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={ctrl.scrollRow}>
        {STATE_BUTTONS.map(b => (
          <Pressable key={b.state} style={ctrl.stateBtn} onPress={() => jumpTo(b.state)}>
            <Text style={ctrl.stateBtnLabel}>{b.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={ctrl.errorRow}>
        <Text style={ctrl.sectionTitle}>오류 주입</Text>
        <View style={ctrl.row}>
          {(['PERMISSION', 'NETWORK', 'CREDIT'] as const).map(o => (
            <Pressable key={o} style={ctrl.errBtn} onPress={() => triggerError(o)}>
              <Text style={ctrl.errBtnLabel}>{o}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <Pressable style={ctrl.closeBtn} onPress={onClose}>
        <Text style={ctrl.closeBtnLabel}>닫기 (내부)</Text>
      </Pressable>
    </View>
  );
}

// ─── 프리뷰 ActionBar ─────────────────────────────────────────────────────────

function PreviewActionBar({ onClose }: { onClose: () => void }) {
  const { state }  = useAIContext();
  const machine    = useAIStateMachine();

  return (
    <DiaryAIActionBar
      inputText="(프리뷰 입력 텍스트)"
      onSubmit={() => {
        machine.submit();
        // 더미: 1초 후 결과
        setTimeout(() => machine.receiveResult(), 1000);
      }}
      onInsert={() => machine.complete()}
      onClose={onClose}
    />
  );
}

// ─── 메인 Preview 화면 ───────────────────────────────────────────────────────

export default function AIPreviewScreen() {
  const [modalVisible,  setModalVisible]  = useState(false);
  const [simulateReducedMotion, setSimulateReducedMotion] = useState(false);

  // 개발 환경 가드
  if (!__DEV__) {
    return (
      <SafeAreaView style={main.blocked}>
        <Text style={main.blockedText}>
          이 화면은 개발 환경 전용입니다.
        </Text>
      </SafeAreaView>
    );
  }

  const openModal = () => setModalVisible(true);
  const closeModal = () => setModalVisible(false);

  return (
    <SafeAreaView style={main.container}>
      <ScrollView contentContainerStyle={main.scroll}>
        <Text style={main.title}>🛠 AI UI Framework Preview</Text>
        <Text style={main.subtitle}>SwimNote AI Motion System — Phase 2 검증 화면</Text>

        {/* Reduce Motion 토글 */}
        <View style={main.toggleRow}>
          <Text style={main.toggleLabel}>Reduce Motion 시뮬레이션</Text>
          <Switch
            value={simulateReducedMotion}
            onValueChange={setSimulateReducedMotion}
            trackColor={{ true: AIThemeColor.primary }}
          />
        </View>
        {simulateReducedMotion && (
          <Text style={main.hint}>
            ⚠️ 시스템 설정의 Reduce Motion을 직접 켜야 효과가 적용됩니다.
            {Platform.OS === 'ios'
              ? '\n설정 → 손쉬운 사용 → 모션 줄이기'
              : '\n설정 → 접근성 → 애니메이션 제거'}
          </Text>
        )}

        {/* 검증 흐름 안내 */}
        <View style={main.section}>
          <Text style={main.sectionTitle}>검증 흐름</Text>
          {[
            'A: OPEN → INPUT → RECORDING → PROCESSING → RESULT → EDITING → COMPLETE → CLOSED',
            'B: OPEN → PERMISSION → ERROR → 재시도 → INPUT',
            'C: OPEN → INPUT → PROCESSING → NETWORK ERROR → INPUT → RESULT',
            'D: OPEN → INPUT → CREDIT ERROR → CLOSED',
            'E: OPEN → RESULT → 내부 스크롤 → Swipe Down → CLOSED',
            'F: Reduce Motion 활성화 → OPEN → PROCESSING → RESULT → COMPLETE → CLOSED',
          ].map((flow, i) => (
            <Text key={i} style={main.flowItem}>{flow}</Text>
          ))}
        </View>

        {/* 모달 열기 버튼 */}
        <Pressable style={main.openBtn} onPress={openModal}>
          <Text style={main.openBtnLabel}>모달 열기 (Open Modal)</Text>
        </Pressable>

        {/* 체크리스트 */}
        <View style={main.section}>
          <Text style={main.sectionTitle}>확인 항목</Text>
          {[
            '모달 슬라이드 업 애니메이션',
            '백드롭 페이드인',
            '핸들 Swipe Down → 닫기',
            '기준 미달 Swipe → Spring 원위치',
            'RECORDING: 파형 애니메이션',
            'PROCESSING: Shimmer Skeleton',
            'RESULT: 카드 등장 + 타이핑 효과',
            'ERROR: 재시도 버튼 동작',
            'CREDIT ERROR → CLOSED',
            'Reduce Motion: opacity 전환만',
            'Shimmer: State 종료 후 중단',
          ].map((item, i) => (
            <Text key={i} style={main.checkItem}>☐ {item}</Text>
          ))}
        </View>
      </ScrollView>

      {/* AI 모달 */}
      <BaseAIModal
        visible={modalVisible}
        onClose={closeModal}
        featureType="diary"
        title="AI 일지 작성 (프리뷰)"
        content={
          <View style={{ flex: 1 }}>
            <DiaryAIContent
              existingContent="(기존 일지 내용 샘플)"
              onClose={closeModal}
            />
            {/* 내부 컨트롤 패널 (프리뷰 전용) */}
            <PreviewControls onClose={closeModal} />
          </View>
        }
        actionBar={<PreviewActionBar onClose={closeModal} />}
      />
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const main = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  scroll: {
    padding:  AIThemeSpacing.section,
    gap:      AIThemeSpacing.element,
  },
  title: {
    fontSize:   22,
    fontWeight: '700',
    color:      AIThemeColor.text,
  },
  subtitle: {
    ...AIThemeTypography.label,
    color: AIThemeColor.textSub,
    marginBottom: AIThemeSpacing.element,
  },
  toggleRow: {
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'space-between',
    backgroundColor: '#FFFFFF',
    borderRadius:    AIThemeRadius.card,
    padding:         AIThemeSpacing.element,
  },
  toggleLabel: {
    ...AIThemeTypography.input,
    color: AIThemeColor.text,
  },
  hint: {
    ...AIThemeTypography.label,
    color:        AIThemeColor.warning,
    marginTop:   -AIThemeSpacing.tight,
  },
  section: {
    backgroundColor: '#FFFFFF',
    borderRadius:    AIThemeRadius.card,
    padding:         AIThemeSpacing.element,
    gap:             AIThemeSpacing.tight,
  },
  sectionTitle: {
    ...AIThemeTypography.heading,
    color:        AIThemeColor.text,
    marginBottom: AIThemeSpacing.tight,
  },
  flowItem: {
    ...AIThemeTypography.label,
    color:      AIThemeColor.textSub,
    lineHeight: 20,
  },
  checkItem: {
    ...AIThemeTypography.label,
    color: AIThemeColor.text,
  },
  openBtn: {
    height:          56,
    borderRadius:    AIThemeRadius.button,
    backgroundColor: AIThemeColor.primary,
    alignItems:      'center',
    justifyContent:  'center',
  },
  openBtnLabel: {
    ...AIThemeTypography.heading,
    color: '#FFFFFF',
  },
  blocked: {
    flex:           1,
    alignItems:     'center',
    justifyContent: 'center',
  },
  blockedText: {
    ...AIThemeTypography.result,
    color: AIThemeColor.textSub,
  },
});

const ctrl = StyleSheet.create({
  panel: {
    backgroundColor: AIThemeColor.surfaceDark,
    borderRadius:    AIThemeRadius.card,
    padding:         AIThemeSpacing.element,
    gap:             AIThemeSpacing.tight,
    marginTop:       AIThemeSpacing.element,
  },
  currentState: {
    ...AIThemeTypography.label,
    color: '#94A3B8',
  },
  stateName: {
    color:      AIThemeColor.primary,
    fontWeight: '700',
  },
  scrollRow: {
    flexGrow: 0,
  },
  row: {
    flexDirection: 'row',
    gap:           AIThemeSpacing.tight,
    flexWrap:      'wrap',
  },
  stateBtn: {
    paddingHorizontal: AIThemeSpacing.element,
    paddingVertical:   AIThemeSpacing.tight,
    backgroundColor:  'rgba(255,255,255,0.12)',
    borderRadius:      AIThemeRadius.badge,
    marginRight:       AIThemeSpacing.tight,
  },
  stateBtnLabel: {
    ...AIThemeTypography.label,
    color: '#E2E8F0',
    fontSize: 11,
  },
  errorRow: {
    gap: AIThemeSpacing.tight,
  },
  sectionTitle: {
    ...AIThemeTypography.label,
    color: '#94A3B8',
    fontSize: 11,
  },
  errBtn: {
    paddingHorizontal: AIThemeSpacing.element,
    paddingVertical:   AIThemeSpacing.tight,
    backgroundColor:  'rgba(239,68,68,0.25)',
    borderRadius:      AIThemeRadius.badge,
  },
  errBtnLabel: {
    ...AIThemeTypography.label,
    color:    '#FCA5A5',
    fontSize: 11,
  },
  closeBtn: {
    height:          36,
    borderRadius:    AIThemeRadius.badge,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems:      'center',
    justifyContent:  'center',
  },
  closeBtnLabel: {
    ...AIThemeTypography.label,
    color: '#94A3B8',
  },
});
