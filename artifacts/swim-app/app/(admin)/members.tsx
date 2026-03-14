import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Modal,
  Platform, Pressable, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { ScreenLayout }  from "@/components/common/ScreenLayout";
import { PageHeader }    from "@/components/common/PageHeader";
import { FilterChips, FilterChipItem } from "@/components/common/FilterChips";
import { EmptyState }    from "@/components/common/EmptyState";
import { STATUS_COLORS } from "@/components/common/constants";

const C = Colors.light;

interface Member {
  id: string; name: string; phone: string; birth_date?: string | null;
  memo?: string | null; class_id?: string | null; class_name?: string | null; created_at: string;
}

type StatusFilter = "all" | "pending" | "free" | "paid";

const FILTER_CHIPS: FilterChipItem<StatusFilter>[] = [
  { key: "all",     label: "전체",    icon: "list",         activeColor: C.tint,                        activeBg: C.tintLight },
  { key: "pending", label: "미승인",  icon: "clock",        activeColor: STATUS_COLORS.pending.color,   activeBg: STATUS_COLORS.pending.bg },
  { key: "free",    label: "무료 이용", icon: "gift",       activeColor: STATUS_COLORS.free.color,      activeBg: STATUS_COLORS.free.bg },
  { key: "paid",    label: "유료 이용", icon: "credit-card", activeColor: STATUS_COLORS.paid.color,     activeBg: STATUS_COLORS.paid.bg },
];

