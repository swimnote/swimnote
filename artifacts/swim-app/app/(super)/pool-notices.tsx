/**
 * (super)/pool-notices.tsx — 슈퍼관리자 공지사항 관리
 *
 * 구조 (전체 공지 우선):
 *  - 상단 탭: [전체 공지] [수영장별 공지]
 *  - 전체 공지(기본): 수영장 선택 없이 플랫폼 전체 사용자에게 발송
 *  - 수영장별 공지: 수영장 선택 후 해당 수영장만 발송
 *
 * 푸시 제목:
 *  - 전체 공지 → [스윔노트] 공지사항
 *  - 수영장별  → [수영장명] 공지사항
 */
import { BellOff, Bookmark, Check, ChevronDown, Globe, Home, PenLine, Plus, Send, Trash2 } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, FlatList, Modal, Pressable, RefreshControl,
  ScrollView, StyleSheet, Switch, Text, TextInput, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { apiRequest, useAuth } from "@/context/AuthContext";
import Colors from "@/constants/colors";
const C = Colors.light;

const P    = "#7C3AED";
const TEAL = "#2EC4B6";
const RED  = "#D96C6C";

// ── 타입 ─────────────────────────────────────────────────────────────────────

interface Pool { id: string; name: string; address?: string; }

interface PoolNotice {
  id: string;
  title: string;
  content: string;
  audience_scope: "global" | "pool";
  swimming_pool_id?: string | null;
  author_name: string;
  is_pinned: boolean;
  created_at: string;
  updated_at?: string;
  push_sent_at?: string | null;
  push_sent_count?: number;
}

// ── 유틸 ─────────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

// ── 공지 카드 ─────────────────────────────────────────────────────────────────

function NoticeRow({
  notice, poolNameMap, onEdit, onDelete,
}: {
  notice: PoolNotice;
  poolNameMap: Record<string, string>;
  onEdit: (n: PoolNotice) => void;
  onDelete: (id: string) => void;
}) {
  const pushed    = !!notice.push_sent_at;
  const pushCount = notice.push_sent_count ?? 0;
  const isGlobal  = notice.audience_scope === "global";
  const scopeLabel = isGlobal ? "전체" : (poolNameMap[notice.swimming_pool_id ?? ""] || "수영장별");
  const scopeColor = isGlobal ? P : TEAL;
  const scopeBg    = isGlobal ? "#EEDDF5" : "#E6FFFA";

  return (
    <Pressable style={r.row} onPress={() => onEdit(notice)}>
      <View style={r.main}>
        <View style={r.top}>
          {notice.is_pinned && (
            <View style={r.pinBadge}>
              <Bookmark size={9} color={P} />
              <Text style={r.pinTxt}>고정</Text>
            </View>
          )}
          <View style={[r.scopeBadge, { backgroundColor: scopeBg }]}>
            <LucideIcon name={isGlobal ? "globe" : "home"} size={9} color={scopeColor} />
            <Text style={[r.scopeTxt, { color: scopeColor }]}>{scopeLabel}</Text>
          </View>
          <Text style={r.title} numberOfLines={1}>{notice.title}</Text>
        </View>
        <View style={r.meta}>
          <Text style={r.author}>{notice.author_name}</Text>
          <Text style={r.dot}>·</Text>
          <Text style={r.date}>{fmtDate(notice.created_at)}</Text>
        </View>
        <View style={r.pushRow}>
          <View style={[r.pushBadge, pushed ? r.pushSent : r.pushNot]}>
            <LucideIcon name={pushed ? "send" : "minus-circle"} size={9} color={pushed ? TEAL : "#64748B"} />
            <Text style={[r.pushTxt, { color: pushed ? TEAL : "#64748B" }]}>
              {pushed ? `발송완료 (${pushCount}회)` : "미발송"}
            </Text>
          </View>
          {pushed && <Text style={r.pushDate}>{fmtDate(notice.push_sent_at)}</Text>}
        </View>
      </View>
      <View style={r.actions}>
        <Pressable style={r.editBtn} onPress={() => onEdit(notice)} hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}>
          <PenLine size={14} color={P} />
        </Pressable>
        <Pressable style={r.delBtn} onPress={() => onDelete(notice.id)} hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}>
          <Trash2 size={14} color={RED} />
        </Pressable>
      </View>
    </Pressable>
  );
}

