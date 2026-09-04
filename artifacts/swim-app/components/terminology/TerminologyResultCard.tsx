/**
 * TerminologyResultCard
 *
 * Single search result card: 용어명 / 영문명 / aliases / summary 1~2줄
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Colors from "@/constants/colors";

const C    = Colors.light;
const NAVY = "#0C1A2E";

export interface TermSearchResult {
  term_id: string;
  canonical_name_ko: string;
  canonical_name_en: string;
  aliases: string[];
  summary: string;
}

interface Props {
  item: TermSearchResult;
  onPress: (termId: string) => void;
}

export function TerminologyResultCard({ item, onPress }: Props) {
  const aliasText =
    item.aliases.length > 0 ? item.aliases.slice(0, 3).join(" · ") : null;

  return (
    <Pressable
      style={({ pressed }) => [styles.card, { opacity: pressed ? 0.72 : 1 }]}
      onPress={() => onPress(item.term_id)}
    >
      {/* 용어명 + 영문명 */}
      <View style={styles.nameRow}>
        <Text style={styles.ko} numberOfLines={1}>
          {item.canonical_name_ko}
        </Text>
        <Text style={styles.en} numberOfLines={1}>
          {item.canonical_name_en}
        </Text>
      </View>

      {/* aliases */}
      {aliasText ? (
        <Text style={styles.aliases} numberOfLines={1}>
          {aliasText}
        </Text>
      ) : null}

      {/* summary */}
      <Text style={styles.summary} numberOfLines={2}>
        {item.summary}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 8,
    gap: 4,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 8,
  },
  ko: {
    fontSize: 16,
    fontFamily: "Pretendard-SemiBold",
    color: NAVY,
    flexShrink: 1,
  },
  en: {
    fontSize: 13,
    fontFamily: "Pretendard-Regular",
    color: C.textMuted,
    flexShrink: 1,
  },
  aliases: {
    fontSize: 12,
    fontFamily: "Pretendard-Regular",
    color: "#1559A0",
    marginTop: 1,
  },
  summary: {
    fontSize: 13,
    fontFamily: "Pretendard-Regular",
    color: C.text,
    lineHeight: 19,
    marginTop: 2,
  },
});
