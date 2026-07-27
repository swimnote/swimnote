/**
 * useDiaryAI — SwimNote AI UI Framework V1.0 / Feature: Diary
 * 일지 AI 작성 비즈니스 로직
 *
 * 의존: useAIStateMachine, AIContracts
 * 사용: DiaryAIContent
 *
 * [원칙 2] 앱 화면으로부터 token / teacherId / classId / date / students[]를 받습니다.
 * [원칙 3] 모든 AI 작업(STT → 생성 → 결과 → 수정 → 삽입)은 이 Hook 내부에서 완결됩니다.
 * [원칙 5] machine.state 변화마다 onLockChange를 호출하여 dismiss 잠금 상태를 부모에 알립니다.
 * [원칙 6] handleInsert()에서만 onInsert(DiaryInsertResult)를 호출합니다.
 *
 * TODO Phase 3: generateDiary() 실제 AI 엔진 API 연결
 */

import { useEffect, useRef, useState } from 'react';
import { useAIStateMachine } from '../../hooks/useAIStateMachine';
import { useVoiceRecorder } from '../../hooks/useVoiceRecorder';
import type { AIState } from '../../core/AIContracts';

// ─── 공개 타입 계약 ──────────────────────────────────────────────────────────

/** [원칙 6] 최종 삽입 시 AI 모달이 앱 화면으로 전달하는 결과 구조체 */
export interface DiaryInsertResult {
  /** 공통 일지 텍스트 → setCommonContent */
  commonDiary: string;
  /** 학생별 일지 목록 → studentId 기준으로 setStudentNotes */
  students:    StudentDiaryNote[];
}

export interface StudentDiaryNote {
  studentId:   string;
  studentName: string;
  note:        string;
}

/** [원칙 2] 앱 화면이 AI 모달로 공급하는 학생 컨텍스트 */
export interface StudentContext {
  id:   string;
  name: string;
}

// ─── Hook 옵션 ───────────────────────────────────────────────────────────────

interface UseDiaryAIOptions {
  /** 현재 일지 템플릿에 이미 입력된 내용 */
  existingContent?: string;
  // ── [원칙 2] 앱 화면 공급 데이터 ─────────────────────────────────────────
  token?:           string;
  teacherId?:       string;
  classId?:         string;
  date?:            string;
  students?:        StudentContext[];
  poolId?:          string;
  // ── [원칙 6] 최종 삽입 콜백 ──────────────────────────────────────────────
  /** COMPLETE 시 DiaryInsertResult를 부모에게 전달하는 콜백 */
  onInsert?:        (result: DiaryInsertResult) => void;
  /** 삽입 완료 후 모달을 닫는 콜백 */
  onClose?:         () => void;
  /**
   * [원칙 1·5] machine.state 변화 시 호출됩니다.
   * true  → dismiss 차단 (PROCESSING / UPLOADING / RECORDING / RESULT / EDITING)
   * false → dismiss 허용 (INPUT / PERMISSION / ERROR / COMPLETE / OPENING)
   */
  onLockChange?:    (locked: boolean) => void;
}

// ─── Dismiss 잠금 대상 States ─────────────────────────────────────────────────