const r = StyleSheet.create({
  row:       { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", paddingHorizontal: 16, paddingVertical: 14, gap: 10 },
  main:      { flex: 1, gap: 4 },
  top:       { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  title:     { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#0F172A", flex: 1 },
  meta:      { flexDirection: "row", alignItems: "center", gap: 4 },
  author:    { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B" },
  dot:       { fontSize: 10, color: "#D1D5DB" },
  date:      { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B" },
  pushRow:   { flexDirection: "row", alignItems: "center", gap: 6 },
  pushBadge: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  pushSent:  { backgroundColor: "#E6FFFA" },
  pushNot:   { backgroundColor: "#FFFFFF" },
  pushTxt:   { fontSize: 10, fontFamily: "Pretendard-Regular" },
  pushDate:  { fontSize: 10, fontFamily: "Pretendard-Regular", color: "#64748B" },
  pinBadge:  { flexDirection: "row", alignItems: "center", gap: 2, backgroundColor: "#EEDDF5", paddingHorizontal: 5, paddingVertical: 2, borderRadius: 5 },
  pinTxt:    { fontSize: 9, fontFamily: "Pretendard-Regular", color: P },
  scopeBadge:{ flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  scopeTxt:  { fontSize: 10, fontFamily: "Pretendard-Regular" },
  actions:   { flexDirection: "row", gap: 8 },
  editBtn:   { width: 32, height: 32, borderRadius: 8, backgroundColor: "#EEDDF5", alignItems: "center", justifyContent: "center" },
  delBtn:    { width: 32, height: 32, borderRadius: 8, backgroundColor: "#F9DEDA", alignItems: "center", justifyContent: "center" },
});

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

type ScopeTab = "global" | "pool";

export default function PoolNoticesScreen() {
  const { token } = useAuth();

  // ── 탭 상태 ────────────────────────────────────────────────────────────
  const [activeScope, setActiveScope] = useState<ScopeTab>("global");

  // ── 수영장 목록 ────────────────────────────────────────────────────────
  const [pools, setPools]               = useState<Pool[]>([]);
  const [poolsLoading, setPoolsLoading] = useState(true);
  const [selectedPool, setSelectedPool] = useState<Pool | null>(null);
  const [showPoolPicker, setShowPoolPicker] = useState(false);
  const [poolSearch, setPoolSearch]     = useState("");

  // ── 공지 목록 ─────────────────────────────────────────────────────────
  const [notices, setNotices]           = useState<PoolNotice[]>([]);
  const [listLoading, setListLoading]   = useState(false);
  const [refreshing, setRefreshing]     = useState(false);

  // ── 등록/수정/삭제 상태 ───────────────────────────────────────────────
  const [editNotice, setEditNotice]     = useState<PoolNotice | null>(null);
  const [showForm, setShowForm]         = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [form, setForm]                 = useState({ title: "", content: "", is_pinned: false, send_push: false });
  const [saving, setSaving]             = useState(false);
  const [formError, setFormError]       = useState("");

  // ── 수영장명 매핑 (카드에서 수영장명 표시용) ──────────────────────────
  const poolNameMap: Record<string, string> = Object.fromEntries(pools.map(p => [p.id, p.name]));

  // ── 풀 목록 로드 ─────────────────────────────────────────────────────
  useEffect(() => { fetchPools(); }, []);

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
        if (list.length > 0) setSelectedPool(list[0]);
      }
    } catch { } finally { setPoolsLoading(false); }
  }

  // ── 공지 목록 로드 ───────────────────────────────────────────────────
  const fetchNotices = useCallback(async () => {
    setListLoading(true);
    try {
      let url = "/notices";
      if (activeScope === "global") {
        url = "/notices?scope=global";
      } else if (activeScope === "pool" && selectedPool) {
        url = `/notices?pool_id=${selectedPool.id}`;
      } else if (activeScope === "pool" && !selectedPool) {
        setNotices([]);
        setListLoading(false);
        setRefreshing(false);
        return;
      }
      const res = await apiRequest(token, url);
      if (res.ok) {
        const data = await res.json();
        setNotices(Array.isArray(data) ? data : []);
      } else {
        setNotices([]);
      }
    } catch { setNotices([]); } finally { setListLoading(false); setRefreshing(false); }
  }, [activeScope, selectedPool, token]);

  useEffect(() => { fetchNotices(); }, [activeScope, selectedPool]);

  // ── 공지 등록/수정 ───────────────────────────────────────────────────
  function openCreate() {
    setEditNotice(null);
    setForm({ title: "", content: "", is_pinned: false, send_push: false });
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
    if (activeScope === "pool" && !selectedPool) { setFormError("수영장을 선택해주세요."); return; }

    setSaving(true);
    setFormError("");
    try {
      if (editNotice) {
        const res = await apiRequest(token, `/notices/${editNotice.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: form.title, content: form.content, is_pinned: form.is_pinned, resend_push: form.send_push }),
        });
        if (!res.ok) { const d = await res.json(); setFormError(d.message || "수정 실패"); return; }
      } else {
        const body: Record<string, any> = {
          title: form.title,
          content: form.content,
          is_pinned: form.is_pinned,
          notice_type: "general",
          audience_scope: activeScope,
        };
        if (activeScope === "pool" && selectedPool) {
          body.pool_id = selectedPool.id;
        }
        const res = await apiRequest(token, "/notices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) { const d = await res.json(); setFormError(d.message || "등록 실패"); return; }
      }
      setShowForm(false);
      fetchNotices();
    } catch { setFormError("네트워크 오류가 발생했습니다."); }
    finally { setSaving(false); }
  }

  // ── 공지 삭제 ─────────────────────────────────────────────────────────
  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await apiRequest(token, `/notices/${deleteTarget}`, { method: "DELETE" });
      setDeleteTarget(null);
      fetchNotices();
    } catch { }
  }

  const filteredPools = pools.filter(p =>
    !poolSearch.trim() || p.name.includes(poolSearch.trim())
  );

  // ── 렌더 ─────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="공지사항 관리" homePath="/(super)/support-group" />

      {/* ── 공지 범위 탭 ── */}
      <View style={s.tabBar}>
        <Pressable
          style={[s.tab, activeScope === "global" && s.tabActive]}
          onPress={() => setActiveScope("global")}
        >
          <Globe size={14} color={activeScope === "global" ? "#fff" : "#64748B"} />
          <Text style={[s.tabTxt, activeScope === "global" && s.tabTxtActive]}>전체 공지</Text>
        </Pressable>
        <Pressable
          style={[s.tab, activeScope === "pool" && s.tabActive]}
          onPress={() => setActiveScope("pool")}
        >
          <Home size={14} color={activeScope === "pool" ? "#fff" : "#64748B"} />
          <Text style={[s.tabTxt, activeScope === "pool" && s.tabTxtActive]}>수영장별 공지</Text>
        </Pressable>
      </View>

      {/* ── 안내 배너 ── */}
      {activeScope === "global" ? (
        <View style={[s.banner, { backgroundColor: "#EEDDF5", borderBottomColor: "#C4B5FD" }]}>
          <Globe size={12} color={P} />
          <Text style={[s.bannerTxt, { color: P }]}>
            전체 공지는 모든 수영장의 관리자·선생님·학부모 전체에 자동 발송됩니다.{"\n"}
            푸시 제목: [스윔노트] 공지사항
          </Text>
        </View>
      ) : (
        <View style={[s.banner, { backgroundColor: "#E6FFFA", borderBottomColor: "#A7F3D0" }]}>
          <Home size={12} color={TEAL} />
          <Text style={[s.bannerTxt, { color: TEAL }]}>
            수영장별 공지는 선택한 수영장 구성원에게만 발송됩니다.{"\n"}
            푸시 제목: [수영장명] 공지사항
          </Text>
        </View>
      )}

      {/* ── 수영장 선택 바 (수영장별 탭일 때만 표시) ── */}
      {activeScope === "pool" && (
        <View style={s.poolBar}>
          <Pressable style={s.poolSelect} onPress={() => setShowPoolPicker(true)}>
            <Home size={14} color={TEAL} />
            <Text style={s.poolSelectTxt} numberOfLines={1}>
              {poolsLoading ? "수영장 로딩 중…" : (selectedPool?.name ?? "수영장 선택")}
            </Text>
            <ChevronDown size={14} color="#64748B" />
          </Pressable>
          <Pressable style={[s.addBtn, { backgroundColor: TEAL }]} onPress={openCreate}>
            <Plus size={16} color="#fff" />
            <Text style={s.addBtnTxt}>공지 등록</Text>
          </Pressable>
        </View>
      )}

      {/* ── 전체 공지 탭: 등록 버튼만 표시 ── */}
      {activeScope === "global" && (
        <View style={s.globalBar}>
          <Text style={s.globalBarLabel}>플랫폼 전체 사용자 대상</Text>
          <Pressable style={[s.addBtn, { backgroundColor: P }]} onPress={openCreate}>
            <Plus size={16} color="#fff" />
            <Text style={s.addBtnTxt}>전체 공지 등록</Text>
          </Pressable>
        </View>
      )}

      {/* ── 공지 목록 ── */}
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
              poolNameMap={poolNameMap}
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
              <BellOff size={32} color="#D1D5DB" />
              <Text style={s.emptyTxt}>
                {activeScope === "pool" && !selectedPool
                  ? "수영장을 선택해주세요"
                  : "등록된 공지가 없습니다"}
              </Text>
            </View>
          }
          contentContainerStyle={{ paddingBottom: 80 }}
        />
      )}

      {/* ── 수영장 선택 모달 ── */}
      <Modal visible={showPoolPicker} animationType="slide" transparent statusBarTranslucent
        onRequestClose={() => setShowPoolPicker(false)}>
        <Pressable style={pm.backdrop} onPress={() => setShowPoolPicker(false)}>
          <Pressable style={pm.sheet} onPress={() => {}}>
            <View style={pm.handle} />
            <Text style={pm.title}>수영장 선택</Text>
            <TextInput style={pm.search} value={poolSearch} onChangeText={setPoolSearch}
              placeholder="수영장 이름 검색" placeholderTextColor="#64748B" />
            <ScrollView showsVerticalScrollIndicator={false}>
              {filteredPools.map(p => (
                <Pressable key={p.id}
                  style={[pm.item, selectedPool?.id === p.id && pm.itemActive]}
                  onPress={() => { setSelectedPool(p); setShowPoolPicker(false); setPoolSearch(""); }}>
                  <Home size={14} color={selectedPool?.id === p.id ? TEAL : "#64748B"} />
                  <View style={{ flex: 1 }}>
                    <Text style={[pm.itemName, selectedPool?.id === p.id && { color: TEAL }]}>{p.name}</Text>
                    {p.address ? <Text style={pm.itemAddr} numberOfLines={1}>{p.address}</Text> : null}
                  </View>
                  {selectedPool?.id === p.id && <Check size={14} color={TEAL} />}
                </Pressable>
              ))}
              {filteredPools.length === 0 && <Text style={pm.empty}>검색 결과 없음</Text>}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── 등록/수정 모달 ── */}
      <Modal visible={showForm} animationType="slide" transparent statusBarTranslucent
        onRequestClose={() => setShowForm(false)}>
        <Pressable style={fm.backdrop} onPress={() => setShowForm(false)}>
          <Pressable style={fm.sheet} onPress={() => {}}>
            <View style={fm.handle} />
            <Text style={fm.title}>{editNotice ? "공지 수정" : activeScope === "global" ? "전체 공지 등록" : "수영장 공지 등록"}</Text>

            {/* 공지 범위 표시 */}
            {!editNotice && (
              <View style={[fm.scopeTag, { backgroundColor: activeScope === "global" ? "#EEDDF5" : "#E6FFFA" }]}>
                <LucideIcon name={activeScope === "global" ? "globe" : "home"} size={11}
                  color={activeScope === "global" ? P : TEAL} />
                <Text style={[fm.scopeTagTxt, { color: activeScope === "global" ? P : TEAL }]}>
                  {activeScope === "global" ? "전체 공지 (모든 수영장)" : `수영장별 공지 (${selectedPool?.name ?? ""})`}
                </Text>
              </View>
            )}

            {/* 수정 시 공지 범위 표시 */}
            {editNotice && (
              <View style={[fm.scopeTag, {
                backgroundColor: editNotice.audience_scope === "global" ? "#EEDDF5" : "#E6FFFA",
              }]}>
                <LucideIcon name={editNotice.audience_scope === "global" ? "globe" : "home"} size={11}
                  color={editNotice.audience_scope === "global" ? P : TEAL} />
                <Text style={[fm.scopeTagTxt, { color: editNotice.audience_scope === "global" ? P : TEAL }]}>
                  {editNotice.audience_scope === "global"
                    ? "전체 공지"
                    : `수영장별 공지 (${poolNameMap[editNotice.swimming_pool_id ?? ""] ?? ""})`}
                </Text>
              </View>
            )}

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
              <View>
                <Text style={fm.label}>제목 *</Text>
                <TextInput style={fm.input} value={form.title}
                  onChangeText={v => setForm(f => ({ ...f, title: v }))}
                  placeholder="공지 제목" placeholderTextColor="#64748B" />
              </View>
              <View>
                <Text style={fm.label}>내용 *</Text>
                <TextInput style={[fm.input, { minHeight: 100 }]} value={form.content}
                  onChangeText={v => setForm(f => ({ ...f, content: v }))}
                  multiline placeholder="공지 내용" placeholderTextColor="#64748B"
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

              {/* 등록 시 푸시 안내 */}
              {!editNotice && (
                <View style={[fm.infoBanner, {
                  backgroundColor: activeScope === "global" ? "#EEDDF5" : "#E6FFFA",
                }]}>
                  <Send size={12} color={activeScope === "global" ? P : TEAL} />
                  <Text style={[fm.infoBannerTxt, { color: activeScope === "global" ? P : TEAL }]}>
                    {activeScope === "global"
                      ? "등록 즉시 모든 수영장 구성원에게 자동 푸시 발송됩니다."
                      : `등록 즉시 ${selectedPool?.name ?? "선택한 수영장"} 구성원에게 자동 푸시 발송됩니다.`}
                  </Text>
                </View>
              )}

              {/* 수정 시 재발송 스위치 */}
              {editNotice && (
                <View style={fm.switchRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={fm.label}>수정 후 푸시 재발송</Text>
                    <Text style={fm.hint}>
                      {editNotice.audience_scope === "global"
                        ? "전체 사용자에게 재발송합니다"
                        : `${poolNameMap[editNotice.swimming_pool_id ?? ""] ?? "수영장"} 구성원에게 재발송합니다`}
                    </Text>
                  </View>
                  <Switch value={form.send_push}
                    onValueChange={v => setForm(f => ({ ...f, send_push: v }))}
                    trackColor={{ true: TEAL }} />
                </View>
              )}

              {formError ? <Text style={fm.error}>{formError}</Text> : null}

              <View style={fm.btnRow}>
                <Pressable style={fm.cancelBtn} onPress={() => setShowForm(false)}>
                  <Text style={fm.cancelTxt}>취소</Text>
                </Pressable>
                <Pressable
                  style={[fm.saveBtn, {
                    backgroundColor: activeScope === "global" ? P : TEAL,
                    opacity: saving ? 0.6 : 1,
                  }]}
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

      {/* ── 삭제 확인 모달 ── */}
      <Modal visible={!!deleteTarget} animationType="fade" transparent statusBarTranslucent
        onRequestClose={() => setDeleteTarget(null)}>
        <View style={dm.overlay}>
          <View style={dm.card}>
            <Text style={dm.title}>공지 삭제</Text>
            <Text style={dm.body}>이 공지를 삭제(숨김 처리)하시겠습니까?{"\n"}공지 이력은 DB에 보존됩니다.</Text>
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
  safe:          { flex: 1, backgroundColor: C.background },
  tabBar:        { flexDirection: "row", padding: 12, gap: 8, backgroundColor: "#fff",
                   borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  tab:           { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
                   gap: 6, paddingVertical: 10, borderRadius: 10, backgroundColor: "#FFFFFF" },
  tabActive:     { backgroundColor: P },
  tabTxt:        { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#64748B" },
  tabTxtActive:  { color: "#fff" },
  banner:        { flexDirection: "row", gap: 8, alignItems: "flex-start",
                   paddingHorizontal: 16, paddingVertical: 10,
                   borderBottomWidth: 1 },
  bannerTxt:     { fontSize: 11, fontFamily: "Pretendard-Regular", flex: 1, lineHeight: 17 },
  globalBar:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                   paddingHorizontal: 16, paddingVertical: 10,
                   backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  globalBarLabel:{ fontSize: 13, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  poolBar:       { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 10,
                   backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  poolSelect:    { flex: 1, flexDirection: "row", alignItems: "center", gap: 8,
                   backgroundColor: "#FFFFFF", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  poolSelectTxt: { flex: 1, fontSize: 14, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  addBtn:        { flexDirection: "row", alignItems: "center", gap: 5,
                   paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10 },
  addBtnTxt:     { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#fff" },
  list:          { flex: 1, backgroundColor: "#FFFFFF" },
  sep:           { height: 1, backgroundColor: "#FFFFFF" },
  center:        { flex: 1, alignItems: "center", justifyContent: "center" },
  empty:         { alignItems: "center", paddingTop: 60, gap: 10 },
  emptyTxt:      { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#64748B" },
});

const pm = StyleSheet.create({
  backdrop:  { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet:     { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "#fff",
               borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 40, maxHeight: "70%" },
  handle:    { width: 36, height: 4, borderRadius: 2, backgroundColor: "#D1D5DB", alignSelf: "center", marginBottom: 16 },
  title:     { fontSize: 17, fontFamily: "Pretendard-Regular", color: "#0F172A", marginBottom: 12 },
  search:    { borderWidth: 1.5, borderColor: "#E5E7EB", borderRadius: 10, padding: 10, marginBottom: 12,
               fontSize: 14, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  item:      { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 10 },
  itemActive:{ backgroundColor: "#E6FFFA" },
  itemName:  { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  itemAddr:  { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B" },
  empty:     { textAlign: "center", fontSize: 13, color: "#64748B", padding: 20 },
});

const fm = StyleSheet.create({
  backdrop:     { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet:        { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "#fff",
                  borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 40, maxHeight: "90%" },
  handle:       { width: 36, height: 4, borderRadius: 2, backgroundColor: "#D1D5DB", alignSelf: "center", marginBottom: 12 },
  title:        { fontSize: 17, fontFamily: "Pretendard-Regular", color: "#0F172A", marginBottom: 8 },
  scopeTag:     { flexDirection: "row", alignItems: "center", gap: 6,
                  paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, alignSelf: "flex-start", marginBottom: 12 },
  scopeTagTxt:  { fontSize: 12, fontFamily: "Pretendard-Regular" },
  label:        { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#0F172A", marginBottom: 4 },
  hint:         { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B" },
  input:        { borderWidth: 1.5, borderColor: "#E5E7EB", borderRadius: 10, padding: 12,
                  fontSize: 14, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  switchRow:    { flexDirection: "row", alignItems: "center", gap: 12 },
  infoBanner:   { flexDirection: "row", gap: 8, alignItems: "flex-start",
                  borderRadius: 10, padding: 10 },
  infoBannerTxt:{ fontSize: 12, fontFamily: "Pretendard-Regular", flex: 1, lineHeight: 18 },
  error:        { fontSize: 13, fontFamily: "Pretendard-Regular", color: RED, textAlign: "center" },
  btnRow:       { flexDirection: "row", gap: 10, marginTop: 4 },
  cancelBtn:    { flex: 1, padding: 13, borderRadius: 12, backgroundColor: "#FFFFFF", alignItems: "center" },
  cancelTxt:    { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#64748B" },
  saveBtn:      { flex: 1, padding: 13, borderRadius: 12, alignItems: "center" },
  saveTxt:      { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#fff" },
});

const dm = StyleSheet.create({
  overlay:   { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: 24 },
  card:      { backgroundColor: "#fff", borderRadius: 20, padding: 24, width: "100%", maxWidth: 360 },
  title:     { fontSize: 17, fontFamily: "Pretendard-Regular", color: "#0F172A", marginBottom: 8 },
  body:      { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#64748B", lineHeight: 22, marginBottom: 20 },
  btnRow:    { flexDirection: "row", gap: 10 },
  cancelBtn: { flex: 1, padding: 13, borderRadius: 12, backgroundColor: "#FFFFFF", alignItems: "center" },
  cancelTxt: { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#64748B" },
  delBtn:    { flex: 1, padding: 13, borderRadius: 12, backgroundColor: RED, alignItems: "center" },
  delTxt:    { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#fff" },
});
