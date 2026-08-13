/**
 * WP15.5-C Fix — ParentAdBanner
 *
 * - TEXT / IMAGE / IMAGE_WITH_TEXT 분기 렌더링
 * - FADE effect 지원 (Animated.View)
 * - 실제 렌더 후 impression API 1회 호출 (GET ad-slot ≠ impression)
 * - 광고 클릭 시 AD_CLICK 기록 + http/https URL만 open
 * - creative 없으면 null (화면 공간 차지 없음)
 */
import React, { useEffect, useRef, useState } from "react";
import { Animated, Image, Linking, Pressable, Text, View } from "react-native";
import { API_BASE } from "@/context/AuthContext";

interface AdCreative {
  id: string;
  placement: string;
  creative_type: string;
  headline?: string;
  body_text?: string;
  image_url?: string;
  destination_url?: string;
  effect_type: string;
}

interface Props {
  token: string | null;
}

const SAFE_URL_RE = /^https?:\/\//i;

export function ParentAdBanner({ token }: Props) {
  const [creative, setCreative] = useState<AdCreative | null>(null);
  const [ready, setReady]       = useState(false);
  const impressionFired         = useRef(false);
  const fadeAnim                = useRef(new Animated.Value(0)).current;

  // ── ad-slot fetch ────────────────────────────────────────────────────
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
          setCreative(data.creative ?? null);
          setReady(true);
        }
      } catch {
        if (!cancelled) setReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  // ── FADE 애니메이션 + impression 기록 (creative 확정 시) ─────────────
  useEffect(() => {
    if (!creative || !token) return;

    // FADE effect 또는 기본: fade-in
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: creative.effect_type === "FADE" ? 600 : 0,
      useNativeDriver: true,
    }).start();

    // impression: 한 렌더에서 1회만 (중복 방지)
    if (impressionFired.current) return;
    impressionFired.current = true;

    fetch(`${API_BASE}/parent/ad-events/impression`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ creative_id: creative.id, placement: creative.placement }),
    }).catch(() => {});
  }, [creative]); // eslint-disable-line react-hooks/exhaustive-deps

  // Creative 없거나 로딩 중이면 null (숨김)
  if (!ready || !creative) return null;

  // ── 클릭 핸들러: AD_CLICK 기록 + URL 안전성 체크 후 open ────────────
  async function handlePress() {
    const dest = creative?.destination_url ?? "";
    if (!dest) return;

    // URL 안전성: http/https만 허용
    if (!SAFE_URL_RE.test(dest)) return;

    // AD_CLICK 기록 (fire-and-forget)
    if (token && creative) {
      fetch(`${API_BASE}/parent/ad-events/click`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ creative_id: creative.id, placement: creative.placement }),
      }).catch(() => {});
    }

    Linking.openURL(dest).catch(() => {});
  }

  const type     = creative.creative_type;
  const hasImage = !!creative.image_url;
  const hasText  = !!(creative.headline || creative.body_text);
  const hasLink  = !!creative.destination_url && SAFE_URL_RE.test(creative.destination_url);

  // ── TEXT only ──────────────────────────────────────────────────────
  const TextBlock = hasText ? (
    <View style={{ paddingHorizontal: 14, paddingVertical: 10, gap: 2 }}>
      {creative.headline ? (
        <Text style={{ fontSize: 13, fontFamily: "Pretendard-SemiBold", color: "#1B3A70" }}>
          {creative.headline}
        </Text>
      ) : null}
      {creative.body_text ? (
        <Text style={{ fontSize: 11, color: "#6B7280", lineHeight: 16 }}>
          {creative.body_text}
        </Text>
      ) : null}
    </View>
  ) : null;

  const ImageBlock = hasImage ? (
    <Image
      source={{ uri: creative.image_url }}
      style={{ width: "100%", height: 120 }}
      resizeMode="cover"
    />
  ) : null;

  return (
    <Animated.View style={{ opacity: fadeAnim, marginHorizontal: 16, marginTop: 8, marginBottom: 4 }}>
      <Pressable
        onPress={hasLink ? handlePress : undefined}
        style={({ pressed }) => ({
          backgroundColor: "#F8F9FA",
          borderRadius: 12,
          borderWidth: 1,
          borderColor: "#E8E8E8",
          overflow: "hidden",
          opacity: pressed && hasLink ? 0.88 : 1,
        })}
      >
        {/* IMAGE or IMAGE_WITH_TEXT — 이미지 먼저 */}
        {(type === "IMAGE" || type === "IMAGE_WITH_TEXT") && ImageBlock}

        {/* TEXT or IMAGE_WITH_TEXT — 텍스트 */}
        {(type === "TEXT" || type === "IMAGE_WITH_TEXT") && TextBlock}

        {/* IMAGE만 (텍스트 없음) — 텍스트 없이 이미지만 */}
        {type === "IMAGE" && !hasText && null}

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
    </Animated.View>
  );
}
