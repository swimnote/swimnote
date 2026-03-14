/**
 * (teacher)/classes.tsx — 선생님: 내 담당 반 목록 + 학생 목록
 */
import { Feather } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, FlatList, Pressable, ScrollView,
  StyleSheet, Text, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { apiRequest, safeJson, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { PoolHeader } from "@/components/PoolHeader";

interface ClassGroup { id: string; name: string; schedule: string; }
interface Student { id: string; name: string; birth_date?: string | null; class_group_id?: string | null; }

export default function TeacherClassesScreen() {
  const { token, adminUser, logout } = useAuth();
  const { themeColor } = useBrand();
  const [classes, setClasses]   = useState<ClassGroup[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [cr, sr] = await Promise.all([
          apiRequest(token, "/class-groups"),
          apiRequest(token, "/students"),
        ]);
        const [cls, sts] = await Promise.all([safeJson(cr), safeJson(sr)]);
        const list = Array.isArray(cls) ? cls : [];
        setClasses(list);
        setStudents(Array.isArray(sts) ? sts : []);
        if (list.length) setSelected(list[0].id);
      } finally { setLoading(false); }
    })();
  }, []);

  const filtered = selected ? students.filter(s => s.class_group_id === selected) : [];

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      <PoolHeader
        right={
          <Pressable onPress={logout} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Feather name="log-out" size={18} color="#6B7280" />
          </Pressable>
        }
      />

      {loading ? (
        <ActivityIndicator style={{ flex: 1 }} color={themeColor} />
      ) : (
        <View style={{ flex: 1 }}>
          {/* 반 탭 */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.tabBar} contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 10, gap: 8 }}>
            {classes.length === 0 && <Text style={s.empty}>배정된 반이 없습니다.</Text>}
            {classes.map(c => (
              <Pressable key={c.id} onPress={() => setSelected(c.id)}
                style={[s.tab, selected === c.id && { backgroundColor: themeColor, borderColor: themeColor }]}>
                <Text style={[s.tabText, selected === c.id && { color: "#fff" }]}>{c.name}</Text>
              </Pressable>
            ))}
          </ScrollView>

          {/* 학생 목록 */}
          {selected && (
            <FlatList
              data={filtered}
              keyExtractor={i => i.id}
              contentContainerStyle={{ padding: 16, gap: 8 }}
              ListEmptyComponent={<Text style={s.empty}>이 반에 등록된 학생이 없습니다.</Text>}
              ListHeaderComponent={
                <Text style={s.count}>
                  {classes.find(c => c.id === selected)?.name} · {filtered.length}명
                </Text>
              }
              renderItem={({ item, index }) => (
                <View style={s.card}>
                  <View style={[s.avatar, { backgroundColor: themeColor + "20" }]}>
                    <Text style={[s.avatarText, { color: themeColor }]}>{index + 1}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.name}>{item.name}</Text>
                    {item.birth_date && <Text style={s.sub}>{item.birth_date}</Text>}
                  </View>
                </View>
              )}
            />
          )}
        </View>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: "#F8FAFF" },
  tabBar:     { backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  tab:        { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1, borderColor: "#E5E7EB", backgroundColor: "#fff" },
  tabText:    { fontSize: 13, fontFamily: "Inter_500Medium", color: "#374151" },
  card:       { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 12, padding: 14, gap: 12 },
  avatar:     { width: 36, height: 36, borderRadius: 18, justifyContent: "center", alignItems: "center" },
  avatarText: { fontFamily: "Inter_700Bold", fontSize: 14 },
  name:       { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#111827" },
  sub:        { fontSize: 12, color: "#6B7280", fontFamily: "Inter_400Regular" },
  count:      { fontSize: 13, color: "#6B7280", fontFamily: "Inter_500Medium", marginBottom: 8 },
  empty:      { textAlign: "center", color: "#9CA3AF", fontFamily: "Inter_400Regular", marginTop: 40 },
});
