/**
 * (super)/pool-notices.tsx — 슈퍼관리자 수영장별 공지사항 관리
 *
 * 구조:
 *  - 수영장 선택 드롭다운
 *  - 공지 목록 (제목·수영장·작성일·상태·푸시 발송 여부)
 *  - 공지 등록 모달 (저장 즉시 수영장 전체 사용자에게 자동 푸시)
 *  - 공지 수정·삭제·숨김 처리
 *
 * 푸시 발송 대상: 해당 수영장 관리자·선생님·학부모 전체
 * 공지 저장 먼저 성공 → 푸시는 비동기 (일부 실패해도 공지 저장 유지)
 */
import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, FlatList, Modal, Pressable, RefreshControl,
  ScrollView, StyleSheet, Switch, Text, TextInput, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { apiRequest, useAuth } from "@/context/AuthContext";

const P = "#7C3AED";
const TEAL = "#1F8F86";
const RED = "#D96C6C";
const AMBER = "#D97706";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "";

// ── 타입 ─────────────────────────────────────────────────────────────────────

interface Pool {
  id: string;
  name: string;
  address?: string;
  is_active?: boolean;
}

interface PoolNotice {
  id: string;
  title: string;
  content: string;
  swimming_pool_id: string;
  author_name: string;
  is_pinned: boolean;
  created_at: string;
  updated_at?: string;
  push_sent_at?: string | null;
  push_sent_count?: number;
}

// ── 상태·날짜 유틸 ────────────────────────────────────────────────────────────

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

// ── 공지 카드 ─────────────────────────────────────────────────────────────────

function NoticeRow({
  notice, poolName, onEdit, onDelete,
}: {
  notice: PoolNotice; poolName: string; onEdit: (n: PoolNotice) => void; onDelete: (id: string) => void;
}) {
  const pushed = !!notice.push_sent_at;
  const pushCount = notice.push_sent_count ?? 0;

  return (
    <Pressable style={r.row} onPress={() => onEdit(notice)}>
      <View style={r.main}>
        <View style={r.top}>
          {notice.is_pinned && (
            <View style={r.pinBadge}><Feather name="bookmark" size={9} color="#7C3AED" /><Text style={r.pinTxt}>고정</Text></View>
          )}
          <Text style={r.title} numberOfLines={1}>{notice.title}</Text>
        </View>
        <View style={r.meta}>
          <Text style={r.poolName}>{poolName}</Text>
          <Text style={r.dot}>·</Text>
          <Text style={r.date}>{fmtDate(notice.created_at)}</Text>
        </View>
        <View style={r.pushRow}>
          <View style={[r.pushBadge, pushed ? r.pushSent : r.pushNot]}>
            <Feather name={pushed ? "send" : "minus-circle"} size={9} color={pushed ? TEAL : "#9A948F"} />
            <Text style={[r.pushTxt, { color: pushed ? TEAL : "#9A948F" }]}>
              {pushed ? `발송완료 (${pushCount}회)` : "미발송"}
            </Text>
          </View>
          {pushed && <Text style={r.pushDate}>{fmtDate(notice.push_sent_at)}</Text>}
        </View>
      </View>
      <View style={r.actions}>
        <Pressable style={r.editBtn} onPress={() => onEdit(notice)} hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}>
          <Feather name="edit-2" size={14} color={P} />
        </Pressable>
        <Pressable style={r.delBtn} onPress={() => onDelete(notice.id)} hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}>
          <Feather name="trash-2" size={14} color={RED} />
        </Pressable>
      </View>
    </Pressable>
  );
}

