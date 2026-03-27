import { Feather } from "@expo/vector-icons";
import React, { useState } from "react";
import {
  ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View,
} from "react-native";
import Colors from "@/constants/colors";

const C = Colors.light;

interface AvailableTeacher {
  inviteId: string;
  userId: string;
  name: string;
  phone: string;
}

interface ClassTransferModalProps {
  sourceName: string;
  availableTeachers: AvailableTeacher[];
  processing: boolean;
  onConfirm: (targetUserId: string, targetName: string) => void;
  onClose: () => void;
}

export function ClassTransferModal({
  sourceName, availableTeachers, processing, onConfirm, onClose,
}: ClassTransferModalProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const selectedTeacher = availableTeachers.find(t => t.userId === selected);

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={tm.overlay}>
        <View style={tm.sheet}>
          <View style={tm.handle} />
          <View style={tm.header}>
            <View>
              <Text style={tm.title}>수업 인수</Text>
              <Text style={tm.sub}>{sourceName} 선생님의 담당 반·회원을 인수할 선생님을 선택하세요</Text>
            </View>
            <Pressable onPress={onClose} style={{ padding: 4 }}>
              <Feather name="x" size={20} color={C.textSecondary} />
            </Pressable>
          </View>

          {availableTeachers.length === 0 ? (
            <View style={tm.emptyBox}>
              <Feather name="users" size={32} color={C.textMuted} />
              <Text style={tm.emptyText}>인수 가능한 선생님이 없습니다</Text>
            </View>
          ) : (
            <ScrollView style={{ maxHeight: 300 }} showsVerticalScrollIndicator={false}>
              {availableTeachers.map(t => (
                <Pressable
                  key={t.userId}
                  style={[tm.teacherRow, selected === t.userId && { borderColor: C.tint, backgroundColor: C.tintLight }]}
                  onPress={() => setSelected(t.userId)}
                >
                  <View style={[tm.avatar, { backgroundColor: selected === t.userId ? C.tint : "#E5E7EB" }]}>
                    <Text style={[tm.avatarText, { color: selected === t.userId ? "#fff" : C.textSecondary }]}>
                      {t.name[0]}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[tm.teacherName, selected === t.userId && { color: C.tint }]}>{t.name}</Text>
                    <Text style={tm.teacherPhone}>{t.phone}</Text>
                  </View>
                  {selected === t.userId && <Feather name="check-circle" size={20} color={C.tint} />}
                </Pressable>
              ))}
            </ScrollView>
          )}

          <View style={tm.btnRow}>
            <Pressable style={[tm.btn, { backgroundColor: "#F8FAFC" }]} onPress={onClose}>
              <Text style={[tm.btnText, { color: C.textSecondary }]}>취소</Text>
            </Pressable>
            <Pressable
              style={[tm.btn, { backgroundColor: C.tint, opacity: (!selected || processing) ? 0.5 : 1 }]}
              onPress={() => { if (selected && selectedTeacher) onConfirm(selected, selectedTeacher.name); }}
              disabled={!selected || processing}
            >
              {processing ? <ActivityIndicator color="#fff" size="small" /> : (
                <Text style={[tm.btnText, { color: "#fff" }]}>인수 완료</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const tm = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: { backgroundColor: C.card, borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 24, gap: 16, maxHeight: "80%" },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#E5E7EB", alignSelf: "center", marginBottom: 4 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  title: { fontSize: 18, fontFamily: "Pretendard-Bold", color: C.text },
  sub: { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginTop: 4, maxWidth: "90%", lineHeight: 18 },
  emptyBox: { alignItems: "center", paddingVertical: 32, gap: 10 },
  emptyText: { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textMuted },
  teacherRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14, borderWidth: 1.5, borderColor: C.border, marginBottom: 8 },
  avatar: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 16, fontFamily: "Pretendard-Bold" },
  teacherName: { fontSize: 14, fontFamily: "Pretendard-SemiBold", color: C.text },
  teacherPhone: { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginTop: 2 },
  btnRow: { flexDirection: "row", gap: 10, paddingTop: 8 },
  btn: { flex: 1, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  btnText: { fontSize: 15, fontFamily: "Pretendard-SemiBold" },
});
