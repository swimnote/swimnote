/**
 * (admin)/parents-list.tsx — 학부모 명단
 * - 카드 누르면 상세 모달 (학생 반·레벨 정보)
 * - 전화걸기 / 문자보내기 버튼
 */
import { HeartHandshake, MessageSquare, Phone, Search, Users, X } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import { useFocusEffect } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Modal,
  Platform,
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
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";

const C = Colors.light;
const TEAL = "#2EC4B6";
const TEAL_BG = "#E6FAF8";

type FilterKey = "all" | "app" | "guardian";

interface ParentRow {
  id: string;
  name: string | null;
  phone: string | null;
  login_id: string | null;
  created_at: string;
  source: "app" | "guardian";
  linked: boolean;
  students: { id: string; name: string }[];
}

interface StudentDetail {
  id: string;
  name: string;
  status: string;
  class_name: string | null;
  level: string | null;
  parent_name?: string | null;
  parent_phone?: string | null;
}

interface ParentDetail {
  id: string;
  name: string | null;
  phone: string | null;
  login_id: string | null;
  created_at: string | null;
  source: "app" | "guardian";
  students: StudentDetail[];
  reg_request: { child_names: any; status: string; created_at: string } | null;
}

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all",      label: "전체" },
  { key: "app",      label: "앱 가입" },
  { key: "guardian", label: "보호자만" },
];

function formatDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  const yy = String(d.getFullYear()).slice(2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yy}.${mm}.${dd}`;
}

function formatPhone(phone: string | null) {
  if (!phone) return "번호 없음";
  const digits = phone.replace(/[^0-9]/g, "");
  if (digits.length >= 11) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  return phone;
}

function callPhone(phone: string | null) {
  if (!phone) return;
  Linking.openURL(`tel:${phone.replace(/[^0-9]/g, "")}`);
}

function smsPhone(phone: string | null) {
  if (!phone) return;
  Linking.openURL(`sms:${phone.replace(/[^0-9]/g, "")}`);
}

/* ─── 상세 모달 ─── */
function ParentDetailModal({
  item,
  visible,
  onClose,
  token,
}: {
  item: ParentRow | null;
  visible: boolean;
  onClose: () => void;
  token: string | null;
}) {
  const insets = useSafeAreaInsets();
  const [detail, setDetail] = useState<ParentDetail | null>(null);
  const [loading, setLoading] = useState(false);

  React.useEffect(() => {
    if (!visible || !item) { setDetail(null); return; }
    setLoading(true);
    apiRequest(token, `/admin/parents/${encodeURIComponent(item.id)}?source=${item.source}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => setDetail(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [visible, item]);

  if (!item) return null;
  const isApp = item.source === "app";
  const phone = item.phone;

  // 가입 시 입력한 자녀 이름 파싱
  let regChildNames: string[] = [];
  if (detail?.reg_request?.child_names) {
    try {
      const parsed = typeof detail.reg_request.child_names === "string"
        ? JSON.parse(detail.reg_request.child_names)
        : detail.reg_request.child_names;
      if (Array.isArray(parsed)) regChildNames = parsed.map((c: any) => (typeof c === "string" ? c : c.name || "")).filter(Boolean);
    } catch {}
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={md.backdrop} onPress={onClose} />
      <View style={[md.sheet, { paddingBottom: insets.bottom + 20 }]}>
        {/* 핸들 */}
        <View style={md.handle} />

        {/* 헤더 */}
        <View style={md.header}>
          <View style={[md.avatarBox, { backgroundColor: isApp ? "#E0F2FE" : "#F1F5F9" }]}>
            <LucideIcon name={isApp ? "heart-handshake" : "user"} size={22} color={isApp ? "#0EA5E9" : "#64748B"} />
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={md.name}>{item.name || "(이름 없음)"}</Text>
              <View style={[md.badge, { backgroundColor: isApp ? "#DBEAFE" : "#F1F5F9" }]}>
                <Text style={[md.badgeTxt, { color: isApp ? "#1D4ED8" : "#64748B" }]}>
                  {isApp ? "앱 가입" : "보호자"}
                </Text>
              </View>
            </View>
            <Text style={md.phoneTxt}>{formatPhone(phone)}</Text>
          </View>
          <Pressable onPress={onClose} hitSlop={12}>
            <X size={20} color={C.textMuted} />
          </Pressable>
        </View>

        {/* 전화 / 문자 버튼 */}
        <View style={md.actionRow}>
          <Pressable
            style={({ pressed }) => [md.actionBtn, { backgroundColor: "#EFF9F8", opacity: pressed ? 0.7 : 1 }]}
            onPress={() => callPhone(phone)}
            disabled={!phone}
          >
            <Phone size={18} color={TEAL} />
            <Text style={[md.actionTxt, { color: TEAL }]}>전화걸기</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [md.actionBtn, { backgroundColor: "#F0F4FF", opacity: pressed ? 0.7 : 1 }]}
            onPress={() => smsPhone(phone)}
            disabled={!phone}
          >
            <MessageSquare size={18} color="#4F6EF7" />
            <Text style={[md.actionTxt, { color: "#4F6EF7" }]}>문자보내기</Text>
          </Pressable>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20, gap: 16 }}>
          {/* 기본 정보 */}
          <View style={md.section}>
            <Text style={md.sectionTitle}>기본 정보</Text>
            <View style={md.infoCard}>
              <InfoLine label="이름" value={item.name || "—"} />
              <View style={md.divider} />
              <InfoLine label="전화번호" value={formatPhone(phone)} />
              {isApp && <><View style={md.divider} /><InfoLine label="가입일" value={formatDate(item.created_at)} /></>}
              {isApp && item.login_id && <><View style={md.divider} /><InfoLine label="아이디" value={item.login_id} /></>}
            </View>
          </View>

          {/* 연결된 자녀 */}
          {loading ? (
            <ActivityIndicator color={TEAL} style={{ marginTop: 8 }} />
          ) : (
            <>
              <View style={md.section}>
                <Text style={md.sectionTitle}>
                  연결된 자녀 {detail?.students?.length ?? item.students.length}명
                </Text>
                {(detail?.students?.length ?? 0) > 0 ? (
                  detail!.students.map((st, i) => (
                    <View key={st.id} style={[md.studentCard, i > 0 && { marginTop: 8 }]}>
                      <View style={[md.studentBadge, { backgroundColor: TEAL_BG }]}>
                        <Text style={[md.studentBadgeTxt, { color: TEAL }]}>{st.name?.[0] ?? "?"}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={md.studentName}>{st.name}</Text>
                        <View style={{ flexDirection: "row", gap: 6, marginTop: 2, flexWrap: "wrap" }}>
                          {st.class_name && (
                            <View style={md.tag}>
                              <Text style={md.tagTxt}>{st.class_name}</Text>
                            </View>
                          )}
                          {st.level && (
                            <View style={[md.tag, { backgroundColor: "#FFF3E0" }]}>
                              <Text style={[md.tagTxt, { color: "#E65100" }]}>{st.level}</Text>
                            </View>
                          )}
                          {st.status && st.status !== "active" && (
                            <View style={[md.tag, { backgroundColor: "#F8D7DA" }]}>
                              <Text style={[md.tagTxt, { color: "#842029" }]}>{st.status}</Text>
                            </View>
                          )}
                        </View>
                      </View>
                    </View>
                  ))
                ) : item.students.length > 0 ? (
                  item.students.map((st, i) => (
                    <View key={st.id} style={[md.studentCard, i > 0 && { marginTop: 8 }]}>
                      <View style={[md.studentBadge, { backgroundColor: TEAL_BG }]}>
                        <Text style={[md.studentBadgeTxt, { color: TEAL }]}>{st.name?.[0] ?? "?"}</Text>
                      </View>
                      <Text style={md.studentName}>{st.name}</Text>
                    </View>
                  ))
                ) : (
                  <View style={[md.infoCard, { alignItems: "center", paddingVertical: 16 }]}>
                    <Text style={{ color: C.textMuted, fontSize: 13 }}>연결된 자녀가 없습니다</Text>
                  </View>
                )}
              </View>

              {/* 가입 시 입력한 자녀 정보 */}
              {regChildNames.length > 0 && (
                <View style={md.section}>
                  <Text style={md.sectionTitle}>가입 시 입력한 자녀 이름</Text>
                  <View style={md.infoCard}>
                    {regChildNames.map((name, i) => (
                      <React.Fragment key={i}>
                        {i > 0 && <View style={md.divider} />}
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 2 }}>
                          <Text style={{ fontSize: 14, color: C.text }}>{name}</Text>
                        </View>
                      </React.Fragment>
                    ))}
                  </View>
                </View>
              )}
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", paddingVertical: 4 }}>
      <Text style={{ fontSize: 12, color: C.textMuted, width: 72 }}>{label}</Text>
      <Text style={{ fontSize: 14, color: C.text, flex: 1 }}>{value}</Text>
    </View>
  );
}

