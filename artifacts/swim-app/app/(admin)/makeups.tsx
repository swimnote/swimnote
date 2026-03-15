/**
 * 보강 시스템 메인 화면
 * 탭: 결석자 리스트 / 담당선생님 보강 / 다른선생님 보강 / 완료 기록
 * 실 DB: /admin/makeups, /admin/makeups/eligible-classes, /admin/makeups/:id/assign, /transfer, /complete, /cancel
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, Modal, Platform, Pressable,
  RefreshControl, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";

const C = Colors.light;
const TAB_BAR_H = Platform.OS === "web" ? 84 : Platform.OS === "android" ? 56 : 49;
const TABS = ["결석자 리스트", "담당 보강", "다른선생님", "완료 기록"] as const;
type MkTab = typeof TABS[number];

const MK_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  waiting:     { label: "대기",   color: "#D97706", bg: "#FEF3C7" },
  assigned:    { label: "배정",   color: "#2563EB", bg: "#DBEAFE" },
  transferred: { label: "이동",   color: "#7C3AED", bg: "#EDE9FE" },
  completed:   { label: "완료",   color: "#059669", bg: "#D1FAE5" },
  cancelled:   { label: "취소",   color: "#6B7280", bg: "#F3F4F6" },
};

export default function MakeupsScreen() {
  const { token } = useAuth();
  const { themeColor } = useBrand();
  const insets = useSafeAreaInsets();

  const [tab, setTab]           = useState<MkTab>("결석자 리스트");
  const [makeups, setMakeups]   = useState<any[]>([]);
  const [loading, setLoading]   = useState(true);

  const [assignModal, setAssignModal]       = useState<{ mk: any } | null>(null);
  const [transferModal, setTransferModal]   = useState<{ mk: any } | null>(null);
  const [eligibleClasses, setEligibleClasses] = useState<any[]>([]);
  const [teachers, setTeachers]              = useState<any[]>([]);
  const [classLoading, setClassLoading]     = useState(false);

  const statusFilter: Record<MkTab, string | null> = {
    "결석자 리스트": "waiting",
    "담당 보강":     "assigned",
    "다른선생님":    "transferred",
    "완료 기록":     "completed",
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
    await apiRequest(token, `/admin/makeups/${mk.id}/assign`, {
      method: "PATCH", body: JSON.stringify({ class_group_id: classGroup.id }),
    });
    setAssignModal(null);
    load();
  };

  const handleTransfer = async (mk: any, teacher: any) => {
    await apiRequest(token, `/admin/makeups/${mk.id}/transfer`, {
      method: "PATCH", body: JSON.stringify({ target_teacher_id: teacher.id, target_teacher_name: teacher.name }),
    });
    setTransferModal(null);
    load();
  };

  const handleComplete = (mk: any) => {
    Alert.alert("보강 완료 처리", `${mk.student_name}의 보강을 완료로 처리합니까?`, [
      { text: "취소", style: "cancel" },
      {
        text: "완료 처리",
        onPress: async () => {
          await apiRequest(token, `/admin/makeups/${mk.id}/complete`, { method: "PATCH" });
          load();
        },
      },
    ]);
  };

  const handleCancel = (mk: any) => {
    Alert.alert("보강 취소", "이 보강 항목을 취소하시겠습니까?", [
      { text: "돌아가기", style: "cancel" },
      {
        text: "취소 처리", style: "destructive",
        onPress: async () => {
          await apiRequest(token, `/admin/makeups/${mk.id}/cancel`, { method: "PATCH" });
          load();
        },
      },
    ]);
  };

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      {/* 헤더 */}
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.back}><Feather name="arrow-left" size={22} color={C.text} /></Pressable>
        <Text style={s.title}>보강 관리</Text>
        <View style={{ width: 32 }} />
      </View>

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
              <Text style={s.emptyTxt}>{tab === "결석자 리스트" ? "처리할 결석자가 없습니다" : "항목이 없습니다"}</Text>
            </View>
          }
          renderItem={({ item }) => (
            <MakeupCard
              item={item} tab={tab} themeColor={themeColor}
              onAssign={() => openAssignModal(item)}
              onTransfer={() => openTransferModal(item)}
              onComplete={() => handleComplete(item)}
              onCancel={() => handleCancel(item)}
              onMemberPress={() => router.push({ pathname: "/(admin)/member-detail", params: { id: item.student_id } })}
            />
          )}
        />
      )}

      {/* 반 배정 모달 (담당선생님 스케줄) */}
      <Modal visible={!!assignModal} animationType="slide" presentationStyle="pageSheet">
        <View style={[s.modal, { paddingTop: insets.top }]}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>{assignModal?.mk?.student_name} 보강반 배정</Text>
            <Pressable onPress={() => setAssignModal(null)}><Feather name="x" size={22} color={C.text} /></Pressable>
          </View>
          <Text style={s.modalSub}>정원 여유 있는 반만 표시됩니다. 레벨 판단은 선생님 몫입니다.</Text>
          {classLoading ? (
            <ActivityIndicator style={{ marginTop: 40 }} color={themeColor} />
          ) : eligibleClasses.length === 0 ? (
            <View style={s.empty}><Text style={s.emptyTxt}>배정 가능한 반이 없습니다</Text></View>
          ) : (
            <FlatList
              data={eligibleClasses}
              keyExtractor={item => item.id}
              contentContainerStyle={{ padding: 16, gap: 8 }}
              renderItem={({ item }) => (
                <Pressable style={[s.classCard, { borderColor: themeColor }]}
                  onPress={() => handleAssign(assignModal!.mk, item)}>
                  <Text style={s.className}>{item.name}</Text>
                  <Text style={s.classSub}>{item.schedule_days} {item.schedule_time}</Text>
                  <Text style={s.classSub}>담당: {item.instructor || "미정"}  정원 여유: {item.available_slots === 999 ? "제한없음" : `${item.available_slots}명`}</Text>
                </Pressable>
              )}
            />
          )}
        </View>
      </Modal>

      {/* 다른선생님 이동 모달 */}
      <Modal visible={!!transferModal} animationType="slide" presentationStyle="pageSheet">
        <View style={[s.modal, { paddingTop: insets.top }]}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>{transferModal?.mk?.student_name} 다른선생님 이동</Text>
            <Pressable onPress={() => setTransferModal(null)}><Feather name="x" size={22} color={C.text} /></Pressable>
          </View>
          <Text style={s.modalSub}>이동하면 해당 선생님의 보강 리스트에 추가됩니다.</Text>
          <FlatList
            data={teachers.filter(t => t.id !== transferModal?.mk?.original_teacher_id)}
            keyExtractor={item => item.id}
            contentContainerStyle={{ padding: 16, gap: 8 }}
            renderItem={({ item }) => (
              <Pressable style={[s.classCard, { borderColor: "#6B7280" }]}
                onPress={() => handleTransfer(transferModal!.mk, item)}>
                <Text style={s.className}>{item.name}</Text>
                <Text style={s.classSub}>담당반: {item.class_count}개  회원: {item.student_count}명</Text>
              </Pressable>
            )}
          />
        </View>
      </Modal>
    </View>
  );
}

