import { Feather } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest } from "@/context/AuthContext";

const C = Colors.light;

interface UnreadMessage {
  id: string; diary_id: string; sender_name: string; content: string;
  created_at: string; lesson_date: string; class_name: string;
}

export default function UnreadMessagesModal({
  visible, token, themeColor, onClose, onOpenDiary,
}: {
  visible: boolean; token: string | null; themeColor: string;
  onClose: () => void; onOpenDiary: (diaryId: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<UnreadMessage[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    apiRequest(token, "/teacher/messages?unread=true")
      .then(r => r.ok ? r.json() : [])
      .then(setMessages)
      .catch(() => setMessages([]))
      .finally(() => setLoading(false));
  }, [visible]);

  function fmtDate(s: string) {
    const d = new Date(s);
    return `${String(d.getMonth()+1).padStart(2,"0")}/${String(d.getDate()).padStart(2,"0")}`;
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={um.overlay} onPress={onClose} />
      <View style={[um.sheet, { paddingBottom: insets.bottom + 20 }]}>
        <View style={um.handle} />
        <View style={um.header}>
          <Text style={[um.title, { color: C.text }]}>읽지 않은 쪽지</Text>
          {messages.length > 0 && (
            <View style={[um.countBadge, { backgroundColor: C.error }]}>
              <Text style={um.countTxt}>{messages.length}</Text>
            </View>
          )}
          <Pressable onPress={onClose} style={um.closeBtn}>
            <Feather name="x" size={18} color={C.textSecondary} />
          </Pressable>
        </View>
        {loading ? (
          <ActivityIndicator color={themeColor} style={{ marginTop: 30 }} />
        ) : messages.length === 0 ? (
          <View style={um.empty}>
            <Feather name="mail" size={36} color={C.textMuted} />
            <Text style={[um.emptyTxt, { color: C.textMuted }]}>읽지 않은 쪽지가 없습니다</Text>
          </View>
        ) : (
          <ScrollView showsVerticalScrollIndicator={false}>
            {messages.map(msg => (
              <Pressable key={msg.id} style={[um.item, { borderBottomColor: C.border }]}
                onPress={() => { onOpenDiary(msg.diary_id); onClose(); }}>
                <View style={um.itemDot} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[um.itemName, { color: C.text }]}>{msg.sender_name}</Text>
                  <Text style={[um.itemContent, { color: C.textSecondary }]} numberOfLines={1}>{msg.content}</Text>
                  <Text style={[um.itemMeta, { color: C.textMuted }]}>{msg.class_name} · {fmtDate(msg.created_at)}</Text>
                </View>
                <Feather name="chevron-right" size={16} color={C.textMuted} />
              </Pressable>
            ))}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const um = StyleSheet.create({
  overlay:    { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet:      { backgroundColor: C.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "55%" },
  handle:     { width: 36, height: 4, backgroundColor: C.border, borderRadius: 2, alignSelf: "center", marginTop: 12, marginBottom: 4 },
  header:     { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 20, paddingBottom: 12 },
  title:      { fontSize: 17, fontFamily: "Inter_700Bold", flex: 1 },
  countBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  countTxt:   { color: "#fff", fontSize: 12, fontFamily: "Inter_600SemiBold" },
  closeBtn:   { width: 32, height: 32, borderRadius: 10, backgroundColor: "#F6F3F1", alignItems: "center", justifyContent: "center" },
  empty:      { alignItems: "center", gap: 10, paddingVertical: 40 },
  emptyTxt:   { fontSize: 14, fontFamily: "Inter_400Regular" },
  item:       { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1 },
  itemDot:    { width: 8, height: 8, borderRadius: 4, backgroundColor: "#1F8F86" },
  itemName:   { fontSize: 14, fontFamily: "Inter_700Bold" },
  itemContent:{ fontSize: 13, fontFamily: "Inter_400Regular" },
  itemMeta:   { fontSize: 12, fontFamily: "Inter_400Regular" },
});
