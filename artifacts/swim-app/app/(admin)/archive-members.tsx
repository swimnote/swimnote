/**
 * (admin)/archive-members.tsx — 지난 회원 (퇴원 Archive) 목록/상세/일지/연결
 *
 * pool_admin: 목록 조회 + 지난 회원 상세 + 수동 연결
 * teacher   : 목록 조회 + 지난 회원 상세 (연결 UI 없음)
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, FlatList, Modal, Pressable,
  RefreshControl, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { ConfirmModal } from "@/components/common/ConfirmModal";
import { LucideIcon } from "@/components/common/LucideIcon";

const C = Colors.light;

// ── Types ────────────────────────────────────────────────────────────────────

interface ArchiveMember {
  id: string;
  original_student_id: string;
  student_name: string;
  birth_year?: string | null;
  last_class_name?: string | null;
  last_level_order?: number | null;
  withdrawn_at: string;
  withdrawn_by_name?: string | null;
  created_at: string;
}

interface ArchiveDiary {
  id: string;
  original_diary_id: string;
  lesson_date: string;
  former_class_name?: string | null;
  former_teacher_name?: string | null;
  common_content?: string | null;
  student_note?: string | null;
  is_makeup_diary: boolean;
  source_type: string;
}

interface StudentCandidate {
  id: string;
  name: string;
  birth_year?: number | null;
  status: string;
  class_group_name?: string | null;
}

function fmtDate(d?: string | null) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });
}

// ── Main Screen ──────────────────────────────────────────────────────────────

export default function ArchiveMembersScreen() {
  const { token, role } = useAuth();
  const { themeColor } = useBrand();
  const insets = useSafeAreaInsets();
  const isAdmin = role === "pool_admin" || role === "super_admin";

  // list state
  const [members, setMembers] = useState<ArchiveMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");

  // detail modal
  const [detail, setDetail] = useState<ArchiveMember | null>(null);
  const [diaries, setDiaries] = useState<ArchiveDiary[]>([]);
  const [diaryLoading, setDiaryLoading] = useState(false);
  const [activeLink, setActiveLink] = useState<any | null>(null);

  // link modal (관리자 전용)
  const [showLinkSearch, setShowLinkSearch] = useState(false);
  const [linkSearch, setLinkSearch] = useState("");
  const [linkCandidates, setLinkCandidates] = useState<StudentCandidate[]>([]);
  const [linkLoading, setLinkLoading] = useState(false);
  const [linkCandidate, setLinkCandidate] = useState<StudentCandidate | null>(null);
  const [linkConfirm, setLinkConfirm] = useState<any | null>(null); // compare info
  const [linking, setLinking] = useState(false);
  const [unlinkTarget, setUnlinkTarget] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // load list
  const load = useCallback(async (q?: string) => {
    setLoading(true);
    try {
      const qs = q ? `?search=${encodeURIComponent(q)}&limit=100` : "?limit=100";
      const res = await apiRequest(token, `/admin/archives${qs}`);
      if (res.ok) {
        const data = await res.json();
        setMembers(data.items ?? []);
      }
    } catch { /* ignore */ } finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const handleSearch = useCallback(() => { load(search.trim() || undefined); }, [load, search]);

  // open detail
  const openDetail = useCallback(async (m: ArchiveMember) => {
    setDetail(m);
    setDiaries([]);
    setActiveLink(null);
    setDiaryLoading(true);
    try {
      const [det, dias] = await Promise.all([
        apiRequest(token, `/admin/archives/${m.id}`).then(r => r.ok ? r.json() : null),
        apiRequest(token, `/admin/archives/${m.id}/diaries`).then(r => r.ok ? r.json() : []),
      ]);
      if (det) setActiveLink(det.active_link ?? null);
      setDiaries(dias ?? []);
    } catch { /* ignore */ } finally { setDiaryLoading(false); }
  }, [token]);

  // link candidate search
  const searchLinkCandidates = useCallback(async (q: string) => {
    if (!q.trim()) { setLinkCandidates([]); return; }
    setLinkLoading(true);
    try {
      const res = await apiRequest(token, `/admin/students?search=${encodeURIComponent(q)}&status=active,suspended&limit=20`);
      if (res.ok) {
        const data = await res.json();
        setLinkCandidates(data.students ?? data ?? []);
      }
    } catch { /* ignore */ } finally { setLinkLoading(false); }
  }, [token]);

  const confirmLink = useCallback(async (candidate: StudentCandidate) => {
    if (!detail) return;
    setLinkCandidate(candidate);
    try {
      const res = await apiRequest(token, `/admin/archive-link-candidates?archive_id=${detail.id}&student_id=${candidate.id}`);
      if (res.ok) {
        const data = await res.json();
        setLinkConfirm(data);
      }
    } catch { /* ignore */ }
  }, [token, detail]);

  const doLink = useCallback(async () => {
    if (!detail || !linkCandidate) return;
    setLinking(true);
    try {
      const res = await apiRequest(token, "/admin/archive-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archive_member_id: detail.id, current_student_id: linkCandidate.id }),
      });
      if (res.ok) {
        const data = await res.json();
        setActiveLink({ id: data.id, current_student_name: data.current_name, current_student_id: data.current_student_id, linked_at: new Date().toISOString() });
        setShowLinkSearch(false);
        setLinkSearch("");
        setLinkCandidates([]);
        setLinkCandidate(null);
        setLinkConfirm(null);
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || "연결 실패");
      }
    } catch { alert("네트워크 오류"); } finally { setLinking(false); }
  }, [token, detail, linkCandidate]);

  const doUnlink = useCallback(async () => {
    if (!unlinkTarget) return;
    setSaving(true);
    try {
      const res = await apiRequest(token, `/admin/archive-links/${unlinkTarget}`, { method: "DELETE" });
      if (res.ok) { setActiveLink(null); }
    } catch { /* ignore */ } finally { setSaving(false); setUnlinkTarget(null); }
  }, [token, unlinkTarget]);

  // ── Render helpers ──────────────────────────────────────────────────────
  const renderDiary = ({ item }: { item: ArchiveDiary }) => (
    <View style={styles.diaryCard}>
      <View style={styles.diaryHeader}>
        <Text style={styles.diaryDate}>{item.lesson_date}</Text>
        {item.is_makeup_diary && (
          <View style={styles.makeupBadge}><Text style={styles.makeupBadgeText}>보강</Text></View>
        )}
      </View>
      {!!item.former_class_name && (
        <Text style={styles.diaryMeta}>반: {item.former_class_name} · 선생님: {item.former_teacher_name ?? "-"}</Text>
      )}
      {!!item.common_content && (
        <Text style={styles.diaryContent}>{item.common_content}</Text>
      )}
      {!!item.student_note && (
        <View style={styles.noteBox}>
          <Text style={styles.noteLabel}>개별 피드백</Text>
          <Text style={styles.noteContent}>{item.student_note}</Text>
        </View>
      )}
    </View>
  );

  const renderMember = ({ item }: { item: ArchiveMember }) => (
    <Pressable style={styles.memberRow} onPress={() => openDetail(item)}>
      <View style={{ flex: 1 }}>
        <Text style={styles.memberName}>{item.student_name}</Text>
        <Text style={styles.memberMeta}>
          {item.last_class_name ? `${item.last_class_name} · ` : ""}
          퇴원 {fmtDate(item.withdrawn_at)}
        </Text>
      </View>
      <LucideIcon name="ChevronRight" size={18} color={C.subtext} />
    </Pressable>
  );

  // phone match label
  const phoneMatchLabel = (match: boolean | null) => {
    if (match === true) return "일치";
    if (match === false) return "불일치";
    return "확인불가";
  };
  const phoneMatchColor = (match: boolean | null) => {
    if (match === true) return "#16A34A";
    if (match === false) return "#DC2626";
    return C.subtext;
  };

  // ── Main render ─────────────────────────────────────────────────────────
  return (
    <View style={[styles.root, { paddingBottom: insets.bottom }]}>
      <SubScreenHeader title="지난 회원" onBack={() => {}} />

      {/* Search */}
      <View style={styles.searchBar}>
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="이름 검색"
          placeholderTextColor={C.subtext}
          returnKeyType="search"
          onSubmitEditing={handleSearch}
        />
        <Pressable style={[styles.searchBtn, { backgroundColor: themeColor }]} onPress={handleSearch}>
          <LucideIcon name="Search" size={16} color="#fff" />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={themeColor} /></View>
      ) : (
        <FlatList
          data={members}
          keyExtractor={m => m.id}
          renderItem={renderMember}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(search.trim() || undefined); }} />}
          ListEmptyComponent={<View style={styles.center}><Text style={styles.emptyText}>지난 회원이 없습니다.</Text></View>}
          contentContainerStyle={{ paddingVertical: 8 }}
        />
      )}

      {/* Detail Modal */}
      <Modal visible={!!detail} animationType="slide" onRequestClose={() => setDetail(null)}>
        <View style={[styles.root, { paddingBottom: insets.bottom }]}>
          <SubScreenHeader title={detail?.student_name ?? "지난 회원"} onBack={() => setDetail(null)} />
          <ScrollView contentContainerStyle={{ padding: 16 }}>
            {/* 회원 정보 */}
            <View style={styles.infoCard}>
              <Text style={styles.sectionTitle}>회원 정보</Text>
              {detail?.last_class_name && <Row label="마지막 반" value={detail.last_class_name} />}
              {detail?.birth_year && <Row label="출생연도" value={String(detail.birth_year)} />}
              <Row label="퇴원일" value={fmtDate(detail?.withdrawn_at)} />
              {detail?.withdrawn_by_name && <Row label="처리자" value={detail.withdrawn_by_name} />}
            </View>

            {/* 연결 섹션 (관리자) */}
            {isAdmin && (
              <View style={styles.infoCard}>
                <Text style={styles.sectionTitle}>현재 회원 연결</Text>
                {activeLink ? (
                  <View>
                    <Text style={styles.linkName}>{activeLink.current_student_name}</Text>
                    <Text style={styles.linkMeta}>연결일: {fmtDate(activeLink.linked_at)}</Text>
                    <Pressable
                      style={[styles.unlinkBtn]}
                      onPress={() => setUnlinkTarget(activeLink.id)}
                    >
                      <Text style={styles.unlinkBtnText}>연결 해제</Text>
                    </Pressable>
                  </View>
                ) : (
                  <Pressable
                    style={[styles.linkBtn, { backgroundColor: themeColor }]}
                    onPress={() => { setShowLinkSearch(true); setLinkSearch(""); setLinkCandidates([]); setLinkCandidate(null); setLinkConfirm(null); }}
                  >
                    <Text style={styles.linkBtnText}>현재 회원과 연결</Text>
                  </Pressable>
                )}
              </View>
            )}

            {/* 지난 일지 */}
            <Text style={[styles.sectionTitle, { marginTop: 8, marginBottom: 8 }]}>
              지난 수업일지 ({diaries.length}건)
            </Text>
            {diaryLoading ? (
              <ActivityIndicator color={themeColor} style={{ marginTop: 20 }} />
            ) : diaries.length === 0 ? (
              <Text style={styles.emptyText}>저장된 수업일지가 없습니다.</Text>
            ) : (
              diaries.map(d => <View key={d.id}>{renderDiary({ item: d })}</View>)
            )}
          </ScrollView>
        </View>
      </Modal>

      {/* Link Search Modal */}
      <Modal visible={showLinkSearch} animationType="slide" onRequestClose={() => setShowLinkSearch(false)}>
        <View style={[styles.root, { paddingBottom: insets.bottom }]}>
          <SubScreenHeader title="현재 회원 검색" onBack={() => setShowLinkSearch(false)} />
          <View style={styles.searchBar}>
            <TextInput
              style={styles.searchInput}
              value={linkSearch}
              onChangeText={setLinkSearch}
              placeholder="이름 검색"
              placeholderTextColor={C.subtext}
              returnKeyType="search"
              onSubmitEditing={() => searchLinkCandidates(linkSearch)}
              autoFocus
            />
            <Pressable
              style={[styles.searchBtn, { backgroundColor: themeColor }]}
              onPress={() => searchLinkCandidates(linkSearch)}
            >
              <LucideIcon name="Search" size={16} color="#fff" />
            </Pressable>
          </View>
          {linkLoading ? (
            <ActivityIndicator color={themeColor} style={{ margin: 20 }} />
          ) : (
            <FlatList
              data={linkCandidates}
              keyExtractor={c => c.id}
              renderItem={({ item }) => (
                <Pressable style={styles.memberRow} onPress={() => confirmLink(item)}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.memberName}>{item.name}</Text>
                    {item.birth_year && <Text style={styles.memberMeta}>{item.birth_year}년생</Text>}
                  </View>
                  <LucideIcon name="ChevronRight" size={18} color={C.subtext} />
                </Pressable>
              )}
              ListEmptyComponent={<View style={styles.center}><Text style={styles.emptyText}>검색 결과가 없습니다.</Text></View>}
            />
          )}
        </View>
      </Modal>

      {/* Link Confirm Modal */}
      {linkConfirm && linkCandidate && detail && (
        <Modal visible animationType="fade" transparent onRequestClose={() => { setLinkCandidate(null); setLinkConfirm(null); }}>
          <View style={styles.overlay}>
            <View style={styles.confirmCard}>
              <Text style={styles.confirmTitle}>연결 확인</Text>
              <View style={styles.compareRow}>
                <View style={styles.compareCol}>
                  <Text style={styles.compareLabel}>지난 회원</Text>
                  <Text style={styles.compareName}>{linkConfirm.archive?.student_name}</Text>
                  {linkConfirm.archive?.birth_year && <Text style={styles.compareMeta}>{linkConfirm.archive.birth_year}년생</Text>}
                  <Text style={styles.compareMeta}>퇴원 {fmtDate(linkConfirm.archive?.withdrawn_at)}</Text>
                </View>
                <View style={styles.compareCol}>
                  <Text style={styles.compareLabel}>현재 회원</Text>
                  <Text style={styles.compareName}>{linkConfirm.current?.name}</Text>
                  {linkConfirm.current?.birth_year && <Text style={styles.compareMeta}>{linkConfirm.current.birth_year}년생</Text>}
                </View>
              </View>
              <View style={styles.phoneMatchRow}>
                <Text style={styles.phoneMatchLabel}>전화번호:</Text>
                <Text style={[styles.phoneMatchValue, { color: phoneMatchColor(linkConfirm.phone_match) }]}>
                  {phoneMatchLabel(linkConfirm.phone_match)}
                </Text>
              </View>
              <View style={styles.confirmActions}>
                <Pressable style={styles.cancelBtn} onPress={() => { setLinkCandidate(null); setLinkConfirm(null); }}>
                  <Text style={styles.cancelBtnText}>취소</Text>
                </Pressable>
                <Pressable
                  style={[styles.doLinkBtn, { backgroundColor: themeColor }]}
                  onPress={doLink}
                  disabled={linking}
                >
                  {linking ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.doLinkBtnText}>연결</Text>}
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* Unlink Confirm */}
      <ConfirmModal
        visible={!!unlinkTarget}
        title="연결 해제"
        message="현재 회원과의 연결을 해제합니다. Archive 원본은 유지됩니다."
        confirmText="해제"
        cancelText="취소"
        onConfirm={doUnlink}
        onCancel={() => setUnlinkTarget(null)}
        loading={saving}
        danger
      />
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  searchBar: { flexDirection: "row", padding: 12, gap: 8 },
  searchInput: {
    flex: 1, height: 40, borderRadius: 8, borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 12, backgroundColor: C.card, color: C.text, fontSize: 14,
  },
  searchBtn: { width: 40, height: 40, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  emptyText: { color: C.subtext, fontSize: 14, textAlign: "center" },
  memberRow: {
    flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14,
    backgroundColor: C.card, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.border,
  },
  memberName: { fontSize: 15, fontWeight: "600", color: C.text },
  memberMeta: { fontSize: 12, color: C.subtext, marginTop: 2 },
  infoCard: {
    backgroundColor: C.card, borderRadius: 12, padding: 16, marginBottom: 12,
    borderWidth: StyleSheet.hairlineWidth, borderColor: C.border,
  },
  sectionTitle: { fontSize: 14, fontWeight: "700", color: C.text, marginBottom: 10 },
  row: { flexDirection: "row", marginBottom: 6 },
  rowLabel: { width: 80, fontSize: 13, color: C.subtext },
  rowValue: { flex: 1, fontSize: 13, color: C.text },
  linkBtn: { borderRadius: 8, paddingVertical: 10, alignItems: "center", marginTop: 4 },
  linkBtnText: { color: "#fff", fontWeight: "600", fontSize: 14 },
  linkName: { fontSize: 15, fontWeight: "600", color: C.text },
  linkMeta: { fontSize: 12, color: C.subtext, marginTop: 2 },
  unlinkBtn: {
    marginTop: 10, borderRadius: 8, paddingVertical: 8, alignItems: "center",
    borderWidth: 1, borderColor: "#DC2626",
  },
  unlinkBtnText: { color: "#DC2626", fontWeight: "600", fontSize: 13 },
  diaryCard: {
    backgroundColor: "#F8F9FA", borderRadius: 8, padding: 12, marginBottom: 8,
    borderWidth: StyleSheet.hairlineWidth, borderColor: C.border,
  },
  diaryHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  diaryDate: { fontSize: 13, fontWeight: "600", color: C.text },
  makeupBadge: { backgroundColor: "#EEF2FF", borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  makeupBadgeText: { fontSize: 10, color: "#4F46E5", fontWeight: "600" },
  diaryMeta: { fontSize: 12, color: C.subtext, marginBottom: 4 },
  diaryContent: { fontSize: 13, color: C.text, lineHeight: 20 },
  noteBox: { marginTop: 8, backgroundColor: "#FFF7ED", borderRadius: 6, padding: 8 },
  noteLabel: { fontSize: 11, color: "#92400E", fontWeight: "600", marginBottom: 2 },
  noteContent: { fontSize: 13, color: C.text, lineHeight: 19 },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", alignItems: "center" },
  confirmCard: {
    width: "88%", backgroundColor: "#fff", borderRadius: 16, padding: 20,
    shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 20, elevation: 8,
  },
  confirmTitle: { fontSize: 16, fontWeight: "700", color: C.text, marginBottom: 16 },
  compareRow: { flexDirection: "row", gap: 16, marginBottom: 12 },
  compareCol: { flex: 1 },
  compareLabel: { fontSize: 11, color: C.subtext, fontWeight: "600", marginBottom: 4 },
  compareName: { fontSize: 15, fontWeight: "700", color: C.text },
  compareMeta: { fontSize: 12, color: C.subtext, marginTop: 2 },
  phoneMatchRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 16 },
  phoneMatchLabel: { fontSize: 13, color: C.text },
  phoneMatchValue: { fontSize: 13, fontWeight: "700" },
  confirmActions: { flexDirection: "row", gap: 10 },
  cancelBtn: { flex: 1, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: C.border, alignItems: "center" },
  cancelBtnText: { fontSize: 14, color: C.text },
  doLinkBtn: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: "center" },
  doLinkBtnText: { fontSize: 14, color: "#fff", fontWeight: "600" },
});