/* ─── 학부모 카드 ─── */
function ParentItem({ item, onPress }: { item: ParentRow; onPress: () => void }) {
  const isApp = item.source === "app";
  return (
    <Pressable
      style={({ pressed }) => [s.card, { opacity: pressed ? 0.92 : 1 }]}
      onPress={onPress}
    >
      <View style={s.cardHeader}>
        <View style={[s.iconBox, { backgroundColor: isApp ? "#E0F2FE" : "#F1F5F9" }]}>
          <LucideIcon name={isApp ? "heart-handshake" : "user"} size={20} color={isApp ? "#0EA5E9" : "#64748B"} />
        </View>

        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={s.name}>{item.name || "(이름 없음)"}</Text>
            <View style={[s.badge, { backgroundColor: isApp ? "#DBEAFE" : "#F1F5F9" }]}>
              <Text style={[s.badgeTxt, { color: isApp ? "#1D4ED8" : "#64748B" }]}>
                {isApp ? "앱 가입" : "보호자"}
              </Text>
            </View>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 }}>
            <Phone size={11} color={C.textMuted} />
            <Text style={s.phone}>{formatPhone(item.phone)}</Text>
          </View>
        </View>

        {/* 전화/문자 퀵 버튼 */}
        <View style={s.quickBtns}>
          <Pressable
            style={[s.quickBtn, { backgroundColor: "#EFF9F8" }]}
            onPress={e => { e.stopPropagation?.(); callPhone(item.phone); }}
            hitSlop={4}
          >
            <Phone size={14} color={TEAL} />
          </Pressable>
          <Pressable
            style={[s.quickBtn, { backgroundColor: "#F0F4FF" }]}
            onPress={e => { e.stopPropagation?.(); smsPhone(item.phone); }}
            hitSlop={4}
          >
            <MessageSquare size={14} color="#4F6EF7" />
          </Pressable>
        </View>

        <Text style={s.date}>{formatDate(item.created_at)}</Text>
      </View>

      {/* 자녀 목록 */}
      {item.students.length > 0 && (
        <View style={s.studentsRow}>
          <Users size={11} color={C.textMuted} />
          <Text style={s.studentsLabel}>자녀: </Text>
          <Text style={s.studentsVal}>{item.students.map(st => st.name).join(", ")}</Text>
        </View>
      )}
    </Pressable>
  );
}

/* ─── 메인 화면 ─── */
export default function ParentsListScreen() {
  const { token, pool } = useAuth();
  const { themeColor } = useBrand();

  const [parents, setParents]       = useState<ParentRow[]>([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter]         = useState<FilterKey>("all");
  const [search, setSearch]         = useState("");
  const [selected, setSelected]     = useState<ParentRow | null>(null);

  const fetchParents = useCallback(async () => {
    if (!token) return;
    try {
      const res = await apiRequest(token, "/admin/parents");
      if (res.ok) setParents(await res.json());
    } catch {}
    finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  // 화면 진입 시 미연결 학생 자동 매칭 (백그라운드, 무음)
  const silentAutoLink = useCallback(async () => {
    if (!token) return;
    try {
      const res = await apiRequest(token, "/admin/auto-link-parents", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        if (data.linked > 0) fetchParents(); // 연결된 경우에만 목록 갱신
      }
    } catch {}
  }, [token, fetchParents]);

  useFocusEffect(useCallback(() => {
    setLoading(true);
    fetchParents().then(() => silentAutoLink());
  }, [fetchParents, silentAutoLink]));

  const filtered = parents.filter(p => {
    if (filter === "app"      && p.source !== "app")      return false;
    if (filter === "guardian" && p.source !== "guardian") return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const nameMatch    = (p.name || "").toLowerCase().includes(q);
      const phoneMatch   = (p.phone || "").replace(/[^0-9]/g, "").includes(q.replace(/[^0-9]/g, ""));
      const studentMatch = p.students.some(s => s.name.toLowerCase().includes(q));
      if (!nameMatch && !phoneMatch && !studentMatch) return false;
    }
    return true;
  });

  const appCount      = parents.filter(p => p.source === "app").length;
  const guardianCount = parents.filter(p => p.source === "guardian").length;

  return (
    <View style={s.root}>
      <SubScreenHeader
        title="학부모 명단"
        subtitle={`${pool?.name ? pool.name + " · " : ""}전체 ${parents.length}명 · 앱 가입 ${appCount}명`}
      />

      {/* 검색 */}
      <View style={s.searchBox}>
        <Search size={15} color={C.textMuted} />
        <TextInput
          style={s.searchInput}
          placeholder="이름, 전화번호, 자녀 이름 검색"
          placeholderTextColor={C.textMuted}
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
        />
        {search.length > 0 && (
          <Pressable onPress={() => setSearch("")} hitSlop={8}>
            <X size={14} color={C.textMuted} />
          </Pressable>
        )}
      </View>

      {/* 필터 칩 */}
      <View style={s.filterRow}>
        {FILTERS.map(f => (
          <Pressable
            key={f.key}
            style={[s.chip, filter === f.key && { backgroundColor: themeColor, borderColor: themeColor }]}
            onPress={() => setFilter(f.key)}
          >
            <Text style={[s.chipTxt, filter === f.key && { color: "#fff" }]}>
              {f.label}
              {f.key === "all"      && ` ${parents.length}`}
              {f.key === "app"      && ` ${appCount}`}
              {f.key === "guardian" && ` ${guardianCount}`}
            </Text>
          </Pressable>
        ))}
      </View>

      {loading && !refreshing ? (
        <ActivityIndicator style={{ marginTop: 48 }} color={themeColor} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={item => item.id}
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingBottom: (Platform.OS === "web" ? 84 : 72) + 16,
            paddingTop: 4,
          }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchParents(); }} tintColor={themeColor} />
          }
          ListEmptyComponent={
            <View style={s.empty}>
              <HeartHandshake size={40} color={C.textMuted} />
              <Text style={s.emptyTxt}>{search ? "검색 결과가 없습니다" : "등록된 학부모가 없습니다"}</Text>
              <Text style={s.emptySub}>
                {search ? "다른 검색어를 사용해 보세요" : "학부모가 앱에서 수영장을 선택하면\n자동으로 여기에 표시됩니다"}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <ParentItem item={item} onPress={() => setSelected(item)} />
          )}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        />
      )}

      <ParentDetailModal
        item={selected}
        visible={!!selected}
        onClose={() => setSelected(null)}
        token={token}
      />
    </View>
  );
}

