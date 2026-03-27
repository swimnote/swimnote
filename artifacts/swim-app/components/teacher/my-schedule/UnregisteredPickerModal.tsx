import { Search, Users, X } from "lucide-react-native";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, Modal, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import Colors from "@/constants/colors";
import { apiRequest } from "@/context/AuthContext";
import { ConfirmModal } from "@/components/common/ConfirmModal";

const C = Colors.light;

const INVITE_LABEL: Record<string, string> = {
  none: "초대 전", invited: "초대 완료", joined: "가입 완료",
};

export default function UnregisteredPickerModal({
  token, classGroupId, themeColor, onClose, onAssigned,
}: {
  token: string | null;
  classGroupId: string;
  themeColor: string;
  onClose: () => void;
  onAssigned: () => void;
}) {
  const [list, setList]       = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ]             = useState("");
  const [assigning, setAssigning] = useState<string | null>(null);
  const [confirmItem, setConfirmItem] = useState<any | null>(null);

  useEffect(() => {
    (async () => {
      const r = await apiRequest(token, "/teacher/unregistered");
      if (r.ok) setList(await r.json());
      setLoading(false);
    })();
  }, []);

  const filtered = list.filter(u => !q || u.name?.includes(q) || u.parent_phone?.includes(q));

  async function doAssign(student: any) {
    setAssigning(student.id);
    await apiRequest(token, `/teacher/unregistered/${student.id}/assign`, {
      method: "POST", body: JSON.stringify({ class_group_id: classGroupId }),
    });
    setAssigning(null); onAssigned();
  }

  return (
    <>
      <Modal visible animationType="slide" transparent onRequestClose={onClose}>
        <Pressable style={um.backdrop} onPress={onClose} />
        <View style={um.sheet}>
          <View style={um.handle} />
          <View style={um.header}>
            <View style={{ flex: 1 }}>
              <Text style={um.title}>미등록회원 가져오기</Text>
              <Text style={um.sub}>반에 배정하면 정상회원으로 전환됩니다</Text>
            </View>
            <Pressable onPress={onClose} style={{ padding: 4 }}>
              <X size={20} color={C.textSecondary} />
            </Pressable>
          </View>
          <View style={um.searchBar}>
            <Search size={14} color={C.textMuted} />
            <TextInput style={um.searchInput} value={q} onChangeText={setQ}
              placeholder="이름·전화번호 검색" placeholderTextColor={C.textMuted} />
            {!!q && <Pressable onPress={() => setQ("")}><X size={14} color={C.textMuted} /></Pressable>}
          </View>
          {loading ? (
            <ActivityIndicator style={{ marginTop: 40 }} color={themeColor} />
          ) : (
            <ScrollView style={um.list} showsVerticalScrollIndicator={false}>
              {filtered.length === 0 ? (
                <View style={um.empty}>
                  <Users size={28} color={C.textMuted} />
                  <Text style={um.emptyTxt}>미등록회원이 없습니다</Text>
                </View>
              ) : filtered.map(item => (
                <View key={item.id} style={um.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={um.name}>{item.name}</Text>
                    <Text style={um.phone}>{item.parent_phone || "-"}</Text>
                    <Text style={[um.invTag,
                      item.invite_status === "invited" ? { color: "#2EC4B6" } :
                      item.invite_status === "joined"  ? { color: "#2EC4B6" } : { color: "#6B7280" }
                    ]}>{INVITE_LABEL[item.invite_status || "none"]}</Text>
                  </View>
                  <Pressable style={[um.assignBtn, { backgroundColor: themeColor }]}
                    onPress={() => setConfirmItem(item)} disabled={assigning === item.id}>
                    {assigning === item.id
                      ? <ActivityIndicator size="small" color="#fff" />
                      : <Text style={um.assignTxt}>반배정</Text>}
                  </Pressable>
                </View>
              ))}
              <View style={{ height: 40 }} />
            </ScrollView>
          )}
        </View>
      </Modal>
      <ConfirmModal visible={!!confirmItem} title="반배정"
        message={`${confirmItem?.name}을(를) 이 반에 배정하시겠습니까?\n배정 후 정상회원으로 전환됩니다.`}
        confirmText="배정" cancelText="취소"
        onConfirm={() => { const s = confirmItem; setConfirmItem(null); doAssign(s); }}
        onCancel={() => setConfirmItem(null)} />
    </>
  );
}

const um = StyleSheet.create({
  backdrop:    { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet:       { position: "absolute", bottom: 0, left: 0, right: 0,
                 backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20,
                 maxHeight: "75%", paddingBottom: 32 },
  handle:      { width: 36, height: 4, borderRadius: 2, backgroundColor: "#D1D5DB", alignSelf: "center", marginTop: 10, marginBottom: 4 },
  header:      { flexDirection: "row", alignItems: "flex-start", padding: 16, paddingTop: 8 },
  title:       { fontSize: 17, fontFamily: "Pretendard-Bold", color: C.text },
  sub:         { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textMuted, marginTop: 2 },
  searchBar:   { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 16,
                 marginBottom: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: "#F8FAFC", borderRadius: 10 },
  searchInput: { flex: 1, fontSize: 14, color: C.text, fontFamily: "Pretendard-Regular" },
  list:        { flexShrink: 1 },
  row:         { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: "#F8FAFC" },
  name:        { fontSize: 15, fontFamily: "Pretendard-SemiBold", color: C.text },
  phone:       { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginTop: 2 },
  invTag:      { fontSize: 11, fontFamily: "Pretendard-Medium", marginTop: 2 },
  assignBtn:   { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, minWidth: 60, alignItems: "center" },
  assignTxt:   { fontSize: 13, fontFamily: "Pretendard-Bold", color: "#fff" },
  empty:       { alignItems: "center", paddingVertical: 40, gap: 8 },
  emptyTxt:    { fontSize: 13, color: C.textMuted, fontFamily: "Pretendard-Regular" },
});