function MakeupCard({ item, tab, themeColor, onAssign, onTransfer, onComplete, onCancel, onMemberPress }: {
  item: any; tab: MkTab; themeColor: string;
  onAssign: () => void; onTransfer: () => void; onComplete: () => void; onCancel: () => void; onMemberPress: () => void;
}) {
  const st = MK_STATUS[item.status] || { label: item.status, color: "#6B7280", bg: "#F3F4F6" };
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
          {item.transferred_to_teacher_name && <Text style={[s.sub, { color: "#7C3AED" }]}>이동선생님: {item.transferred_to_teacher_name}</Text>}
          {item.is_substitute && item.substitute_teacher_name && (
            <Text style={[s.sub, { color: "#059669", fontWeight: "600" }]}>대리보강: {item.substitute_teacher_name}</Text>
          )}
          {item.note && <Text style={s.sub}>메모: {item.note}</Text>}
        </View>
        <View style={[s.badge, { backgroundColor: st.bg }]}>
          <Text style={[s.badgeTxt, { color: st.color }]}>{st.label}</Text>
        </View>
      </View>

      {/* 액션 버튼 */}
      {(tab === "결석자 리스트" || tab === "담당 보강") && (
        <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
          {tab === "결석자 리스트" && (
            <>
              <Pressable style={[s.actBtn, { backgroundColor: themeColor }]} onPress={onAssign}>
                <Text style={s.actBtnTxt}>보강반 배정</Text>
              </Pressable>
              <Pressable style={[s.actBtn, { backgroundColor: "#EDE9FE" }]} onPress={onTransfer}>
                <Text style={[s.actBtnTxt, { color: "#7C3AED" }]}>다른선생님</Text>
              </Pressable>
            </>
          )}
          {tab === "담당 보강" && (
            <Pressable style={[s.actBtn, { backgroundColor: "#D1FAE5", flex: 1 }]} onPress={onComplete}>
              <Text style={[s.actBtnTxt, { color: "#059669" }]}>보강 완료 처리</Text>
            </Pressable>
          )}
          <Pressable style={[s.actBtn, { backgroundColor: "#F3F4F6" }]} onPress={onCancel}>
            <Text style={[s.actBtnTxt, { color: "#6B7280" }]}>취소</Text>
          </Pressable>
        </View>
      )}
      {tab === "다른선생님" && (
        <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
          <Pressable style={[s.actBtn, { backgroundColor: "#D1FAE5", flex: 1 }]} onPress={onComplete}>
            <Text style={[s.actBtnTxt, { color: "#059669" }]}>대리보강 완료</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root:       { flex: 1, backgroundColor: C.background },
  header:     { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12 },
  back:       { width: 32 },
  title:      { flex: 1, fontSize: 20, fontWeight: "700", color: C.text },
  chipRow:    { flexGrow: 0, paddingVertical: 8 },
  chip:       { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: C.border, backgroundColor: "#fff" },
  chipTxt:    { fontSize: 13, fontWeight: "600", color: C.textSecondary },
  card:       { backgroundColor: "#fff", borderRadius: 12, padding: 14, marginBottom: 10, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  row:        { flexDirection: "row", alignItems: "flex-start" },
  name:       { fontSize: 15, fontWeight: "700", color: C.text },
  sub:        { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  badge:      { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  badgeTxt:   { fontSize: 11, fontWeight: "600" },
  actBtn:     { flex: 1, borderRadius: 8, paddingVertical: 9, alignItems: "center" },
  actBtnTxt:  { fontSize: 13, fontWeight: "700", color: "#fff" },
  empty:      { paddingVertical: 50, alignItems: "center", gap: 10 },
  emptyTxt:   { color: C.textSecondary, fontSize: 14 },
  modal:      { flex: 1, backgroundColor: C.background },
  modalHeader:{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14 },
  modalTitle: { fontSize: 18, fontWeight: "700", color: C.text },
  modalSub:   { paddingHorizontal: 16, fontSize: 12, color: C.textSecondary, marginBottom: 4 },
  classCard:  { backgroundColor: "#fff", borderRadius: 10, padding: 14, borderWidth: 1.5 },
  className:  { fontSize: 15, fontWeight: "700", color: C.text },
  classSub:   { fontSize: 12, color: C.textSecondary, marginTop: 3 },
});
