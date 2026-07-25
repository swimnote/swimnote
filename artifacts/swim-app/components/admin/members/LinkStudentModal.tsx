/**
 * LinkStudentModal.tsx — 관리자 수동 보호자↔학생 연결 모달
 *
 * - 가입 시 입력한 자녀 이름을 검색창에 자동 입력
 * - 학생 이름 / 보호자 이름 / 전화번호 통합 검색
 * - 연결 전 확인 모달 표시
 * - 신규 학생 생성 없이 기존 학생에만 연결
 */
import { AlertCircle, ChevronRight, Link2, Loader, Search, UserCheck, Users, X } from "lucide-react-native";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest } from "@/context/AuthContext";

const C = Colors.light;
const TEAL = "#2EC4B6";
const TEAL_BG = "#E6FAF8";
const TEAL_LIGHT = "#F0FAFA";

interface StudentResult {
  id: string;
  name: string;
  birth_year: number | null;
  status: string;
  level: string | null;
  parent_name: string | null;
  parent_phone_masked: string | null;
  has_phone2: boolean;
  class_name: string | null;
  parent_user_id: string | null;
  linked_count: number;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  parentId: string;
  parentName: string | null;
  initialChildName: string | null;
  token: string | null;
  onLinked: (studentName: string) => void;
}

