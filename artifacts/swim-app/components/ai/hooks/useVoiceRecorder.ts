/**
 * useVoiceRecorder — SwimNote AI UI Framework V1.0
 * expo-av 기반 녹음 로직 캡슐화
 *
 * 책임:
 *   1. 마이크 권한 요청
 *   2. 녹음 시작 / 중지
 *   3. m4a 포맷 강제 (iOS + Android 모두 Whisper API 호환)
 *   4. 녹음 완료 후 URI 반환
 *   5. 녹음 상태 노출 (isRecording, durationMs)
 *
 * 향후 OCR / 영상분석 등 다른 AI 기능에서도 재사용 가능
 *
 * 의존: expo-av, expo-file-system
 * 사용: useDiaryAI (processVoice 전 단계)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Audio }       from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';

// ─── Whisper API 호환 녹음 옵션 ───────────────────────────────────────────────
// HIGH_QUALITY preset은 Android에서 3gp/amr을 반환하므로 Whisper API 미지원.
// iOS/Android 모두 m4a(AAC)로 명시 지정.
const WHISPER_RECORDING_OPTIONS: Audio.RecordingOptions = {
  android: {
    extension:        '.m4a',
    outputFormat:     Audio.AndroidOutputFormat.MPEG_4,
    audioEncoder:     Audio.AndroidAudioEncoder.AAC,
    sampleRate:       44100,
    numberOfChannels: 1,
    bitRate:          128000,
  },
  ios: {
    extension:    '.m4a',
    outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
    audioQuality: Audio.IOSAudioQuality.HIGH,
    sampleRate:       44100,
    numberOfChannels: 1,
    bitRate:          128000,
  },
  web: {
    mimeType:     'audio/webm',
    bitsPerSecond: 128000,
  },
};

// ─── 최대 녹음 시간: 120초 (Whisper 25MB 제한 대비, 수업 메모 용도) ────────────
const MAX_RECORDING_MS = 120_000;

// ─── 반환 타입 ────────────────────────────────────────────────────────────────

export interface VoiceRecorderResult {
  /** 현재 녹음 중 여부 */
  isRecording:  boolean;
  /** 경과 시간(ms) — UI 표시용 */
  durationMs:   number;
  /**
   * 녹음 시작.
   * @returns 'ok' | 'permission_denied' | 'error'
   */
  startRecording: () => Promise<'ok' | 'permission_denied' | 'error'>;
  /**
   * 녹음 중지.
   * @returns 녹음 파일 URI (m4a) 또는 null (실패 시)
   */
  stopRecording: () => Promise<string | null>;
  /** 임시 파일 삭제 (Whisper 업로드 완료 또는 실패 후 호출) */
  deleteRecording: (uri: string) => Promise<void>;
}

// ─── useVoiceRecorder ─────────────────────────────────────────────────────────