/** 이 State에 있는 동안 백드롭·스와이프 dismiss를 차단합니다. [원칙 5] */
const LOCK_STATES: AIState[] = ['PROCESSING', 'UPLOADING', 'RECORDING', 'RESULT', 'EDITING'];

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useDiaryAI(options: UseDiaryAIOptions = {}) {
  const machine  = useAIStateMachine();
  const recorder = useVoiceRecorder();

  const [inputText,  setInputText]  = useState('');
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

  // ─── [원칙 1·5] State 변화 → dismiss 잠금 상태 부모에 알림 ──────────────
  useEffect(() => {
    options.onLockChange?.(LOCK_STATES.includes(machine.state as AIState));
  }, [machine.state]);

  // ─── 음성 입력 ──────────────────────────────────────────────────────────

  const handleVoicePress = async () => {
    console.log(`[SM-QA] State: ${machine.state} | Event: VOICE_BUTTON_TAP | isRecording=${recorder.isRecording}`);

    if (machine.is('RECORDING')) {
      // ── 녹음 중지 → STT 변환 ────────────────────────────────────────────
      console.log('[SM-QA] State: RECORDING | Event: STOP_RECORDING | Next: INPUT | Function: recorder.stopRecording()');
      machine.stopRecording();                        // RECORDING → INPUT
      const uri = await recorder.stopRecording();     // 녹음 파일 URI 획득
      await processVoice(uri);                        // STT → setInputText
    } else {
      // ── 녹음 시작 — 권한 확인 포함 ───────────────────────────────────────
      console.log('[SM-QA] State: INPUT | Event: START_RECORDING | Function: recorder.startRecording()');
      const result = await recorder.startRecording();

      if (result === 'permission_denied') {
        console.log('[SM-QA] State: INPUT | Event: PERMISSION_REQUIRED | Next: PERMISSION');
        machine.requirePermission();
        return;
      }
      if (result === 'error') {
        machine.setError({
          origin:      'PERMISSION',
          message:     '마이크를 시작할 수 없습니다. 다시 시도해주세요.',
          retryTarget: 'INPUT',
        });
        return;
      }
      machine.startRecording(); // INPUT → RECORDING
    }
  };

  /**
   * processVoice — 녹음 파일 URI를 받아 Whisper STT 변환 후 inputText에 설정
   *
   * [원칙 3] STT 완료 후 inputText만 채우고, AI 자동 실행 없음.
   * 사용자가 텍스트 확인 후 "AI 작성" 버튼을 탭해야 generateDiary() 실행.
   */
  const processVoice = async (uri: string | null) => {
    if (!uri) {
      console.warn('[VOICE] processVoice: URI 없음 — STT 스킵');
      return;
    }

    console.log('[VOICE-0] processVoice 시작 — uri:', uri);

    try {
      const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'https://swimnote.kr/api';
      const endpoint = `${API_BASE}/ai/transcribe`;

      const formData = new FormData();
      formData.append('audio', {
        uri,
        name: 'recording.m4a',
        type: 'audio/m4a',
      } as any);

      console.log('[VOICE-1] Whisper API 요청 → ', endpoint);

      // [원칙 2] 앱 화면에서 전달받은 token으로 Authorization 헤더 구성
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (options.token) {
        headers['Authorization'] = `Bearer ${options.token}`;
      }

      const response = await fetch(endpoint, {
        method:  'POST',
        body:    formData,
        headers,
        // Content-Type은 FormData가 자동으로 multipart/form-data; boundary=... 설정
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        throw new Error((errBody as any)?.error ?? `HTTP ${response.status}`);
      }

      const { transcript } = await response.json() as { transcript: string };
      console.log('[VOICE-2] STT 완료 — transcript 길이:', transcript?.length ?? 0);

      if (transcript?.trim()) {
        setInputText(transcript.trim());
        console.log('[VOICE-3] inputText 설정 완료 — AI 자동 실행 없음');
      } else {
        console.warn('[VOICE-3] transcript 비어 있음 — 무음 또는 인식 불가');
      }
    } catch (e: any) {
      console.error('[VOICE-ERR] processVoice 오류:', e?.message ?? e);
      machine.setError({
        origin:      'NETWORK',
        message:     '음성 인식에 실패했습니다. 다시 시도해주세요.',
        retryTarget: 'INPUT',
      });
    } finally {
      await recorder.deleteRecording(uri);
      console.log('[VOICE-4] 임시 녹음 파일 삭제 완료');
    }
  };

  // ─── 텍스트 제출 / 다시 작성 ────────────────────────────────────────────

  const handleSubmit = async () => {
    console.log('[REWRITE-CALL] handleSubmit() 진입 — state:', machine.state, 'inputText길이:', inputText.length);

    if (machine.state === 'RESULT' || machine.state === 'EDITING') {
      console.log('[REWRITE-2] RESULT 상태 → retry(INPUT) 선행');
      rewriteCountRef.current += 1;
      console.log('[REWRITE-COUNT] rewriteCountRef 증가 →', rewriteCountRef.current);
      machine.retry('INPUT');
    } else if (!inputText.trim()) {
      console.log('[REWRITE-1] 스킵 — INPUT 상태이고 inputText 없음');
      return;
    }

    console.log('[REWRITE-3] machine.submit() 호출');
    machine.submit();  // INPUT → PROCESSING
    console.log('[REWRITE-4] generateDiary() 시작');
    await generateDiary();
  };

  const generateDiary = async () => {
    // ⚠️ 더미 결과 — Phase 3에서 실제 AI 엔진 API 교체 예정
    // TODO Phase 3: 실제 API 호출 구현
    //   endpoint, request body(token, teacherId, classId, date, students, inputText),
    //   response 파싱(commonDiary, students[]) 모두 엔진 최종 명세 수신 후 작성
    const BASE_DUMMY = '오늘은 자유형 발차기와 호흡 연습을 진행했습니다. 학생들이 발차기 자세를 교정하며 호흡 타이밍을 맞추는 연습을 했고, 전반적으로 좋은 향상을 보였습니다.';
    const count      = rewriteCountRef.current;
    const DUMMY_RESULT = count > 0 ? `${BASE_DUMMY} (더미 재작성 ${count})` : BASE_DUMMY;

    try {
      console.log('[GENERATE-1] generateDiary 시작 — rewriteCount:', count);
      console.log('[GENERATE-2] context — classId:', options.classId, 'date:', options.date, 'students:', options.students?.length ?? 0);

      // ── 더미 최소 지연 (Phase 3에서 제거) ───────────────────────────────
      await new Promise<void>((resolve) => setTimeout(resolve, 1500));

      console.log('[GENERATE-3] setResultText 직전 — 더미 텍스트 길이:', DUMMY_RESULT.length);
      setResultText(DUMMY_RESULT);
      console.log('[GENERATE-4] setResultText 완료 — machine.receiveResult() 직전');
      machine.receiveResult();
      console.log('[GENERATE-5] machine.receiveResult() 완료');
    } catch (e: any) {
      console.error('[GENERATE-ERR] generateDiary 오류:', e?.message ?? e);
      machine.setError({
        origin:      'NETWORK',
        message:     'AI 생성에 실패했습니다. 네트워크를 확인해주세요.',
        retryTarget: 'INPUT',
      });
    }
  };

  // ─── [원칙 6] 최종 삽입 — 모든 결과가 확정된 시점에만 onInsert 호출 ────

  const handleInsert = () => {
    console.log('[INSERT-1] 버튼 클릭 — handleInsert 진입');
    console.log('[INSERT-2] result 확인:', resultText ? `길이=${resultText.length}자` : '(없음)');

    if (options.onInsert && resultText) {
      // [원칙 6] DiaryInsertResult 단일 구조체로 전달
      // Phase 3: students는 실제 AI 엔진 응답으로 교체 예정 (현재 더미이므로 빈 배열)
      const result: DiaryInsertResult = {
        commonDiary: resultText,
        students:    [],
      };

      console.log(`[INSERT-RESULT] 삽입 직전 commonDiary 길이=${result.commonDiary.length}, students=${result.students.length}명`);
      console.log('[INSERT-3] 부모 onInsert 시작');
      options.onInsert(result);
      console.log('[INSERT-4] 부모 onInsert 완료');

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