export function LinkStudentModal({
  visible,
  onClose,
  parentId,
  parentName,
  initialChildName,
  token,
  onLinked,
}: Props) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StudentResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selected, setSelected] = useState<StudentResult | null>(null);
  const [linking, setLinking] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 모달 열릴 때 초기 검색어 세팅
  useEffect(() => {
    if (visible) {
      setQuery(initialChildName || "");
      setResults([]);
      setSelected(null);
      setSearchError(null);
    }
  }, [visible, initialChildName]);

  const doSearch = useCallback(async (q: string) => {
    if (!token) return;
    setSearching(true);
    setSearchError(null);
    try {
      const encoded = encodeURIComponent(q.trim());
      const res = await apiRequest(token, `/admin/students/search?q=${encoded}`);
      const data = await res.json();
      if (data.success) {
        setResults(data.data as StudentResult[]);
      } else {
        setSearchError("검색 중 오류가 발생했습니다.");
      }
    } catch {
      setSearchError("네트워크 오류가 발생했습니다.");
    } finally {
      setSearching(false);
    }
  }, [token]);

  // 검색어 디바운스
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!visible) return;
    debounceRef.current = setTimeout(() => {
      doSearch(query);
    }, 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, visible, doSearch]);

  const handleLink = async () => {
    if (!selected || !token) return;
    setLinking(true);
    try {
      const res = await apiRequest(token, `/admin/parents/${encodeURIComponent(parentId)}/link-student`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ student_id: selected.id }),
      });
      const data = await res.json();
      if (data.success) {
        setSelected(null);
        onLinked(data.student_name || selected.name);
      } else {
        setSearchError(data.error || "연결 중 오류가 발생했습니다.");
        setSelected(null);
      }
    } catch {
      setSearchError("네트워크 오류가 발생했습니다.");
      setSelected(null);
    } finally {
      setLinking(false);
    }
  };

  function maskName(name: string | null) {
    if (!name) return "—";
    if (name.length <= 1) return name;
    return name[0] + "○" + (name.length > 2 ? name.slice(2) : "");
  }

  return (
    <>
      {/* ── 검색 모달 ── */}
      <Modal visible={visible && !selected} animationType="slide" transparent onRequestClose={onClose}>
        <Pressable style={ls.backdrop} onPress={onClose} />
        <View style={[ls.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={ls.handle} />

          {/* 헤더 */}
          <View style={ls.header}>
            <View style={ls.headerIcon}>
              <Link2 size={20} color={TEAL} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={ls.headerTitle}>기존 학생과 연결</Text>
              {parentName && (
                <Text style={ls.headerSub}>{parentName}님을 연결할 학생을 검색하세요</Text>
              )}
            </View>
            <Pressable onPress={onClose} hitSlop={12}>
              <X size={20} color={C.textMuted} />
            </Pressable>
          </View>

          {/* 검색창 */}
          <View style={ls.searchBox}>
            <Search size={15} color={C.textMuted} />
            <TextInput
              style={ls.searchInput}
              placeholder="학생 이름, 보호자 이름, 전화번호 검색"
              placeholderTextColor={C.textMuted}
              value={query}
              onChangeText={setQuery}
              autoFocus
              returnKeyType="search"
              clearButtonMode="while-editing"
            />
            {searching && <ActivityIndicator size="small" color={TEAL} />}
          </View>

          {/* 오류 */}
          {searchError && (
            <View style={ls.errorRow}>
              <AlertCircle size={13} color="#EF4444" />
              <Text style={ls.errorTxt}>{searchError}</Text>
            </View>
          )}

          {/* 결과 */}
          <FlatList
            data={results}
            keyExtractor={item => item.id}
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: 16, gap: 8 }}
            ListEmptyComponent={() =>
              !searching ? (
                <View style={ls.emptyBox}>
                  <Users size={28} color={C.textMuted} style={{ marginBottom: 8 }} />
                  <Text style={ls.emptyTitle}>
                    {query.trim().length > 0 ? "검색 결과가 없습니다" : "학생 이름을 입력하세요"}
                  </Text>
                  <Text style={ls.emptyDesc}>
                    {query.trim().length > 0
                      ? "이름, 보호자 이름, 전화번호로 검색할 수 있습니다"
                      : "가입 시 입력한 자녀 이름이 자동 입력됩니다"}
                  </Text>
                </View>
              ) : null
            }
            renderItem={({ item }) => (
              <Pressable
                style={({ pressed }) => [ls.studentCard, { opacity: pressed ? 0.9 : 1 }]}
                onPress={() => setSelected(item)}
              >
                {/* 좌측: 이름 이니셜 */}
                <View style={[ls.avatar, { backgroundColor: item.parent_user_id ? TEAL_BG : "#F1F5F9" }]}>
                  <Text style={[ls.avatarTxt, { color: item.parent_user_id ? TEAL : "#64748B" }]}>
                    {item.name?.[0] ?? "?"}
                  </Text>
                </View>

                {/* 중앙: 학생 정보 */}
                <View style={{ flex: 1, gap: 3 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text style={ls.studentName}>{item.name}</Text>
                    {item.linked_count > 0 && (
                      <View style={ls.linkedBadge}>
                        <Text style={ls.linkedBadgeTxt}>보호자 {item.linked_count}명</Text>
                      </View>
                    )}
                  </View>
                  <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                    {item.class_name && (
                      <View style={ls.tag}>
                        <Text style={ls.tagTxt}>{item.class_name}</Text>
                      </View>
                    )}
                    {item.level && (
                      <View style={[ls.tag, { backgroundColor: "#FFF3E0" }]}>
                        <Text style={[ls.tagTxt, { color: "#E65100" }]}>{item.level}</Text>
                      </View>
                    )}
                    {item.status !== "active" && (
                      <View style={[ls.tag, { backgroundColor: "#F8D7DA" }]}>
                        <Text style={[ls.tagTxt, { color: "#842029" }]}>{item.status}</Text>
                      </View>
                    )}
                  </View>
                  {(item.parent_name || item.parent_phone_masked) && (
                    <Text style={ls.parentInfo}>
                      보호자 {maskName(item.parent_name)}
                      {item.parent_phone_masked ? ` / ${item.parent_phone_masked}` : ""}
                      {item.has_phone2 ? " 외 1" : ""}
                    </Text>
                  )}
                </View>

                <ChevronRight size={16} color={C.textMuted} />
              </Pressable>
            )}
          />
        </View>
      </Modal>

      {/* ── 연결 확인 모달 ── */}
      <Modal visible={!!selected && !linking} animationType="fade" transparent onRequestClose={() => setSelected(null)}>
        <View style={ls.confirmBackdrop}>
          <View style={ls.confirmBox}>
            <View style={ls.confirmIcon}>
              <UserCheck size={28} color={TEAL} />
            </View>
            <Text style={ls.confirmTitle}>연결하시겠습니까?</Text>
            <Text style={ls.confirmBody}>
              <Text style={{ fontFamily: "Pretendard-SemiBold" }}>{parentName || "이 보호자"}</Text>
              {"님을\n"}
              <Text style={{ fontFamily: "Pretendard-SemiBold" }}>{selected?.name}</Text>
              {" 학생에게 연결합니다.\n\n연결 후 보호자 앱에서 기존 학생의\n수업일지, 출결, 진도 정보를 확인할 수 있습니다."}
            </Text>
            <View style={ls.confirmBtns}>
              <Pressable
                style={[ls.confirmBtn, ls.cancelBtn]}
                onPress={() => setSelected(null)}
              >
                <Text style={ls.cancelBtnTxt}>취소</Text>
              </Pressable>
              <Pressable
                style={[ls.confirmBtn, ls.linkBtn]}
                onPress={handleLink}
              >
                <Text style={ls.linkBtnTxt}>연결</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── 연결 중 오버레이 ── */}
      <Modal visible={linking} transparent animationType="fade">
        <View style={ls.confirmBackdrop}>
          <View style={[ls.confirmBox, { gap: 16, paddingVertical: 32 }]}>
            <ActivityIndicator size="large" color={TEAL} />
            <Text style={{ fontFamily: "Pretendard-Regular", fontSize: 15, color: C.textSecondary }}>
              연결 중...
            </Text>
          </View>
        </View>
      </Modal>
    </>
  );
}

