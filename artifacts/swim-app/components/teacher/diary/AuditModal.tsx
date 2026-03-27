import { Feather } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Colors from "@/constants/colors";
import { apiRequest } from "@/context/AuthContext";
import { AuditLog } from "./types";

const C = Colors.light;

export default function AuditModal({
  diaryId, token, onClose,
}: {
  diaryId: string; token: string; onClose: () => void;
}) {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiRequest(token, `/diaries/${diaryId}/audit-logs`)
      .then(r => r.ok ? r.json() : [])
      .then(setLogs)
      .catch(() => setLogs([]))
      .finally(() => setLoading(false));
  }, []);

  const actionLabel: Record<string, string> = { create: "작성", update: "수정", delete: "삭제" };
  const targetLabel: Record<string, string> = { common: "공통 일지", student_note: "개별 일지" };

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={a.overlay}>
        <View style={[a.sheet, { backgroundColor: C.card }]}>
          <View style={a.sheetHeader}>
            <Text style={[a.sheetTitle, { color: C.text }]}>변경 기록</Text>
            <Pressable onPress={onClose}><Feather name="x" size={20} color={C.textSecondary} /></Pressable>
          </View>
          {loading ? <ActivityIndicator color={C.tint} style={{ marginTop: 40 }} /> : (
            <ScrollView contentContainerStyle={{ gap: 10, padding: 16, paddingBottom: 40 }}>
              {logs.length === 0 && <Text style={{ textAlign: "center", color: C.textMuted, marginTop: 20 }}>기록이 없습니다</Text>}
              {logs.map(log => (
                <View key={log.id} style={[a.logCard, { backgroundColor: C.background }]}>
                  <View style={a.logHeader}>
                    <View style={[a.logBadge, { backgroundColor: log.action_type === "delete" ? "#F9DEDA" : log.action_type === "update" ? "#FFF1BF" : "#E6FFFA" }]}>
                      <Text style={[a.logBadgeText, { color: log.action_type === "delete" ? C.error : log.action_type === "update" ? C.warning : C.success }]}>
                        {actionLabel[log.action_type]}
                      </Text>
                    </View>
                    <Text style={a.logTarget}>{targetLabel[log.target_type]}</Text>
                    <Text style={a.logMeta}>{log.actor_name} · {new Date(log.created_at).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</Text>
                  </View>
                  {log.before_content && (
                    <View style={[a.logContent, { backgroundColor: "#FEF2F2", borderColor: "#FCA5A5" }]}>
                      <Text style={a.logContentLabel}>수정 전</Text>
                      <Text style={[a.logContentText, { color: C.text }]}>{log.before_content}</Text>
                    </View>
                  )}
                  {log.after_content && (
                    <View style={[a.logContent, { backgroundColor: "#DFF3EC", borderColor: "#86EFAC" }]}>
                      <Text style={a.logContentLabel}>수정 후</Text>
                      <Text style={[a.logContentText, { color: C.text }]}>{log.after_content}</Text>
                    </View>
                  )}
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const a = StyleSheet.create({
  overlay:         { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  sheet:           { borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "85%", minHeight: "50%" },
  sheetHeader:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  sheetTitle:      { fontSize: 16, fontFamily: "Pretendard-Bold" },
  logCard:         { borderRadius: 12, padding: 12, gap: 8 },
  logHeader:       { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  logBadge:        { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 },
  logBadgeText:    { fontSize: 11, fontFamily: "Pretendard-Bold" },
  logTarget:       { fontSize: 12, fontFamily: "Pretendard-Medium", color: "#6B7280" },
  logMeta:         { flex: 1, fontSize: 11, fontFamily: "Pretendard-Regular", color: "#9CA3AF", textAlign: "right" },
  logContent:      { borderRadius: 8, borderWidth: 1, padding: 10, gap: 4 },
  logContentLabel: { fontSize: 11, fontFamily: "Pretendard-SemiBold", color: "#6B7280" },
  logContentText:  { fontSize: 13, fontFamily: "Pretendard-Regular", lineHeight: 19 },
});
