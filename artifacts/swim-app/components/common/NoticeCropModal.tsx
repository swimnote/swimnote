/**
 * NoticeCropModal — 공지 대표 이미지 크롭 (16:9, 순수 JS, OTA 가능)
 *
 * - PanResponder: 이미지 이동/확대·축소 (순수 JS, native dep 없음)
 * - expo-image-manipulator: 실제 crop 연산 (이미 설치됨)
 * - 크롭 frame: 16:9 고정 (NoticePopupCard 실제 비율과 일치)
 * - "취소" 시 form 데이터 유지, 이미지 상태만 복원
 * - 결과는 local temp URI → 최종 등록 시점에만 R2 업로드
 */
import React, { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Image } from "expo-image";
import * as ImageManipulator from "expo-image-manipulator";

const SCREEN_W = Dimensions.get("window").width;

// 크롭 frame: 화면 너비에서 좌우 32px 여백
const FRAME_W = SCREEN_W - 64;
const FRAME_H = Math.round(FRAME_W * (9 / 16)); // 16:9

// 이미지 표시 최대 크기
const IMG_DISPLAY_W = SCREEN_W;
const IMG_DISPLAY_H = Math.round(SCREEN_W * (9 / 16));

// 크롭 frame의 화면 상 위치 (display 좌표)
const FRAME_LEFT = 32;
const FRAME_TOP_OFFSET = 0; // 이미지 컨테이너 내부 기준

interface Props {
  visible: boolean;
  sourceUri: string;           // 원본 이미지 URI
  onApply: (croppedUri: string) => void;
  onCancel: () => void;
}

