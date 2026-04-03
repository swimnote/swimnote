/**
 * 내 정보 화면
 * - 이름, 휴대폰번호, 자녀 목록, 수영장 정보, 가입일
 * - 수영장이 없으면 직접 검색해서 연결 가능
 */
import { Check, Pencil, X } from "lucide-react-native";
import { router } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, Keyboard, KeyboardAvoidingView, Modal,
  Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Colors from "@/constants/colors";
import { LucideIcon } from "@/components/common/LucideIcon";
import { ParentScreenHeader } from "@/components/parent/ParentScreenHeader";
import { API_BASE, apiRequest, useAuth } from "@/context/AuthContext";
import { useParent } from "@/context/ParentContext";

const C = Colors.light;
const TEAL = "#2EC4B6";
const TEAL_BG = "#E6FAF8";
const GRAY_BG = "#F4F6FA";

interface MeData {
  id: string;
  name: string;
  phone: string | null;
  swimming_pool_id: string | null;
  pool_name: string | null;
  pool_address: string | null;
  pool_phone: string | null;
  created_at: string | null;
}

interface PoolResult {
  id: string;
  name: string;
  address?: string | null;
  phone?: string | null;
}

/* ─── 헬퍼 ─── */
function formatPhone(phone: string | null) {
  if (!phone) return "—";
  const n = phone.replace(/[^0-9]/g, "");
  if (n.length === 11) return `${n.slice(0, 3)}-${n.slice(3, 7)}-${n.slice(7)}`;
  if (n.length === 10) return `${n.slice(0, 3)}-${n.slice(3, 6)}-${n.slice(6)}`;
  return phone;
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return "—";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "—";
    return `${d.getFullYear()}년 ${String(d.getMonth() + 1).padStart(2, "0")}월 ${String(d.getDate()).padStart(2, "0")}일`;
  } catch { return "—"; }
}

/* ─── 서브 컴포넌트 ─── */
function InfoRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <View style={s.row}>
      <View style={s.rowIcon}><LucideIcon name={icon} size={16} color={TEAL} /></View>
      <View style={{ flex: 1 }}>
        <Text style={[s.rowLabel, { color: C.textMuted }]}>{label}</Text>
        <Text style={[s.rowValue, { color: C.text }]}>{value}</Text>
      </View>
    </View>
  );
}

function SectionCard({ title, icon, right, children }: {
  title: string; icon: string; right?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <View style={[s.card, { backgroundColor: C.card }]}>
      <View style={s.cardHeader}>
        <View style={[s.cardIconWrap, { backgroundColor: TEAL_BG }]}>
          <LucideIcon name={icon} size={15} color={TEAL} />
        </View>
        <Text style={[s.cardTitle, { color: C.text }]}>{title}</Text>
        {right ? <View style={{ marginLeft: "auto" }}>{right}</View> : null}
      </View>
      {children}
    </View>
  );
}

