/**
 * StoryCapturePipeline.tsx
 *
 * 1080×1920 Story 이미지 캡처 → Instagram Share (1장)
 *
 * 동작 흐름:
 *  1. 부모가 storyInput(entry + photos)을 전달
 *  2. buildPageV2()로 단일 페이지 구성
 *  3. StoryPageRenderer(off-screen View)에 렌더링
 *  4. 150ms 딜레이 후 captureRef → PNG URI
 *  5. Instagram Story Composer에 공유
 *     - Instagram 미설치 / 공유 취소 → 임시 파일 정리 후 종료
 */
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { captureRef } from "react-native-view-shot";
import * as FileSystem from "expo-file-system/legacy";
import Share, { Social } from "react-native-share";

// Meta/Facebook App ID — env 우선, fallback 하드코딩
const META_APP_ID = process.env.EXPO_PUBLIC_META_APP_ID || "2093655621362240";

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
  teacherName: string;      // V3 Story 표시 안 함 (외부 사용자 기준 불필요)
  classGroupName?: string | null; // V3 Story 표시 안 함
  poolName: string;         // 수영장 이름 — footer LEFT에 표시
  bodyText: string;         // AI 한줄평 또는 원문
  photos: StoryPhoto[];     // 이미 URI가 resolve된 사진 목록 (최대 10장)
}

interface Props {
  input: StoryInput;
  onDone: () => void; // 완료(성공/실패 모두) 후 호출
}

// ── V3: Story 1장 완결 (Editorial Design) ──────────────────────────────────
function buildPageV2(input: StoryInput): StoryPageData {
  return {
    lessonDate: input.lessonDate,
    poolName:   input.poolName,   // footer LEFT에 표시
    photos:     input.photos.length > 0 ? input.photos.slice(0, 10) : undefined,
    bodyText:   input.bodyText.trim(),
    pageNum:    1,
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

  const currentPage = pages[pageIdx];

  useEffect(() => {
    captureScheduled.current = false;
    setStatus("rendering");
    // 렌더링이 완료될 수 있도록 ~2프레임(150ms) 대기
    const t = setTimeout(() => {
      captureScheduled.current = true;
      captureCurrent();
    }, 150);
    return () => clearTimeout(t);
  }, [pageIdx]);

  async function captureCurrent() {
    if (!rendererRef.current) {
      finishWithError("이미지 생성에 실패했습니다.");
      return;
    }
    setStatus("capturing");
    try {
      const uri = await captureRef(rendererRef, {
        format: "png",
        quality: 1,
        result: "tmpfile",
        // 360×640 View → 1080×1920 출력 (3× scale)
        width: 1080,
        height: 1920,
      });

      const newUris = [...capturedUris, uri];
      if (pageIdx + 1 < pages.length) {
        setCapturedUris(newUris);
        setPageIdx(pageIdx + 1);
      } else {
        await finalize(newUris);
      }
    } catch {
      finishWithError("이미지 생성에 실패했습니다.");
    }
  }

  async function finalize(uris: string[]) {
    // META_APP_ID guard — 설정 미완료 시 즉시 종료
    if (!META_APP_ID) {
      Alert.alert(
        "Instagram 공유 준비 중",
        "Instagram Story 공유 설정이 완료되지 않았습니다.",
      );
      cleanup(uris);
      onDone();
      return;
    }

    setStatus("sharing");

    // Instagram Story Composer에 공유
    for (let i = 0; i < uris.length; i++) {
      try {
        await Share.shareSingle({
          social: Social.InstagramStories,
          backgroundImage: uris[i],
          appId: META_APP_ID,
        });
      } catch (e: any) {
        const isCancelled =
          e?.message?.includes("cancel") ||
          e?.message?.includes("dismiss") ||
          e?.error?.includes("cancel");
        if (isCancelled) {
          // 공유 취소 → 조용히 종료
          cleanup(uris);
          onDone();
          return;
        }
        // Instagram 미설치 등 기타 오류
        Alert.alert("Instagram 앱이 설치되어 있지 않습니다.");
        cleanup(uris);
        onDone();
        return;
      }
    }

    cleanup(uris);
    onDone();
  }

  function cleanup(uris: string[]) {
    uris.forEach(uri => {
      FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
    });
  }

  function finishWithError(msg: string) {
    Alert.alert("오류", msg);
    onDone();
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
          <ActivityIndicator size="large" color="#1683A3" />
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
  offscreen: {
    position: "absolute",
    left: -(STORY_W + 100),
    top: 0,
    width: STORY_W,
    height: STORY_H,
  },
});
