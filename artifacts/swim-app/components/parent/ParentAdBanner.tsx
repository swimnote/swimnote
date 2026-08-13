/**
 * WP15.5-C — ParentAdBanner
 * PARENT_HOME_BANNER 슬롯에서 활성 Creative를 가져와 렌더링한다.
 * Creative가 없거나 오류 시 null 반환 (화면 공간 차지 없음).
 */
import React, { useEffect, useState } from "react";
import { Image, Linking, Pressable, Text, View } from "react-native";
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

export function ParentAdBanner({ token }: Props) {
  const [creative, setCreative] = useState<AdCreative | null>(null);
  const [ready, setReady]       = useState(false);

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
        if (!cancelled) setCreative(data.creative ?? null);
      } catch {}
      finally { if (!cancelled) setReady(true); }
    })();
    return () => { cancelled = true; };
  }, [token]);

  // Creative 없거나 로딩 중이면 null (숨김)
  if (!ready || !creative) return null;

  const hasImage   = !!creative.image_url;
  const hasLink    = !!creative.destination_url;
  const handlePress = () => {
    if (hasLink) Linking.openURL(creative.destination_url!).catch(() => {});
  };

  return (
    <View style={{ marginHorizontal: 16, marginTop: 8, marginBottom: 4 }}>
      <Pressable
        onPress={handlePress}
        style={({ pressed }) => ({
          backgroundColor: "#F8F9FA",
          borderRadius: 12,
          borderWidth: 1,
          borderColor: "#E8E8E8",
          overflow: "hidden",
          opacity: pressed ? 0.88 : 1,
        })}
      >
        {/* 이미지 */}
        {hasImage && (
          <Image
            source={{ uri: creative.image_url }}
            style={{ width: "100%", height: 120 }}
            resizeMode="cover"
          />
        )}

        {/* 텍스트 영역 */}
        {(creative.headline || creative.body_text) && (
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
        )}

        {/* AD 표시 (투명도 낮은 작은 라벨) */}
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
    </View>
  );
}
