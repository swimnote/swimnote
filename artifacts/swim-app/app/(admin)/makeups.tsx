/**
 * 보강 시스템 메인 화면
 * 탭: 결석자 리스트 / 담당 보강 / 다른선생님 / 완료 기록 / 만료
 * 실 DB: /admin/makeups, /admin/makeups/eligible-classes,
 *         /admin/makeups/:id/assign, /transfer, /complete, /cancel, /revert
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, FlatList, Modal, Platform, Pressable,
  RefreshControl, ScrollView, StyleSheet, Text, View,
} from "react-native";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { ModalSheet } from "@/components/common/ModalSheet";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { ConfirmModal } from "@/components/common/ConfirmModal";
import { useBrand } from "@/context/BrandContext";

const C = Colors.light;
const TAB_BAR_H = Platform.OS === "web" ? 84 : Platform.OS === "android" ? 56 : 49;
const TABS = ["결석자 리스트", "담당 보강", "다른선생님", "완료 기록", "만료"] as const;
type MkTab = typeof TABS[number];

const MK_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  waiting:     { label: "대기",   color: "#D97706", bg: "#FFF1BF" },
  assigned:    { label: "배정",   color: "#2EC4B6", bg: "#E6FFFA" },
  transferred: { label: "이동",   color: "#7C3AED", bg: "#EEDDF5" },
  completed:   { label: "완료",   color: "#2EC4B6", bg: "#E6FFFA" },
  cancelled:   { label: "취소",   color: "#6B7280", bg: "#F8FAFC" },
  expired:     { label: "만료",   color: "#9CA3AF", bg: "#F3F4F6" },
};

type ConfirmAction = {
  title: string;
  message: string;
  confirmText: string;
  confirmColor?: string;
  onConfirm: () => Promise<void>;
} | null;

export default function MakeupsScreen() {
  const { token } = useAuth();
  const { themeColor } = useBrand();

  const [tab, setTab]           = useState<MkTab>("결석자 리스트");
  const [makeups, setMakeups]   = useState<any[]>([]);
  const [loading, setLoading]   = useState(true);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);

  const [assignModal, setAssignModal]       = useState<{ mk: any } | null>(null);
  const [transferModal, setTransferModal]   = useState<{ mk: any } | null>(null);
  const [eligibleClasses, setEligibleClasses] = useState<any[]>([]);
  const [teachers, setTeachers]              = useState<any[]>([]);
  const [classLoading, setClassLoading]     = useState(false);
  const [conflictVisible, setConflictVisible] = useState(false);

  const statusFilter: Record<MkTab, string | null> = {
    "결석자 리스트": "waiting",
    "담당 보강":     "assigned",
    "다른선생님":    "transferred",
    "완료 기록":     "completed",
    "만료":          "expired",
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const st = statusFilter[tab];
      const url = st ? `/admin/makeups?status=${st}` : `/admin/makeups`;
      const r = await apiRequest(token, url);
      if (r.ok) setMakeups(await r.json());
    } finally { setLoading(false); }
  }, [token, tab]);

  useEffect(() => { load(); }, [load]);

  const openAssignModal = async (mk: any) => {
    setAssignModal({ mk });
    setClassLoading(true);
    const r = await apiRequest(token, `/admin/makeups/eligible-classes?teacher_id=${mk.original_teacher_id || ""}`);
    if (r.ok) setEligibleClasses(await r.json());
    setClassLoading(false);
  };

  const openTransferModal = async (mk: any) => {
    setTransferModal({ mk });
    const r = await apiRequest(token, "/admin/teachers");
    if (r.ok) setTeachers(await r.json());
  };

  const handleAssign = async (mk: any, classGroup: any) => {
    const r = await apiRequest(token, `/admin/makeups/${mk.id}/assign`, {
      method: "PATCH", body: JSON.stringify({ class_group_id: classGroup.id }),
    });
    setAssignModal(null);
    if (r.status === 409) { setConflictVisible(true); return; }
    load();
  };

  const handleTransfer = async (mk: any, teacher: any) => {
    await apiRequest(token, `/admin/makeups/${mk.id}/transfer`, {
      method: "PATCH", body: JSON.stringify({ target_teacher_id: teacher.id, target_teacher_name: teacher.name }),
    });
    setTransferModal(null);
    load();
  };

  const requestComplete = (mk: any) => {
    setConfirmAction({
      title: "보강 완료 처리",
      message: `${mk.student_name}의 보강을 완료로 처리합니까?\n완료 처리 후에는 되돌릴 수 없습니다.`,
      confirmText: "완료 처리",
      onConfirm: async () => {
        const r = await apiRequest(token, `/admin/makeups/${mk.id}/complete`, { method: "PATCH" });
        if (r.status === 409) { setConflictVisible(true); load(); return; }
        if (r.ok) load();
      },
    });
  };

  const requestRevert = (mk: any) => {
    setConfirmAction({
      title: "보강대기자로 되돌리기",
      message: `${mk.student_name}을(를) 보강 대기 목록으로 되돌립니까?\n배정/이동 정보가 모두 초기화됩니다.`,
      confirmText: "되돌리기",
      confirmColor: "#D97706",
      onConfirm: async () => {
        const r = await apiRequest(token, `/admin/makeups/${mk.id}/revert`, { method: "PATCH" });
        if (r.ok) load();
      },
    });
  };

  const requestCancel = (mk: any) => {
    setConfirmAction({
      title: "보강 취소",
      message: "이 보강 항목을 취소하시겠습니까?\n취소된 항목은 복구할 수 없습니다.",
      confirmText: "취소 처리",
      confirmColor: "#D96C6C",
      onConfirm: async () => {
        const r = await apiRequest(token, `/admin/makeups/${mk.id}/cancel`, { method: "PATCH" });
        if (r.ok) load();
      },
    });
  };

  return (
    <View style={s.root}>
      <SubScreenHeader
        title="보강 관리"
        rightSlot={
          <Pressable
            onPress={() => router.push("/(admin)/makeup-policy" as any)}
            style={{ paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, backgroundColor: "#EEDDF5" }}
          >
            <Text style={{ fontSize: 12, fontWeight: "700", color: "#7C3AED" }}>정책 설정</Text>
          </Pressable>
        }
      />

      {/* 탭 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chipRow}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
        {TABS.map(t => (
          <Pressable key={t} onPress={() => setTab(t)}
            style={[s.chip, tab === t && { backgroundColor: themeColor, borderColor: themeColor }]}>
            <Text style={[s.chipTxt, tab === t && { color: "#fff" }]}>{t}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {loading ? (
        <ActivityIndicator style={{ flex: 1 }} color={themeColor} />
      ) : (
        <FlatList
          data={makeups}
          keyExtractor={item => item.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: TAB_BAR_H + 16 }}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
          ListEmptyComponent={
            <View style={s.empty}>
              <Feather name="check-circle" size={40} color={C.border} />
              <Text style={s.emptyTxt}>
                {tab === "결석자 리스트" ? "처리할 결석자가 없습니다"
                  : tab === "만료" ? "만료된 보강권이 없습니다"
                  : "항목이 없습니다"}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <MakeupCard
              item={item} tab={tab} themeColor={themeColor}
              onAssign={() => openAssignModal(item)}
              onTransfer={() => openTransferModal(item)}
              onComplete={() => requestComplete(item)}
              onRevert={() => requestRevert(item)}
              onCancel={() => requestCancel(item)}
              onMemberPress={() => router.push({ pathname: "/(admin)/member-detail", params: { id: item.student_id } })}
            />
          )}
        />
      )}

      {/* 반 배정 모달 */}
      <ModalSheet
        visible={!!assignModal}
        onClose={() => setAssignModal(null)}
        title={`${assignModal?.mk?.student_name || ""} 보강반 배정`}
      >
        <Text style={s.modalSub}>정원 여유 있는 반만 표시됩니다. 레벨 판단은 선생님 몫입니다.</Text>
        {classLoading ? (
          <ActivityIndicator style={{ marginTop: 20 }} color={themeColor} />
        ) : eligibleClasses.length === 0 ? (
          <View style={s.empty}><Text style={s.emptyTxt}>배정 가능한 반이 없습니다</Text></View>
        ) : (
          eligibleClasses.map(item => (
            <Pressable key={item.id} style={[s.classCard, { borderColor: themeColor }]}
              onPress={() => handleAssign(assignModal!.mk, item)}>
              <Text style={s.className}>{item.name}</Text>
              <Text style={s.classSub}>{item.schedule_days} {item.schedule_time}</Text>
              <Text style={s.classSub}>담당: {item.instructor || "미정"}  정원 여유: {item.available_slots === 999 ? "제한없음" : `${item.available_slots}명`}</Text>
            </Pressable>
          ))
        )}
      </ModalSheet>

      {/* 다른선생님 이동 모달 */}
      <ModalSheet
        visible={!!transferModal}
        onClose={() => setTransferModal(null)}
        title={`${transferModal?.mk?.student_name || ""} 다른선생님 이동`}
      >
        <Text style={s.modalSub}>이동하면 해당 선생님의 보강 리스트에 추가됩니다.</Text>
        {teachers.filter(t => t.id !== transferModal?.mk?.original_teacher_id).map(item => (
          <Pressable key={item.id} style={[s.classCard, { borderColor: "#6B7280" }]}
            onPress={() => handleTransfer(transferModal!.mk, item)}>
            <Text style={s.className}>{item.name}</Text>
            <Text style={s.classSub}>담당반: {item.class_count}개  회원: {item.student_count}명</Text>
          </Pressable>
        ))}
      </ModalSheet>

      {/* 확인 모달 (완료/되돌리기/취소 공용) */}
      <ConfirmModal
        visible={!!confirmAction}
        title={confirmAction?.title ?? ""}
        message={confirmAction?.message ?? ""}
        confirmText={confirmAction?.confirmText ?? "확인"}
        onConfirm={async () => {
          if (confirmAction) await confirmAction.onConfirm();
          setConfirmAction(null);
        }}
        onCancel={() => setConfirmAction(null)}
      />

      {/* 동시성 충돌 팝업 */}
      {conflictVisible && (
        <Modal visible animationType="fade" transparent onRequestClose={() => { setConflictVisible(false); load(); }}>
          <Pressable style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.45)" }}
            onPress={() => { setConflictVisible(false); load(); }} />
          <View style={{ position: "absolute", left: 24, right: 24, top: "35%", backgroundColor: "#fff", borderRadius: 14, padding: 24, alignItems: "center", shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 12, elevation: 10 }}>
            <Text style={{ fontSize: 17, fontWeight: "700", color: "#222", marginBottom: 8 }}>보강 상태가 변경되었습니다</Text>
            <Text style={{ fontSize: 14, color: "#555", textAlign: "center", marginBottom: 20 }}>다른 작업자가 먼저 처리했습니다.{"\n"}최신 목록을 다시 불러옵니다.</Text>
            <Pressable
              onPress={() => { setConflictVisible(false); load(); }}
              style={{ backgroundColor: themeColor, paddingHorizontal: 32, paddingVertical: 12, borderRadius: 8 }}
            >
              <Text style={{ color: "#fff", fontSize: 15, fontWeight: "600" }}>확인</Text>
            </Pressable>
          </View>
        </Modal>
      )}
    </View>
  );
}

