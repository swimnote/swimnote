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
  Alert,
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
  TEXT_LINE_H,
  TEXT_FONT_SIZE,
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

interface Props {
  input: StoryInput;
  onDone: () => void;   // 완료(성공/실패 모두) 후 호출
}

// ── 텍스트 → 페이지 분할 ────────────────────────────────────────────────────
// 단락(\n\n 또는 \n) 기준으로 분할, 단락이 페이지 경계에서 잘리지 않도록 보장
//
// Story 캔버스(360×640), 텍스트 영역 너비 ≈ 332px
// fontSize 13, Pretendard: 한글 1자 ≈ 13px → 1줄 ≈ 25자
// lineHeight 20px
//   - Page 1 (사진 있음): 사용 가능 줄 수 ≈ 10
//   - Page 1 (사진 없음): 사용 가능 줄 수 ≈ 18
//   - Page 2+:            사용 가능 줄 수 ≈ 20
const CHARS_PER_LINE = 25;
const MAX_LINES_PAGE1_PHOTO = 10;
const MAX_LINES_PAGE1_NO_PHOTO = 18;
const MAX_LINES_LATER = 20;

function estimateLines(text: string): number {
  if (!text.trim()) return 0;
  return text.split("\n").reduce((acc, line) => {
    return acc + Math.max(1, Math.ceil((line.length || 0.1) / CHARS_PER_LINE));
  }, 0);
}

function buildPages(input: StoryInput): StoryPageData[] {
  const hasPhotos = input.photos.length > 0;
  const fullText = input.bodyText.trim();

  if (!fullText) {
    // 텍스트 없음 — 사진만 있는 1장
    return [{
      lessonDate: input.lessonDate,
      teacherName: input.teacherName,
      classGroupName: input.classGroupName,
      photos: input.photos,
      bodyText: "",
      pageNum: 1,
      totalPages: 1,
    }];
  }

  // 단락 분리 (빈 줄로 구분된 블록 또는 단순 줄바꿈)
  const rawParagraphs = fullText.split(/\n\n+/);
  const paragraphs = rawParagraphs.flatMap(p => p.split(/\n/)).filter(Boolean);

  const pageTexts: string[] = [];
  let currentParas: string[] = [];
  let currentLines = 0;
  let isFirstPage = true;

  const maxLines = () => {
    if (isFirstPage) return hasPhotos ? MAX_LINES_PAGE1_PHOTO : MAX_LINES_PAGE1_NO_PHOTO;
    return MAX_LINES_LATER;
  };

  for (const para of paragraphs) {
    const paraLines = estimateLines(para);
    if (currentLines + paraLines > maxLines() && currentParas.length > 0) {
      pageTexts.push(currentParas.join("\n"));
      isFirstPage = false;
      currentParas = [para];
      currentLines = paraLines;
    } else {
      currentParas.push(para);
      currentLines += paraLines;
    }
  }
  if (currentParas.length > 0) {
    pageTexts.push(currentParas.join("\n"));
  }

  const totalPages = pageTexts.length;
  return pageTexts.map((text, idx) => ({
    lessonDate: input.lessonDate,
    teacherName: input.teacherName,
    classGroupName: input.classGroupName,
    photos: idx === 0 ? input.photos : undefined,
    bodyText: text,
    pageNum: idx + 1,
    totalPages,
  }));
}

// ── StoryCapturePipeline ─────────────────────────────────────────────────────
export default function StoryCapturePipeline({ input, onDone }: Props) {
  const pages = buildPages(input);
  const [pageIdx, setPageIdx] = useState(0);
  const [capturedUris, setCapturedUris] = useState<string[]>([]);
  const [status, setStatus] = useState<"rendering" | "capturing" | "sharing" | "done">("rendering");
  const rendererRef = useRef<View>(null);
  const captureScheduled = useRef(false);

  const currentPage = pages[pageIdx];

  useEffect(() => {
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
    if (!rendererRef.current) {
      finishWithError("렌더링 중 오류가 발생했습니다.");
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
        // 모든 페이지 캡처 완료
        await finalize(newUris);
      }
    } catch (e) {
      console.warn("[StoryCapture] captureRef error:", e);
      finishWithError("이미지 생성에 실패했습니다.");
    }
  }

  async function finalize(uris: string[]) {
    // META_APP_ID guard — 설정 미완료 시 즉시 종료 (저장/fallback 없음)
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

    // 1장 또는 N장 모두 Instagram Story Composer에 1장씩 순서대로 공유
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
          // 공유 취소 → 나머지 페이지 없이 조용히 종료
          cleanup(uris);
          onDone();
          return;
        }
        // Instagram 미설치(home.tsx에서 canOpenURL 체크했음에도 실행 중 예외) → 종료
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
    capturing: `${pageIdx + 1} / ${pages.length}장 처리 중...`,
    sharing: pages.length > 1
      ? `Instagram 스토리 열기... (${pages.length}장)`
      : "Instagram 스토리 열기...",
    done: "완료",
  };

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent>
      {/* 반투명 오버레이 */}
      <View style={p.overlay}>
        <View style={p.card}>
          <ActivityIndicator size="large" color="#2EC4B6" />
          <Text style={p.label}>{statusLabel[status]}</Text>
          {pages.length > 1 && (
            <Text style={p.sub}>{pages.length}장 분량 · 순서대로 생성합니다</Text>
          )}
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
