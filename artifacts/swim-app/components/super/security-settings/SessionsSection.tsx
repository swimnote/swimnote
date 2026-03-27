/**
 * components/super/security-settings/SessionsSection.tsx
 * F. 세션·접속 관리
 */
import { Feather } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SectionTitle } from "./SectionTitle";
import type { FlatSession } from "./types";
import { DANGER } from "./types";

interface Props {
  sessions: FlatSession[];
  onTerminate: (sess: FlatSession) => void;
}

export function SessionsSection({ sessions, onTerminate }: Props) {
  return (
    <View style={s.section}>
      <SectionTitle title="F. 세션·접속 관리" sub={`활성 세션 ${sessions.length}개`} />
      {sessions.length === 0 && (
        <Text style={s.emptyTxt}>현재 활성 세션이 없습니다</Text>
      )}
      {sessions.map(sess => (
        <View key={sess.id} style={s.sessionRow}>
          <View style={[s.sessionIconBox, { backgroundColor: "#F8FAFC" }]}>
            <Feather name="monitor" size={14} color="#6B7280" />
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={s.sessionDevice}>{sess.device}</Text>
              <Text style={s.sessionOwner}>{sess.accountName}</Text>
            </View>
            <Text style={s.sessionMeta}>{sess.ip}</Text>
          </View>
          <Pressable style={s.terminateBtn} onPress={() => onTerminate(sess)}>
            <Text style={s.terminateTxt}>종료</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  section:      { backgroundColor: "#fff", borderRadius: 16, padding: 16, gap: 10,
                  borderWidth: 1, borderColor: "#E5E7EB" },
  emptyTxt:     { fontSize: 13, fontFamily: "Inter_400Regular", color: "#9CA3AF",
                  textAlign: "center", paddingVertical: 12 },
  sessionRow:   { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10,
                  borderBottomWidth: 1, borderBottomColor: "#F8FAFC" },
  sessionIconBox:{ width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  sessionDevice: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#111827" },
  sessionOwner:  { fontSize: 11, fontFamily: "Inter_400Regular", color: "#6B7280",
                   backgroundColor: "#F8FAFC", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  sessionMeta:  { fontSize: 11, fontFamily: "Inter_400Regular", color: "#6B7280", marginTop: 2 },
  terminateBtn: { backgroundColor: "#F9DEDA", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  terminateTxt: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: DANGER },
});