export function NoticeCropModal({ visible, sourceUri, onApply, onCancel }: Props) {
  // pan/zoom 상태
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const [processing, setProcessing] = useState(false);

  // PanResponder용 ref (직전 값 추적)
  const lastTranslate = useRef({ x: 0, y: 0 });
  const lastScale = useRef(1);
  const lastDistance = useRef<number | null>(null);

  const [imgNaturalSize, setImgNaturalSize] = useState<{ w: number; h: number } | null>(null);

  // modal 열릴 때 상태 초기화
  React.useEffect(() => {
    if (visible) {
      setTranslate({ x: 0, y: 0 });
      setScale(1);
      lastTranslate.current = { x: 0, y: 0 };
      lastScale.current = 1;
      lastDistance.current = null;
      setProcessing(false);
    }
  }, [visible]);

  const getDistance = (touches: any[]) => {
    const [t1, t2] = touches;
    const dx = t1.pageX - t2.pageX;
    const dy = t1.pageY - t2.pageY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        lastDistance.current = null;
      },
      onPanResponderMove: (evt, gestureState) => {
        const touches = evt.nativeEvent.touches;
        if (touches.length === 2) {
          // 핀치 줌
          const dist = getDistance(touches as any);
          if (lastDistance.current !== null) {
            const ratio = dist / lastDistance.current;
            const newScale = Math.max(0.5, Math.min(4, lastScale.current * ratio));
            setScale(newScale);
          }
          lastDistance.current = dist;
        } else if (touches.length === 1) {
          // 팬
          setTranslate({
            x: lastTranslate.current.x + gestureState.dx,
            y: lastTranslate.current.y + gestureState.dy,
          });
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (lastDistance.current !== null) {
          // 핀치 종료 — scale 고정
          lastScale.current = scale;
          lastDistance.current = null;
        } else {
          lastTranslate.current = {
            x: lastTranslate.current.x + gestureState.dx,
            y: lastTranslate.current.y + gestureState.dy,
          };
        }
      },
    })
  ).current;

  // scale ref 동기
  React.useEffect(() => {
    lastScale.current = scale;
  }, [scale]);

  const handleApply = useCallback(async () => {
    if (!imgNaturalSize) return;
    setProcessing(true);
    try {
      // display 공간에서의 이미지 표시 크기
      const displayW = IMG_DISPLAY_W * scale;
      const displayH = IMG_DISPLAY_H * scale;

      // 이미지 display 좌상단 위치 (화면 기준)
      const imgLeft = (SCREEN_W - displayW) / 2 + translate.x;
      const imgTop  = (IMG_DISPLAY_H - displayH) / 2 + translate.y;

      // frame의 display 기준 위치
      const frameLeft = FRAME_LEFT;
      const frameTop  = FRAME_TOP_OFFSET + (IMG_DISPLAY_H - FRAME_H) / 2;

      // frame과 image의 상대 위치 → 원본 픽셀 좌표 변환
      const ratioX = imgNaturalSize.w / displayW;
      const ratioY = imgNaturalSize.h / displayH;

      const cropX = Math.max(0, (frameLeft - imgLeft) * ratioX);
      const cropY = Math.max(0, (frameTop  - imgTop)  * ratioY);
      const cropW = Math.min(imgNaturalSize.w - cropX, FRAME_W * ratioX);
      const cropH = Math.min(imgNaturalSize.h - cropY, FRAME_H * ratioY);

      const result = await ImageManipulator.manipulateAsync(
        sourceUri,
        [{ crop: { originX: cropX, originY: cropY, width: cropW, height: cropH } }],
        { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG }
      );
      onApply(result.uri);
    } catch (e) {
      console.error("crop error:", e);
      onCancel();
    } finally {
      setProcessing(false);
    }
  }, [imgNaturalSize, scale, translate, sourceUri, onApply, onCancel]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onCancel}
    >
      <View style={s.container}>
        {/* 상단 헤더 */}
        <View style={s.header}>
          <Pressable onPress={onCancel} style={s.headerBtn}>
            <Text style={s.cancelTxt}>취소</Text>
          </Pressable>
          <Text style={s.headerTitle}>이미지 위치 조절</Text>
          <Pressable
            onPress={handleApply}
            disabled={processing}
            style={[s.headerBtn, s.applyBtn, processing && { opacity: 0.4 }]}
          >
            {processing
              ? <ActivityIndicator size="small" color="#7C3AED" />
              : <Text style={s.applyTxt}>적용</Text>
            }
          </Pressable>
        </View>

        {/* 안내 */}
        <Text style={s.guide}>드래그하여 이동 · 두 손가락으로 확대/축소</Text>

        {/* 이미지 + 크롭 frame */}
        <View style={s.imageContainer} {...panResponder.panHandlers}>
          <Image
            source={{ uri: sourceUri }}
            style={[
              s.image,
              {
                transform: [
                  { translateX: translate.x },
                  { translateY: translate.y },
                  { scale },
                ],
              },
            ]}
            contentFit="contain"
            onLoad={(e: any) => {
              const { width, height } = e.source ?? e.nativeEvent?.source ?? {};
              if (width && height) setImgNaturalSize({ w: width, h: height });
            }}
          />
          {/* 크롭 frame 오버레이 */}
          <View style={s.overlay} pointerEvents="none">
            {/* 상단 어두운 영역 */}
            <View style={[s.dim, { top: 0, left: 0, right: 0, height: (IMG_DISPLAY_H - FRAME_H) / 2 }]} />
            {/* 하단 어두운 영역 */}
            <View style={[s.dim, { bottom: 0, left: 0, right: 0, height: (IMG_DISPLAY_H - FRAME_H) / 2 }]} />
            {/* 좌측 어두운 영역 */}
            <View style={[s.dim, {
              top: (IMG_DISPLAY_H - FRAME_H) / 2,
              left: 0,
              width: FRAME_LEFT,
              height: FRAME_H,
            }]} />
            {/* 우측 어두운 영역 */}
            <View style={[s.dim, {
              top: (IMG_DISPLAY_H - FRAME_H) / 2,
              right: 0,
              width: FRAME_LEFT,
              height: FRAME_H,
            }]} />
            {/* frame 테두리 */}
            <View style={[s.frame, {
              top: (IMG_DISPLAY_H - FRAME_H) / 2,
              left: FRAME_LEFT,
              width: FRAME_W,
              height: FRAME_H,
            }]} />
          </View>
        </View>

        {/* 비율 안내 */}
        <Text style={s.ratioNote}>16:9 비율 · 실제 공지 카드와 동일 영역</Text>

        {/* 리셋 */}
        <Pressable
          style={s.resetBtn}
          onPress={() => {
            setTranslate({ x: 0, y: 0 });
            setScale(1);
            lastTranslate.current = { x: 0, y: 0 };
            lastScale.current = 1;
          }}
        >
          <Text style={s.resetTxt}>위치 초기화</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#111" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 12,
    backgroundColor: "#111",
  },
  headerTitle: {
    fontSize: 16,
    color: "#fff",
    fontFamily: "Pretendard-SemiBold",
  },
  headerBtn: { minWidth: 56, alignItems: "center", paddingVertical: 6 },
  applyBtn: {
    backgroundColor: "#7C3AED",
    borderRadius: 8,
    paddingHorizontal: 14,
  },
  cancelTxt: { fontSize: 15, color: "#aaa", fontFamily: "Pretendard-Regular" },
  applyTxt:  { fontSize: 15, color: "#fff", fontFamily: "Pretendard-SemiBold" },
  guide: {
    textAlign: "center",
    fontSize: 12,
    color: "#aaa",
    fontFamily: "Pretendard-Regular",
    marginBottom: 12,
  },
  imageContainer: {
    width: IMG_DISPLAY_W,
    height: IMG_DISPLAY_H,
    overflow: "hidden",
    backgroundColor: "#222",
  },
  image: {
    width: IMG_DISPLAY_W,
    height: IMG_DISPLAY_H,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
  },
  dim: {
    position: "absolute",
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  frame: {
    position: "absolute",
    borderWidth: 2,
    borderColor: "#fff",
  },
  ratioNote: {
    textAlign: "center",
    fontSize: 11,
    color: "#888",
    fontFamily: "Pretendard-Regular",
    marginTop: 10,
  },
  resetBtn: {
    alignSelf: "center",
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 8,
    backgroundColor: "#222",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#444",
  },
  resetTxt: { fontSize: 13, color: "#bbb", fontFamily: "Pretendard-Regular" },
});
