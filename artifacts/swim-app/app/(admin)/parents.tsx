import { MessageSquare, Phone, Search, Users } from "lucide-react-native";
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
      if (res.ok) setParents(await res.json());
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
          p.students?.some(s => s.name?.toLowerCase().includes(q))
        );
      })
    : parents;

  return (
    <View style={[s.root, { backgroundColor: C.background }]}>
      <SubScreenHeader title="학부모 회원" />

      {/* 검색 */}
      <View style={[s.searchWrap, { backgroundColor: C.card, borderColor: C.border }]}>
        <Search size={15} color={C.textMuted} />
        <TextInput
          style={[s.searchInput, { color: C.text }]}
          placeholder="이름, 전화번호, 자녀이름 검색"
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
            <Users size={15} color={C.tint} />
            <Text style={[s.statText, { color: C.text }]}>
              가입된 학부모 <Text style={{ color: C.tint, fontFamily: "Pretendard-Regular" }}>{filtered.length}명</Text>
            </Text>
          </View>

          {filtered.length === 0 ? (
            <View style={s.empty}>
              <View style={[s.emptyIcon, { backgroundColor: C.tintLight }]}>
                <Users size={36} color={C.tint} />
              </View>
              <Text style={[s.emptyTitle, { color: C.text }]}>
                {search.trim() ? "검색 결과가 없습니다" : "아직 가입한 학부모가 없습니다"}
              </Text>
              {!search.trim() && (
                <Text style={[s.emptySub, { color: C.textSecondary }]}>
                  학부모가 앱에서 가입하면{"\n"}자동으로 이 목록에 나타납니다
                </Text>
              )}
            </View>
          ) : (
            filtered.map(pa => (
              <View key={pa.id} style={[s.card, { backgroundColor: C.card, borderColor: C.border }]}>
                {/* 학부모 기본정보 */}
                <View style={s.cardHeader}>
                  <View style={[s.avatar, { backgroundColor: C.tintLight }]}>
                    <Text style={[s.avatarText, { color: C.tint }]}>{pa.name?.[0] ?? "?"}</Text>
                  </View>
                  <View style={s.info}>
                    <Text style={[s.name, { color: C.text }]}>{pa.name}</Text>
                    {pa.login_id && (
                      <Text style={[s.loginId, { color: C.textMuted }]}>아이디: {pa.login_id}</Text>
                    )}
                  </View>
                  {pa.phone ? (
                    <View style={s.phoneRow}>
                      <Pressable onPress={() => callPhone(pa.phone)} hitSlop={8}>
                        <Phone size={15} color={CALL_COLOR} />
                      </Pressable>
                      <Pressable onPress={() => sendSms(pa.phone)} hitSlop={8}>
                        <MessageSquare size={15} color={SMS_COLOR} />
                      </Pressable>
                    </View>
                  ) : null}
                </View>

                {/* 전화번호 */}
                {pa.phone ? (
                  <Text style={[s.phone, { color: C.textSecondary }]}>{formatPhone(pa.phone)}</Text>
                ) : null}

                {/* 연결된 자녀 */}
                {pa.students && pa.students.length > 0 ? (
                  <View style={[s.childrenWrap, { borderTopColor: C.border }]}>
                    <Text style={[s.childLabel, { color: C.textMuted }]}>연결된 자녀</Text>
                    <View style={s.chips}>
                      {pa.students.map(st => (
                        <View key={st.id} style={[s.chip, { backgroundColor: C.tintLight }]}>
                          <Text style={[s.chipText, { color: C.tint }]}>{st.name}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                ) : (
                  <View style={[s.childrenWrap, { borderTopColor: C.border }]}>
                    <Text style={[s.childLabel, { color: C.textMuted }]}>자녀 미연결</Text>
                  </View>
                )}
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
    flexDirection: "row", alignItems: "center", gap: 8,
    padding: 12, borderRadius: 12, borderWidth: 1,
  },
  statText: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  empty: { alignItems: "center", paddingTop: 60, gap: 12 },
  emptyIcon: { width: 80, height: 80, borderRadius: 40, alignItems: "center", justifyContent: "center" },
  emptyTitle: { fontSize: 16, fontFamily: "Pretendard-Regular" },
  emptySub: { fontSize: 13, fontFamily: "Pretendard-Regular", textAlign: "center", lineHeight: 20 },
  card: {
    borderRadius: 16, borderWidth: 1,
    overflow: "hidden",
  },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 18, fontFamily: "Pretendard-Regular" },
  info: { flex: 1, gap: 2 },
  name: { fontSize: 16, fontFamily: "Pretendard-Regular" },
  loginId: { fontSize: 12, fontFamily: "Pretendard-Regular" },
  phoneRow: { flexDirection: "row", gap: 12 },
  phone: { fontSize: 13, fontFamily: "Pretendard-Regular", paddingHorizontal: 14, paddingBottom: 8 },
  childrenWrap: { borderTopWidth: 1, paddingHorizontal: 14, paddingVertical: 10, gap: 6 },
  childLabel: { fontSize: 11, fontFamily: "Pretendard-Regular" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  chipText: { fontSize: 13, fontFamily: "Pretendard-Regular" },
});