/* ─── 수영장 선택 모달 ─── */
function PoolSelectModal({
  visible,
  onClose,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  onSelect: (pool: PoolResult) => void;
}) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState("");
  const [pools, setPools] = useState<PoolResult[]>([]);
  const [allPools, setAllPools] = useState<PoolResult[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<TextInput>(null);

  // 모달 열릴 때 전체 목록 로드
  useEffect(() => {
    if (!visible) { setQuery(""); setPools([]); return; }
    setLoading(true);
    fetch(`${API_BASE}/pools/public-search`)
      .then(r => r.ok ? r.json() : { success: false, data: [] })
      .then(data => {
        const list: PoolResult[] = Array.isArray(data) ? data : (Array.isArray(data.data) ? data.data : []);
        setAllPools(list);
        setPools(list);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    setTimeout(() => inputRef.current?.focus(), 300);
  }, [visible]);

  // 검색 필터
  useEffect(() => {
    const q = query.trim().toLowerCase();
    if (!q) { setPools(allPools); return; }
    setPools(allPools.filter(p =>
      p.name.toLowerCase().includes(q) || (p.address ?? "").toLowerCase().includes(q)
    ));
  }, [query, allPools]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={s.modalBackdrop} onPress={onClose} />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={[s.modalSheet, { paddingBottom: insets.bottom + 16 }]}
      >
        {/* 핸들 */}
        <View style={s.modalHandle} />
        <View style={s.modalHeader}>
          <Text style={[s.modalTitle, { color: C.text }]}>수영장 선택</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <LucideIcon name="x" size={20} color={C.textMuted} />
          </Pressable>
        </View>

        {/* 검색창 */}
        <View style={[s.searchBox, { backgroundColor: GRAY_BG }]}>
          <LucideIcon name="search" size={16} color={C.textMuted} />
          <TextInput
            ref={inputRef}
            style={[s.searchInput, { color: C.text }]}
            placeholder="수영장 이름 검색"
            placeholderTextColor={C.textMuted}
            value={query}
            onChangeText={setQuery}
            returnKeyType="search"
            onSubmitEditing={Keyboard.dismiss}
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery("")} hitSlop={8}>
              <LucideIcon name="x" size={14} color={C.textMuted} />
            </Pressable>
          )}
        </View>

        {loading ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <ActivityIndicator color={TEAL} />
          </View>
        ) : pools.length === 0 ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 8 }}>
            <LucideIcon name="building-2" size={36} color={C.border} />
            <Text style={[s.emptyTxt, { color: C.textMuted }]}>
              {query ? "검색 결과가 없습니다." : "등록된 수영장이 없습니다."}
            </Text>
          </View>
        ) : (
          <FlatList
            data={pools}
            keyExtractor={p => p.id}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 8, gap: 8 }}
            renderItem={({ item }) => (
              <Pressable
                style={({ pressed }) => [s.poolItem, { backgroundColor: pressed ? TEAL_BG : C.card }]}
                onPress={() => { onSelect(item); onClose(); }}
              >
                <View style={[s.poolIcon, { backgroundColor: TEAL_BG }]}>
                  <LucideIcon name="building-2" size={18} color={TEAL} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.poolName, { color: C.text }]}>{item.name}</Text>
                  {item.address ? (
                    <Text style={[s.poolAddr, { color: C.textMuted }]} numberOfLines={1}>{item.address}</Text>
                  ) : null}
                </View>
                <LucideIcon name="chevron-right" size={16} color={C.textMuted} />
              </Pressable>
            )}
          />
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

