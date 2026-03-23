/**
 * (admin)/withdrawn-members.tsx — 퇴원자 / 아카이브 관리
 * 퇴원자(withdrawn): 과금 포함, 학부모 접근 기본 허용
 *   → 최종퇴원처리: 학부모 접근 즉시 차단
 *   → 아카이브로이동: 과금 제외, 데이터 보존
 * 아카이브(archived): 과금 제외, 학부모 접근 차단, 관리자만 열람
 *   → 복원: active로 복구
 *   → 영구삭제: 2단계 확인 후 복구 불가
 */
import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useState } from "react";
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

const C = Colors.light;

interface ArchivedMember {
  id: string;
  name: string;
  phone?: string | null;
  birth_year?: number | null;
  last_class_group_name?: string | null;
  attendance_count: number;
  withdrawn_at?: string | null;
  deleted_at?: string | null;
  archived_reason?: string | null;
  status: "withdrawn" | "deleted" | "archived";
  updated_at?: string | null;
}

type MainTab = "withdrawn" | "archived";

function fmtDate(d: string | null | undefined) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });
}

export default function WithdrawnMembersScreen() {
  const { token } = useAuth();
  const { themeColor } = useBrand();
  const insets = useSafeAreaInsets();

  const [members,    setMembers]    = useState<ArchivedMember[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab,        setTab]        = useState<MainTab>("withdrawn");
  const [search,     setSearch]     = useState("");
  const [saving,     setSaving]     = useState<string | null>(null);

  // 액션 모달 상태
  const [actionTarget,    setActionTarget]    = useState<ArchivedMember | null>(null);
  const [confirmAction,   setConfirmAction]   = useState<"final_withdraw" | "archive" | "restore" | "permanent_delete" | null>(null);
  const [deleteStep,      setDeleteStep]      = useState<1 | 2>(1);

  const load = useCallback(async () => {
    try {
      const res = await apiRequest(token, "/admin/withdrawn-members");
      if (res.ok) {
        const data: ArchivedMember[] = await res.json();
        setMembers(data);
      } else {
        setMembers([]);
      }
    } catch (e) { console.error(e); setMembers([]); }
    finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const withdrawnList = members.filter(m => m.status === "withdrawn" || m.status === "deleted");
  const archivedList  = members.filter(m => m.status === "archived");

  const displayed = (tab === "withdrawn" ? withdrawnList : archivedList).filter(m => {
    if (!search.trim()) return true;
    const q = search.trim();
    return m.name.includes(q) || (m.last_class_group_name || "").includes(q);
  });

  function openAction(member: ArchivedMember, action: typeof confirmAction) {
    setActionTarget(member);
    setDeleteStep(1);
    setConfirmAction(action);
  }

  async function executeAction() {
    if (!actionTarget || !confirmAction) return;
    setSaving(actionTarget.id);
    try {
      let res: Response;
      if (confirmAction === "final_withdraw") {
        res = await apiRequest(token, `/admin/students/${actionTarget.id}/final-withdraw`, { method: "POST" });
      } else if (confirmAction === "archive") {
        res = await apiRequest(token, `/admin/students/${actionTarget.id}/archive`, { method: "POST" });
      } else if (confirmAction === "restore") {
        res = await apiRequest(token, `/admin/students/${actionTarget.id}/restore-archive`, { method: "POST" });
      } else if (confirmAction === "permanent_delete") {
        res = await apiRequest(token, `/admin/students/${actionTarget.id}/permanent?confirm=true`, { method: "DELETE" });
      } else {
        return;
      }
      if (res.ok) {
        setConfirmAction(null);
        setActionTarget(null);
        await load();
      } else {
        const err = await res.json().catch(() => ({}));
        console.error("action failed:", err.error || res.status);
      }
    } catch (e) { console.error(e); }
    finally { setSaving(null); }
  }

  const TABS: { key: MainTab; label: string; color: string }[] = [
    { key: "withdrawn", label: "퇴원자",  color: "#D96C6C" },
    { key: "archived",  label: "아카이브", color: "#6F6B68" },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <SubScreenHeader title="퇴원자 / 아카이브 관리" />

      {/* 탭 */}
      <View style={styles.tabRow}>
        {TABS.map(t => {
          const cnt = t.key === "withdrawn" ? withdrawnList.length : archivedList.length;
          return (
            <Pressable
              key={t.key}
              style={[styles.tab, tab === t.key && { borderBottomColor: t.color, borderBottomWidth: 2.5 }]}
              onPress={() => setTab(t.key)}
            >
              <Text style={[styles.tabText, { color: tab === t.key ? t.color : C.textMuted }]}>
                {t.label}
                {cnt > 0 ? (
                  <Text style={{ color: tab === t.key ? t.color : C.textMuted }}> {cnt}</Text>
                ) : null}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* 설명 배너 */}
      <View style={[styles.infoBanner, { backgroundColor: tab === "withdrawn" ? "#FEF2F2" : "#F6F3F1" }]}>
        {tab === "withdrawn" ? (
          <Text style={[styles.infoText, { color: "#991B1B" }]}>
            퇴원자는 과금에 포함되지 않습니다. 최종 퇴원 처리 시 학부모 앱 접근이 차단됩니다. 복구 가능 기간 내에는 관리자가 복구할 수 있습니다.
          </Text>
        ) : (
          <Text style={[styles.infoText, { color: "#1F1F1F" }]}>
            아카이브는 과금 제외, 학부모 접근 차단, 기록 보존 상태입니다. 관리자만 열람 가능합니다.
          </Text>
        )}
      </View>

      {/* 검색 */}
      <View style={[styles.searchBox, { borderColor: C.border, backgroundColor: C.card, marginHorizontal: 16 }]}>
        <Feather name="search" size={16} color={C.textMuted} />
        <TextInput
          style={[styles.searchInput, { color: C.text }]}
          value={search}
          onChangeText={setSearch}
          placeholder="이름 또는 마지막 반 검색"
          placeholderTextColor={C.textMuted}
        />
        {search.length > 0 && (
          <Pressable onPress={() => setSearch("")}><Feather name="x" size={15} color={C.textMuted} /></Pressable>
        )}
      </View>

      {loading ? (
        <ActivityIndicator color={themeColor} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={displayed}
          keyExtractor={m => m.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: insets.bottom + 60, gap: 8 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={themeColor} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Feather name="user-x" size={40} color={C.textMuted} />
              <Text style={[styles.emptyText, { color: C.textMuted }]}>
                {search ? "검색 결과가 없습니다" : `${tab === "withdrawn" ? "퇴원자" : "아카이브 회원"}이 없습니다`}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <MemberCard
              item={item}
              tab={tab}
              saving={saving === item.id}
              onFinalWithdraw={() => openAction(item, "final_withdraw")}
              onArchive={() => openAction(item, "archive")}
              onRestore={() => openAction(item, "restore")}
              onPermanentDelete={() => openAction(item, "permanent_delete")}
            />
          )}
        />
      )}

      {/* 최종 퇴원처리 확인 */}
      <ConfirmModal
        visible={confirmAction === "final_withdraw"}
        title="최종 퇴원 처리"
        message={actionTarget
          ? `"${actionTarget.name}" 회원을 최종 퇴원 처리합니다.\n\n학부모 앱에서 이 수영장 정보를 즉시 볼 수 없게 됩니다. 이 작업은 관리자만 되돌릴 수 있습니다.`
          : ""}
        confirmText="최종 퇴원 처리"
        cancelText="취소"
        destructive
        onConfirm={executeAction}
        onCancel={() => { setConfirmAction(null); setActionTarget(null); }}
      />

      {/* 아카이브로 이동 확인 */}
      <ConfirmModal
        visible={confirmAction === "archive"}
        title="아카이브로 이동"
        message={actionTarget
          ? `"${actionTarget.name}" 회원을 아카이브로 이동합니다.\n\n과금에서 제외되며, 출결·일지·사진 기록은 보존됩니다. 추후 복원 가능합니다.`
          : ""}
        confirmText="아카이브로 이동"
        cancelText="취소"
        onConfirm={executeAction}
        onCancel={() => { setConfirmAction(null); setActionTarget(null); }}
      />

      {/* 복원 확인 */}
      <ConfirmModal
        visible={confirmAction === "restore"}
        title="아카이브 복원"
        message={actionTarget
          ? `"${actionTarget.name}" 회원을 정상(active) 상태로 복원합니다.\n\n기존 출결·일지·사진 기록이 모두 복원됩니다.`
          : ""}
        confirmText="복원"
        cancelText="취소"
        onConfirm={executeAction}
        onCancel={() => { setConfirmAction(null); setActionTarget(null); }}
      />

      {/* 영구 삭제 2단계 */}
      {confirmAction === "permanent_delete" && actionTarget && (
        <Modal visible animationType="fade" transparent onRequestClose={() => { setConfirmAction(null); setActionTarget(null); setDeleteStep(1); }}>
          <Pressable style={styles.backdrop} onPress={() => { setConfirmAction(null); setActionTarget(null); setDeleteStep(1); }} />
          <View style={styles.deleteModal}>
            {deleteStep === 1 ? (
              <>
                <View style={[styles.deleteIcon, { backgroundColor: "#FEF2F2" }]}>
                  <Feather name="alert-triangle" size={28} color="#D96C6C" />
                </View>
                <Text style={styles.deleteTitle}>영구 삭제 확인</Text>
                <Text style={styles.deleteMsg}>
                  <Text style={{ fontFamily: "Inter_700Bold" }}>{actionTarget.name}</Text>
                  {" "}회원을 영구 삭제합니다.{"\n\n"}
                  출결, 수업일지, 사진, 학부모 연결 등{"\n"}모든 데이터가 삭제되며{" "}
                  <Text style={{ color: "#D96C6C", fontFamily: "Inter_700Bold" }}>복구할 수 없습니다.</Text>
                </Text>
                <View style={styles.deleteBtnRow}>
                  <Pressable style={[styles.deleteBtn, { backgroundColor: C.border }]} onPress={() => { setConfirmAction(null); setActionTarget(null); }}>
                    <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: C.textSecondary }}>취소</Text>
                  </Pressable>
                  <Pressable style={[styles.deleteBtn, { backgroundColor: "#F9DEDA" }]} onPress={() => setDeleteStep(2)}>
                    <Text style={{ fontSize: 14, fontFamily: "Inter_700Bold", color: "#D96C6C" }}>다음 단계</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <>
                <View style={[styles.deleteIcon, { backgroundColor: "#D96C6C" }]}>
                  <Feather name="trash-2" size={28} color="#fff" />
                </View>
                <Text style={styles.deleteTitle}>정말 삭제하시겠습니까?</Text>
                <Text style={styles.deleteMsg}>
                  {`"${actionTarget.name}" 회원의 모든 데이터를 영구 삭제합니다.\n이 작업은 절대 되돌릴 수 없습니다.`}
                </Text>
                <View style={styles.deleteBtnRow}>
                  <Pressable style={[styles.deleteBtn, { backgroundColor: C.border }]} onPress={() => setDeleteStep(1)}>
                    <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: C.textSecondary }}>이전</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.deleteBtn, { backgroundColor: "#D96C6C" }]}
                    onPress={executeAction}
                    disabled={!!saving}
                  >
                    {saving ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={{ fontSize: 14, fontFamily: "Inter_700Bold", color: "#fff" }}>영구 삭제</Text>
                    )}
                  </Pressable>
                </View>
              </>
            )}
          </View>
        </Modal>
      )}
    </View>
  );
}

