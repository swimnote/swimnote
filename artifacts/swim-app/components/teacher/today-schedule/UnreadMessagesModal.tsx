import { ChevronRight, ClipboardList, Mail, X } from "lucide-react-native";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import Colors from "@/constants/colors";
import { apiRequest } from "@/context/AuthContext";

const C = Colors.light;

interface UnreadMessage {
  id: string; diary_id: string; sender_name: string; content: string;
  created_at: string; lesson_date: string; class_name: string;
}

interface ParentRequest {
  id: string; student_name: string; parent_name: string;
  request_type: string; content: string | null; status: string; created_at: string;
}

const REQUEST_TYPE_LABEL: Record<string, string> = {
  absence: "결석", makeup: "보강", postpone: "연기",
  withdrawal: "퇴원", counseling: "상담", inquiry: "문의",
};
const REQUEST_TYPE_COLOR: Record<string, string> = {
  absence: "#EF4444", makeup: "#3B82F6", postpone: "#F59E0B",
  withdrawal: "#6B7280", counseling: "#8B5CF6", inquiry: "#0EA5E9",
};

type ListItem =
  | { kind: "message"; data: UnreadMessage }
  | { kind: "request"; data: ParentRequest };

export default function UnreadMessagesModal({
  visible, token, themeColor, onClose, onOpenDiary, onMessagesRead,
}: {
  visible: boolean; token: string | null; themeColor: string;
  onClose: () => void; onOpenDiary: (diaryId: string) => void;
  onMessagesRead?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<ListItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);

    Promise.all([
      apiRequest(token, "/teacher/messages?unread=true").then(r => r.ok ? r.json() : []),
      apiRequest(token, "/teacher/parent-requests").then(r => r.ok ? r.json() : []),
    ]).then(([msgs, reqs]: [UnreadMessage[], ParentRequest[]]) => {
      const msgItems: ListItem[] = msgs.map(m => ({ kind: "message", data: m }));
      const pendingReqs = (reqs as ParentRequest[]).filter(r => r.status === "pending");
      const reqItems: ListItem[] = pendingReqs.map(r => ({ kind: "request", data: r }));

      const merged = [
        ...msgItems,
        ...reqItems,
      ].sort((a, b) => new Date(b.data.created_at).getTime() - new Date(a.data.created_at).getTime());

      setItems(merged);

      if (msgs.length > 0) {
        apiRequest(token, "/teacher/messages/read-all", { method: "POST" })
          .then(() => onMessagesRead?.())
          .catch(() => {});
      } else {
        onMessagesRead?.();
      }
    }).catch(() => setItems([])).finally(() => setLoading(false));
  }, [visible]);

  function fmtDate(s: string) {
    const d = new Date(s);
    return `${String(d.getMonth()+1).padStart(2,"0")}/${String(d.getDate()).padStart(2,"0")}`;
  }

  const totalCount = items.length;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={um.overlay} onPress={onClose} />
      <View style={[um.sheet, { paddingBottom: insets.bottom + 20 }]}>
        <View style={um.handle} />
        <View style={um.header}>
          <Text style={[um.title, { color: C.text }]}>쪽지 · 학부모 요청</Text>
          {totalCount > 0 && (
            <View style={[um.countBadge, { backgroundColor: C.error }]}>
              <Text style={um.countTxt}>{totalCount}</Text>
            </View>
          )}
          <Pressable onPress={onClose} style={um.closeBtn}>
            <X size={18} color={C.textSecondary} />
          </Pressable>
        </View>

        {loading ? (
          <ActivityIndicator color={themeColor} style={{ marginTop: 30 }} />
        ) : items.length === 0 ? (
          <View style={um.empty}>
            <Mail size={36} color={C.textMuted} />
            <Text style={[um.emptyTxt, { color: C.textMuted }]}>새 쪽지 · 요청이 없습니다</Text>
          </View>
        ) : (
          <ScrollView showsVerticalScrollIndicator={false}>
            {items.map((item, idx) => {
              if (item.kind === "message") {
                const msg = item.data;
                return (
                  <Pressable key={`msg-${msg.id}`} style={[um.item, { borderBottomColor: C.border }]}
                    onPress={() => {
                      onClose();
                      router.push(`/(teacher)/messages-inbox?diaryId=${msg.diary_id}` as any);
                    }}>
                    <View style={[um.iconBox, { backgroundColor: themeColor + "18" }]}>
                      <Mail size={16} color={themeColor} />
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <View style={um.rowBetween}>
                        <Text style={[um.itemName, { color: C.text }]}>{msg.sender_name}</Text>
                        <Text style={[um.itemMeta, { color: C.textMuted }]}>{fmtDate(msg.created_at)}</Text>
                      </View>
                      <Text style={[um.itemContent, { color: C.textSecondary }]} numberOfLines={1}>{msg.content}</Text>
                      <Text style={[um.itemMeta, { color: C.textMuted }]}>{msg.class_name}</Text>
                    </View>
                    <ChevronRight size={16} color={C.textMuted} />
                  </Pressable>
                );
              } else {
                const req = item.data;
                const typeColor = REQUEST_TYPE_COLOR[req.request_type] ?? "#6B7280";
                const typeLabel = REQUEST_TYPE_LABEL[req.request_type] ?? req.request_type;
                return (
                  <Pressable key={`req-${req.id}`} style={[um.item, { borderBottomColor: C.border }]}
                    onPress={() => {
                      onClose();
                      router.push(`/(teacher)/messages-inbox?tab=requests` as any);
                    }}>
                    <View style={[um.iconBox, { backgroundColor: typeColor + "18" }]}>
                      <ClipboardList size={16} color={typeColor} />
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <View style={um.rowBetween}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <Text style={[um.itemName, { color: C.text }]}>{req.student_name}</Text>
                          <View style={[um.typeBadge, { backgroundColor: typeColor + "18" }]}>
                            <Text style={[um.typeTxt, { color: typeColor }]}>{typeLabel}</Text>
                          </View>
                        </View>
                        <Text style={[um.itemMeta, { color: C.textMuted }]}>{fmtDate(req.created_at)}</Text>
                      </View>
                      <Text style={[um.itemContent, { color: C.textSecondary }]} numberOfLines={1}>
                        {req.parent_name} · {req.content ?? "내용 없음"}
                      </Text>
                    </View>
                    <ChevronRight size={16} color={C.textMuted} />
                  </Pressable>
                );
              }
            })}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const um = StyleSheet.create({
  overlay:    { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet:      { backgroundColor: C.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "60%" },
  handle:     { width: 36, height: 4, backgroundColor: C.border, borderRadius: 2, alignSelf: "center", marginTop: 12, marginBottom: 4 },
  header:     { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 20, paddingBottom: 12 },
  title:      { fontSize: 17, fontFamily: "Pretendard-Regular", flex: 1 },
  countBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  countTxt:   { color: "#fff", fontSize: 12, fontFamily: "Pretendard-Regular" },
  closeBtn:   { width: 32, height: 32, borderRadius: 10, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  empty:      { alignItems: "center", gap: 10, paddingVertical: 40 },
  emptyTxt:   { fontSize: 14, fontFamily: "Pretendard-Regular" },
  item:       { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1 },
  iconBox:    { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  itemName:   { fontSize: 14, fontFamily: "Pretendard-Regular" },
  itemContent:{ fontSize: 13, fontFamily: "Pretendard-Regular" },
  itemMeta:   { fontSize: 12, fontFamily: "Pretendard-Regular" },
  typeBadge:  { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  typeTxt:    { fontSize: 11, fontFamily: "Pretendard-Regular" },
});