const ls = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    backgroundColor: "#fff",
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    maxHeight: "90%",
    shadowColor: "#000", shadowOffset: { width: 0, height: -2 }, shadowOpacity: 0.12, shadowRadius: 8,
    elevation: 8,
  },
  handle: {
    width: 40, height: 4, backgroundColor: "#DDE3EA",
    borderRadius: 2, alignSelf: "center", marginTop: 12, marginBottom: 4,
  },
  header: {
    flexDirection: "row", alignItems: "center", gap: 10,
    padding: 16, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: "#F1F5F9",
  },
  headerIcon: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: TEAL_LIGHT,
    alignItems: "center", justifyContent: "center",
  },
  headerTitle: { fontFamily: "Pretendard-SemiBold", fontSize: 16, color: C.text },
  headerSub: { fontFamily: "Pretendard-Regular", fontSize: 12, color: C.textSecondary, marginTop: 2 },
  searchBox: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginHorizontal: 16, marginVertical: 12,
    backgroundColor: "#F8FAFC", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    borderWidth: 1, borderColor: "#E2E8F0",
  },
  searchInput: {
    flex: 1, fontFamily: "Pretendard-Regular", fontSize: 14, color: C.text,
    padding: 0,
  },
  errorRow: {
    flexDirection: "row", alignItems: "center", gap: 6,
    marginHorizontal: 16, marginBottom: 8,
  },
  errorTxt: { fontFamily: "Pretendard-Regular", fontSize: 12, color: "#EF4444", flex: 1 },
  emptyBox: { alignItems: "center", paddingVertical: 40, paddingHorizontal: 24 },
  emptyTitle: { fontFamily: "Pretendard-SemiBold", fontSize: 15, color: C.textSecondary, marginBottom: 6 },
  emptyDesc: { fontFamily: "Pretendard-Regular", fontSize: 13, color: C.textMuted, textAlign: "center" },
  studentCard: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "#FAFAFA", borderRadius: 12,
    padding: 14, borderWidth: 1, borderColor: "#F0F2F5",
  },
  avatar: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: "center", justifyContent: "center",
  },
  avatarTxt: { fontFamily: "Pretendard-SemiBold", fontSize: 16 },
  studentName: { fontFamily: "Pretendard-SemiBold", fontSize: 15, color: C.text },
  linkedBadge: {
    backgroundColor: TEAL_BG, borderRadius: 6,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  linkedBadgeTxt: { fontFamily: "Pretendard-Regular", fontSize: 11, color: TEAL },
  tag: {
    backgroundColor: "#F1F5F9", borderRadius: 5,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  tagTxt: { fontFamily: "Pretendard-Regular", fontSize: 11, color: "#475569" },
  parentInfo: { fontFamily: "Pretendard-Regular", fontSize: 12, color: C.textMuted },

  // 확인 모달
  confirmBackdrop: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center", alignItems: "center", padding: 24,
  },
  confirmBox: {
    backgroundColor: "#fff", borderRadius: 20, padding: 24,
    width: "100%", maxWidth: 360, alignItems: "center", gap: 12,
  },
  confirmIcon: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: TEAL_BG, alignItems: "center", justifyContent: "center",
  },
  confirmTitle: { fontFamily: "Pretendard-Bold", fontSize: 18, color: C.text },
  confirmBody: {
    fontFamily: "Pretendard-Regular", fontSize: 14, color: C.textSecondary,
    textAlign: "center", lineHeight: 22,
  },
  confirmBtns: { flexDirection: "row", gap: 10, marginTop: 8, width: "100%" },
  confirmBtn: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: "center" },
  cancelBtn: { backgroundColor: "#F1F5F9" },
  cancelBtnTxt: { fontFamily: "Pretendard-SemiBold", fontSize: 15, color: C.textSecondary },
  linkBtn: { backgroundColor: TEAL },
  linkBtnTxt: { fontFamily: "Pretendard-SemiBold", fontSize: 15, color: "#fff" },
});
