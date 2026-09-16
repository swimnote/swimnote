/**
 * ParentPromoStrip — 학부모 홈 상단 프로모션 배너
 *
 * - /platform/banners?type=strip API로 활성 strip 배너 목록 조회
 * - 1개: 단일 표시
 * - 2개+: display_seconds 기반 개별 시간 자동 순환
 * - 이미지/텍스트/이미지+텍스트 모두 지원
 * - 높이 고정 (레이아웃 흔들림 없음)
 * - 배너 0개: fallback 표시 ("스윔노트 — 우리 아이 수영 성장을 기록해보세요")
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AppState,
  Dimensions,
  Image,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { API_BASE } from "@/context/AuthContext";

const { width: SCREEN_W } = Dimensions.get("window");
const STRIP_MX = 16;
const STRIP_H  = 88;

interface StripBanner {
  id: string;
  title: string;
  description?: string | null;
  image_url?: string | null;
  image_key?: string | null;
  link_type?: string | null;
  link_url?: string | null;
  color_theme?: string;
  display_seconds?: number | null;
}

const THEME_MAP: Record<string, { bg: string; accent: string; text: string }> = {
  teal:   { bg: "#EEF9FB", accent: "#1683A3", text: "#163842" },
  purple: { bg: "#EDE9FE", accent: "#7C3AED", text: "#4C1D95" },
  orange: { bg: "#FFF7ED", accent: "#F97316", text: "#9A3412" },
  blue:   { bg: "#DBEAFE", accent: "#2563EB", text: "#1E40AF" },
  green:  { bg: "#D1FAE5", accent: "#059669", text: "#065F46" },
  red:    { bg: "#FEE2E2", accent: "#DC2626", text: "#991B1B" },
  pink:   { bg: "#FCE7F3", accent: "#DB2777", text: "#831843" },
};
const DEFAULT_THEME = { bg: "#EEF9FB", accent: "#1683A3", text: "#163842" };

const FALLBACK: StripBanner = {
  id: "__fallback__",
  title: "스윔노트 — 우리 아이 수영 성장을 기록해보세요",
  color_theme: "teal",
  display_seconds: 0,
};

const SAFE_URL_RE = /^https?:\/\//i;

function resolveImageUrl(b: StripBanner): string {
  if (b.image_key) return `${API_BASE}/uploads/${b.image_key}`;
  if (b.image_url) return b.image_url;
  return "";
}

function handleBannerPress(b: StripBanner) {
  const lt = b.link_type ?? "external";
  if (lt === "none" || !b.link_url) return;
  const url = b.link_url.trim();
  if (lt === "external" && SAFE_URL_RE.test(url)) {
    Linking.openURL(url).catch(() => {});
  }
  // internal: 향후 router.push 연동 가능
}

/** 단일 배너 렌더 */
function BannerSlide({ banner }: { banner: StripBanner }) {
  const th = THEME_MAP[banner.color_theme ?? ""] ?? DEFAULT_THEME;
  const imgUri = resolveImageUrl(banner);
  const hasImg = !!imgUri;
  const hasText = !!(banner.title || banner.description);
  const hasLink = !!(banner.link_type && banner.link_type !== "none" && banner.link_url);

  return (
    <Pressable
      style={[s.slide, { backgroundColor: hasImg ? "#000" : th.bg }]}
      onPress={hasLink ? () => handleBannerPress(banner) : undefined}
    >
      {hasImg && (
        <Image
          source={{ uri: imgUri }}
          style={s.bgImage}
          resizeMode="cover"
        />
      )}
      {hasImg && hasText && (
        <View style={s.imgOverlay} />
      )}
      {hasText && (
        <View style={[s.textArea, hasImg && s.textAreaOnImage]}>
          <Text
            style={[s.title, { color: hasImg ? "#fff" : th.text }]}
            numberOfLines={2}
          >
            {banner.title}
          </Text>
          {!!banner.description && (
            <Text
              style={[s.desc, { color: hasImg ? "rgba(255,255,255,0.85)" : th.accent }]}
              numberOfLines={1}
            >
              {banner.description}
            </Text>
          )}
        </View>
      )}
    </Pressable>
  );
}

export function ParentPromoStrip() {
  const [banners, setBanners] = useState<StripBanner[]>([]);
  const [ready, setReady] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const indexRef = useRef(0);
  const appStateRef = useRef(AppState.currentState);

  // ── 데이터 조회 ────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${API_BASE}/platform/banners?type=strip`);
        if (!r.ok) return;
        const data = await r.json();
        const list: StripBanner[] = Array.isArray(data.banners) ? data.banners : [];
        if (!cancelled) setBanners(list);
      } catch {}
      finally { if (!cancelled) setReady(true); }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── 자동 순환 (배너별 display_seconds) ────────────────────────────────
  const scheduleNext = useCallback((bList: StripBanner[], idx: number) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (bList.length <= 1) return;
    const current = bList[idx];
    const secs = Math.max(3, Math.min(30, current.display_seconds ?? 5));
    timerRef.current = setTimeout(() => {
      const next = (indexRef.current + 1) % bList.length;
      indexRef.current = next;
      setCurrentIndex(next);
      scheduleNext(bList, next);
    }, secs * 1000);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  }, []);

  useEffect(() => {
    if (!ready) return;
    indexRef.current = 0;
    setCurrentIndex(0);
    scheduleNext(banners, 0);
    return stopTimer;
  }, [ready, banners, scheduleNext, stopTimer]);

  // AppState 백그라운드 → 타이머 일시정지
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (appStateRef.current === "active" && next !== "active") {
        stopTimer();
      } else if (appStateRef.current !== "active" && next === "active") {
        scheduleNext(banners, indexRef.current);
      }
      appStateRef.current = next;
    });
    return () => sub.remove();
  }, [banners, scheduleNext, stopTimer]);

  if (!ready) return null;

  const displayList = banners.length > 0 ? banners : [FALLBACK];
  const current = displayList[currentIndex] ?? displayList[0];

  return (
    <View style={s.container}>
      <BannerSlide banner={current} />

      {/* 페이지 인디케이터 (2개 이상 실제 배너일 때만) */}
      {banners.length > 1 && (
        <View style={s.dots}>
          {banners.map((_, i) => (
            <View
              key={i}
              style={[
                s.dot,
                i === currentIndex ? s.dotActive : s.dotInactive,
              ]}
            />
          ))}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    marginHorizontal: STRIP_MX,
  },
  slide: {
    height: STRIP_H,
    borderRadius: 14,
    overflow: "hidden",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#CBD5E1",
  },
  bgImage: {
    ...StyleSheet.absoluteFillObject,
    width: SCREEN_W - STRIP_MX * 2,
    height: STRIP_H,
  },
  imgOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.32)",
  },
  textArea: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 3,
  },
  textAreaOnImage: {
    paddingHorizontal: 16,
  },
  title: {
    fontSize: 13,
    fontFamily: "Pretendard-SemiBold",
    lineHeight: 19,
    textAlign: "center",
  },
  desc: {
    fontSize: 11,
    fontFamily: "Pretendard-Regular",
    lineHeight: 16,
    textAlign: "center",
  },
  dots: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginTop: 6,
    gap: 4,
  },
  dot: {
    height: 5,
    borderRadius: 3,
  },
  dotActive: {
    width: 16,
    backgroundColor: "#1B3A70",
  },
  dotInactive: {
    width: 5,
    backgroundColor: "#CBD5E1",
  },
});
