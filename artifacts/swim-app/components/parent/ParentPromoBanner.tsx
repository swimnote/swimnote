/**
 * ParentPromoBanner — 학부모 홈 프로모션 배너 슬라이더
 *
 * - /platform/banners API에서 활성 배너를 가져옴
 * - 배너가 없으면 기본 수영 팁 카드로 채움
 * - 자동 스크롤 + 인디케이터 도트
 */
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Dimensions, Linking, Pressable, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import { API_BASE } from "@/context/AuthContext";

const { width: SW } = Dimensions.get("window");
const CARD_W = SW - 48;
const CARD_H = 130;
const AUTO_SCROLL_MS = 4200;

interface PlatformBanner {
  id: string;
  title: string;
  description?: string;
  link_url?: string;
  link_label?: string;
  color_theme: string;
}

const SWIM_TIPS = [
  {
    id: "tip1", tag: "수영 팁",
    title: "호흡 리듬이 실력을 결정해요",
    desc: "3번 스트로크에 1번 호흡하는 패턴을 꾸준히 연습해보세요.",
    bg: "#EDE9FE", tagColor: "#7C3AED", titleColor: "#4C1D95", icon: "wind",
  },
  {
    id: "tip2", tag: "성장 포인트",
    title: "킥은 무릎이 아닌 고관절에서",
    desc: "킥은 무릎을 굽히지 않고 고관절에서 시작해야 효율이 높아집니다.",
    bg: "#DBEAFE", tagColor: "#2563EB", titleColor: "#1E40AF", icon: "zap",
  },
  {
    id: "tip3", tag: "건강 정보",
    title: "수영 후 스트레칭 5분의 기적",
    desc: "수영 후 어깨·허리 스트레칭으로 근육 회복과 유연성을 높여보세요.",
    bg: "#D1FAE5", tagColor: "#059669", titleColor: "#065F46", icon: "heart",
  },
  {
    id: "tip4", tag: "출결 관리",
    title: "꾸준함이 실력의 90%",
    desc: "주 3회 이상 꾸준한 출석이 실력 향상의 가장 빠른 지름길입니다.",
    bg: "#FEF9C3", tagColor: "#D97706", titleColor: "#92400E", icon: "calendar-check",
  },
];

// 색상 테마 매핑
const THEME_MAP: Record<string, { bg: string; tagColor: string; titleColor: string }> = {
  teal:   { bg: "#E6FAF8", tagColor: "#2EC4B6", titleColor: "#0D6E68" },
  purple: { bg: "#EDE9FE", tagColor: "#7C3AED", titleColor: "#4C1D95" },
  orange: { bg: "#FFF7ED", tagColor: "#F97316", titleColor: "#9A3412" },
  blue:   { bg: "#DBEAFE", tagColor: "#2563EB", titleColor: "#1E40AF" },
  green:  { bg: "#D1FAE5", tagColor: "#059669", titleColor: "#065F46" },
  red:    { bg: "#FEE2E2", tagColor: "#DC2626", titleColor: "#991B1B" },
  pink:   { bg: "#FCE7F3", tagColor: "#DB2777", titleColor: "#831843" },
};

function getTheme(colorTheme: string) {
  return THEME_MAP[colorTheme] ?? THEME_MAP.teal;
}

interface Props {
  /** 하위 호환 — 기존 notice 기반 코드에서 전달 시 무시됨 */
  notices?: any[];
  onPressNotice?: (id: string) => void;
}