/* ─── 스타일 ─── */
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.background },

  searchBox: {
    flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#fff",
    marginHorizontal: 16, marginTop: 12, marginBottom: 8,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9,
    borderWidth: 1, borderColor: C.border,
  },
  searchInput: { flex: 1, fontSize: 14, color: C.text, padding: 0 },

  filterRow: { flexDirection: "row", gap: 6, paddingHorizontal: 16, marginBottom: 8 },
  chip: {
    borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: 1, borderColor: C.border, backgroundColor: "#fff",
  },
  chipTxt: { fontSize: 12, fontWeight: "600", color: C.textSecondary },

  card: {
    backgroundColor: "#fff", borderRadius: 14, padding: 14,
    shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 }, elevation: 1,
  },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  iconBox: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  name: { fontSize: 15, fontWeight: "700", color: C.text },
  badge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  badgeTxt: { fontSize: 11, fontWeight: "600" },
  phone: { fontSize: 12, color: C.textMuted },
  date: { fontSize: 11, color: C.textMuted, alignSelf: "flex-start" },

  quickBtns: { flexDirection: "row", gap: 6 },
  quickBtn: { width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center" },

  studentsRow: {
    flexDirection: "row", alignItems: "center", gap: 4,
    marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.border,
  },
  studentsLabel: { fontSize: 12, color: C.textMuted },
  studentsVal: { fontSize: 12, color: C.textSecondary, flex: 1 },

  empty: { alignItems: "center", marginTop: 60, gap: 10 },
  emptyTxt: { fontSize: 15, fontWeight: "700", color: C.textSecondary },
  emptySub: { fontSize: 13, color: C.textMuted, textAlign: "center", lineHeight: 20 },
});

const md = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)" },
  sheet: {
    backgroundColor: C.background, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    maxHeight: "85%",
    shadowColor: "#000", shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.12, shadowRadius: 12, elevation: 10,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: "#DDD",
    alignSelf: "center", marginTop: 10, marginBottom: 4,
  },
  header: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  avatarBox: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  name: { fontSize: 16, fontWeight: "700", color: C.text },
  badge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  badgeTxt: { fontSize: 11, fontWeight: "600" },
  phoneTxt: { fontSize: 12, color: C.textMuted, marginTop: 2 },

  actionRow: { flexDirection: "row", gap: 10, paddingHorizontal: 20, paddingVertical: 12 },
  actionBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, paddingVertical: 12, borderRadius: 12,
  },
  actionTxt: { fontSize: 14, fontWeight: "600" },

  section: { gap: 8 },
  sectionTitle: { fontSize: 12, fontWeight: "700", color: C.textMuted, textTransform: "uppercase"},

  infoCard: {
    backgroundColor: "#fff", borderRadius: 12, padding: 14,
    shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 }, elevation: 1,
  },
  divider: { height: 1, backgroundColor: C.border, marginVertical: 4 },

  studentCard: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: "#fff", borderRadius: 12, padding: 12,
    shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 }, elevation: 1,
  },
  studentBadge: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  studentBadgeTxt: { fontSize: 16, fontWeight: "700" },
  studentName: { fontSize: 14, fontWeight: "600", color: C.text },

  tag: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, backgroundColor: TEAL_BG },
  tagTxt: { fontSize: 11, color: TEAL, fontWeight: "600" },
});
