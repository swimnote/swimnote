/**
 * StoryCapturePipeline.tsx
 *
 * 1080×1920 Story 이미지 캡처 → Instagram Share (1장) / 사진첩 저장 (N장)
 *
 * 동작 흐름:
 *  1. 부모가 storyInput(entry + photos)을 전달
 *  2. buildPages()로 페이지 분할
 *  3. 각 페이지를 StoryPageRenderer(off-screen Modal)에 렌더링
 *  4. 100ms 딜레이 후 captureRef → PNG URI
 *  5. 모든 페이지 capture 완료 후:
 *     - 1장 또는 N장 → Instagram Story Composer에 1장씩 순서대로 공유
 *     - Instagram 미설치 / 공유 취소 → 임시 파일 정리 후 종료 (저장 fallback 없음)
 */
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { captureRef } from "react-native-view-shot";
import * as FileSystem from "expo-file-system/legacy";
import Share, { Social } from "react-native-share";

// Meta/Facebook App ID — EXPO_PUBLIC_META_APP_ID 환경변수에서 읽음
// 값이 없으면 Instagram Story 직접 공유 불가 (갤러리 저장 fallback)
const META_APP_ID = process.env.EXPO_PUBLIC_META_APP_ID ?? "";
import StoryPageRenderer, {
  STORY_W,
  STORY_H,
  StoryPageData,
  StoryPhoto,
} from "./StoryPageRenderer";

// ── Story 입력 타입 ──────────────────────────────────────────────────────────
export interface StoryInput {
  entryId: string;
  lessonDate: string;
  teacherName: string;
  classGroupName?: string | null;
  bodyText: string;          // common_content + student_note 합친 전체 텍스트
  photos: StoryPhoto[];       // 이미 URI가 resolve된 사진 목록
}

// ── 진단 결과 타입 ────────────────────────────────────────────────────────────
// stage: 마지막으로 도달한 단계 (P0~P12, PX)
// meta: META_APP_ID 존재 여부
// uriExists: capture URI 파일 존재 여부 (null=미확인)
// fileSize: capture 파일 크기(byte), null=미확인
// photoCount: input.photos.length
// shareResult: Share 최종 결과
// error: sanitized error message (개인정보/경로 제외)
// reason: 실패 이유 코드
export interface DiagResult {
  stage: string;
  meta: boolean;
  uriExists: boolean | null;
  fileSize: number | null;
  photoCount: number;
  shareResult: "success" | "cancelled" | "error" | "not_reached";
  error: string | null;
  reason?: string;
}

interface Props {
  input: StoryInput;
  onDone: (result: DiagResult) => void;   // 완료(성공/실패 모두) 후 호출
}

// ── V2: Story 1장 완결 ──────────────────────────────────────────────────────
// - 사진 최대 10장 전달 (StoryPageRenderer에서 동적 그리드로 배치)
// - 텍스트는 단일 페이지 — bodyText overflow는 renderer의 flex:1+overflow:hidden으로 자연 클리핑
// - AI 요약 경로: 기존 안전한 endpoint 없음 → 이번 단계 미적용 (보고 완료)
function buildPageV2(input: StoryInput): StoryPageData {
  return {
    lessonDate: input.lessonDate,
    teacherName: input.teacherName,
    classGroupName: input.classGroupName,
    photos: input.photos.length > 0 ? input.photos.slice(0, 10) : undefined,
    bodyText: input.bodyText.trim(),
    pageNum: 1,
    totalPages: 1,
  };
}