/* ─── 메인 화면 ─── */
export default function MyInfoScreen() {
  const insets = useSafeAreaInsets();
  const { token, parentPoolName, pool } = useAuth();
  const { students, refresh: refreshStudents } = useParent();
  const [me, setMe] = useState<MeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [poolModal, setPoolModal] = useState(false);
  const [linking, setLinking] = useState(false);
  const [linkMsg, setLinkMsg] = useState("");

  // 자녀 이름 편집 상태
  const [editingChildId, setEditingChildId] = useState<string | null>(null);
  const [editingChildName, setEditingChildName] = useState("");
  const [savingChild, setSavingChild] = useState(false);
  const childNameInputRef = useRef<TextInput>(null);

  // 자녀 추가(검색 연결) 상태
  const [addChildName, setAddChildName] = useState("");
  const [addingChild, setAddingChild] = useState(false);
  const [addChildResult, setAddChildResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const loadMe = async () => {
    try {
      const r = await apiRequest(token, "/parent/me");
      if (r.ok) setMe(await r.json());
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => { loadMe(); }, []);

  // 자녀 이름 저장
  async function saveChildName(id: string) {
    const trimmed = editingChildName.trim();
    if (!trimmed) { Alert.alert("이름을 입력해주세요."); return; }
    setSavingChild(true);
    try {
      const r = await apiRequest(token, `/parent/students/${id}/name`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (r.ok) {
        await refreshStudents?.();
        setEditingChildId(null);
      } else {
        const d = await r.json();
        Alert.alert("저장 실패", d.error || "오류가 발생했습니다.");
      }
    } catch { Alert.alert("오류", "네트워크 오류가 발생했습니다."); }
    finally { setSavingChild(false); }
  }

  // 자녀 이름으로 관리자 회원목록 검색 후 연결
  async function linkChildByName() {
    const trimmed = addChildName.trim();
    if (!trimmed) { Alert.alert("자녀 이름을 입력해주세요."); return; }
    const poolId = me?.swimming_pool_id;
    if (!poolId) { Alert.alert("먼저 수영장을 연결해주세요."); return; }
    setAddingChild(true);
    setAddChildResult(null);
    try {
      const r = await apiRequest(token, "/parent/link-child", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ swimming_pool_id: poolId, child_name: trimmed }),
      });
      const d = await r.json();
      if (d.status === "auto_approved") {
        setAddChildResult({ ok: true, msg: `✓ ${d.student?.name ?? trimmed}이(가) 연결되었습니다!` });
        setAddChildName("");
        await refreshStudents?.();
      } else if (d.status === "pending") {
        setAddChildResult({ ok: false, msg: "일치하는 학생을 찾지 못했습니다. 관리자에게 이름 등록을 요청하세요." });
      } else {
        setAddChildResult({ ok: false, msg: d.message || "연결에 실패했습니다." });
      }
    } catch { setAddChildResult({ ok: false, msg: "네트워크 오류가 발생했습니다." }); }
    finally { setAddingChild(false); }
  }

  // 표시할 수영장 정보: API > context pool > parentPoolName
  const poolName = me?.pool_name || pool?.name || parentPoolName || null;
  const poolAddress = me?.pool_address || pool?.address || null;
  const poolPhone = me?.pool_phone || pool?.phone || null;
  const hasPool = !!(me?.swimming_pool_id || poolName);

  async function handlePoolSelect(selected: PoolResult) {
    setLinking(true);
    setLinkMsg("");
    try {
      const r = await apiRequest(token, "/parent/onboard-pool", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ swimming_pool_id: selected.id }),
      });
      const data = await r.json();
      if (r.ok) {
        // 로컬 상태 즉시 반영
        setMe(prev => prev ? {
          ...prev,
          swimming_pool_id: selected.id,
          pool_name: data.pool_name || selected.name,
          pool_address: selected.address || null,
          pool_phone: selected.phone || null,
        } : prev);
        // AsyncStorage에 pool_name 저장
        AsyncStorage.setItem("parent_pool_name", data.pool_name || selected.name).catch(() => {});
        if (data.auto_approved && data.linked_students?.length > 0) {
          setLinkMsg(`✓ ${selected.name}에 연결되었습니다. 자녀 ${data.linked_students.length}명이 자동 연결되었습니다.`);
          refreshStudents?.();
        } else {
          setLinkMsg(`✓ ${selected.name}에 연결 요청이 완료되었습니다.`);
        }
      } else {
        setLinkMsg(data.error || "연결에 실패했습니다.");
      }
    } catch {
      setLinkMsg("연결 중 오류가 발생했습니다.");
    } finally {
      setLinking(false);
    }
  }

  return (
    <View style={[s.root, { backgroundColor: C.background }]}>
      <ParentScreenHeader title="내 정보" onBack={() => router.back()} />

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={TEAL} />
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: insets.bottom + 40, gap: 12 }}
        >
          {/* 아바타 헤더 */}
          <View style={[s.avatarCard, { backgroundColor: TEAL }]}>
            <View style={s.avatar}>
              <Text style={s.avatarTxt}>{me?.name?.[0] ?? "?"}</Text>
            </View>
            <Text style={s.avatarName}>{me?.name ?? ""}님</Text>
            <Text style={s.avatarSub}>{poolName ?? "수영장 미연결"}</Text>
          </View>

          {/* 연결 결과 메시지 */}
          {linkMsg ? (
            <View style={[s.linkMsgBox, {
              backgroundColor: linkMsg.startsWith("✓") ? TEAL_BG : "#FFF0F0",
              borderColor: linkMsg.startsWith("✓") ? TEAL : "#F97316",
            }]}>
              <Text style={[s.linkMsgTxt, { color: linkMsg.startsWith("✓") ? TEAL : "#D9534F" }]}>{linkMsg}</Text>
            </View>
          ) : null}

          {/* 계정 정보 */}
          <SectionCard title="계정 정보" icon="user">
            <InfoRow icon="user" label="이름" value={me?.name ?? "—"} />
            <View style={s.divider} />
            <InfoRow icon="phone" label="휴대폰 번호" value={formatPhone(me?.phone ?? null)} />
            <View style={s.divider} />
            <InfoRow icon="calendar" label="가입일" value={formatDate(me?.created_at ?? null)} />
          </SectionCard>

          {/* ── 자녀 연결 카드 ─────────────────────────────── */}
          <View style={[s.card, { backgroundColor: C.card }]}>
            {/* 카드 헤더 */}
            <View style={s.cardHeader}>
              <View style={[s.cardIconWrap, { backgroundColor: TEAL_BG }]}>
                <LucideIcon name="users" size={15} color={TEAL} />
              </View>
              <Text style={[s.cardTitle, { color: C.text }]}>등록된 자녀</Text>
            </View>

            {/* 연결된 자녀 목록 */}
            {students.map((st, i) => {
              const isEditing = editingChildId === st.id;
              return (
                <React.Fragment key={st.id}>
                  <View style={[s.divider, { marginBottom: 8 }]} />
                  <View style={s.childRow}>
                    <View style={[s.childBadge, { backgroundColor: TEAL_BG }]}>
                      <Text style={[s.childBadgeTxt, { color: TEAL }]}>
                        {(isEditing ? editingChildName : st.name)?.[0] ?? "?"}
                      </Text>
                    </View>

                    {isEditing ? (
                      <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <TextInput
                          ref={childNameInputRef}
                          style={[s.childEditInput, { borderColor: TEAL, color: C.text }]}
                          value={editingChildName}
                          onChangeText={setEditingChildName}
                          placeholder="자녀 이름"
                          placeholderTextColor={C.textMuted}
                          autoFocus
                          returnKeyType="done"
                          onSubmitEditing={() => saveChildName(st.id)}
                        />
                        {savingChild
                          ? <ActivityIndicator size="small" color={TEAL} />
                          : <>
                              <Pressable hitSlop={10} onPress={() => saveChildName(st.id)} style={[s.editAction, { backgroundColor: TEAL }]}>
                                <Check size={14} color="#fff" />
                              </Pressable>
                              <Pressable hitSlop={10} onPress={() => setEditingChildId(null)} style={[s.editAction, { backgroundColor: "#EEE" }]}>
                                <X size={14} color={C.textMuted} />
                              </Pressable>
                            </>
                        }
                      </View>
                    ) : (
                      <View style={{ flex: 1 }}>
                        <Text style={[s.childName, { color: C.text }]}>{st.name}</Text>
                        {(st as any).class_name
                          ? <Text style={[s.childSub, { color: C.textMuted }]}>{(st as any).class_name}</Text>
                          : null}
                      </View>
                    )}

                    {!isEditing && (
                      <Pressable hitSlop={12} onPress={() => { setEditingChildId(st.id); setEditingChildName(st.name); }}>
                        <Pencil size={15} color={TEAL} />
                      </Pressable>
                    )}
                  </View>
                </React.Fragment>
              );
            })}

            {/* 구분선 */}
            {students.length > 0 && <View style={[s.divider, { marginVertical: 12 }]} />}

            {/* 자녀 이름으로 회원목록 연결 */}
            <Text style={[s.addChildLabel, { color: C.textSecondary }]}>
              {students.length === 0 ? "자녀 이름을 입력해 회원목록과 연결하세요" : "추가 자녀 연결"}
            </Text>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
              <TextInput
                style={[s.addChildInput, { borderColor: C.border, backgroundColor: GRAY_BG, color: C.text }]}
                value={addChildName}
                onChangeText={v => { setAddChildName(v); setAddChildResult(null); }}
                placeholder="자녀 이름 (관리자 등록 이름과 동일)"
                placeholderTextColor={C.textMuted}
                returnKeyType="done"
                onSubmitEditing={linkChildByName}
              />
              <Pressable
                style={({ pressed }) => [s.addChildBtn, { backgroundColor: TEAL, opacity: pressed ? 0.8 : 1 }]}
                onPress={linkChildByName}
                disabled={addingChild}
              >
                {addingChild
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={s.addChildBtnTxt}>연결</Text>
                }
              </Pressable>
            </View>

            {/* 연결 결과 */}
            {addChildResult && (
              <View style={[s.addChildResult, { backgroundColor: addChildResult.ok ? "#DCFCE7" : "#FEF2F2" }]}>
                <Text style={[s.addChildResultTxt, { color: addChildResult.ok ? "#15803D" : "#DC2626" }]}>
                  {addChildResult.msg}
                </Text>
              </View>
            )}

            {!me?.swimming_pool_id && (
              <Text style={[s.addChildNote, { color: "#F97316" }]}>
                ⚠ 수영장을 먼저 연결해야 자녀를 검색할 수 있습니다
              </Text>
            )}
          </View>

          {/* 수영장 정보 */}
          <SectionCard
            title="등록된 수영장"
            icon="building-2"
            right={
              <Pressable
                style={({ pressed }) => [s.changePoolBtn, { opacity: pressed ? 0.7 : 1 }]}
                onPress={() => setPoolModal(true)}
                disabled={linking}
              >
                {linking
                  ? <ActivityIndicator size="small" color={TEAL} />
                  : <Text style={[s.changePoolTxt, { color: TEAL }]}>{hasPool ? "변경" : "수영장 연결하기"}</Text>}
              </Pressable>
            }
          >
            {hasPool ? (
              <>
                <InfoRow icon="building-2" label="수영장 이름" value={poolName!} />
                <View style={s.divider} />
                <InfoRow icon="map-pin" label="주소" value={poolAddress || "—"} />
                <View style={s.divider} />
                <InfoRow icon="phone" label="전화번호" value={formatPhone(poolPhone)} />
              </>
            ) : (
              <Pressable
                style={({ pressed }) => [s.connectBtn, { backgroundColor: TEAL, opacity: pressed ? 0.8 : 1 }]}
                onPress={() => setPoolModal(true)}
                disabled={linking}
              >
                {linking
                  ? <ActivityIndicator color="#fff" />
                  : <>
                    <LucideIcon name="plus" size={18} color="#fff" />
                    <Text style={s.connectBtnTxt}>수영장 검색해서 연결하기</Text>
                  </>}
              </Pressable>
            )}
          </SectionCard>

          {/* 내 정보 수정 버튼 */}
          <Pressable
            style={({ pressed }) => [s.editBtn, { backgroundColor: TEAL, opacity: pressed ? 0.8 : 1 }]}
            onPress={() => router.push("/(parent)/parent-profile?backTo=my-info" as any)}
          >
            <LucideIcon name="pencil" size={16} color="#fff" />
            <Text style={s.editBtnTxt}>내 정보 수정</Text>
          </Pressable>
        </ScrollView>
      )}

      <PoolSelectModal
        visible={poolModal}
        onClose={() => setPoolModal(false)}
        onSelect={handlePoolSelect}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },

  avatarCard: {
    borderRadius: 20, padding: 28, alignItems: "center", gap: 6, marginBottom: 4,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08, shadowRadius: 8, elevation: 3,
  },
  avatar: {
    width: 64, height: 64, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.25)",
    alignItems: "center", justifyContent: "center", marginBottom: 4,
  },
  avatarTxt: { fontSize: 28, color: "#fff", fontFamily: "Pretendard-Regular" },
  avatarName: { fontSize: 20, color: "#fff", fontFamily: "Pretendard-Regular" },
  avatarSub: { fontSize: 13, color: "rgba(255,255,255,0.75)", fontFamily: "Pretendard-Regular" },

  linkMsgBox: { borderRadius: 12, padding: 12, borderWidth: 1 },
  linkMsgTxt: { fontSize: 13, fontFamily: "Pretendard-Regular", textAlign: "center" },

  card: {
    borderRadius: 16, padding: 16,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 3, elevation: 1,
  },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  cardIconWrap: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  cardTitle: { fontSize: 13, fontFamily: "Pretendard-Regular", letterSpacing: 0.2, flex: 1 },

  changePoolBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: "#E6FAF8" },
  changePoolTxt: { fontSize: 12, fontFamily: "Pretendard-Regular" },

  connectBtn: {
    borderRadius: 12, paddingVertical: 14, flexDirection: "row",
    alignItems: "center", justifyContent: "center", gap: 8, marginTop: 4,
  },
  connectBtnTxt: { fontSize: 14, color: "#fff", fontFamily: "Pretendard-Regular" },

  row: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 4 },
  rowIcon: { width: 28, height: 28, alignItems: "center", justifyContent: "center" },
  rowLabel: { fontSize: 11, fontFamily: "Pretendard-Regular", marginBottom: 2 },
  rowValue: { fontSize: 14, fontFamily: "Pretendard-Regular" },

  divider: { height: 1, backgroundColor: "rgba(0,0,0,0.04)", marginVertical: 6 },

  emptyTxt: { fontSize: 13, fontFamily: "Pretendard-Regular", textAlign: "center", paddingVertical: 8 },

  childRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 },
  childBadge: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  childBadgeTxt: { fontSize: 15, fontFamily: "Pretendard-Regular" },
  childName: { fontSize: 14, fontFamily: "Pretendard-Regular" },
  childSub: { fontSize: 12, fontFamily: "Pretendard-Regular", marginTop: 1 },
  childEditInput: {
    flex: 1, borderWidth: 1.5, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 6,
    fontSize: 14, fontFamily: "Pretendard-Regular",
  },
  editAction: {
    width: 28, height: 28, borderRadius: 8,
    alignItems: "center", justifyContent: "center",
  },
  addChildLabel: {
    fontSize: 12, fontFamily: "Pretendard-Regular", marginBottom: 2,
  },
  addChildInput: {
    flex: 1, borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, fontFamily: "Pretendard-Regular",
  },
  addChildBtn: {
    borderRadius: 10, paddingHorizontal: 16,
    alignItems: "center", justifyContent: "center", minWidth: 52,
  },
  addChildBtnTxt: { color: "#fff", fontSize: 13, fontFamily: "Pretendard-SemiBold" },
  addChildResult: {
    borderRadius: 10, padding: 10, marginTop: 10,
  },
  addChildResultTxt: { fontSize: 13, fontFamily: "Pretendard-Regular", lineHeight: 20 },
  addChildNote: {
    fontSize: 12, fontFamily: "Pretendard-Regular", marginTop: 10, textAlign: "center",
  },

  editBtn: {
    borderRadius: 14, paddingVertical: 14, flexDirection: "row",
    alignItems: "center", justifyContent: "center", gap: 8, marginTop: 4,
  },
  editBtnTxt: { fontSize: 15, color: "#fff", fontFamily: "Pretendard-Regular" },

  // 모달
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)" },
  modalSheet: {
    backgroundColor: C.background, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    maxHeight: "75%", minHeight: "60%",
    shadowColor: "#000", shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.12, shadowRadius: 12, elevation: 10,
  },
  modalHandle: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: "#DDD",
    alignSelf: "center", marginTop: 10, marginBottom: 4,
  },
  modalHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingVertical: 12,
  },
  modalTitle: { fontSize: 17, fontFamily: "Pretendard-Regular" },

  searchBox: {
    flexDirection: "row", alignItems: "center", borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 10, gap: 8, marginHorizontal: 20, marginBottom: 8,
  },
  searchInput: { flex: 1, fontSize: 15, fontFamily: "Pretendard-Regular", paddingVertical: 0 },

  poolItem: {
    flexDirection: "row", alignItems: "center", borderRadius: 12,
    padding: 12, gap: 10,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03, shadowRadius: 2, elevation: 1,
  },
  poolIcon: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  poolName: { fontSize: 14, fontFamily: "Pretendard-Regular" },
  poolAddr: { fontSize: 12, fontFamily: "Pretendard-Regular", marginTop: 2 },
});