function formatExpireAt(expireAt: string | null): { text: string; color: string } | null {
  if (!expireAt) return null;
  const d = new Date(expireAt);
  const now = new Date();
  const diffDays = Math.ceil((d.getTime() - now.getTime()) / 86400000);
  const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  if (diffDays < 0) return { text: `만료됨 (${dateStr})`, color: "#9CA3AF" };
  if (diffDays <= 7) return { text: `만료 D-${diffDays} (${dateStr})`, color: "#D96C6C" };
  if (diffDays <= 14) return { text: `만료 D-${diffDays} (${dateStr})`, color: "#D97706" };
  return { text: `만료일: ${dateStr}`, color: "#6B7280" };
}

function MakeupCard({ item, tab, themeColor, onAssign, onTransfer, onComplete, onRevert, onCancel, onMemberPress }: {
  item: any; tab: MkTab; themeColor: string;
  onAssign: () => void; onTransfer: () => void;
  onComplete: () => void; onRevert: () => void; onCancel: () => void;
  onMemberPress: () => void;
}) {
  const st = MK_STATUS[item.status] || { label: item.status, color: "#6B7280", bg: "#F8FAFC" };
  const expireInfo = formatExpireAt(item.expire_at);
  return (
    <View style={s.card}>
      <View style={s.row}>
        <View style={{ flex: 1 }}>
          <Pressable onPress={onMemberPress}>
            <Text style={[s.name, { color: themeColor, textDecorationLine: "underline" }]}>{item.student_name}</Text>
          </Pressable>
          <Text style={s.sub}>결석일: {item.absence_date}</Text>
          <Text style={s.sub}>원반: {item.original_class_group_name || "미배정"}  담당: {item.original_teacher_name || "미배정"}</Text>
          {item.assigned_class_group_name && <Text style={s.sub}>배정반: {item.assigned_class_group_name}</Text>}
          {item.transferred_to_teacher_name && (
            <Text style={[s.sub, { color: "#7C3AED" }]}>이동선생님: {item.transferred_to_teacher_name}</Text>
          )}
          {item.is_substitute && item.substitute_teacher_name && (
            <Text style={[s.sub, { color: "#2EC4B6", fontWeight: "600" }]}>대리보강: {item.substitute_teacher_name}</Text>
          )}
          {expireInfo && (
            <Text style={[s.sub, { color: expireInfo.color, fontWeight: "600" }]}>{expireInfo.text}</Text>
          )}
          {item.note && <Text style={s.sub}>메모: {item.note}</Text>}
        </View>
        <View style={[s.badge, { backgroundColor: st.bg }]}>
          <Text style={[s.badgeTxt, { color: st.color }]}>{st.label}</Text>
        </View>
      </View>

      {/* 결석자 리스트 액션 */}
      {tab === "결석자 리스트" && (
        <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
          <Pressable style={[s.actBtn, { backgroundColor: themeColor }]} onPress={onAssign}>
            <Text style={s.actBtnTxt}>보강반 배정</Text>
          </Pressable>
          <Pressable style={[s.actBtn, { backgroundColor: "#EEDDF5" }]} onPress={onTransfer}>
            <Text style={[s.actBtnTxt, { color: "#7C3AED" }]}>다른선생님</Text>
          </Pressable>
          <Pressable style={[s.actBtn, { backgroundColor: "#F8FAFC" }]} onPress={onCancel}>
            <Text style={[s.actBtnTxt, { color: "#6B7280" }]}>취소</Text>
          </Pressable>
        </View>
      )}

      {/* 담당 보강 액션 */}
      {tab === "담당 보강" && (
        <View style={{ gap: 8, marginTop: 10 }}>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable style={[s.actBtn, { backgroundColor: "#E6FFFA", flex: 1 }]} onPress={onComplete}>
              <Feather name="check-circle" size={14} color="#2EC4B6" />
              <Text style={[s.actBtnTxt, { color: "#2EC4B6" }]}>보강 완료 처리</Text>
            </Pressable>
            <Pressable style={[s.actBtn, { backgroundColor: "#F8FAFC" }]} onPress={onCancel}>
              <Text style={[s.actBtnTxt, { color: "#6B7280" }]}>취소</Text>
            </Pressable>
          </View>
          <Pressable style={[s.revertBtn]} onPress={onRevert}>
            <Feather name="rotate-ccw" size={13} color="#D97706" />
            <Text style={s.revertTxt}>보강대기자로 되돌리기</Text>
          </Pressable>
        </View>
      )}

      {/* 다른선생님 탭 액션 */}
      {tab === "다른선생님" && (
        <View style={{ gap: 8, marginTop: 10 }}>
          <Pressable style={[s.actBtn, { backgroundColor: "#E6FFFA", flexDirection: "row", gap: 6 }]} onPress={onComplete}>
            <Feather name="check-circle" size={14} color="#2EC4B6" />
            <Text style={[s.actBtnTxt, { color: "#2EC4B6" }]}>대리보강 완료</Text>
          </Pressable>
          <Pressable style={s.revertBtn} onPress={onRevert}>
            <Feather name="rotate-ccw" size={13} color="#D97706" />
            <Text style={s.revertTxt}>보강대기자로 되돌리기</Text>
          </Pressable>
        </View>
      )}

      {/* 완료 기록 탭 — 읽기 전용 */}
      {tab === "완료 기록" && item.substitute_teacher_name && (
        <View style={[s.completedBanner]}>
          <Feather name="user-check" size={12} color="#2EC4B6" />
          <Text style={s.completedTxt}>
            대리 진행: {item.substitute_teacher_name} 선생님
          </Text>
        </View>
      )}

      {/* 만료 탭 — 읽기 전용 */}
      {tab === "만료" && (
        <View style={[s.completedBanner, { backgroundColor: "#F3F4F6" }]}>
          <Feather name="clock" size={12} color="#9CA3AF" />
          <Text style={[s.completedTxt, { color: "#6B7280" }]}>
            보강권 만료됨{item.expire_at ? ` · ${new Date(item.expire_at).toLocaleDateString("ko-KR")}` : ""}
          </Text>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root:          { flex: 1, backgroundColor: C.background },
  chipRow:       { flexGrow: 0, paddingVertical: 8 },
  chip:          { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: C.border, backgroundColor: "#fff" },
  chipTxt:       { fontSize: 13, fontWeight: "600", color: C.textSecondary },
  card:          { backgroundColor: "#fff", borderRadius: 12, padding: 14, marginBottom: 10, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  row:           { flexDirection: "row", alignItems: "flex-start" },
  name:          { fontSize: 15, fontWeight: "700", color: C.text },
  sub:           { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  badge:         { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  badgeTxt:      { fontSize: 11, fontWeight: "600" },
  actBtn:        { flex: 1, flexDirection: "row", borderRadius: 8, paddingVertical: 9, alignItems: "center", justifyContent: "center", gap: 4 },
  actBtnTxt:     { fontSize: 13, fontWeight: "700", color: "#fff" },
  revertBtn:     { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 8, borderRadius: 8, borderWidth: 1.5, borderColor: "#D97706", backgroundColor: "#FFF8EE" },
  revertTxt:     { fontSize: 13, fontWeight: "600", color: "#D97706" },
  completedBanner:{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8, backgroundColor: "#E6FFFA", borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10 },
  completedTxt:  { fontSize: 12, fontWeight: "600", color: "#2EC4B6" },
  empty:         { paddingVertical: 50, alignItems: "center", gap: 10 },
  emptyTxt:      { color: C.textSecondary, fontSize: 14 },
  modalSub:      { paddingHorizontal: 16, fontSize: 12, color: C.textSecondary, marginBottom: 4 },
  classCard:     { backgroundColor: "#fff", borderRadius: 10, padding: 14, borderWidth: 1.5 },
  className:     { fontSize: 15, fontWeight: "700", color: C.text },
  classSub:      { fontSize: 12, color: C.textSecondary, marginTop: 3 },
});
