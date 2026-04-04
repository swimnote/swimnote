/**
 * ParentPromoStrip — 학부모 홈 슬림 가로 배너
 *
 * - /platform/banners API 첫 번째 활성 배너를 단일 가로줄로 표시
 * - 높이: 기존 카드 배너의 약 30% (42px)
 * - 없으면 기본 스윔노트 안내 문구 표시
 */
import React, { useEffect, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import { API_BASE } from "@/context/AuthContext";

interface Banner { id: string; title: string; link_url?: string; color_theme: string; }

const THEME_MAP: Record<string, { bg: string; accent: string; text: string }> = {
  teal:   { bg: "#E6FAF8", accent: "#2EC4B6", text: "#065F46" },
  purple: { bg: "#EDE9FE", accent: "#7C3AED", text: "#4C1D95" },
  orange: { bg: "#FFF7ED", accent: "#F97316", text: "#9A3412" },
  blue:   { bg: "#DBEAFE", accent: "#2563EB", text: "#1E40AF" },
  green:  { bg: "#D1FAE5", accent: "#059669", text: "#065F46" },
  red:    { bg: "#FEE2E2", accent: "#DC2626", text: "#991B1B" },
  pink:   { bg: "#FCE7F3", accent: "#DB2777", text: "#831843" },
};

const DEFAULT = { bg: "#E6FAF8", accent: "#2EC4B6", text: "#065F46" };

const FALLBACK = {
  title: "스윔노트 — 우리 아이 수영 성장을 기록해보세요",
  link_url: "",
  color_theme: "teal",
};

export function ParentPromoStrip() {
  const [banner, setBanner] = useState<Banner | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${API_BASE}/platform/banners`);
        if (!r.ok) return;
        const data = await r.json();
        const first: Banner | undefined = data.banners?.[0];
        if (!cancelled && first) setBanner(first);
      } catch {}
      finally { if (!cancelled) setReady(true); }
    })();
    return () => { cancelled = true; };
  }, []);

  const src = banner ?? FALLBACK;
  const th = THEME_MAP[src.color_theme] ?? DEFAULT;

  if (!ready) return null;

  return (
    <Pressable
      style={[s.strip, { backgroundColor: th.bg }]}
      onPress={() => {
        if (src.link_url) Linking.openURL(src.link_url).catch(() => {});
      }}
    >
      <View style={[s.iconWrap, { backgroundColor: th.accent + "22" }]}>
        <LucideIcon name="megaphone" size={14} color={th.accent} />
      </View>
      <Text style={[s.txt, { color: th.text }]} numberOfLines={1}>{src.title}</Text>
      {src.link_url ? (
        <LucideIcon name="chevron-right" size={14} color={th.accent} />
      ) : (
        <View style={{ width: 14 }} />
      )}
    </Pressable>
  );
}

const s = StyleSheet.create({
  strip: {
    marginHorizontal: 20,
    borderRadius: 10,
    height: 42,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    gap: 8,
  },
  iconWrap: {
    width: 26, height: 26, borderRadius: 13,
    alignItems: "center", justifyContent: "center",
  },
  txt: {
    flex: 1,
    fontSize: 12,
    fontFamily: "Pretendard-SemiBold",
    lineHeight: 16,
  },
});
