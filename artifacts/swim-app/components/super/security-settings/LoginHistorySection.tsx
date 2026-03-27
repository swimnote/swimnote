/**
 * components/super/security-settings/LoginHistorySection.tsx
 * G. 로그인 이력 (최근 7건)
 */
import { Feather } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { SectionTitle } from "./SectionTitle";
import { LOGIN_HISTORY } from "./types";

export function LoginHistorySection() {
  return (
    <View style={s.section}>
      <SectionTitle title="G. 로그인 이력" sub="최근 7건" />
      {LOGIN_HISTORY.map(log => {
        const isSuccess = log.status === "success";
        const isBlock   = log.status === "block";
        const color = isSuccess ? "#16A34A" : isBlock ? "#D96C6C" : "#D97706";
        const bg    = isSuccess ? "#DFF3EC" : isBlock ? "#FEF2F2" : "#FFFBEB";
        return (
          <View
            key={log.id}
            style={[
              s.row,
              { backgroundColor: bg },
            ]}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, width: "100%" }}>
              <Feather
                name={isSuccess ? "check-circle" : isBlock ? "slash" : "alert-circle"}
                size={13}
                color={color}
              />
              <Text style={[s.label, { color, flex: 1 }]}>
                {isSuccess ? "로그인 성공" : isBlock ? "계정 차단" : "로그인 실패"}
              </Text>
              <Text style={s.value}>{log.at}</Text>
            </View>
            <Text style={[s.value, { paddingLeft: 21, fontSize: 12 }]}>
              {log.device} · {log.ip} · {log.method}
            </Text>
            {(log.status === "fail" || isBlock) && log.failReason && (
              <Text style={[s.value, { paddingLeft: 21, fontSize: 11, color }]}>
                {log.failReason}
              </Text>
            )}
          </View>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  section: { backgroundColor: "#fff", borderRadius: 16, padding: 16, gap: 10,
             borderWidth: 1, borderColor: "#E5E7EB" },
  row:     { borderRadius: 10, padding: 10, flexDirection: "column", alignItems: "flex-start", gap: 3 },
  label:   { fontSize: 13, fontFamily: "Inter_500Medium", color: "#111827" },
  value:   { fontSize: 11, fontFamily: "Inter_400Regular", color: "#6B7280" },
});
