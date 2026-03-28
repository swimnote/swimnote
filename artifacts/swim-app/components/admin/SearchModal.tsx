import { Bell, ChevronRight, CircleX, Layers, Search, User } from "lucide-react-native";
import { router } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Modal, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import Colors from "@/constants/colors";
import { apiRequest } from "@/context/AuthContext";

const C = Colors.light;

interface SearchModalProps {
  visible: boolean;
  onClose: () => void;
  token: string | null;
}

export function SearchModal({ visible, onClose, token }: SearchModalProps) {
  const [q, setQ]           = useState("");
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const debounce = useRef<any>(null);

  useEffect(() => { if (!visible) { setQ(""); setResult(null); } }, [visible]);

  function handleChange(text: string) {
    setQ(text);
    if (debounce.current) clearTimeout(debounce.current);
    if (text.trim().length < 1) { setResult(null); return; }
    debounce.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await apiRequest(token, `/admin/search?q=${encodeURIComponent(text)}`);
        if (res.ok) setResult(await res.json());
      } finally { setLoading(false); }
    }, 300);
  }

  const total = result
    ? (result.students?.length ?? 0) + (result.teachers?.length ?? 0) + (result.classes?.length ?? 0) + (result.notices?.length ?? 0)
    : 0;

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <View style={sm.container}>
        <View style={sm.header}>
          <View style={sm.searchBar}>
            <Search size={18} color={C.textMuted} />
            <TextInput style={sm.input} placeholder="회원, 반, 선생님, 공지 검색..." placeholderTextColor={C.textMuted}
              value={q} onChangeText={handleChange} autoFocus returnKeyType="search" />
            {q.length > 0 && (
              <Pressable onPress={() => { setQ(""); setResult(null); }}>
                <CircleX size={16} color={C.textMuted} />
              </Pressable>
            )}
          </View>
          <Pressable onPress={onClose} style={sm.closeBtn}>
            <Text style={{ color: C.tint, fontSize: 15, fontFamily: "Pretendard-Regular" }}>취소</Text>
          </Pressable>
        </View>
        {loading ? (
          <ActivityIndicator color={C.tint} style={{ marginTop: 40 }} />
        ) : result ? (
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 60 }}>
            {total === 0 ? (
              <View style={sm.empty}><Search size={40} color={C.textMuted} /><Text style={sm.emptyText}>검색 결과가 없습니다</Text></View>
            ) : (
              <>
                {(result.students ?? []).length > 0 && (
                  <View>
                    <Text style={sm.sectionLabel}>회원 ({result.students.length})</Text>
                    {result.students.map((s: any) => (
                      <Pressable key={s.id} style={sm.row} onPress={() => { onClose(); router.push({ pathname: "/(admin)/member-detail", params: { id: s.id } }); }}>
                        <View style={[sm.avatar, { backgroundColor: C.tint + "20" }]}><Text style={[sm.avatarText, { color: C.tint }]}>{s.name[0]}</Text></View>
                        <View style={{ flex: 1 }}><Text style={sm.rowTitle}>{s.name}</Text><Text style={sm.rowSub}>{s.class_name || "미배정"}</Text></View>
                        <ChevronRight size={16} color={C.textMuted} />
                      </Pressable>
                    ))}
                  </View>
                )}
                {(result.classes ?? []).length > 0 && (
                  <View>
                    <Text style={sm.sectionLabel}>반 ({result.classes.length})</Text>
                    {result.classes.map((c: any) => (
                      <Pressable key={c.id} style={sm.row} onPress={() => { onClose(); router.push("/(admin)/classes"); }}>
                        <View style={[sm.avatar, { backgroundColor: "#7C3AED20" }]}><Layers size={16} color="#7C3AED" /></View>
                        <View style={{ flex: 1 }}><Text style={sm.rowTitle}>{c.name}</Text><Text style={sm.rowSub}>{c.schedule_days}</Text></View>
                        <ChevronRight size={16} color={C.textMuted} />
                      </Pressable>
                    ))}
                  </View>
                )}
                {(result.notices ?? []).length > 0 && (
                  <View>
                    <Text style={sm.sectionLabel}>공지 ({result.notices.length})</Text>
                    {result.notices.map((n: any) => (
                      <Pressable key={n.id} style={sm.row} onPress={() => { onClose(); router.push("/(admin)/community"); }}>
                        <View style={[sm.avatar, { backgroundColor: "#D9770620" }]}><Bell size={16} color="#D97706" /></View>
                        <View style={{ flex: 1 }}><Text style={sm.rowTitle}>{n.title}</Text></View>
                        <ChevronRight size={16} color={C.textMuted} />
                      </Pressable>
                    ))}
                  </View>
                )}
                {(result.teachers ?? []).length > 0 && (
                  <View>
                    <Text style={sm.sectionLabel}>선생님 ({result.teachers.length})</Text>
                    {result.teachers.map((t: any) => (
                      <View key={t.id} style={sm.row}>
                        <View style={[sm.avatar, { backgroundColor: "#1F8F8620" }]}><User size={16} color="#2EC4B6" /></View>
                        <View style={{ flex: 1 }}><Text style={sm.rowTitle}>{t.name}</Text><Text style={sm.rowSub}>{t.phone || "연락처 없음"}</Text></View>
                      </View>
                    ))}
                  </View>
                )}
              </>
            )}
          </ScrollView>
        ) : (
          <View style={sm.empty}><Search size={50} color={C.border} /><Text style={sm.emptyText}>이름, 반 이름, 공지 제목으로 검색</Text></View>
        )}
      </View>
    </Modal>
  );
}

const sm = StyleSheet.create({
  container:    { flex: 1, backgroundColor: C.background, paddingTop: Platform.OS === "ios" ? 58 : 24 },
  header:       { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, gap: 10, marginBottom: 8 },
  searchBar:    { flex: 1, flexDirection: "row", alignItems: "center", backgroundColor: C.card, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, gap: 10, borderWidth: 1, borderColor: C.border },
  input:        { flex: 1, fontSize: 15, fontFamily: "Pretendard-Regular", color: C.text },
  closeBtn:     { paddingHorizontal: 4 },
  sectionLabel: { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textMuted, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: "#F1F5F9" },
  row:          { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 14, backgroundColor: C.card, borderBottomWidth: 1, borderBottomColor: C.border },
  avatar:       { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  avatarText:   { fontSize: 14, fontFamily: "Pretendard-Regular" },
  rowTitle:     { fontSize: 15, fontFamily: "Pretendard-Regular", color: C.text },
  rowSub:       { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginTop: 2 },
  empty:        { alignItems: "center", paddingVertical: 60, gap: 12 },
  emptyText:    { fontSize: 15, fontFamily: "Pretendard-Regular", color: C.textMuted },
});
