/**
 * ParentPromoBanner — 학부모 홈 프로모션/이벤트 배너 슬라이더
 *
 * - 수영장 공지가 있으면 이벤트 카드로 표시
 * - 없으면 기본 수영 팁 카드로 채움
 * - 자동 스크롤 + 인디케이터 도트
 */
import React, { useEffect, useRef, useState } from "react";
import {
  Dimensions, Pressable, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { router } from "expo-router";
import { LucideIcon } from "@/components/common/LucideIcon";

const { width: SW } = Dimensions.get("window");
const CARD_W = SW - 48;
const CARD_H = 130;
const AUTO_SCROLL_MS = 4000;

interface Notice {
  id: string;
  title: string;
  content?: string;
  created_at?: string;
}

interface Props {
  notices?: Notice[];
  onPressNotice?: (id: string) => void;
}

const SWIM_TIPS = [
  {
    id: "tip1",
    tag: "수영 팁",
    title: "호흡 리듬이 실력을 결정해요",
    desc: "3번 스트로크에 1번 호흡하는 패턴을 꾸준히 연습해보세요.",
    bg: "#EDE9FE", tagColor: "#7C3AED", titleColor: "#4C1D95", icon: "wind",
  },
  {
    id: "tip2",
    tag: "성장 포인트",
    title: "킥은 무릎이 아닌 고관절에서",
    desc: "킥은 무릎을 굽히지 않고 고관절에서 시작해야 효율이 높아집니다.",
    bg: "#DBEAFE", tagColor: "#2563EB", titleColor: "#1E40AF", icon: "zap",
  },
  {
    id: "tip3",
    tag: "건강 정보",
    title: "수영 후 스트레칭 5분의 기적",
    desc: "수영 후 어깨·허리 스트레칭으로 근육 회복과 유연성을 높여보세요.",
    bg: "#D1FAE5", tagColor: "#059669", titleColor: "#065F46", icon: "heart",
  },
  {
    id: "tip4",
    tag: "출결 관리",
    title: "꾸준함이 실력의 90%",
    desc: "주 3회 이상 꾸준한 출석이 실력 향상의 가장 빠른 지름길입니다.",
    bg: "#FEF9C3", tagColor: "#D97706", titleColor: "#92400E", icon: "calendar-check",
  },
];

function formatDate(d?: string) {
  if (!d) return "";
  const dt = new Date(d);
  return `${dt.getMonth() + 1}/${dt.getDate()}`;
}

export function ParentPromoBanner({ notices = [], onPressNotice }: Props) {
  const scrollRef = useRef<ScrollView>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const hasNotices = notices.length > 0;
  const items = hasNotices ? notices.slice(0, 5) : SWIM_TIPS;
  const total = items.length;

  const PALETTE = [
    { bg: "#E6FAF8", tagColor: "#2EC4B6", titleColor: "#0D6E68", accentBg: "#2EC4B6" },
    { bg: "#EDE9FE", tagColor: "#7C3AED", titleColor: "#4C1D95", accentBg: "#7C3AED" },
    { bg: "#FEF3C7", tagColor: "#D97706", titleColor: "#92400E", accentBg: "#D97706" },
    { bg: "#DBEAFE", tagColor: "#2563EB", titleColor: "#1E40AF", accentBg: "#2563EB" },
    { bg: "#FCE7F3", tagColor: "#DB2777", titleColor: "#831843", accentBg: "#DB2777" },
  ];

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

  return (
    <View style={s.wrap}>
      <View style={s.headerRow}>
        <View style={s.titleRow}>
          {hasNotices
            ? <LucideIcon name="megaphone" size={14} color="#F97316" />
            : <LucideIcon name="lightbulb" size={14} color="#2EC4B6" />
          }
          <Text style={s.sectionTitle}>
            {hasNotices ? "수영장 이벤트" : "오늘의 수영 팁"}
          </Text>
        </View>
        {hasNotices && (
          <Pressable onPress={() => router.push("/(parent)/notices?backTo=home" as any)} hitSlop={8}>
            <Text style={s.moreBtn}>전체보기</Text>
          </Pressable>
        )}
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
        {hasNotices
          ? notices.slice(0, 5).map((n, i) => {
              const p = PALETTE[i % PALETTE.length];
              return (
                <Pressable
                  key={n.id}
                  style={({ pressed }) => [s.card, { backgroundColor: p.bg, opacity: pressed ? 0.88 : 1, width: CARD_W }]}
                  onPress={() => onPressNotice ? onPressNotice(n.id) : router.push("/(parent)/notices?backTo=home" as any)}
                >
                  <View style={[s.tag, { backgroundColor: p.accentBg + "22" }]}>
                    <LucideIcon name="megaphone" size={11} color={p.tagColor} />
                    <Text style={[s.tagTxt, { color: p.tagColor }]}>수영장 공지</Text>
                  </View>
                  <Text style={[s.cardTitle, { color: p.titleColor }]} numberOfLines={2}>{n.title}</Text>
                  {n.content ? (
                    <Text style={s.cardDesc} numberOfLines={2}>{n.content.replace(/<[^>]+>/g, "")}</Text>
                  ) : null}
                  <View style={s.cardFooter}>
                    <Text style={s.cardDate}>{formatDate(n.created_at)}</Text>
                    <View style={[s.readMore, { backgroundColor: p.accentBg }]}>
                      <Text style={s.readMoreTxt}>자세히 보기</Text>
                      <LucideIcon name="chevron-right" size={10} color="#fff" />
                    </View>
                  </View>
                </Pressable>
              );
            })
          : SWIM_TIPS.map((tip) => (
              <Pressable
                key={tip.id}
                style={[s.card, { backgroundColor: tip.bg, width: CARD_W }]}
                onPress={() => {}}
              >
                <View style={[s.tag, { backgroundColor: tip.tagColor + "22" }]}>
                  <LucideIcon name={tip.icon as any} size={11} color={tip.tagColor} />
                  <Text style={[s.tagTxt, { color: tip.tagColor }]}>{tip.tag}</Text>
                </View>
                <Text style={[s.cardTitle, { color: tip.titleColor }]} numberOfLines={2}>{tip.title}</Text>
                <Text style={s.cardDesc} numberOfLines={2}>{tip.desc}</Text>
                <View style={s.cardFooter}>
                  <Text style={[s.cardDate, { color: tip.tagColor + "99" }]}>SwimNote</Text>
                </View>
              </Pressable>
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
  moreBtn: { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#2EC4B6" },
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
    flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8,
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
