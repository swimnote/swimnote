import React, { useEffect } from "react";
import { StyleSheet, View, ViewStyle } from "react-native";
import Animated, {
  useSharedValue, useAnimatedStyle,
  withRepeat, withTiming, withSequence, interpolate,
} from "react-native-reanimated";
import Colors from "@/constants/colors";

const C = Colors.light;

interface Props {
  width?: number | string;
  height?: number;
  borderRadius?: number;
  style?: ViewStyle;
}

export function SkeletonBox({ width = "100%", height = 16, borderRadius = 8, style }: Props) {
  const opacity = useSharedValue(1);

  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(0.35, { duration: 700 }),
        withTiming(1, { duration: 700 }),
      ),
      -1,
      false,
    );
  }, []);

  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      style={[
        {
          width: width as any,
          height,
          borderRadius,
          backgroundColor: C.border,
        },
        animStyle,
        style,
      ]}
    />
  );
}

export function ScheduleCardSkeleton() {
  return (
    <View style={sk.card}>
      <View style={sk.topRow}>
        <SkeletonBox width={56} height={32} borderRadius={10} />
        <View style={{ flex: 1, gap: 6 }}>
          <SkeletonBox width="60%" height={16} />
          <SkeletonBox width="40%" height={12} />
        </View>
      </View>
      <View style={sk.badgeRow}>
        <SkeletonBox width={72} height={22} borderRadius={8} />
        <SkeletonBox width={72} height={22} borderRadius={8} />
      </View>
      <View style={sk.btnRow}>
        {[1, 2, 3, 4].map(i => <SkeletonBox key={i} width={70} height={34} borderRadius={10} />)}
      </View>
    </View>
  );
}

export function ParentHomeSkeleton() {
  return (
    <View style={{ paddingHorizontal: 20, gap: 14, marginTop: 12 }}>
      <View style={sk.heroCard}>
        <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
          <SkeletonBox width={60} height={60} borderRadius={30} />
          <View style={{ flex: 1, gap: 8 }}>
            <SkeletonBox width="50%" height={18} />
            <SkeletonBox width="70%" height={13} />
          </View>
        </View>
        <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
          {[1, 2, 3].map(i => (
            <View key={i} style={{ flex: 1, gap: 6, alignItems: "center" }}>
              <SkeletonBox width={32} height={32} borderRadius={16} />
              <SkeletonBox width="60%" height={11} />
            </View>
          ))}
        </View>
      </View>
      <View style={sk.quickGrid}>
        {[1, 2, 3, 4].map(i => (
          <View key={i} style={sk.quickItem}>
            <SkeletonBox width={44} height={44} borderRadius={14} />
            <SkeletonBox width="80%" height={12} />
          </View>
        ))}
      </View>
      <View style={sk.card}>
        <SkeletonBox width="40%" height={15} />
        <SkeletonBox width="90%" height={13} />
        <SkeletonBox width="75%" height={13} />
      </View>
    </View>
  );
}

const sk = StyleSheet.create({
  card:     { backgroundColor: C.card, borderRadius: 16, padding: 14, gap: 12 },
  topRow:   { flexDirection: "row", gap: 10, alignItems: "center" },
  badgeRow: { flexDirection: "row", gap: 8 },
  btnRow:   { flexDirection: "row", gap: 8 },
  heroCard: { backgroundColor: C.card, borderRadius: 20, padding: 18 },
  quickGrid:{ flexDirection: "row", flexWrap: "wrap", gap: 10 },
  quickItem:{ width: "47%", backgroundColor: C.card, borderRadius: 16, padding: 14, gap: 8, alignItems: "center" },
});
