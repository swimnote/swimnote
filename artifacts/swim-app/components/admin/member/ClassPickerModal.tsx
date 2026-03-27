import { Feather } from "@expo/vector-icons";
import React, { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Colors from "@/constants/colors";
import { useBrand } from "@/context/BrandContext";
import type { ClassGroup } from "./memberDetailTypes";

const C = Colors.light;

interface ClassPickerModalProps {
  groups: ClassGroup[];
  selectedIds: string[];
  maxSelect: number;
  onSelect: (ids: string[]) => void;
  onClose: () => void;
}

export function ClassPickerModal({ groups, selectedIds, maxSelect, onSelect, onClose }: ClassPickerModalProps) {
  const [picked, setPicked] = useState<string[]>(selectedIds);
  const [limitErr, setLimitErr] = useState(false);
  const { themeColor } = useBrand();

  function toggle(id: string) {
    if (picked.includes(id)) { setPicked(p => p.filter(x => x !== id)); setLimitErr(false); return; }
    if (picked.length >= maxSelect) { setLimitErr(true); return; }
    setPicked(p => [...p, id]);
  }

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={cp.overlay}>
        <View style={cp.sheet}>
          <View style={cp.header}>
            <Text style={cp.title}>반 선택 (최대 {maxSelect}개)</Text>
            <Pressable onPress={onClose}><Feather name="x" size={22} color={C.textSecondary} /></Pressable>
          </View>
          <Text style={[cp.sub, limitErr && { color: "#D96C6C" }]}>
            {limitErr ? `최대 ${maxSelect}개까지 선택 가능합니다` : `${picked.length}/${maxSelect}개 선택됨`}
          </Text>
          <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 380 }}>
            {groups.length === 0 ? (
              <View style={cp.empty}>
                <Feather name="layers" size={32} color={C.textMuted} />
                <Text style={{ color: C.textMuted, marginTop: 8 }}>개설된 반이 없습니다</Text>
              </View>
            ) : groups.map(g => {
              const sel = picked.includes(g.id);
              const days = g.schedule_days.split(",").map(d => d.trim()).join("·");
              return (
                <Pressable
                  key={g.id}
                  style={[cp.row, { borderColor: sel ? themeColor : C.border, backgroundColor: sel ? themeColor + "10" : C.background }]}
                  onPress={() => toggle(g.id)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[cp.name, { color: C.text }]}>{g.name}</Text>
                    <Text style={cp.info}>{days}요일 · {g.schedule_time}{g.instructor ? ` · ${g.instructor}` : ""}</Text>
                    <Text style={[cp.count, { color: C.textMuted }]}>재학 {g.student_count}명</Text>
                  </View>
                  <Feather name={sel ? "check-circle" : "circle"} size={22} color={sel ? themeColor : C.textMuted} />
                </Pressable>
              );
            })}
          </ScrollView>
          <Pressable style={[cp.confirmBtn, { backgroundColor: themeColor }]} onPress={() => { onSelect(picked); onClose(); }}>
            <Text style={cp.confirmText}>{picked.length}개 반 선택 완료</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const cp = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: { backgroundColor: C.card, borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 24, gap: 14 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { fontSize: 18, fontFamily: "Pretendard-Bold", color: C.text },
  sub: { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  row: { flexDirection: "row", alignItems: "center", padding: 14, borderRadius: 14, borderWidth: 1.5, marginBottom: 8, gap: 12 },
  name: { fontSize: 15, fontFamily: "Pretendard-SemiBold" },
  info: { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginTop: 2 },
  count: { fontSize: 11, fontFamily: "Pretendard-Regular", marginTop: 2 },
  confirmBtn: { height: 50, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  confirmText: { color: "#fff", fontSize: 16, fontFamily: "Pretendard-SemiBold" },
  empty: { alignItems: "center", paddingVertical: 40 },
});
