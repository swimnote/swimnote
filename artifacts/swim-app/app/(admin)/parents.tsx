import { MessageSquare, Phone, Search, Smartphone, Users } from "lucide-react-native";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { callPhone, sendSms, formatPhone, CALL_COLOR, SMS_COLOR } from "@/utils/phoneUtils";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";

const C = Colors.light;

interface StudentLink { id: string; name: string; }
interface ParentRow {
  id: string;
  name: string;
  phone: string;
  login_id?: string | null;
  students: StudentLink[];
  source: "app" | "guardian";
  created_at: string;
}

export default function ParentsScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();

  const [parents, setParents] = useState<ParentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await apiRequest(token, "/admin/parents");
      if (res.ok) {
        const data = await res.json();
        setParents(Array.isArray(data) ? data : []);
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const filtered = search.trim()
    ? parents.filter(p => {
        const q = search.trim().toLowerCase();
        return (
          p.name?.toLowerCase().includes(q) ||
          p.phone?.includes(q) ||
          (p.students ?? []).some(s => s.name?.toLowerCase().includes(q))
        );
      })
    : parents;

  const appCount = filtered.filter(p => p.source === "app").length;
  const guardianCount = filtered.filter(p => p.source === "guardian").length;

  return (
    <View style={[s.root, { backgroundColor: C.background }]}>
      <SubScreenHeader title="학부모 연락처" />

      {/* 검색 */}
      <View style={[s.searchWrap, { backgroundColor: C.card, borderColor: C.border }]}>
        <Search size={15} color={C.textMuted} />
        <TextInput
          style={[s.searchInput, { color: C.text }]}
          placeholder="보호자 이름, 전화번호, 자녀이름 검색"
          placeholderTextColor={C.textMuted}
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
        />
      </View>

      {loading ? (
        <ActivityIndicator color={C.tint} style={{ marginTop: 60 }} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: insets.bottom + 24 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          showsVerticalScrollIndicator={false}
        >
          {/* 통계 */}
          <View style={[s.statRow, { backgroundColor: C.card, borderColor: C.border }]}>
            <Users size={14} color={C.tint} />
            <Text style={[s.statText, { color: C.text }]}>
              전체 <Text style={{ color: C.tint }}>{filtered.length}명</Text>
            </Text>
            {appCount > 0 && (
              <>
                <Text style={[s.statDot, { color: C.textMuted }]}>·</Text>
                <Smartphone size={13} color="#2EC4B6" />
                <Text style={[s.statText, { color: C.textSecondary }]}>앱 가입 {appCount}명</Text>
              </>
            )}
            {guardianCount > 0 && (
              <>
                <Text style={[s.statDot, { color: C.textMuted }]}>·</Text>
                <Text style={[s.statText, { color: C.textSecondary }]}>보호자 정보 {guardianCount}명</Text>
              </>
            )}
          </View>

          {filtered.length === 0 ? (
            <View style={s.empty}>
              <View style={[s.emptyIcon, { backgroundColor: C.tintLight }]}>
                <Users size={36} color={C.tint} />
              </View>
              <Text style={[s.emptyTitle, { color: C.text }]}>
                {search.trim() ? "검색 결과가 없습니다" : "학부모 정보가 없습니다"}
              </Text>
              {!search.trim() && (
                <Text style={[s.emptySub, { color: C.textSecondary }]}>
                  학생 등록 시 보호자 이름·연락처를 입력하거나{"\n"}학부모가 앱에서 가입하면 여기에 표시됩니다
                </Text>
              )}
            </View>
          ) : (
            filtered.map(pa => (
              <View key={pa.id} style={[s.card, { backgroundColor: C.card, borderColor: C.border }]}>
                {/* 카드 헤더 */}
                <View style={s.cardHeader}>
                  <View style={[s.avatar, {
                    backgroundColor: pa.source === "app" ? "#E6FAF8" : "#F0F4FF",
                  }]}>
                    <Text style={[s.avatarText, {
                      color: pa.source === "app" ? C.tint : "#4F6EF7",
                    }]}>{pa.name?.[0] ?? "?"}</Text>
                  </View>
                  <View style={s.info}>
                    <View style={s.nameRow}>
                      <Text style={[s.name, { color: C.text }]}>{pa.name || "이름 없음"}</Text>
                      {pa.source === "app" && (
                        <View style={s.appBadge}>
                          <Smartphone size={10} color="#2EC4B6" />
                          <Text style={s.appBadgeText}>앱 가입</Text>
                        </View>
                      )}
                    </View>
                    {pa.phone ? (
                      <Text style={[s.phoneText, { color: C.textSecondary }]}>{formatPhone(pa.phone)}</Text>
                    ) : (
                      <Text style={[s.phoneText, { color: C.textMuted }]}>연락처 없음</Text>
                    )}
                  </View>
                  {pa.phone ? (
                    <View style={s.actions}>
                      <Pressable
                        style={[s.actionBtn, { backgroundColor: "#FFF0E0" }]}
                        onPress={() => callPhone(pa.phone)}
                        hitSlop={8}
                      >
                        <Phone size={15} color={CALL_COLOR} />
                      </Pressable>
                      <Pressable
                        style={[s.actionBtn, { backgroundColor: "#E8F5E9" }]}
                        onPress={() => sendSms(pa.phone)}
                        hitSlop={8}
                      >
                        <MessageSquare size={15} color={SMS_COLOR} />
                      </Pressable>
                    </View>
                  ) : null}
                </View>

                {/* 연결된 자녀 */}
                <View style={[s.childrenWrap, { borderTopColor: C.border }]}>
                  <Text style={[s.childLabel, { color: C.textMuted }]}>자녀</Text>
                  {(pa.students ?? []).length > 0 ? (
                    <View style={s.chips}>
                      {(pa.students ?? []).map(st => (
                        <View key={st.id} style={[s.chip, {
                          backgroundColor: pa.source === "app" ? "#E6FAF8" : "#EEF2FF",
                        }]}>
                          <Text style={[s.chipText, {
                            color: pa.source === "app" ? C.tint : "#4F6EF7",
                          }]}>{st.name}</Text>
                        </View>
                      ))}
                    </View>
                  ) : (
                    <Text style={[s.noChild, { color: C.textMuted }]}>자녀 정보 없음</Text>
                  )}
                </View>
              </View>
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  searchWrap: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginHorizontal: 16, marginTop: 12, marginBottom: 4,
    borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 14, height: 46,
  },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Pretendard-Regular" },
  statRow: {
    flexDirection: "row", alignItems: "center", gap: 6,
    padding: 12, borderRadius: 12, borderWidth: 1, flexWrap: "wrap",
  },
  statDot: { fontSize: 14 },
  statText: { fontSize: 12, fontFamily: "Pretendard-Regular" },
  empty: { alignItems: "center", paddingTop: 60, gap: 12 },
  emptyIcon: { width: 80, height: 80, borderRadius: 40, alignItems: "center", justifyContent: "center" },
  emptyTitle: { fontSize: 16, fontFamily: "Pretendard-Regular" },
  emptySub: { fontSize: 13, fontFamily: "Pretendard-Regular", textAlign: "center", lineHeight: 20 },
  card: { borderRadius: 16, borderWidth: 1, overflow: "hidden" },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 18, fontFamily: "Pretendard-Regular" },
  info: { flex: 1, gap: 3 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  name: { fontSize: 15, fontFamily: "Pretendard-Regular" },
  appBadge: {
    flexDirection: "row", alignItems: "center", gap: 3,
    backgroundColor: "#E6FAF8", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10,
  },
  appBadgeText: { fontSize: 10, color: "#2EC4B6", fontFamily: "Pretendard-Regular" },
  phoneText: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  actions: { flexDirection: "row", gap: 8 },
  actionBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  childrenWrap: { borderTopWidth: 1, paddingHorizontal: 14, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 8 },
  childLabel: { fontSize: 11, fontFamily: "Pretendard-Regular", minWidth: 24 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, flex: 1 },
  chip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  chipText: { fontSize: 12, fontFamily: "Pretendard-Regular" },
  noChild: { fontSize: 12, fontFamily: "Pretendard-Regular" },
});
