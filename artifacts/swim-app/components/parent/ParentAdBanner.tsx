/**
 * ParentAdBanner — multi-banner carousel
 *
 * - platform_banners(slider) 기반 creatives[] 배열 수신
 * - 1개: 단일 배너 표시
 * - 0개: null (공간 0)
 * - 2개+: horizontal carousel (FlatList pagingEnabled)
 * - page indicator (dot)
 * - 5초 자동 slide (AppState background에서 pause)
 * - impression: 최초 보이는 배너만 1회 (각 id 기준)
 * - click: 배너 클릭 시 AD_CLICK 기록 + URL open
 * - backward compat: creatives[] 없으면 creative 단일 사용
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
  Text,
  View,
} from "react-native";
import { API_BASE } from "@/context/AuthContext";

const { width: SCREEN_W } = Dimensions.get("window");
const BANNER_H = 120;
const BANNER_MX = 16;
const BANNER_W = SCREEN_W - BANNER_MX * 2;
const AUTO_SLIDE_MS = 5000;
const SAFE_URL_RE = /^https?:\/\//i;

interface BannerCreative {
  id: string;
  placement: string;
  creative_type: string;
  headline?: string | null;
  body_text?: string | null;
  image_url?: string | null;
  destination_url?: string | null;
  effect_type: string;
}

interface Props {
  token: string | null;
}

function BannerItem({
  item,
  token,
  impressionFired,
}: {
  item: BannerCreative;
  token: string | null;
  impressionFired: React.MutableRefObject<Set<string>>;
}) {
  const type = item.creative_type;
  const hasImage = !!item.image_url;
  const hasText = !!(item.headline || item.body_text);
  const hasLink = !!item.destination_url && SAFE_URL_RE.test(item.destination_url);

  // impression on first mount
  useEffect(() => {
    if (!token || impressionFired.current.has(item.id)) return;
    impressionFired.current.add(item.id);
    fetch(`${API_BASE}/parent/ad-events/impression`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ creative_id: item.id, placement: item.placement }),
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handlePress() {
    const dest = item.destination_url ?? "";
    if (!dest || !SAFE_URL_RE.test(dest)) return;
    if (token) {
      fetch(`${API_BASE}/parent/ad-events/click`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ creative_id: item.id, placement: item.placement }),
      }).catch(() => {});
    }
    Linking.openURL(dest).catch(() => {});
  }

  return (
    <Pressable
      onPress={hasLink ? handlePress : undefined}
      style={({ pressed }) => ({
        width: BANNER_W,
        height: BANNER_H,
        backgroundColor: "#F8F9FA",
        borderRadius: 12,
        borderWidth: 1,
        borderColor: "#E8E8E8",
        overflow: "hidden",
        opacity: pressed && hasLink ? 0.88 : 1,
      })}
    >
      {/* IMAGE 또는 IMAGE_WITH_TEXT */}
      {(type === "IMAGE" || type === "IMAGE_WITH_TEXT") && hasImage && (
        <Image
          source={{ uri: item.image_url! }}
          style={{ width: "100%", height: hasText ? BANNER_H * 0.65 : BANNER_H }}
          resizeMode="cover"
        />
      )}

      {/* TEXT 또는 IMAGE_WITH_TEXT */}
      {(type === "TEXT" || type === "IMAGE_WITH_TEXT") && hasText && (
        <View style={{ paddingHorizontal: 14, paddingVertical: 8, gap: 2 }}>
          {item.headline ? (
            <Text style={{ fontSize: 13, fontFamily: "Pretendard-SemiBold", color: "#1B3A70" }} numberOfLines={1}>
              {item.headline}
            </Text>
          ) : null}
          {item.body_text ? (
            <Text style={{ fontSize: 11, color: "#6B7280", lineHeight: 16 }} numberOfLines={2}>
              {item.body_text}
            </Text>
          ) : null}
        </View>
      )}

      {/* AD 라벨 */}
      <View
        style={{
          position: "absolute",
          top: 6,
          right: 6,
          backgroundColor: "rgba(0,0,0,0.35)",
          borderRadius: 4,
          paddingHorizontal: 5,
          paddingVertical: 2,
        }}
      >
        <Text style={{ fontSize: 9, color: "#fff", fontFamily: "Pretendard-Regular", letterSpacing: 0.5 }}>
          AD
        </Text>
      </View>
    </Pressable>
  );
}