export function ParentPromoBanner({ }: Props) {
  const scrollRef = useRef<ScrollView>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [banners, setBanners] = useState<PlatformBanner[]>([]);
  const [fetched, setFetched] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${API_BASE}/platform/banners`);
        if (!r.ok) return;
        const data = await r.json();
        if (!cancelled) setBanners(data.banners ?? []);
      } catch {}
      finally { if (!cancelled) setFetched(true); }
    })();
    return () => { cancelled = true; };
  }, []);

  const hasBanners = banners.length > 0;
  const items: any[] = hasBanners ? banners : SWIM_TIPS;
  const total = items.length;

  function scrollTo(idx: number) {
    scrollRef.current?.scrollTo({ x: idx * (CARD_W + 12), animated: true });
    setActiveIdx(idx);
  }

  function startAutoScroll() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setActiveIdx(prev => {
        const next = (prev + 1) % total;
        scrollRef.current?.scrollTo({ x: next * (CARD_W + 12), animated: true });
        return next;
      });
    }, AUTO_SCROLL_MS);
  }

  useEffect(() => {
    if (total > 1) startAutoScroll();
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [total]);

  function handleScrollEnd(e: any) {
    const x = e.nativeEvent.contentOffset.x;
    const idx = Math.round(x / (CARD_W + 12));
    setActiveIdx(Math.max(0, Math.min(idx, total - 1)));
  }

  if (!fetched) {
    return (
      <View style={[s.wrap, { alignItems: "center", justifyContent: "center", height: CARD_H + 40 }]}>
        <ActivityIndicator size="small" color="#2EC4B6" />
      </View>
    );
  }

  return (
    <View style={s.wrap}>
      <View style={s.headerRow}>
        <View style={s.titleRow}>
          <LucideIcon name={hasBanners ? "megaphone" : "lightbulb"} size={14} color={hasBanners ? "#F97316" : "#2EC4B6"} />
          <Text style={s.sectionTitle}>{hasBanners ? "스윔노트 이벤트" : "오늘의 수영 팁"}</Text>
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled={false}
        snapToInterval={CARD_W + 12}
        decelerationRate="fast"
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, gap: 12 }}
        onMomentumScrollEnd={handleScrollEnd}
        onScrollBeginDrag={() => { if (timerRef.current) clearInterval(timerRef.current); }}
        onScrollEndDrag={() => { if (total > 1) startAutoScroll(); }}
      >
        {hasBanners
          ? banners.map(b => {
              const th = getTheme(b.color_theme);
              return (
                <Pressable
                  key={b.id}
                  style={({ pressed }) => [s.card, { backgroundColor: th.bg, opacity: pressed ? 0.88 : 1, width: CARD_W }]}
                  onPress={() => { if (b.link_url) Linking.openURL(b.link_url).catch(() => {}); }}
                >
                  <View style={[s.tag, { backgroundColor: th.tagColor + "22" }]}>
                    <LucideIcon name="megaphone" size={11} color={th.tagColor} />
                    <Text style={[s.tagTxt, { color: th.tagColor }]}>스윔노트</Text>
                  </View>
                  <Text style={[s.cardTitle, { color: th.titleColor }]} numberOfLines={2}>{b.title}</Text>
                  {b.description ? (
                    <Text style={s.cardDesc} numberOfLines={2}>{b.description}</Text>
                  ) : null}
                  {b.link_url ? (
                    <View style={s.cardFooter}>
                      <View style={[s.readMore, { backgroundColor: th.tagColor }]}>
                        <Text style={s.readMoreTxt}>{b.link_label || "자세히 보기"}</Text>
                        <LucideIcon name="chevron-right" size={10} color="#fff" />
                      </View>
                    </View>
                  ) : null}
                </Pressable>
              );
            })
          : SWIM_TIPS.map(tip => (
              <View key={tip.id} style={[s.card, { backgroundColor: tip.bg, width: CARD_W }]}>
                <View style={[s.tag, { backgroundColor: tip.tagColor + "22" }]}>
                  <LucideIcon name={tip.icon as any} size={11} color={tip.tagColor} />
                  <Text style={[s.tagTxt, { color: tip.tagColor }]}>{tip.tag}</Text>
                </View>
                <Text style={[s.cardTitle, { color: tip.titleColor }]} numberOfLines={2}>{tip.title}</Text>
                <Text style={s.cardDesc} numberOfLines={2}>{tip.desc}</Text>
                <View style={s.cardFooter}>
                  <Text style={[s.cardDate, { color: tip.tagColor + "99" }]}>SwimNote</Text>
                </View>
              </View>
            ))
        }
      </ScrollView>

      {total > 1 && (
        <View style={s.dots}>
          {items.map((_, i) => (
            <Pressable key={i} onPress={() => scrollTo(i)} hitSlop={6}>
              <View style={[s.dot, activeIdx === i && s.dotActive]} />
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginTop: 4, marginBottom: 4 },
  headerRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, marginBottom: 10,
  },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  sectionTitle: { fontSize: 14, fontFamily: "Pretendard-SemiBold", color: "#111" },
  card: {
    height: CARD_H, borderRadius: 16, padding: 16,
    justifyContent: "space-between", overflow: "hidden",
  },
  tag: {
    flexDirection: "row", alignItems: "center", gap: 4,
    alignSelf: "flex-start", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3,
    marginBottom: 6,
  },
  tagTxt: { fontSize: 11, fontFamily: "Pretendard-SemiBold" },
  cardTitle: { fontSize: 15, fontFamily: "Pretendard-Bold", lineHeight: 21, flex: 1 },
  cardDesc: { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#555", lineHeight: 17, marginTop: 2 },
  cardFooter: {
    flexDirection: "row", alignItems: "center", justifyContent: "flex-end", marginTop: 8,
  },
  cardDate: { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#999" },
  readMore: {
    flexDirection: "row", alignItems: "center", gap: 2,
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5,
  },
  readMoreTxt: { fontSize: 11, fontFamily: "Pretendard-SemiBold", color: "#fff" },
  dots: { flexDirection: "row", justifyContent: "center", gap: 6, marginTop: 10 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#DDD" },
  dotActive: { backgroundColor: "#2EC4B6", width: 18 },
});
