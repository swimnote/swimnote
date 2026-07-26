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

import { useEffect, useState } from 'react';
import { useAIStateMachine } from '../../hooks/useAIStateMachine';

interface UseDiaryAIOptions {
  /** 현재 일지 템플릿에 이미 입력된 내용 */
  existingContent?: string;
  studentId?:       string;
  classId?:         string;
  poolId?:          string;
  /** COMPLETE 시 결과 텍스트를 부모에게 전달하는 콜백 */
  onInsert?:        (text: string) => void;
}

export function useDiaryAI(options: UseDiaryAIOptions = {}) {
  const machine = useAIStateMachine();
  const [inputText, setInputText]   = useState('');
  const [resultText, setResultText] = useState('');

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
    if (machine.is('RECORDING')) {
      // 녹음 중지 → 처리 시작
      machine.stopRecording();
      await processVoice();
    } else {
      // 녹음 시작 (권한 확인 포함)
      // TODO: 마이크 권한 확인 후 startRecording
      machine.startRecording();
    }
  };

  const processVoice = async () => {
    try {
      // TODO: expo-av 녹음 파일 → API Whisper 호출 → 텍스트 반환
      // const text = await transcribeAudio(audioUri);
      // setInputText(prev => prev + text);
      machine.submit();
      await generateDiary();
    } catch {
      machine.setError({
        origin:      'NETWORK',
        message:     '음성 인식에 실패했습니다. 다시 시도해주세요.',
        retryTarget: 'INPUT',
      });
    }
  };

  // ─── 텍스트 제출 ────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (!inputText.trim()) return;
    machine.submit();
    await generateDiary();
  };

  const generateDiary = async () => {
    try {
      // TODO: API 호출
      // const result = await apiClient.post('/ai/diary/generate', {
      //   input:   inputText,
      //   context: {
      //     existingContent: options.existingContent,
      //     studentId:       options.studentId,
      //     classId:         options.classId,
      //     poolId:          options.poolId,
      //   },
      // });
      // setResultText(result.text);

      // 임시 더미 결과
      setResultText('AI 생성 결과가 여기에 표시됩니다.');
      machine.receiveResult();
    } catch {
      machine.setError({
        origin:      'NETWORK',
        message:     'AI 생성에 실패했습니다. 네트워크를 확인해주세요.',
        retryTarget: 'INPUT',
      });
    }
  };

  // ─── 일지 삽입 ──────────────────────────────────────────────────────────

  const handleInsert = () => {
    // 부모 컴포넌트의 일지 필드에 resultText 삽입
    if (options.onInsert && resultText) {
      options.onInsert(resultText);
    }
    machine.complete();
  };

  return {
    inputText,
    setInputText,
    resultText,
    setResultText,
    handleVoicePress,
    handleSubmit,
    handleInsert,
    machine,
  };
}