export function useVoiceRecorder(): VoiceRecorderResult {
  const recordingRef   = useRef<Audio.Recording | null>(null);
  const timerRef       = useRef<ReturnType<typeof setInterval> | null>(null);
  const maxTimerRef    = useRef<ReturnType<typeof setTimeout>  | null>(null);
  /** 언마운트 후 setState 방지 */
  const isMountedRef   = useRef(true);

  const [isRecording, setIsRecording] = useState(false);
  const [durationMs,  setDurationMs]  = useState(0);

  // ── 언마운트 시 리소스 정리 ────────────────────────────────────────────────
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (timerRef.current)    clearInterval(timerRef.current);
      if (maxTimerRef.current) clearTimeout(maxTimerRef.current);
      recordingRef.current?.stopAndUnloadAsync().catch(() => {});
    };
  }, []);

  // ── 타이머 시작 ───────────────────────────────────────────────────────────
  const startTimer = useCallback(() => {
    setDurationMs(0);
    timerRef.current = setInterval(() => {
      if (isMountedRef.current) setDurationMs(prev => prev + 200);
    }, 200);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (maxTimerRef.current) { clearTimeout(maxTimerRef.current); maxTimerRef.current = null; }
    if (isMountedRef.current) setDurationMs(0);
  }, []);

  // ── 녹음 시작 ─────────────────────────────────────────────────────────────
  const startRecording = useCallback(async (): Promise<'ok' | 'permission_denied' | 'error'> => {
    // ① 중복 호출 방지 — 이미 녹음 중이면 무시
    if (recordingRef.current) {
      console.warn('[VoiceRecorder] startRecording: 이미 녹음 중 — 무시');
      return 'error';
    }

    try {
      console.log('[VoiceRecorder] 권한 요청');
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) {
        console.log('[VoiceRecorder] 권한 거부 — permission_denied');
        return 'permission_denied';
      }

      // 언마운트 확인 (권한 요청 대기 중 언마운트 가능)
      if (!isMountedRef.current) return 'error';

      await Audio.setAudioModeAsync({
        allowsRecordingIOS:  true,
        playsInSilentModeIOS: true,
      });

      console.log('[VoiceRecorder] 녹음 시작 (m4a 포맷)');
      const { recording } = await Audio.Recording.createAsync(WHISPER_RECORDING_OPTIONS);

      // 언마운트 확인 (createAsync 대기 중 언마운트 가능)
      if (!isMountedRef.current) {
        recording.stopAndUnloadAsync().catch(() => {});
        return 'error';
      }

      recordingRef.current = recording;
      setIsRecording(true);
      startTimer();

      // ② 최대 녹음 시간 초과 시 자동 중지
      maxTimerRef.current = setTimeout(async () => {
        const rec = recordingRef.current;
        if (!rec) return;
        console.log('[VoiceRecorder] 최대 녹음 시간(120s) 도달 — 자동 중지');
        recordingRef.current = null;
        if (timerRef.current)    { clearInterval(timerRef.current); timerRef.current = null; }
        if (isMountedRef.current) { setIsRecording(false); setDurationMs(0); }
        try {
          await rec.stopAndUnloadAsync();
          await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
          console.log('[VoiceRecorder] 자동 중지 완료 — URI:', rec.getURI());
        } catch (e: any) {
          console.error('[VoiceRecorder] 자동 중지 오류:', e?.message ?? e);
        }
      }, MAX_RECORDING_MS);

      return 'ok';
    } catch (e: any) {
      console.error('[VoiceRecorder] startRecording 오류:', e?.message ?? e);
      if (isMountedRef.current) setIsRecording(false);
      return 'error';
    }
  }, [startTimer]);

  // ── 녹음 중지 ─────────────────────────────────────────────────────────────
  const stopRecording = useCallback(async (): Promise<string | null> => {
    const rec = recordingRef.current;
    if (!rec) {
      console.warn('[VoiceRecorder] stopRecording: recording 없음');
      return null;
    }

    // 중지 전에 ref를 null로 — 중복 호출 방지
    recordingRef.current = null;
    if (isMountedRef.current) setIsRecording(false);
    stopTimer();

    try {
      await rec.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });

      const uri = rec.getURI();
      console.log('[VoiceRecorder] 녹음 완료 — URI:', uri);
      return uri ?? null;
    } catch (e: any) {
      console.error('[VoiceRecorder] stopRecording 오류:', e?.message ?? e);
      return null;
    }
  }, [stopTimer]);

  // ── 임시 파일 삭제 ────────────────────────────────────────────────────────
  const deleteRecording = useCallback(async (uri: string): Promise<void> => {
    try {
      await FileSystem.deleteAsync(uri, { idempotent: true });
      console.log('[VoiceRecorder] 임시 파일 삭제 완료:', uri);
    } catch (e: any) {
      console.warn('[VoiceRecorder] 임시 파일 삭제 실패 (무시):', e?.message ?? e);
    }
  }, []);

  return { isRecording, durationMs, startRecording, stopRecording, deleteRecording };
}
