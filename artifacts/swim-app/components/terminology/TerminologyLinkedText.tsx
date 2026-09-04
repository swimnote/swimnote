/**
 * TerminologyLinkedText
 *
 * Renders ENGINE-provided segment array as inline text with tappable term links.
 * NO string slicing, NO offset calculation — APP renders segments as-is.
 *
 * Contract: segments come pre-split from ENGINE.
 *   { text: "벽을 차고 " }
 *   { text: "글라이드", link: { term_id: "TERM-000014" } }
 *   { text: "와 연결됩니다." }
 */

import React from "react";
import { Text, StyleSheet } from "react-native";
import Colors from "@/constants/colors";

export interface TermSegment {
  text: string;
  link?: { term_id: string };
}

interface Props {
  segments: TermSegment[];
  onTermPress: (termId: string) => void;
  /** Body text size — default 15 */
  fontSize?: number;
  /** Body text color — default C.text */
  color?: string;
}

const C = Colors.light;

export function TerminologyLinkedText({
  segments,
  onTermPress,
  fontSize = 15,
  color = C.text,
}: Props) {
  return (
    <Text style={[styles.body, { fontSize, color }]}>
      {segments.map((seg, i) =>
        seg.link ? (
          <Text
            key={i}
            style={styles.link}
            onPress={() => onTermPress(seg.link!.term_id)}
            suppressHighlighting
          >
            {seg.text}
          </Text>
        ) : (
          <Text key={i}>{seg.text}</Text>
        ),
      )}
    </Text>
  );
}

const styles = StyleSheet.create({
  body: {
    lineHeight: 24,
    fontFamily: "Pretendard-Regular",
  },
  link: {
    color: "#1559A0",
    fontFamily: "Pretendard-SemiBold",
    textDecorationLine: "underline",
  },
});