// ── StoryCapturePipeline ─────────────────────────────────────────────────────
export default function StoryCapturePipeline({ input, onDone }: Props) {
  const pages = [buildPageV2(input)]; // V2: 항상 1장 완결
  const [pageIdx, setPageIdx] = useState(0);
  const [capturedUris, setCapturedUris] = useState<string[]>([]);
  const [status, setStatus] = useState<"rendering" | "capturing" | "sharing" | "done">("rendering");
  const rendererRef = useRef<View>(null);
  const captureScheduled = useRef(false);

  // ── 진단 누적 ref ─────────────────────────────────────────────────────────
  const diagRef = useRef<DiagResult>({
    stage: "P0",
    meta: typeof META_APP_ID === "string" && META_APP_ID.length > 0,
    uriExists: null,
    fileSize: null,
    photoCount: input.photos.length,
    shareResult: "not_reached",
    error: null,
  });

  const currentPage = pages[pageIdx];

  useEffect(() => {
    // P0: Pipeline mount / 페이지 전환
    diagRef.current.stage = "P0";
    captureScheduled.current = false;
    setStatus("rendering");
    // 렌더링이 완료될 수 있도록 2프레임(~100ms) 대기
    const t = setTimeout(() => {
      captureScheduled.current = true;
      captureCurrent();
    }, 150);
    return () => clearTimeout(t);
  }, [pageIdx]);

  async function captureCurrent() {
    // P1: rendererRef 확인
    diagRef.current.stage = "P1";
    if (!rendererRef.current) {
      diagRef.current.error = "rendererRef null";
      diagRef.current.shareResult = "error";
      onDone({ ...diagRef.current });
      return;
    }

    setStatus("capturing");

    // P2: captureRef 시작
    diagRef.current.stage = "P2";
    try {
      const uri = await captureRef(rendererRef, {
        format: "png",
        quality: 1,
        result: "tmpfile",
        // 360×640 View → 1080×1920 출력 (3× scale)
        width: 1080,
        height: 1920,
      });

      // P3: captureRef 성공
      diagRef.current.stage = "P3";

      // P4: URI 존재 + 파일 크기 확인 (read-only, 실패해도 공유 계속)
      diagRef.current.stage = "P4";
      try {
        const info = await FileSystem.getInfoAsync(uri);
        diagRef.current.uriExists = info.exists;
        diagRef.current.fileSize = (info as any).size ?? null;
      } catch {
        // getInfoAsync 실패 — URI 길이로 존재 추정
        diagRef.current.uriExists = typeof uri === "string" && uri.length > 0;
        diagRef.current.fileSize = null;
      }

      const newUris = [...capturedUris, uri];
      if (pageIdx + 1 < pages.length) {
        setCapturedUris(newUris);
        setPageIdx(pageIdx + 1);
      } else {
        // 모든 페이지 캡처 완료
        await finalize(newUris);
      }
    } catch (e: any) {
      console.warn("[StoryCapture] captureRef error:", e);
      // PX: captureRef 예외
      diagRef.current.stage = "PX";
      diagRef.current.error = String(e?.message ?? "captureRef failed").slice(0, 100);
      diagRef.current.shareResult = "error";
      onDone({ ...diagRef.current });
    }
  }

  async function finalize(uris: string[]) {
    // P5: finalize 진입
    diagRef.current.stage = "P5";

    // P6: META_APP_ID 검사
    diagRef.current.stage = "P6";
    const hasMetaAppId =
      typeof META_APP_ID === "string" && META_APP_ID.length > 0;
    diagRef.current.meta = hasMetaAppId;

    if (!hasMetaAppId) {
      // meta=false → parent에서 Alert 표시 (Pipeline 내부 Alert 제거)
      diagRef.current.shareResult = "error";
      diagRef.current.reason = "missing_meta_app_id";
      cleanup(uris);
      onDone({ ...diagRef.current });
      return;
    }

    // P7: META_APP_ID 존재 확인
    diagRef.current.stage = "P7";

    setStatus("sharing");

    // 1장 또는 N장 모두 Instagram Story Composer에 1장씩 순서대로 공유
    for (let i = 0; i < uris.length; i++) {
      // P8: Share.shareSingle 직전
      diagRef.current.stage = "P8";
      try {
        // P9: Share.shareSingle 호출
        diagRef.current.stage = "P9";
        await Share.shareSingle({
          social: Social.InstagramStories,
          backgroundImage: uris[i],
          appId: META_APP_ID,
        });
        // P10: Promise resolve
        diagRef.current.stage = "P10";
        diagRef.current.shareResult = "success";
      } catch (e: any) {
        // PX: Share 예외
        diagRef.current.stage = "PX";
        const isCancelled =
          e?.message?.includes("cancel") ||
          e?.message?.includes("dismiss") ||
          e?.error?.includes("cancel");
        if (isCancelled) {
          // 공유 취소 → 나머지 페이지 없이 조용히 종료
          diagRef.current.shareResult = "cancelled";
          diagRef.current.error = String(e?.message ?? "cancelled").slice(0, 100);
          cleanup(uris);
          onDone({ ...diagRef.current });
          return;
        }
        // Instagram 미설치(home.tsx에서 canOpenURL 체크했음에도 실행 중 예외) → 종료
        diagRef.current.shareResult = "error";
        diagRef.current.error = String(e?.message ?? "share error").slice(0, 100);
        cleanup(uris);
        onDone({ ...diagRef.current });
        return;
      }
    }

    // P11: cleanup
    diagRef.current.stage = "P11";
    cleanup(uris);

    // P12: onDone
    diagRef.current.stage = "P12";
    onDone({ ...diagRef.current });
  }

  function cleanup(uris: string[]) {
    uris.forEach(uri => {
      FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
    });
  }

  const statusLabel: Record<typeof status, string> = {
    rendering: "이미지 생성 중...",
    capturing: "이미지 생성 중...",
    sharing: "Instagram 스토리 열기...",
    done: "완료",
  };

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent>
      {/* 반투명 오버레이 */}
      <View style={p.overlay}>
        <View style={p.card}>
          <ActivityIndicator size="large" color="#2EC4B6" />
          <Text style={p.label}>{statusLabel[status]}</Text>
        </View>
      </View>

      {/* ── off-screen 렌더러 ── */}
      <View style={p.offscreen} pointerEvents="none">
        {currentPage && (
          <StoryPageRenderer ref={rendererRef} page={currentPage} />
        )}
      </View>
    </Modal>
  );
}

const p = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 28,
    alignItems: "center",
    gap: 12,
    minWidth: 200,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  label: {
    fontSize: 15,
    fontFamily: "Pretendard-Regular",
    color: "#1E293B",
    textAlign: "center",
  },
  sub: {
    fontSize: 12,
    fontFamily: "Pretendard-Regular",
    color: "#64748B",
    textAlign: "center",
  },
  offscreen: {
    position: "absolute",
    left: -(STORY_W + 100),
    top: 0,
    width: STORY_W,
    height: STORY_H,
  },
});
