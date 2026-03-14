import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList,
  Pressable, RefreshControl, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import ClassCreateFlow from "@/components/classes/ClassCreateFlow";

const C = Colors.light;

interface ClassGroup {
  id: string;
  name: string;
  schedule_days: string;
  schedule_time: string;
  instructor: string | null;
  student_count: number;
  level: string | null;
  capacity: number | null;
  teacher_user_id: string | null;
  is_deleted?: boolean;
}

export default function ClassesScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const [groups, setGroups] = useState<ClassGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiRequest(token, "/class-groups");
      if (res.ok) {
        const data = await res.json();
        // is_deleted=false 인 반만 표시 (API가 이미 필터링하지만 이중 체크)
        setGroups(Array.isArray(data) ? data.filter((g: ClassGroup) => !g.is_deleted) : []);
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function handleDelete(id: string, name: string) {
    Alert.alert(
      "반 삭제",
      `"${name}"을 삭제하면 소속 회원은 미배정 상태로 변경되고, 선생님·출결·스케줄 화면에서도 반영됩니다.\n\n삭제하시겠습니까?`,
      [
        { text: "취소", style: "cancel" },
        {
          text: "삭제", style: "destructive", onPress: async () => {
            setDeletingId(id);
            try {
              const res = await apiRequest(token, `/class-groups/${id}`, { method: "DELETE" });
              if (res.ok) {
                setGroups(prev => prev.filter(g => g.id !== id));
              } else {
                Alert.alert("오류", "삭제에 실패했습니다.");
              }
            } catch {
              Alert.alert("오류", "네트워크 오류가 발생했습니다.");
            } finally {
              setDeletingId(null);
            }
          },
        },
      ]
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <View style={[s.header, { paddingTop: insets.top + 16 }]}>
        <Text style={s.title}>반 관리</Text>
        <Pressable style={[s.addBtn, { backgroundColor: C.tint }]} onPress={() => setShowCreate(true)}>
          <Feather name="plus" size={16} color="#fff" />
          <Text style={s.addBtnText}>반 등록</Text>
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator color={C.tint} style={{ marginTop: 60 }} />
      ) : (
        <FlatList
          data={groups}
          keyExtractor={item => item.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 120, paddingTop: 8, gap: 12 }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={s.empty}>
              <Feather name="layers" size={48} color={C.textMuted} />
              <Text style={[s.emptyTitle, { color: C.textMuted }]}>등록된 반이 없습니다</Text>
              <Text style={[s.emptySub, { color: C.textMuted }]}>반 등록 버튼을 눌러 첫 번째 반을 만들어보세요</Text>
            </View>
          }
          renderItem={({ item }) => (
            <ClassGroupCard
              item={item}
              onDelete={handleDelete}
              isDeleting={deletingId === item.id}
            />
          )}
        />
      )}

      {showCreate && (
        <ClassCreateFlow
          token={token}
          role="pool_admin"
          onSuccess={(newGroup) => {
            setGroups(prev => [newGroup, ...prev]);
            setShowCreate(false);
          }}
          onClose={() => setShowCreate(false)}
        />
      )}
    </View>
  );
}

function ClassGroupCard({
  item, onDelete, isDeleting,
}: {
  item: ClassGroup;
  onDelete: (id: string, name: string) => void;
  isDeleting: boolean;
}) {
  const days = item.schedule_days.split(",").map(d => d.trim()).join("·");

  return (
    <View style={[cd.card, { shadowColor: C.shadow }]}>
      <View style={cd.top}>
        <View style={cd.icon}>
          <Feather name="layers" size={20} color="#7C3AED" />
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={[cd.name, { color: C.text }]}>{item.name}</Text>
          <View style={cd.metaRow}>
            <Feather name="calendar" size={12} color={C.textMuted} />
            <Text style={[cd.meta, { color: C.textSecondary }]}>{days}요일</Text>
          </View>
          <View style={cd.metaRow}>
            <Feather name="clock" size={12} color={C.textMuted} />
            <Text style={[cd.meta, { color: C.textSecondary }]}>{item.schedule_time}</Text>
          </View>
          {item.instructor && (
            <View style={cd.metaRow}>
              <Feather name="user" size={12} color={C.textMuted} />
              <Text style={[cd.meta, { color: C.textSecondary }]}>{item.instructor}</Text>
            </View>
          )}
        </View>
        <View style={{ alignItems: "flex-end", gap: 6 }}>
          <View style={[cd.countBadge, { backgroundColor: C.tintLight }]}>
            <Text style={[cd.countText, { color: C.tint }]}>{item.student_count}명</Text>
          </View>
          {item.level && (
            <View style={[cd.levelBadge]}>
              <Text style={cd.levelText}>{item.level}</Text>
            </View>
          )}
        </View>
      </View>

      <View style={cd.bottom}>
        {item.capacity != null && (
          <View style={cd.capacityChip}>
            <Feather name="users" size={12} color={C.textMuted} />
            <Text style={[cd.capacityText, { color: C.textSecondary }]}>정원 {item.capacity}명</Text>
          </View>
        )}
        <Pressable
          style={[cd.deleteBtn, isDeleting && { opacity: 0.5 }]}
          onPress={() => !isDeleting && onDelete(item.id, item.name)}
          disabled={isDeleting}
        >
          {isDeleting ? (
            <ActivityIndicator size={14} color={C.error} />
          ) : (
            <Feather name="trash-2" size={14} color={C.error} />
          )}
          <Text style={[cd.deleteBtnText, { color: C.error }]}>
            {isDeleting ? "처리중..." : "삭제"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingBottom: 12 },
  title: { fontSize: 24, fontFamily: "Inter_700Bold", color: C.text },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12 },
  addBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  empty: { alignItems: "center", paddingTop: 80, gap: 10 },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  emptySub: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center" },
});

const cd = StyleSheet.create({
  card: { backgroundColor: C.card, borderRadius: 18, padding: 16, gap: 14, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 10, elevation: 3 },
  top: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  icon: { width: 46, height: 46, borderRadius: 14, backgroundColor: "#F3E8FF", alignItems: "center", justifyContent: "center" },
  name: { fontSize: 16, fontFamily: "Inter_700Bold" },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  meta: { fontSize: 13, fontFamily: "Inter_400Regular" },
  countBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  countText: { fontSize: 13, fontFamily: "Inter_700Bold" },
  levelBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: "#EDE9FE" },
  levelText: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#7C3AED" },
  bottom: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8 },
  capacityChip: { flexDirection: "row", alignItems: "center", gap: 4, flex: 1 },
  capacityText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  deleteBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, backgroundColor: "#FEE2E2" },
  deleteBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
});
