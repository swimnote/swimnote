import { TriangleAlert } from "lucide-react-native";
import React from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import Colors from "@/constants/colors";

const C = Colors.light;

interface DuplicateModalProps {
  candidates: any[];
  onLinkExisting: (id: string) => void;
  onForceCreate: () => void;
  onCancel: () => void;
}

export function DuplicateModal({ candidates, onLinkExisting, onForceCreate, onCancel }: DuplicateModalProps) {
  return (
    <Modal visible animationType="fade" transparent onRequestClose={onCancel}>
      <View style={dup.overlay}>
        <View style={dup.sheet}>
          <View style={dup.icon}>
            <TriangleAlert size={28} color="#D97706" />
          </View>
          <Text style={dup.title}>유사한 회원이 있습니다</Text>
          <Text style={dup.sub}>아래 회원과 동일한 학생일 수 있습니다.</Text>
          <View style={dup.list}>
            {candidates.slice(0, 3).map((c: any) => (
              <Pressable key={c.id} style={dup.row} onPress={() => onLinkExisting(c.id)}>
                <View style={[dup.avatar, { backgroundColor: C.tintLight }]}>
                  <Text style={[dup.avatarText, { color: C.tint }]}>{c.name[0]}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={dup.name}>{c.name}</Text>
                  <Text style={dup.info}>{c.birth_year ? `${c.birth_year}년생` : ""}{c.parent_phone ? ` · ${c.parent_phone}` : ""}</Text>
                </View>
                <Text style={[dup.linkBtn, { color: C.tint }]}>연결 →</Text>
              </Pressable>
            ))}
          </View>
          <View style={dup.btnRow}>
            <Pressable style={[dup.btn, { backgroundColor: "#FFF1BF" }]} onPress={onForceCreate}>
              <Text style={[dup.btnText, { color: "#92400E" }]}>새 회원으로 등록</Text>
            </Pressable>
            <Pressable style={[dup.btn, { backgroundColor: C.background, borderWidth: 1, borderColor: C.border }]} onPress={onCancel}>
              <Text style={[dup.btnText, { color: C.textSecondary }]}>취소</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const dup = StyleSheet.create({
  overlay:    { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", padding: 24 },
  sheet:      { backgroundColor: C.card, borderRadius: 20, padding: 24, gap: 14, alignItems: "center" },
  icon:       { width: 60, height: 60, borderRadius: 20, backgroundColor: "#FFF1BF", alignItems: "center", justifyContent: "center" },
  title:      { fontSize: 18, fontFamily: "Pretendard-Bold", color: C.text },
  sub:        { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary, textAlign: "center" },
  list:       { width: "100%", gap: 8 },
  row:        { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12, backgroundColor: C.background, borderWidth: 1, borderColor: C.border },
  avatar:     { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 14, fontFamily: "Pretendard-Bold" },
  name:       { fontSize: 14, fontFamily: "Pretendard-SemiBold", color: C.text },
  info:       { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  linkBtn:    { fontSize: 13, fontFamily: "Pretendard-SemiBold" },
  btnRow:     { flexDirection: "row", gap: 10, width: "100%" },
  btn:        { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: "center" },
  btnText:    { fontSize: 14, fontFamily: "Pretendard-SemiBold" },
});