export function ParentAdBanner({ token }: Props) {
  const [creatives, setCreatives] = useState<BannerCreative[]>([]);
  const [ready, setReady] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const flatListRef = useRef<FlatList<BannerCreative>>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const appStateRef = useRef(AppState.currentState);
  const impressionFired = useRef<Set<string>>(new Set());

  // ── fetch ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!token) { setReady(true); return; }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(
          `${API_BASE}/parent/ad-slot?placement=PARENT_HOME_BANNER`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!r.ok) { if (!cancelled) setReady(true); return; }
        const data = await r.json();
        if (!cancelled) {
          // creatives[] 우선, 없으면 creative 단일을 배열로
          const list: BannerCreative[] = Array.isArray(data.creatives) && data.creatives.length > 0
            ? data.creatives
            : data.creative ? [data.creative] : [];
          setCreatives(list);
          setReady(true);
        }
      } catch {
        if (!cancelled) setReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  // ── auto slide ─────────────────────────────────────────────────────────────
  const startTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setCurrentIndex((prev) => {
        const next = (prev + 1) % creatives.length;
        try {
          flatListRef.current?.scrollToIndex({ index: next, animated: true });
        } catch { /* ignore */ }
        return next;
      });
    }, AUTO_SLIDE_MS);
  }, [creatives.length]);

  const stopTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  useEffect(() => {
    if (creatives.length <= 1) { stopTimer(); return; }
    startTimer();
    return stopTimer;
  }, [creatives.length, startTimer, stopTimer]);

  // AppState background → pause timer
  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState) => {
      if (appStateRef.current === "active" && nextState !== "active") stopTimer();
      else if (appStateRef.current !== "active" && nextState === "active") {
        if (creatives.length > 1) startTimer();
      }
      appStateRef.current = nextState;
    });
    return () => sub.remove();
  }, [creatives.length, startTimer, stopTimer]);

  // ── scroll handler ─────────────────────────────────────────────────────────
  function onMomentumScrollEnd(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const idx = Math.round(e.nativeEvent.contentOffset.x / BANNER_W);
    setCurrentIndex(idx);
    // 사용자가 swipe하면 timer restart (충돌 방지)
    if (creatives.length > 1) startTimer();
  }

  // 로딩 중이거나 배너 없으면 null
  if (!ready || creatives.length === 0) return null;

  return (
    <View style={{ marginHorizontal: BANNER_MX, marginTop: 8, marginBottom: 4 }}>
      <FlatList
        ref={flatListRef}
        data={creatives}
        keyExtractor={(item) => item.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onMomentumScrollEnd}
        scrollEnabled={creatives.length > 1}
        renderItem={({ item }) => (
          <BannerItem item={item} token={token} impressionFired={impressionFired} />
        )}
        getItemLayout={(_, index) => ({ length: BANNER_W, offset: BANNER_W * index, index })}
        style={{ borderRadius: 12 }}
      />

      {/* Page indicator (2개 이상일 때만) */}
      {creatives.length > 1 && (
        <View
          style={{
            flexDirection: "row",
            justifyContent: "center",
            alignItems: "center",
            marginTop: 6,
            gap: 4,
          }}
        >
          {creatives.map((_, i) => (
            <View
              key={i}
              style={{
                width: i === currentIndex ? 16 : 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: i === currentIndex ? "#1B3A70" : "#D1D5DB",
              }}
            />
          ))}
        </View>
      )}
    </View>
  );
}
