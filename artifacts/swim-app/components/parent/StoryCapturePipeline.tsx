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
 *     - 1장 → Instagram Stories direct (react-native-share)
 *     - N장 → MediaLibrary 저장 + Alert 안내
 */
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  StyleSheet,
  Text,
  ToastAndroid,
  View,
} from "react-native";
import { captureRef } from "react-native-view-shot";
import * as MediaLibrary from "expo-media-library";
import * as FileSystem from "expo-file-system/legacy";
import Share, { Social } from "react-native-share";
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
  const [status, setStatus] = useState<"rendering" | "capturing" | "sharing" | "saving" | "done">("rendering");
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
    if (uris.length === 1) {
      // ── 1장: Instagram Story 직접 공유 ──────────────────────────────
      setStatus("sharing");
      try {
        await Share.shareSingle({
          social: Social.InstagramStories,
          backgroundImage: uris[0],
          // Facebook App ID: Instagram 앱이 실제로 검증하지 않음
          // react-native-share 내부 empty-check 통과용
          appId: "swimnote",
        });
        cleanup(uris);
        onDone();
      } catch (e: any) {
        // Instagram 미설치 또는 공유 취소 → 사진첩 저장으로 fallback
        if (e?.message?.includes("cancel") || e?.message?.includes("dismiss")) {
          cleanup(uris);
          onDone();
          return;
        }
        // Instagram 미설치
        await saveToLibrary(uris);
      }
    } else {
      // ── N장: 사진첩 저장 + 안내 ───────────────────────────────────
      await saveToLibrary(uris);
    }
  }

  async function saveToLibrary(uris: string[]) {
    setStatus("saving");
    try {
      const { status: permStatus } = await MediaLibrary.requestPermissionsAsync();
      if (permStatus !== "granted") {
        Alert.alert("권한 필요", "사진 저장을 위해 갤러리 접근 권한이 필요합니다.");
        cleanup(uris);
        onDone();
        return;
      }
      for (const uri of uris) {
        await MediaLibrary.saveToLibraryAsync(uri);
      }
      cleanup(uris);
      if (Platform.OS === "android") {
        ToastAndroid.show(
          uris.length === 1
            ? "스토리 이미지가 저장되었습니다 📸"
            : `${uris.length}장 스토리 이미지가 저장되었습니다 📸`,
          ToastAndroid.LONG,
        );
      } else {
        Alert.alert(
          "저장 완료",
          uris.length === 1
            ? "스토리 이미지가 갤러리에 저장되었습니다.\nInstagram 앱에서 스토리 만들기 → 갤러리에서 불러와 공유하세요."
            : `${uris.length}장의 스토리 이미지가 갤러리에 저장되었습니다.\nInstagram 앱에서 갤러리 이미지를 선택해 스토리로 공유하세요.`,
        );
      }
      onDone();
    } catch {
      cleanup(uris);
      Alert.alert("저장 실패", "이미지를 저장하지 못했습니다.");
      onDone();
    }
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
    sharing: "Instagram 열기...",
    saving: "저장 중...",
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