function MemberCard({
  item, tab, saving,
  onFinalWithdraw, onArchive, onRestore, onPermanentDelete,
}: {
  item: ArchivedMember;
  tab: MainTab;
  saving: boolean;
  onFinalWithdraw: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onPermanentDelete: () => void;
}) {
  const isAccessBlocked = item.archived_reason === "access_blocked";

  return (
    <View style={[styles.card, { backgroundColor: C.card }]}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 10 }}>
        <View style={[styles.avatar, { backgroundColor: tab === "withdrawn" ? "#FEF2F2" : "#F6F3F1" }]}>
          <Text style={[styles.avatarTxt, { color: tab === "withdrawn" ? "#D96C6C" : "#6F6B68" }]}>{item.name[0]}</Text>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={styles.memberName}>{item.name}</Text>
            {tab === "withdrawn" && isAccessBlocked && (
              <View style={[styles.tagBadge, { backgroundColor: "#D96C6C" }]}>
                <Feather name="lock" size={9} color="#fff" />
                <Text style={[styles.tagTxt, { color: "#fff" }]}>접근차단</Text>
              </View>
            )}
            {tab === "archived" && (
              <View style={[styles.tagBadge, { backgroundColor: "#E9E2DD" }]}>
                <Text style={[styles.tagTxt, { color: "#6F6B68" }]}>아카이브</Text>
              </View>
            )}
          </View>
          {item.birth_year ? <Text style={styles.memberSub}>{item.birth_year}년생</Text> : null}
          {item.last_class_group_name ? (
            <Text style={styles.memberSub}>마지막 반: {item.last_class_group_name}</Text>
          ) : null}
        </View>
        <View style={styles.attBadge}>
          <Text style={styles.attNum}>{item.attendance_count}</Text>
          <Text style={styles.attLabel}>회 출석</Text>
        </View>
      </View>

      <View style={styles.dateRow}>
        {tab === "withdrawn" && item.withdrawn_at && (
          <Text style={styles.dateText}>퇴원일: {fmtDate(item.withdrawn_at)}</Text>
        )}
        {tab === "archived" && (
          <Text style={styles.dateText}>처리일: {fmtDate(item.updated_at)}</Text>
        )}
      </View>

      {saving ? (
        <ActivityIndicator color={C.tint} style={{ marginTop: 8 }} />
      ) : (
        <View style={styles.actionRow}>
          {tab === "withdrawn" && (
            <>
              {!isAccessBlocked && (
                <Pressable style={[styles.actionBtn, { backgroundColor: "#FEF2F2", borderColor: "#FECACA" }]} onPress={onFinalWithdraw}>
                  <Feather name="lock" size={12} color="#D96C6C" />
                  <Text style={[styles.actionBtnTxt, { color: "#D96C6C" }]}>최종 퇴원처리</Text>
                </Pressable>
              )}
              <Pressable style={[styles.actionBtn, { backgroundColor: "#FBF8F6", borderColor: "#E9E2DD" }]} onPress={onArchive}>
                <Feather name="archive" size={12} color="#6F6B68" />
                <Text style={[styles.actionBtnTxt, { color: "#6F6B68" }]}>아카이브로 이동</Text>
              </Pressable>
            </>
          )}
          {tab === "archived" && (
            <>
              <Pressable style={[styles.actionBtn, { backgroundColor: "#DDF2EF", borderColor: "#BFDBFE" }]} onPress={onRestore}>
                <Feather name="rotate-ccw" size={12} color="#1F8F86" />
                <Text style={[styles.actionBtnTxt, { color: "#1F8F86" }]}>복원</Text>
              </Pressable>
              <Pressable style={[styles.actionBtn, { backgroundColor: "#FEF2F2", borderColor: "#FECACA" }]} onPress={onPermanentDelete}>
                <Feather name="trash-2" size={12} color="#D96C6C" />
                <Text style={[styles.actionBtnTxt, { color: "#D96C6C" }]}>영구 삭제</Text>
              </Pressable>
            </>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tabRow:      { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#E9E2DD" },
  tab:         { flex: 1, alignItems: "center", paddingVertical: 12, borderBottomWidth: 2.5, borderBottomColor: "transparent" },
  tabText:     { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  infoBanner:  { paddingHorizontal: 16, paddingVertical: 8, marginBottom: 8 },
  infoText:    { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },
  searchBox:   { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 12, height: 44, marginBottom: 10 },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular" },
  empty:       { alignItems: "center", justifyContent: "center", paddingTop: 80, gap: 12 },
  emptyText:   { fontSize: 15, fontFamily: "Inter_400Regular" },
  card:        { borderRadius: 14, padding: 14 },
  avatar:      { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  avatarTxt:   { fontSize: 14, fontFamily: "Inter_700Bold" },
  memberName:  { fontSize: 15, fontFamily: "Inter_700Bold", color: C.text },
  memberSub:   { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary },
  tagBadge:    { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 },
  tagTxt:      { fontSize: 9, fontFamily: "Inter_700Bold" },
  attBadge:    { alignItems: "center", justifyContent: "center", backgroundColor: "#F6F3F1", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, minWidth: 50 },
  attNum:      { fontSize: 16, fontFamily: "Inter_700Bold", color: C.tint },
  attLabel:    { fontSize: 10, fontFamily: "Inter_400Regular", color: C.textMuted, marginTop: 1 },
  dateRow:     { marginBottom: 8 },
  dateText:    { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textMuted },
  actionRow:   { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  actionBtn:   { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, borderWidth: 1 },
  actionBtnTxt:{ fontSize: 12, fontFamily: "Inter_600SemiBold" },
  backdrop:    { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  deleteModal: { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 28, alignItems: "center", gap: 12, paddingBottom: 48 },
  deleteIcon:  { width: 60, height: 60, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  deleteTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: C.text },
  deleteMsg:   { fontSize: 14, fontFamily: "Inter_400Regular", color: C.textSecondary, textAlign: "center", lineHeight: 22 },
  deleteBtnRow:{ flexDirection: "row", gap: 12, width: "100%", marginTop: 4 },
  deleteBtn:   { flex: 1, alignItems: "center", paddingVertical: 13, borderRadius: 12 },
});