const r = StyleSheet.create({
  row:       { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", paddingHorizontal: 16, paddingVertical: 14, gap: 10 },
  main:      { flex: 1, gap: 4 },
  top:       { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  title:     { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#1F1F1F", flex: 1 },
  meta:      { flexDirection: "row", alignItems: "center", gap: 4 },
  poolName:  { fontSize: 11, fontFamily: "Inter_600SemiBold", color: P },
  dot:       { fontSize: 10, color: "#D1D5DB" },
  date:      { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9A948F" },
  pushRow:   { flexDirection: "row", alignItems: "center", gap: 6 },
  pushBadge: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  pushSent:  { backgroundColor: "#DDF2EF" },
  pushNot:   { backgroundColor: "#F6F3F1" },
  pushTxt:   { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  pushDate:  { fontSize: 10, fontFamily: "Inter_400Regular", color: "#9A948F" },
  pinBadge:  { flexDirection: "row", alignItems: "center", gap: 2, backgroundColor: "#EEDDF5", paddingHorizontal: 5, paddingVertical: 2, borderRadius: 5 },
  pinTxt:    { fontSize: 9, fontFamily: "Inter_600SemiBold", color: P },
  actions:   { flexDirection: "row", gap: 8 },
  editBtn:   { width: 32, height: 32, borderRadius: 8, backgroundColor: "#EEDDF5", alignItems: "center", justifyContent: "center" },
  delBtn:    { width: 32, height: 32, borderRadius: 8, backgroundColor: "#F9DEDA", alignItems: "center", justifyContent: "center" },
});

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

export default function PoolNoticesScreen() {
  const { token } = useAuth();

  const [pools, setPools]             = useState<Pool[]>([]);
  const [poolsLoading, setPoolsLoading] = useState(true);
  const [selectedPool, setSelectedPool] = useState<Pool | null>(null);
  const [showPoolPicker, setShowPoolPicker] = useState(false);
  const [poolSearch, setPoolSearch]   = useState("");

  const [notices, setNotices]         = useState<PoolNotice[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [refreshing, setRefreshing]   = useState(false);

  const [editNotice, setEditNotice]   = useState<PoolNotice | null>(null);
  const [showForm, setShowForm]       = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const [form, setForm] = useState({
    title: "", content: "", is_pinned: false, send_push: true,
  });
  const [saving, setSaving]   = useState(false);
  const [formError, setFormError] = useState("");

  // ── 풀 목록 로드 ─────────────────────────────────────────────────────────
  useEffect(() => {
    fetchPools();
  }, []);

  async function fetchPools() {
    setPoolsLoading(true);
    try {
      const res = await apiRequest(token, "/pools/search?q=&limit=200");
      if (res.ok) {
        const data = await res.json();
        const list: Pool[] = Array.isArray(data) ? data :
          Array.isArray(data.pools) ? data.pools :
          Array.isArray(data.items) ? data.items : [];
        setPools(list);
        if (list.length > 0 && !selectedPool) setSelectedPool(list[0]);
      }
    } catch { } finally { setPoolsLoading(false); }
  }

  // ── 공지 목록 로드 ───────────────────────────────────────────────────────
  const fetchNotices = useCallback(async (poolId?: string) => {
    const pid = poolId ?? selectedPool?.id;
    if (!pid) return;
    setListLoading(true);
    try {
      const res = await apiRequest(token, `/notices?pool_id=${pid}`);
      if (res.ok) {
        const data = await res.json();
        setNotices(Array.isArray(data) ? data : []);
      } else {
        setNotices([]);
      }
    } catch { setNotices([]); } finally { setListLoading(false); setRefreshing(false); }
  }, [selectedPool, token]);

  useEffect(() => {
    if (selectedPool) fetchNotices(selectedPool.id);
  }, [selectedPool]);

  // ── 공지 등록 / 수정 ─────────────────────────────────────────────────────
  function openCreate() {
    setEditNotice(null);
    setForm({ title: "", content: "", is_pinned: false, send_push: true });
    setFormError("");
    setShowForm(true);
  }

  function openEdit(n: PoolNotice) {
    setEditNotice(n);
    setForm({ title: n.title, content: n.content, is_pinned: n.is_pinned, send_push: false });
    setFormError("");
    setShowForm(true);
  }

  async function handleSave() {
    if (!form.title.trim()) { setFormError("제목을 입력해주세요."); return; }
    if (!form.content.trim()) { setFormError("내용을 입력해주세요."); return; }
    if (!selectedPool) { setFormError("수영장을 선택해주세요."); return; }

    setSaving(true);
    setFormError("");
    try {
      if (editNotice) {
        // 수정
        const res = await apiRequest(token, `/notices/${editNotice.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: form.title,
            content: form.content,
            is_pinned: form.is_pinned,
            resend_push: form.send_push,
          }),
        });
        if (!res.ok) {
          const d = await res.json();
          setFormError(d.message || "수정 실패");
          return;
        }
      } else {
        // 등록 — 저장 즉시 해당 수영장 전체 사용자에게 자동 푸시
        const res = await apiRequest(token, "/notices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: form.title,
            content: form.content,
            is_pinned: form.is_pinned,
            pool_id: selectedPool.id,
            notice_type: "general",
          }),
        });
        if (!res.ok) {
          const d = await res.json();
          setFormError(d.message || "등록 실패");
          return;
        }
      }
      setShowForm(false);
      fetchNotices(selectedPool.id);
    } catch { setFormError("네트워크 오류가 발생했습니다."); }
    finally { setSaving(false); }
  }

  // ── 공지 삭제 ────────────────────────────────────────────────────────────
  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await apiRequest(token, `/notices/${deleteTarget}`, { method: "DELETE" });
      setDeleteTarget(null);
      fetchNotices();
    } catch { }
  }

  // ── 풀 피커 필터 ─────────────────────────────────────────────────────────
  const filteredPools = pools.filter(p =>
    !poolSearch.trim() || p.name.includes(poolSearch.trim())
  );

  // ── 렌더 ─────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="공지사항 관리" homePath="/(super)/dashboard" />

      {/* 안내 배너 */}
      <View style={s.banner}>
        <Feather name="info" size={12} color={TEAL} />
        <Text style={s.bannerTxt}>
          공지 등록 시 해당 수영장 관리자·선생님·학부모 전체에 자동 푸시 발송됩니다.
        </Text>
      </View>

      {/* 수영장 선택 */}
      <View style={s.poolBar}>
        <Pressable style={s.poolSelect} onPress={() => setShowPoolPicker(true)}>
          <Feather name="home" size={14} color={P} />
          <Text style={s.poolSelectTxt} numberOfLines={1}>
            {poolsLoading ? "수영장 로딩 중…" : (selectedPool?.name ?? "수영장 선택")}
          </Text>
          <Feather name="chevron-down" size={14} color="#9A948F" />
        </Pressable>
        <Pressable style={s.addBtn} onPress={openCreate}>
          <Feather name="plus" size={16} color="#fff" />
          <Text style={s.addBtnTxt}>공지 등록</Text>
        </Pressable>
      </View>

      {/* 공지 목록 */}
      {listLoading && !refreshing ? (
        <View style={s.center}><ActivityIndicator color={P} /></View>
      ) : (
        <FlatList
          style={s.list}
          data={notices}
          keyExtractor={n => n.id}
          renderItem={({ item }) => (
            <NoticeRow
              notice={item}
              poolName={selectedPool?.name ?? ""}
              onEdit={openEdit}
              onDelete={setDeleteTarget}
            />
          )}
          ItemSeparatorComponent={() => <View style={s.sep} />}
          refreshControl={
            <RefreshControl refreshing={refreshing} tintColor={P}
              onRefresh={() => { setRefreshing(true); fetchNotices(); }} />
          }
          ListEmptyComponent={
            <View style={s.empty}>
              <Feather name="bell-off" size={32} color="#D1D5DB" />
              <Text style={s.emptyTxt}>{selectedPool ? "등록된 공지가 없습니다" : "수영장을 선택해주세요"}</Text>
            </View>
          }
          contentContainerStyle={{ paddingBottom: 80 }}
        />
      )}

      {/* 수영장 선택 모달 */}
      <Modal visible={showPoolPicker} animationType="slide" transparent statusBarTranslucent
        onRequestClose={() => setShowPoolPicker(false)}>
        <Pressable style={pm.backdrop} onPress={() => setShowPoolPicker(false)}>
          <Pressable style={pm.sheet} onPress={() => {}}>
            <View style={pm.handle} />
            <Text style={pm.title}>수영장 선택</Text>
            <TextInput style={pm.search} value={poolSearch} onChangeText={setPoolSearch}
              placeholder="수영장 이름 검색" placeholderTextColor="#9A948F" />
            <ScrollView showsVerticalScrollIndicator={false}>
              {filteredPools.map(p => (
                <Pressable key={p.id} style={[pm.item, selectedPool?.id === p.id && pm.itemActive]}
                  onPress={() => { setSelectedPool(p); setShowPoolPicker(false); setPoolSearch(""); }}>
                  <Feather name="home" size={14} color={selectedPool?.id === p.id ? P : "#9A948F"} />
                  <View style={{ flex: 1 }}>
                    <Text style={[pm.itemName, selectedPool?.id === p.id && { color: P }]}>{p.name}</Text>
                    {p.address ? <Text style={pm.itemAddr} numberOfLines={1}>{p.address}</Text> : null}
                  </View>
                  {selectedPool?.id === p.id && <Feather name="check" size={14} color={P} />}
                </Pressable>
              ))}
              {filteredPools.length === 0 && (
                <Text style={pm.empty}>검색 결과 없음</Text>
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* 등록/수정 모달 */}
      <Modal visible={showForm} animationType="slide" transparent statusBarTranslucent
        onRequestClose={() => setShowForm(false)}>
        <Pressable style={fm.backdrop} onPress={() => setShowForm(false)}>
          <Pressable style={fm.sheet} onPress={() => {}}>
            <View style={fm.handle} />
            <Text style={fm.title}>{editNotice ? "공지 수정" : "공지 등록"}</Text>

            {selectedPool && (
              <View style={fm.poolTag}>
                <Feather name="home" size={11} color={P} />
                <Text style={fm.poolTagTxt}>{selectedPool.name}</Text>
              </View>
            )}

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
              <View>
                <Text style={fm.label}>제목 *</Text>
                <TextInput style={fm.input} value={form.title}
                  onChangeText={v => setForm(f => ({ ...f, title: v }))}
                  placeholder="공지 제목" placeholderTextColor="#9A948F" />
              </View>
              <View>
                <Text style={fm.label}>내용 *</Text>
                <TextInput style={[fm.input, { minHeight: 100 }]} value={form.content}
                  onChangeText={v => setForm(f => ({ ...f, content: v }))}
                  multiline placeholder="공지 내용" placeholderTextColor="#9A948F"
                  textAlignVertical="top" />
              </View>

              <View style={fm.switchRow}>
                <View style={{ flex: 1 }}>
                  <Text style={fm.label}>상단 고정</Text>
                  <Text style={fm.hint}>목록 최상단에 고정됩니다</Text>
                </View>
                <Switch value={form.is_pinned}
                  onValueChange={v => setForm(f => ({ ...f, is_pinned: v }))}
                  trackColor={{ true: P }} />
              </View>

              {editNotice ? (
                <View style={fm.switchRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={fm.label}>수정 후 푸시 재발송</Text>
                    <Text style={fm.hint}>수영장 전체 사용자에게 재발송합니다</Text>
                  </View>
                  <Switch value={form.send_push}
                    onValueChange={v => setForm(f => ({ ...f, send_push: v }))}
                    trackColor={{ true: TEAL }} />
                </View>
              ) : (
                <View style={fm.infoBanner}>
                  <Feather name="send" size={12} color={TEAL} />
                  <Text style={fm.infoBannerTxt}>
                    등록 즉시 수영장 전체 사용자에게 자동으로 푸시가 발송됩니다.
                  </Text>
                </View>
              )}

              {formError ? <Text style={fm.error}>{formError}</Text> : null}

              <View style={fm.btnRow}>
                <Pressable style={fm.cancelBtn} onPress={() => setShowForm(false)}>
                  <Text style={fm.cancelTxt}>취소</Text>
                </Pressable>
                <Pressable
                  style={[fm.saveBtn, { opacity: saving ? 0.6 : 1 }]}
                  onPress={handleSave} disabled={saving}>
                  {saving
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={fm.saveTxt}>{editNotice ? "저장" : "등록"}</Text>}
                </Pressable>
              </View>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* 삭제 확인 모달 */}
      <Modal visible={!!deleteTarget} animationType="fade" transparent statusBarTranslucent
        onRequestClose={() => setDeleteTarget(null)}>
        <View style={dm.overlay}>
          <View style={dm.card}>
            <Text style={dm.title}>공지 삭제</Text>
            <Text style={dm.body}>이 공지를 삭제하시겠습니까? 삭제된 공지는 복구되지 않습니다.</Text>
            <View style={dm.btnRow}>
              <Pressable style={dm.cancelBtn} onPress={() => setDeleteTarget(null)}>
                <Text style={dm.cancelTxt}>취소</Text>
              </Pressable>
              <Pressable style={dm.delBtn} onPress={handleDelete}>
                <Text style={dm.delTxt}>삭제</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ── 스타일 ─────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe:     { flex: 1, backgroundColor: "#EEDDF5" },
  banner:   { flexDirection: "row", gap: 8, alignItems: "flex-start", backgroundColor: "#DDF2EF",
              paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#A7F3D0" },
  bannerTxt:{ fontSize: 12, fontFamily: "Inter_400Regular", color: "#1F8F86", flex: 1, lineHeight: 18 },
  poolBar:  { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 10,
              backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E9E2DD" },
  poolSelect:{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8,
               backgroundColor: "#F6F3F1", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  poolSelectTxt:{ flex: 1, fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#1F1F1F" },
  addBtn:   { flexDirection: "row", alignItems: "center", gap: 5,
              backgroundColor: P, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10 },
  addBtnTxt:{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#fff" },
  list:     { flex: 1, backgroundColor: "#F6F3F1" },
  sep:      { height: 1, backgroundColor: "#F6F3F1" },
  center:   { flex: 1, alignItems: "center", justifyContent: "center" },
  empty:    { alignItems: "center", paddingTop: 60, gap: 10 },
  emptyTxt: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#9A948F" },
});

const pm = StyleSheet.create({
  backdrop:  { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet:     { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "#fff",
               borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 40, maxHeight: "70%" },
  handle:    { width: 36, height: 4, borderRadius: 2, backgroundColor: "#D1D5DB", alignSelf: "center", marginBottom: 16 },
  title:     { fontSize: 17, fontFamily: "Inter_700Bold", color: "#1F1F1F", marginBottom: 12 },
  search:    { borderWidth: 1.5, borderColor: "#E9E2DD", borderRadius: 10, padding: 10, marginBottom: 12,
               fontSize: 14, fontFamily: "Inter_400Regular", color: "#1F1F1F" },
  item:      { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 10 },
  itemActive:{ backgroundColor: "#EEDDF5" },
  itemName:  { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#1F1F1F" },
  itemAddr:  { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9A948F" },
  empty:     { textAlign: "center", fontSize: 13, color: "#9A948F", padding: 20 },
});

const fm = StyleSheet.create({
  backdrop:   { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet:      { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "#fff",
                borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 40, maxHeight: "90%" },
  handle:     { width: 36, height: 4, borderRadius: 2, backgroundColor: "#D1D5DB", alignSelf: "center", marginBottom: 12 },
  title:      { fontSize: 17, fontFamily: "Inter_700Bold", color: "#1F1F1F", marginBottom: 8 },
  poolTag:    { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#EEDDF5",
                paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, alignSelf: "flex-start", marginBottom: 12 },
  poolTagTxt: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: P },
  label:      { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#1F1F1F", marginBottom: 4 },
  hint:       { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9A948F" },
  input:      { borderWidth: 1.5, borderColor: "#E9E2DD", borderRadius: 10, padding: 12,
                fontSize: 14, fontFamily: "Inter_400Regular", color: "#1F1F1F" },
  switchRow:  { flexDirection: "row", alignItems: "center", gap: 12 },
  infoBanner: { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: "#DDF2EF",
                borderRadius: 10, padding: 12 },
  infoBannerTxt:{ fontSize: 12, fontFamily: "Inter_400Regular", color: "#1F8F86", flex: 1, lineHeight: 18 },
  error:      { fontSize: 12, fontFamily: "Inter_500Medium", color: RED, backgroundColor: "#FFF5F5",
                borderRadius: 8, padding: 10 },
  btnRow:     { flexDirection: "row", gap: 10 },
  cancelBtn:  { flex: 1, padding: 14, borderRadius: 12, backgroundColor: "#F6F3F1", alignItems: "center" },
  cancelTxt:  { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#6F6B68" },
  saveBtn:    { flex: 2, padding: 14, borderRadius: 12, backgroundColor: P, alignItems: "center" },
  saveTxt:    { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },
});

const dm = StyleSheet.create({
  overlay:   { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: 32 },
  card:      { backgroundColor: "#fff", borderRadius: 20, padding: 24, width: "100%", gap: 16 },
  title:     { fontSize: 17, fontFamily: "Inter_700Bold", color: "#1F1F1F" },
  body:      { fontSize: 14, fontFamily: "Inter_400Regular", color: "#6F6B68", lineHeight: 20 },
  btnRow:    { flexDirection: "row", gap: 10 },
  cancelBtn: { flex: 1, padding: 12, borderRadius: 10, backgroundColor: "#F6F3F1", alignItems: "center" },
  cancelTxt: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#6F6B68" },
  delBtn:    { flex: 1, padding: 12, borderRadius: 10, backgroundColor: RED, alignItems: "center" },
  delTxt:    { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },
});
