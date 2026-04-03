/**
 * 학부모 연락처 화면 (새로 작성)
 * - /admin/parents 에서 데이터 fetch
 * - 앱 가입 (연결완료) / 미연결 (학생 등록 시 입력한 연락처) 구분 표시
 */
import { MessageSquare, Phone, RefreshCw, Search, Smartphone, Users } from "lucide-react-native";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
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
  linked: boolean;
  created_at: string;
}

type FilterTab = "all" | "linked" | "unlinked";

export default function ParentsScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();

  const [parents, setParents] = useState<ParentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<FilterTab>("all");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await apiRequest(token, "/admin/parents");
      if (res.ok) {
        const data = await res.json();
        setParents(Array.isArray(data) ? data : []);
      } else {
        const body = await res.json().catch(() => ({}));
        setError(body.error || `오류 ${res.status}`);
      }
    } catch (e: any) {
      setError(e?.message || "네트워크 오류");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const filtered = parents.filter(p => {
    const q = search.trim().toLowerCase();
    const matchSearch = !q || (
      (p.name || "").toLowerCase().includes(q) ||
      (p.phone || "").includes(q) ||
      (p.students || []).some(s => s.name?.toLowerCase().includes(q))
    );
    const matchTab =
      tab === "all" ? true :
      tab === "linked" ? p.linked :
      !p.linked;
    return matchSearch && matchTab;
  });

  const allCount     = parents.length;
  const linkedCount  = parents.filter(p => p.linked).length;
  const unlinkedCount = parents.filter(p => !p.linked).length;

  const TABS: { key: FilterTab; label: string; count: number; color: string }[] = [
    { key: "all",      label: "전체",    count: allCount,      color: C.tint },
    { key: "linked",   label: "앱연결",  count: linkedCount,   color: "#2563EB" },
    { key: "unlinked", label: "미연결",  count: unlinkedCount, color: "#EA580C" },
  ];

  return (
    <View style={[s.root, { backgroundColor: C.background }]}>
      <SubScreenHeader title="학부모 연락처" />

      {/* 검색 */}
      <View style={[s.searchWrap, { backgroundColor: C.card, borderColor: C.border }]}>
        <Search size={15} color={C.textMuted} />
        <TextInput
          style={[s.searchInput, { color: C.text }]}
          placeholder="이름, 전화번호, 자녀 이름 검색"
          placeholderTextColor={C.textMuted}
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
        />
        {search.length > 0 && (
          <Pressable onPress={() => setSearch("")}>
            <Text style={{ color: C.textMuted, fontSize: 16, paddingHorizontal: 4 }}>×</Text>
          </Pressable>
        )}
      </View>

      {/* 탭 필터 */}
      <View style={s.tabRow}>
        {TABS.map(t => (
          <Pressable
            key={t.key}
            style={[s.tabBtn, tab === t.key && { borderBottomColor: t.color, borderBottomWidth: 2 }]}
            onPress={() => setTab(t.key)}
          >
            <Text style={[s.tabTxt, { color: tab === t.key ? t.color : C.textMuted }]}>
              {t.label} {t.count}
            </Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator color={C.tint} style={{ marginTop: 60 }} />
      ) : error ? (
        <View style={s.empty}>
          <Text style={[s.emptyTitle, { color: "#D96C6C" }]}>데이터를 불러오지 못했습니다</Text>
          <Text style={[s.emptySub, { color: C.textSecondary }]}>{error}</Text>
          <Pressable style={[s.retryBtn, { backgroundColor: C.tint }]} onPress={() => { setLoading(true); load(); }}>
            <RefreshCw size={14} color="#fff" />
            <Text style={s.retryTxt}>다시 시도</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: insets.bottom + 24 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={C.tint} />}
          showsVerticalScrollIndicator={false}
        >
          {filtered.length === 0 ? (
            <View style={s.empty}>
              <View style={[s.emptyIcon, { backgroundColor: C.tintLight }]}>
                <Users size={36} color={C.tint} />
              </View>
              <Text style={[s.emptyTitle, { color: C.text }]}>
                {search.trim() ? "검색 결과가 없습니다" : tab === "linked" ? "앱 연결 학부모가 없습니다" : tab === "unlinked" ? "미연결 학부모가 없습니다" : "학부모 정보가 없습니다"}
              </Text>
              {!search.trim() && tab === "all" && (
                <Text style={[s.emptySub, { color: C.textSecondary }]}>
                  학생 등록 시 학부모 이름·연락처를 입력하거나{"\n"}학부모가 앱에서 가입하면 여기에 표시됩니다
                </Text>
              )}
            </View>
          ) : (
            filtered.map(pa => <ParentCard key={pa.id} pa={pa} />)
          )}
        </ScrollView>
      )}
    </View>
  );
}

