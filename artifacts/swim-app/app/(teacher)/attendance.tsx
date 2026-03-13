/**
 * (teacher)/attendance.tsx — 선생님: 출결 체크
 */
import { Feather } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, Pressable,
  ScrollView, StyleSheet, Text, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";

interface ClassGroup { id: string; name: string; }
interface Student { id: string; name: string; class_group_id?: string | null; }

type Status = "present" | "absent" | "late";

const ST: Record<Status, { label: string; color: string; icon: string }> = {
  present: { label: "출석", color: "#10B981", icon: "check-circle" },
  absent:  { label: "결석", color: "#EF4444", icon: "x-circle"     },
  late:    { label: "지각", color: "#F59E0B", icon: "clock"         },
};

export default function TeacherAttendanceScreen() {
  const { token } = useAuth();
  const { themeColor } = useBrand();
  const [classes, setClasses]     = useState<ClassGroup[]>([]);
  const [students, setStudents]   = useState<Student[]>([]);
  const [selected, setSelected]   = useState<string | null>(null);
  const [date, setDate]           = useState(() => new Date().toISOString().split("T")[0]);
  const [att, setAtt]             = useState<Record<string, Status>>({});
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);

  useEffect(() => {
    (async () => {
      const [cr, sr] = await Promise.all([apiRequest(token, "/classes"), apiRequest(token, "/students")]);
      const [cls, sts] = await Promise.all([cr.json(), sr.json()]);
      const list = Array.isArray(cls) ? cls : [];
      setClasses(list); setStudents(Array.isArray(sts) ? sts : []);
      if (list.length) { setSelected(list[0].id); }
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (!selected) return;
    (async () => {
      const r = await apiRequest(token, `/attendance?class_id=${selected}&date=${date}`);
      const data = await r.json();
      if (Array.isArray(data)) {
        const map: Record<string, Status> = {};
        data.forEach((a: any) => { map[a.student_id ?? a.member_id] = a.status; });
        setAtt(map);
      }
    })();
  }, [selected, date]);

  const visible = selected ? students.filter(st => st.class_group_id === selected) : [];

  async function save(studentId: string, status: Status) {
    setSaving(true);
    try {
      await apiRequest(token, "/attendance", {
        method: "POST",
        body: JSON.stringify({ student_id: studentId, class_id: selected, date, status }),
      });
      setAtt(prev => ({ ...prev, [studentId]: status }));
    } catch { Alert.alert("오류", "저장 실패"); }
    finally { setSaving(false); }
  }

  async function saveAll() {
    setSaving(true);
    try {
      await Promise.all(
        visible.filter(st => att[st.id]).map(st =>
          apiRequest(token, "/attendance", {
            method: "POST",
            body: JSON.stringify({ student_id: st.id, class_id: selected, date, status: att[st.id] }),
          })
        )
      );
      Alert.alert("완료", "출결이 저장되었습니다.");
    } finally { setSaving(false); }
  }

  if (loading) return <ActivityIndicator style={{ flex: 1 }} color={themeColor} />;

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      <View style={s.header}>
        <Text style={s.title}>출결 체크</Text>
        <Text style={s.dateText}>{date}</Text>
      </View>

      {/* 반 선택 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={s.tabBar} contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8, gap: 8 }}>
        {classes.map(c => (
          <Pressable key={c.id} onPress={() => setSelected(c.id)}
            style={[s.tab, selected === c.id && { backgroundColor: themeColor, borderColor: themeColor }]}>
            <Text style={[s.tabText, selected === c.id && { color: "#fff" }]}>{c.name}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* 학생 목록 */}
      <FlatList
        data={visible}
        keyExtractor={i => i.id}
        contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 100 }}
        ListEmptyComponent={<Text style={s.empty}>학생이 없습니다.</Text>}
        renderItem={({ item }) => {
          const cur = att[item.id];
          return (
            <View style={s.row}>
              <Text style={s.name}>{item.name}</Text>
              <View style={{ flexDirection: "row", gap: 6 }}>
                {(["present", "absent", "late"] as Status[]).map(st => (
                  <Pressable key={st} onPress={() => save(item.id, st)}
                    style={[s.btn, { borderColor: ST[st].color, backgroundColor: cur === st ? ST[st].color : "#fff" }]}>
                    <Text style={[s.btnText, { color: cur === st ? "#fff" : ST[st].color }]}>{ST[st].label}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          );
        }}
      />

      {visible.length > 0 && (
        <View style={s.footer}>
          <Pressable onPress={saveAll} disabled={saving}
            style={[s.saveBtn, { backgroundColor: themeColor }]}>
            <Text style={s.saveBtnText}>{saving ? "저장 중..." : "전체 저장"}</Text>
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: "#F8FAFF" },
  header:     { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  title:      { fontSize: 17, fontFamily: "Inter_700Bold", color: "#111827" },
  dateText:   { fontSize: 13, color: "#6B7280", fontFamily: "Inter_500Medium" },
  tabBar:     { backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  tab:        { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: "#E5E7EB", backgroundColor: "#fff" },
  tabText:    { fontSize: 13, fontFamily: "Inter_500Medium", color: "#374151" },
  row:        { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#fff", borderRadius: 12, padding: 14 },
  name:       { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#111827", flex: 1 },
  btn:        { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1.5 },
  btnText:    { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  empty:      { textAlign: "center", color: "#9CA3AF", fontFamily: "Inter_400Regular", marginTop: 40 },
  footer:     { padding: 16, backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: "#E5E7EB" },
  saveBtn:    { height: 48, borderRadius: 12, justifyContent: "center", alignItems: "center" },
  saveBtnText:{ color: "#fff", fontSize: 15, fontFamily: "Inter_700Bold" },
});