export default function MembersScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();

  const [members,      setMembers]      = useState<Member[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [showModal,    setShowModal]    = useState(false);
  const [form,         setForm]         = useState({ name: "", phone: "", birth_date: "", memo: "" });
  const [saving,       setSaving]       = useState(false);
  const [error,        setError]        = useState("");
  const [search,       setSearch]       = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  async function fetchMembers() {
    try {
      const res = await apiRequest(token, "/members");
      const data = await res.json();
      setMembers(Array.isArray(data) ? data : []);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }

  useEffect(() => { fetchMembers(); }, []);

  async function handleCreate() {
    if (!form.name || !form.phone) { setError("이름과 전화번호를 입력해주세요."); return; }
    setSaving(true); setError("");
    try {
      const res = await apiRequest(token, "/members", { method: "POST", body: JSON.stringify(form) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMembers(prev => [data, ...prev]);
      setShowModal(false);
      setForm({ name: "", phone: "", birth_date: "", memo: "" });
    } catch (err: unknown) { setError(err instanceof Error ? err.message : "오류가 발생했습니다."); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string, name: string) {
    Alert.alert("회원 삭제", `${name} 회원을 삭제하시겠습니까?`, [
      { text: "취소", style: "cancel" },
      { text: "삭제", style: "destructive", onPress: async () => {
        await apiRequest(token, `/members/${id}`, { method: "DELETE" });
        setMembers(prev => prev.filter(m => m.id !== id));
      }},
    ]);
  }

  // 필터링
  const filtered = members.filter(m =>
    (m.name.includes(search) || m.phone.includes(search)) &&
    (statusFilter === "all" ||
     (statusFilter === "pending" && !m.class_id) ||
     (statusFilter === "free"    && m.class_id && m.class_name === "무료") ||
     (statusFilter === "paid"    && m.class_id && m.class_name !== "무료"))
  );

  // 필터칩 카운트 주입
  const chipsWithCount: FilterChipItem<StatusFilter>[] = FILTER_CHIPS.map(chip => ({
    ...chip,
    count: members.filter(m =>
      chip.key === "all"     ? true :
      chip.key === "pending" ? !m.class_id :
      chip.key === "free"    ? (!!m.class_id && m.class_name === "무료") :
      chip.key === "paid"    ? (!!m.class_id && m.class_name !== "무료") : false
    ).length,
  }));

  // 고정 상단 헤더
  const header = (
    <>
      <PageHeader
        title="회원 관리"
        action={{ icon: "user-plus", label: "회원 등록", onPress: () => setShowModal(true) }}
      />
      {/* 검색바 */}
      <View style={[s.searchRow, { borderColor: C.border, backgroundColor: C.card }]}>
        <Feather name="search" size={16} color={C.textMuted} />
        <TextInput
          style={[s.searchInput, { color: C.text }]}
          value={search}
          onChangeText={setSearch}
          placeholder="이름 또는 전화번호 검색"
          placeholderTextColor={C.textMuted}
        />
        {search.length > 0 && (
          <Pressable onPress={() => setSearch("")}>
            <Feather name="x-circle" size={16} color={C.textMuted} />
          </Pressable>
        )}
      </View>
      {/* 상태 필터칩 (고정 크기 — 절대 변하지 않음) */}
      <FilterChips<StatusFilter>
        chips={chipsWithCount}
        active={statusFilter}
        onChange={setStatusFilter}
      />
    </>
  );

  if (loading) {
    return (
      <ScreenLayout header={header}>
        <ActivityIndicator color={C.tint} style={{ marginTop: 80 }} size="large" />
      </ScreenLayout>
    );
  }

  return (
    <>
      <ScreenLayout header={header}>
        <FlatList
          data={filtered}
          keyExtractor={item => item.id}
          contentContainerStyle={[s.list, { paddingBottom: insets.bottom + 100 }]}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <EmptyState
              icon="users"
              title="해당하는 회원이 없습니다"
              subtitle={search ? `"${search}" 검색 결과가 없습니다` : "필터를 변경해보세요"}
            />
          }
          renderItem={({ item: m }) => (
            <View style={[s.card, { backgroundColor: C.card }]}>
              <View style={[s.avatar, { backgroundColor: C.tintLight }]}>
                <Text style={[s.avatarText, { color: C.tint }]}>{m.name[0]}</Text>
              </View>
              <View style={s.info}>
                <Text style={[s.name, { color: C.text }]}>{m.name}</Text>
                <Text style={[s.phone, { color: C.textSecondary }]}>{m.phone}</Text>
                {m.class_name ? (
                  <View style={[s.classBadge, { backgroundColor: C.tintLight }]}>
                    <Text style={[s.classBadgeText, { color: C.tint }]}>{m.class_name}</Text>
                  </View>
                ) : (
                  <View style={[s.classBadge, { backgroundColor: STATUS_COLORS.pending.bg }]}>
                    <Text style={[s.classBadgeText, { color: STATUS_COLORS.pending.color }]}>미승인</Text>
                  </View>
                )}
                <Pressable
                  style={[s.diaryBtn, { backgroundColor: "#059669" + "1A" }]}
                  onPress={() => router.push({ pathname: "/(admin)/diary-write", params: { studentId: m.id, studentName: m.name } } as any)}
                >
                  <Feather name="book-open" size={12} color="#059669" />
                  <Text style={[s.diaryBtnText, { color: "#059669" }]}>수영 일지 작성</Text>
                </Pressable>
              </View>
              <Pressable onPress={() => handleDelete(m.id, m.name)} style={s.deleteBtn}>
                <Feather name="trash-2" size={18} color={C.error} />
              </Pressable>
            </View>
          )}
        />
      </ScreenLayout>

      {/* 회원 등록 모달 */}
      <Modal visible={showModal} animationType="slide" transparent onRequestClose={() => setShowModal(false)}>
        <KeyboardAvoidingView style={s.overlay} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View style={[s.sheet, { backgroundColor: C.card, paddingBottom: insets.bottom + 20 }]}>
            <View style={s.handle} />
            <View style={s.sheetHeader}>
              <Text style={[s.sheetTitle, { color: C.text }]}>회원 등록</Text>
              <Pressable onPress={() => setShowModal(false)}>
                <Feather name="x" size={22} color={C.textSecondary} />
              </Pressable>
            </View>
            {error ? <Text style={[s.errText, { color: C.error }]}>{error}</Text> : null}
            {(["name", "phone", "birth_date", "memo"] as const).map(key => (
              <View key={key} style={s.field}>
                <Text style={[s.label, { color: C.textSecondary }]}>
                  {key === "name" ? "이름 *" : key === "phone" ? "전화번호 *" : key === "birth_date" ? "생년월일" : "메모"}
                </Text>
                <TextInput
                  style={[s.input, { borderColor: C.border, color: C.text, backgroundColor: C.background }]}
                  value={form[key]}
                  onChangeText={v => setForm(f => ({ ...f, [key]: v }))}
                  placeholder={key === "name" ? "회원 이름" : key === "phone" ? "010-0000-0000" : key === "birth_date" ? "2000-01-01" : "특이사항 등"}
                  placeholderTextColor={C.textMuted}
                />
              </View>
            ))}
            <Pressable
              style={({ pressed }) => [s.saveBtn, { backgroundColor: C.tint, opacity: pressed ? 0.85 : 1 }]}
              onPress={handleCreate}
              disabled={saving}
            >
              {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.saveBtnText}>등록하기</Text>}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  searchRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    borderWidth: 1.5, borderRadius: 12,
    paddingHorizontal: 12, height: 44,
    marginHorizontal: 16, marginBottom: 4,
  },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular" },

  list: { paddingHorizontal: 16, paddingTop: 8, gap: 10 },

  card: {
    flexDirection: "row", alignItems: "center",
    borderRadius: 14, padding: 14, gap: 12,
  },
  avatar: { width: 48, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 20, fontFamily: "Inter_700Bold" },
  info: { flex: 1, gap: 3 },
  name:  { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  phone: { fontSize: 13, fontFamily: "Inter_400Regular" },
  classBadge: { alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, marginTop: 2 },
  classBadgeText: { fontSize: 11, fontFamily: "Inter_500Medium" },
  deleteBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  diaryBtn: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, marginTop: 4 },
  diaryBtnText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },

  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 14 },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#E5E7EB", alignSelf: "center", marginBottom: 8 },
  sheetHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sheetTitle: { fontSize: 20, fontFamily: "Inter_700Bold" },
  errText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  field: { gap: 6 },
  label: { fontSize: 13, fontFamily: "Inter_500Medium" },
  input: { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, height: 46, fontSize: 15, fontFamily: "Inter_400Regular" },
  saveBtn: { height: 50, borderRadius: 14, alignItems: "center", justifyContent: "center", marginTop: 4 },
  saveBtnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold" },
});
