/**
 * useDiaryAI — SwimNote AI UI Framework V1.0 / Feature: Diary
 * 일지 AI 작성 비즈니스 로직
 *
 * 의존: useAIStateMachine, AIContracts
 * 사용: DiaryAIContent
 *
 * TODO: 실제 API 서버 연결 (POST /ai/diary/generate)
 * TODO: Whisper 음성 인식 연결
 * TODO: 현재 학생/수업 컨텍스트 수집
 */

import { useEffect, useRef, useState } from 'react';
import { useAIStateMachine } from '../../hooks/useAIStateMachine';

interface UseDiaryAIOptions {
  /** 현재 일지 템플릿에 이미 입력된 내용 */
  existingContent?: string;
  studentId?:       string;
  classId?:         string;
  poolId?:          string;
  /** COMPLETE 시 결과 텍스트를 부모에게 전달하는 콜백 */
  onInsert?:        (text: string) => void;
  /** 삽입 완료 후 모달을 닫는 콜백 (machine.complete() 대신 직접 닫기) */
  onClose?:         () => void;
}

export function useDiaryAI(options: UseDiaryAIOptions = {}) {
  const machine = useAIStateMachine();
  const [inputText, setInputText]   = useState('');
  const [resultText, setResultText] = useState('');

  // "다시 작성" 호출 횟수 — 더미 구분용 (Phase 3 실 API 교체 시 제거)
  const rewriteCountRef = useRef(0);

  // "삽입 완료" 버튼 피드백 상태 (Stage A 임시)
  const [insertDone, setInsertDone] = useState(false);
  const insertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (insertTimerRef.current) clearTimeout(insertTimerRef.current);
    };
  }, []);

  // ─── 모달 마운트 시 CLOSED → OPENING → INPUT 자동 전환 ──────────────────
  useEffect(() => {
    machine.open(); // CLOSED → OPENING
  }, []);

  useEffect(() => {
    if (machine.state === 'OPENING') {
      machine.grantPermission(); // OPENING → INPUT
    }
  }, [machine.state]);

  // ─── 음성 입력 ──────────────────────────────────────────────────────────

  const handleVoicePress = async () => {
    console.log(`[useDiaryAI] handleVoicePress called — state=${machine.state} isRECORDING=${machine.is('RECORDING')}`);
    if (machine.is('RECORDING')) {
      console.log('[useDiaryAI] → stopRecording path');
      machine.stopRecording();
      await processVoice();
    } else {
      console.log('[useDiaryAI] → startRecording path');
      machine.startRecording();
    }
  };

  const processVoice = async () => {
    // STOP_RECORDING 이벤트가 이미 RECORDING → INPUT 전환을 완료한 상태에서 진입
    // AI 자동 실행 없음 — 사용자가 "AI 작성" 버튼을 눌렀을 때만 generateDiary() 호출
    try {
      console.log('[VOICE-0] processVoice 시작 — STT 변환 단계 (AI 자동 실행 없음)');
      // TODO: expo-av 녹음 파일 → Whisper API 호출 → 텍스트 반환
      // const transcript = await transcribeAudio(audioUri);
      // setInputText(transcript);
      // STT 완료 후 INPUT 상태 유지 — 사용자가 텍스트 확인/수정 후 AI 작성 버튼 탭
      console.log('[VOICE-1] processVoice 완료 — INPUT 상태 대기 중');
    } catch (e: any) {
      console.error('[VOICE-ERR] processVoice 오류:', e?.message ?? e);
      machine.setError({
        origin:      'NETWORK',
        message:     '음성 인식에 실패했습니다. 다시 시도해주세요.',
        retryTarget: 'INPUT',
      });
    }
  };

  // ─── 텍스트 제출 / 다시 작성 ────────────────────────────────────────────

  const handleSubmit = async () => {
    console.log('[REWRITE-CALL] handleSubmit() 진입 — state:', machine.state, 'inputText길이:', inputText.length);
    console.log('[REWRITE-1] 다시 작성/AI작성 클릭 — state:', machine.state, 'inputText길이:', inputText.length);

    if (machine.state === 'RESULT' || machine.state === 'EDITING') {
      // RESULT/EDITING → INPUT → PROCESSING
      console.log('[REWRITE-2] RESULT 상태 → retry(INPUT) 선행');
      rewriteCountRef.current += 1;
      console.log('[REWRITE-COUNT] rewriteCountRef 증가 →', rewriteCountRef.current);
      console.log('[REWRITE-2b] 재작성 횟수:', rewriteCountRef.current);
      console.log(`[REWRITE-RESULT] 다시 작성 클릭 시점 resultText="${resultText.slice(0, 20)}" length=${resultText.length}`);
      machine.retry('INPUT');
    } else if (!inputText.trim()) {
      // INPUT 상태에서 inputText 없으면 스킵
      console.log('[REWRITE-1] 스킵 — INPUT 상태이고 inputText 없음');
      return;
    }

    console.log('[REWRITE-3] machine.submit() 호출');
    machine.submit();  // INPUT → PROCESSING
    console.log('[REWRITE-4] generateDiary() 시작');
    await generateDiary();
  };

  const generateDiary = async () => {
    // ⚠️ 더미 결과 — Phase 3에서 실제 API 교체 예정
    const BASE_DUMMY = '오늘은 자유형 발차기와 호흡 연습을 진행했습니다. 학생들이 발차기 자세를 교정하며 호흡 타이밍을 맞추는 연습을 했고, 전반적으로 좋은 향상을 보였습니다.';
    // 재작성 횟수를 더미 결과 끝에 표시하여 재실행 여부를 눈으로 확인
    const count = rewriteCountRef.current;
    const DUMMY_RESULT = count > 0
      ? `${BASE_DUMMY} (더미 재작성 ${count})`
      : BASE_DUMMY;

    try {
      console.log('[GENERATE-1] generateDiary 시작 — rewriteCount:', count);
      console.log('[GENERATE-2] transcript=(더미) result=(생성예정) state:', machine.state);

      // TODO Phase 3: 실제 API 호출 (아래 더미 지연 및 DUMMY_RESULT 제거)
      // const resp = await apiClient.post('/ai/diary/generate', { input: inputText, ... });
      // setResultText(resp.text);

      // ── 더미 최소 지연 (1500ms) ─────────────────────────────────────────
      // 실제 API 연결 시 이 줄 제거 — 네트워크 응답 대기가 자연스러운 PROCESSING 시간
      await new Promise<void>((resolve) => setTimeout(resolve, 1500));
      // ────────────────────────────────────────────────────────────────────

      console.log('[GENERATE-3] setResultText 직전 — 더미 텍스트 길이:', DUMMY_RESULT.length);
      console.log(`[RESULT-SET] "${resultText.slice(0, 20) || '(빈값)'}" → "${DUMMY_RESULT.slice(0, 20)}"`);
      setResultText(DUMMY_RESULT);
      console.log('[GENERATE-4] setResultText 완료 — machine.receiveResult() 직전');
      machine.receiveResult();
      console.log('[GENERATE-5] machine.receiveResult() 완료 — resultText:', DUMMY_RESULT.slice(0, 30));
    } catch (e: any) {
      console.error('[GENERATE-ERR] generateDiary 오류:', e?.message ?? e);
      machine.setError({
        origin:      'NETWORK',
        message:     'AI 생성에 실패했습니다. 네트워크를 확인해주세요.',
        retryTarget: 'INPUT',
      });
    }
  };

  // ─── 일지 삽입 (단계별 격리 테스트) ────────────────────────────────────
  //
  //  ★ 크래시 격리 절차 ★
  //  Stage A: 현재 상태 — onInsert만 실행, 모달 닫지 않음
  //  Stage B: A 성공 후 → [STAGE-B] 주석 해제
  //  Stage C: B 성공 후 → [STAGE-C] 주석 해제
  //  Stage D: C 크래시 시 → AIResultArea.tsx의 CRASH_TEST_DISABLE_ANIMATION = true

  const handleInsert = () => {
    console.log('[INSERT-1] 버튼 클릭 — handleInsert 진입');
    console.log('[INSERT-2] result 확인:', resultText ? `길이=${resultText.length}자` : '(없음)');

    // ── STAGE A + B: onInsert → onClose (모달 닫기) ──────────────────────
    // ⚠️ 최종 삽입 위치/정책 미확정 — setCommonContent는 테스트용 임시 삽입
    if (options.onInsert && resultText) {
      console.log(`[INSERT-RESULT] 삽입 직전 resultText="${resultText.slice(0, 30)}" length=${resultText.length}`);
      console.log('[INSERT-3] 부모 onInsert 시작');
      options.onInsert(resultText);
      console.log('[INSERT-4] 부모 onInsert 완료');

      // Stage B: 모달 닫기 (삽입 완료 후 DiaryWriteView로 복귀)
      console.log('[INSERT-6] modal close 시작');
      console.log('[MODAL-CLOSE-CALL] handleInsert → options.onClose() 호출');
      options.onClose?.();
      console.log('[INSERT-7] modal close 호출 완료');
    } else {
      console.log('[INSERT-3] onInsert 스킵 — hasOnInsert:', !!options.onInsert, 'hasResult:', !!resultText);
    }

    // ── STAGE C: machine.complete() 비활성화 (비교 실험) ─────────────────
    // console.log('[INSERT-5] machine complete 시작');
    // machine.complete();
  };

  return {
    inputText,
    setInputText,
    resultText,
    setResultText,
    insertDone,
    handleVoicePress,
    handleSubmit,
    handleInsert,
    machine,
  };
}