function ParentCard({ pa }: { pa: ParentRow }) {
  return (
    <View style={[s.card, { backgroundColor: C.card, borderColor: C.border }]}>
      <View style={s.cardHeader}>
        {/* 아바타 */}
        <View style={[s.avatar, { backgroundColor: pa.linked ? "#E6FAF8" : "#F1F5F9" }]}>
          <Text style={[s.avatarTxt, { color: pa.linked ? C.tint : "#64748B" }]}>
            {(pa.name || "?")[0]}
          </Text>
        </View>

        {/* 이름 + 뱃지 + 전화번호 */}
        <View style={s.info}>
          <View style={s.nameRow}>
            <Text style={[s.name, { color: C.text }]}>{pa.name || "이름 없음"}</Text>
            {pa.linked ? (
              <View style={s.linkedBadge}>
                <Smartphone size={9} color="#2563EB" />
                <Text style={s.linkedTxt}>앱연결</Text>
              </View>
            ) : (
              <View style={s.unlinkedBadge}>
                <Text style={s.unlinkedTxt}>미연결</Text>
              </View>
            )}
          </View>
          <Text style={[s.phone, { color: pa.phone ? C.textSecondary : C.textMuted }]}>
            {pa.phone ? formatPhone(pa.phone) : "연락처 없음"}
          </Text>
        </View>

        {/* 전화/문자 버튼 */}
        {pa.phone ? (
          <View style={s.actions}>
            <Pressable style={[s.actionBtn, { backgroundColor: "#FFF0E0" }]} onPress={() => callPhone(pa.phone)} hitSlop={8}>
              <Phone size={15} color={CALL_COLOR} />
            </Pressable>
            <Pressable style={[s.actionBtn, { backgroundColor: "#E8F5E9" }]} onPress={() => sendSms(pa.phone)} hitSlop={8}>
              <MessageSquare size={15} color={SMS_COLOR} />
            </Pressable>
          </View>
        ) : null}
      </View>

      {/* 자녀 목록 */}
      <View style={[s.childRow, { borderTopColor: C.border }]}>
        <Text style={[s.childLabel, { color: C.textMuted }]}>자녀</Text>
        {(pa.students || []).length > 0 ? (
          <View style={s.chips}>
            {pa.students.map(st => (
              <View key={st.id} style={[s.chip, { backgroundColor: pa.linked ? "#E6FAF8" : "#F1F5F9" }]}>
                <Text style={[s.chipTxt, { color: pa.linked ? C.tint : "#475569" }]}>{st.name}</Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={[s.noChild, { color: C.textMuted }]}>자녀 정보 없음</Text>
        )}
      </View>
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

  tabRow: {
    flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#E5E7EB",
    marginHorizontal: 16, marginBottom: 4,
  },
  tabBtn: { flex: 1, alignItems: "center", paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabTxt: { fontSize: 13, fontFamily: "Pretendard-Regular" },

  empty: { alignItems: "center", paddingTop: 60, gap: 12 },
  emptyIcon: { width: 80, height: 80, borderRadius: 40, alignItems: "center", justifyContent: "center" },
  emptyTitle: { fontSize: 16, fontFamily: "Pretendard-Regular" },
  emptySub: { fontSize: 13, fontFamily: "Pretendard-Regular", textAlign: "center", lineHeight: 20 },
  retryBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12, marginTop: 8 },
  retryTxt: { color: "#fff", fontSize: 14, fontFamily: "Pretendard-Regular" },

  card: { borderRadius: 16, borderWidth: 1, overflow: "hidden" },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  avatarTxt: { fontSize: 18, fontFamily: "Pretendard-Regular" },
  info: { flex: 1, gap: 3 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  name: { fontSize: 15, fontFamily: "Pretendard-Regular" },
  linkedBadge: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#DBEAFE", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10 },
  linkedTxt: { fontSize: 10, color: "#2563EB", fontFamily: "Pretendard-Regular" },
  unlinkedBadge: { backgroundColor: "#FEF3C7", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10 },
  unlinkedTxt: { fontSize: 10, color: "#D97706", fontFamily: "Pretendard-Regular" },
  phone: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  actions: { flexDirection: "row", gap: 8 },
  actionBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },

  childRow: { borderTopWidth: 1, paddingHorizontal: 14, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 8 },
  childLabel: { fontSize: 11, fontFamily: "Pretendard-Regular", minWidth: 24 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, flex: 1 },
  chip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  chipTxt: { fontSize: 12, fontFamily: "Pretendard-Regular" },
  noChild: { fontSize: 12, fontFamily: "Pretendard-Regular" },
});
