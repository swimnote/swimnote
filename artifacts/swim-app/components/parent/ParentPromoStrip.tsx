/**
 * ParentPromoStrip v2 — 학부모 홈 가로 프로모션 배너
 *
 * - GET /platform/banners?type=strip 에서 활성 배너 목록(최대 4개) 가져옴
 * - 1개: 단일 배너, 자동전환 없음
 * - 2~4개: FlatList horizontal 슬라이드 + 15초 자동전환 + 수동 스와이프
 * - 배너 없음: FALLBACK 문구
 * - AppState background → 타이머 pause / foreground → resume
 * - 비율: 16:5 (기기 폭 - 40px)
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AppState,
  Dimensions,
  FlatList,
  Image,
  Linking,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { API_BASE, useAuth } from "@/context/AuthContext";

const SCREEN_W = Dimensions.get("window").width;
const BANNER_MX = 20;
const BANNER_W = SCREEN_W - BANNER_MX * 2;
const ASPECT = 16 / 5;
const BANNER_H = Math.round(BANNER_W / ASPECT);
const DEFAULT_SLIDE_MS = 15000;

const THEME_MAP: Record<string, { bg: string; accent: string; text: string }> = {
  teal:   { bg: "#EEF9FB", accent: "#1683A3", text: "#163842" },
  purple: { bg: "#EDE9FE", accent: "#7C3AED", text: "#4C1D95" },
  orange: { bg: "#FFF7ED", accent: "#F97316", text: "#9A3412" },
  blue:   { bg: "#DBEAFE", accent: "#2563EB", text: "#1E40AF" },
  green:  { bg: "#D1FAE5", accent: "#059669", text: "#065F46" },
  red:    { bg: "#FEE2E2", accent: "#DC2626", text: "#991B1B" },
  pink:   { bg: "#FCE7F3", accent: "#DB2777", text: "#831843" },
};
const DEFAULT_THEME = { bg: "#FFFFFF", accent: "#1B3A70", text: "#1B3A70" };

interface BannerSlide {
  id: string;
  title: string;
  description?: string;
  color_theme: string;
  link_url?: string;
  display_url?: string;   // 서버에서 조합된 이미지 URL (image_key 기반)
  image_url?: string;
}

const FALLBACK: BannerSlide = {
  id: "__fallback__",
  title: "스윔노트 — 우리 아이 수영 성장을 기록해보세요",
  color_theme: "teal",
};

// 슬라이드 하나 렌더러
function SlideItem({ slide, onPress }: { slide: BannerSlide; onPress?: () => void }) {
  const imgUri = slide.display_url || slide.image_url || "";
  const th = THEME_MAP[slide.color_theme] ?? DEFAULT_THEME;

  if (imgUri) {
    return (
      <Pressable style={s.slide} onPress={onPress}>
        <Image source={{ uri: imgUri }} style={s.img} resizeMode="cover" />
      </Pressable>
    );
  }

  return (
    <Pressable style={[s.slide, s.textSlide, { backgroundColor: th.bg }]} onPress={onPress}>
      <View style={s.textInner}>
        <Text style={[s.title, { color: th.text }]} numberOfLines={2}>
          {slide.title}
        </Text>
        {!!slide.description && (
          <Text style={[s.desc, { color: th.text }]} numberOfLines={2}>
            {slide.description}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

export function ParentPromoStrip() {
  const { token, isLoading } = useAuth();
  const [slides, setSlides] = useState<BannerSlide[]>([]);
  const [ready, setReady] = useState(false);
  const [currentIdx, setCurrentIdx] = useState(0);

  const flatRef = useRef<FlatList<BannerSlide>>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const idxRef = useRef(0);
  const pausedRef = useRef(false);

  // ── fetch ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (isLoading) return;
    if (!token) { setReady(true); return; }

    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${API_BASE}/platform/banners?type=strip`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!r.ok) return;
        const data = await r.json();
        const list: BannerSlide[] = (data.banners ?? []).map((b: any) => ({
          id:          b.id,
          title:       b.title ?? "",
          description: b.description ?? "",
          color_theme: b.color_theme ?? "teal",
          link_url:    b.link_url ?? "",
          display_url: b.display_url ?? "",
          image_url:   b.image_url ?? "",
        }));
        if (!cancelled && list.length > 0) setSlides(list);
      } catch {}
      finally { if (!cancelled) setReady(true); }
    })();
    return () => { cancelled = true; };
  }, [isLoading, token]);

  // ── 자동 슬라이드 타이머 ───────────────────────────────────────────────
  const startTimer = useCallback(() => {
    if (slides.length < 2) return;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      if (pausedRef.current) return;
      const next = (idxRef.current + 1) % slides.length;
      idxRef.current = next;
      setCurrentIdx(next);
      flatRef.current?.scrollToIndex({ index: next, animated: true });
    }, DEFAULT_SLIDE_MS);
  }, [slides.length]);

  useEffect(() => {
    if (!ready || slides.length < 2) return;
    startTimer();
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [ready, startTimer]);

  // ── AppState pause / resume ────────────────────────────────────────────
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        pausedRef.current = false;
      } else {
        pausedRef.current = true;
      }
    });
    return () => sub.remove();
  }, []);

  // ── 수동 스와이프 핸들러 ───────────────────────────────────────────────
  function onMomentumScrollEnd(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const idx = Math.round(e.nativeEvent.contentOffset.x / BANNER_W);
    idxRef.current = idx;
    setCurrentIdx(idx);
    // 스와이프 후 타이머 리셋
    if (slides.length >= 2) startTimer();
  }

  if (!ready) return null;

  const displaySlides = slides.length > 0 ? slides : [FALLBACK];
  const showIndicator = displaySlides.length > 1;

  return (
    <View style={s.container}>
      <FlatList
        ref={flatRef}
        data={displaySlides}
        keyExtractor={item => item.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEnabled={displaySlides.length > 1}
        onMomentumScrollEnd={onMomentumScrollEnd}
        getItemLayout={(_, index) => ({ length: BANNER_W, offset: BANNER_W * index, index })}
        renderItem={({ item }) => (
          <SlideItem
            slide={item}
            onPress={() => { if (item.link_url) Linking.openURL(item.link_url).catch(() => {}); }}
          />
        )}
      />
      {showIndicator && (
        <View style={s.dots}>
          {displaySlides.map((_, i) => (
            <View key={i} style={[s.dot, i === currentIdx && s.dotActive]} />
          ))}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    marginHorizontal: BANNER_MX,
  },
  slide: {
    width: BANNER_W,
    height: BANNER_H,
    borderRadius: 12,
    overflow: "hidden",
  },
  img: {
    width: BANNER_W,
    height: BANNER_H,
  },
  textSlide: {
    borderWidth: 1,
    borderColor: "#CBD5E1",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  textInner: {
    alignItems: "center",
    gap: 6,
  },
  title: {
    fontSize: 13,
    fontFamily: "Pretendard-SemiBold",
    lineHeight: 19,
    textAlign: "center",
  },
  desc: {
    fontSize: 12,
    fontFamily: "Pretendard-Regular",
    lineHeight: 17,
    textAlign: "center",
    opacity: 0.8,
  },
  dots: {
    flexDirection: "row",
    justifyContent: "center",
    marginTop: 7,
    gap: 5,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: "#CBD5E1",
  },
  dotActive: {
    backgroundColor: "#1683A3",
    width: 14,
  },
});
