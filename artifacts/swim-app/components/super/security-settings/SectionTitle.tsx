/**
 * components/super/security-settings/SectionTitle.tsx
 */
import React from "react";
import { StyleSheet, Text, View } from "react-native";

interface Props {
  title: string;
  sub?: string;
}

export function SectionTitle({ title, sub }: Props) {
  return (
    <View style={{ gap: 2, marginBottom: 8 }}>
      <Text style={st.title}>{title}</Text>
      {sub && <Text style={st.sub}>{sub}</Text>}
    </View>
  );
}

const st = StyleSheet.create({
  title: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#1F1F1F" },
  sub:   { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9A948F" },
});
