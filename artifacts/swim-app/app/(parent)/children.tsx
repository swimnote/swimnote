/**
 * 학부모 자녀 연결/추가 화면
 * - 현재 연결된 자녀 목록 (클릭 → 자녀 프로필)
 * - 새 자녀 연결 요청 입력 영역
 * - ParentScreenHeader (홈 버튼 → 학부모 홈)
 */
import { ChevronRight, User, UserX } from "lucide-react-native";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { ConfirmModal } from "@/components/common/ConfirmModal";
import { ParentScreenHeader } from "@/components/parent/ParentScreenHeader";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useParent } from "@/context/ParentContext";

const C = Colors.light;
const CHILD_COLORS = [C.tint, "#2EC4B6", "#7C3AED", "#D97706", "#0EA5E9"];

const DAY_ORDER = ["월", "화", "수", "목", "금", "토", "일"];
function parseScheduleText(days: string, time: string): string {
  let parts: string[] = [];
  if (days.includes(",")) parts = days.split(",").map(d => d.trim()).filter(Boolean);
  else parts = days.split("").filter(d => DAY_ORDER.includes(d));
  parts.sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b));
  return parts.map(d => `${d} ${time}`).join("  ");
}

interface StudentRequest { id: string; child_name: string; status: string; created_at: string; memo?: string | null; }

export default function ChildrenScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const { students, refresh } = useParent();
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [requests, setRequests] = useState<StudentRequest[]>([]);
  const [childName, setChildName] = useState("");
  const [childBirth, setChildBirth] = useState("");
  const [memo, setMemo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitConfirm, setSubmitConfirm] = useState(false);
  const [submitDone, setSubmitDone] = useState(false);

  useEffect(() => { fetchRequests(); }, []);

  async function fetchRequests() {
    try {
      const res = await apiRequest(token, "/parent/student-requests");
      if (res.ok) setRequests(await res.json());
    } catch {}
  }

  async function onRefresh() {
    setRefreshing(true);
    await Promise.all([refresh(), fetchRequests()]);
    setRefreshing(false);
  }

  async function submitRequest() {
    if (!childName.trim()) return;
    setSubmitting(true);
    try {
      const res = await apiRequest(token, "/parent/student-requests", {
        method: "POST",
        body: JSON.stringify({
          child_name: childName.trim(),
          child_birth_date: childBirth.trim() || null,
          memo: memo.trim() || null,
        }),
      });
      if (res.ok) {
        setChildName(""); setChildBirth(""); setMemo("");
        await fetchRequests();
        setSubmitDone(true);
      }
    } finally { setSubmitting(false); }
  }

  function statusLabel(s: string) {
    return { pending: "검토 중", approved: "승인됨", rejected: "거절됨" }[s] ?? s;
  }
  function statusColor(s: string) {
    return { pending: "#D97706", approved: "#2EC4B6", rejected: "#D96C6C" }[s] ?? C.textMuted;
  }

  return (
    <View style={[s.root, { backgroundColor: C.background }]}>
      <ParentScreenHeader title="자녀 연결/추가" />

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.tint} />}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 40, gap: 14, paddingTop: 8 }}
      >
        {/* ─ 현재 연결된 자녀 ─ */}
        <Text style={[s.sectionTitle, { color: C.text }]}>연결된 자녀</Text>

        {students.length === 0 ? (
          <View style={[s.emptyBox, { backgroundColor: C.card }]}>
            <UserX size={36} color={C.textMuted} />
            <Text style={[s.emptyTxt, { color: C.textSecondary }]}>아직 연결된 자녀가 없습니다</Text>
          </View>
        ) : (
          students.map((st, i) => {
            const color = CHILD_COLORS[i % CHILD_COLORS.length];
            return (
              <Pressable
                key={st.id}
                style={({ pressed }) => [s.childCard, { backgroundColor: C.card, opacity: pressed ? 0.9 : 1 }]}
                onPress={() => router.push({ pathname: "/(parent)/child-profile" as any, params: { id: st.id } })}
              >
                <View style={[s.childAvatar, { backgroundColor: color + "22" }]}>
                  <Text style={[s.childAvatarTxt, { color }]}>{st.name[0]}</Text>
                </View>
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={[s.childName, { color: C.text }]}>{st.name}</Text>
                  {st.class_group?.name
                    ? <Text style={[s.childClass, { color: C.textSecondary }]}>
                        {st.class_group.name}
                        {st.class_group.schedule_days && st.class_group.schedule_time
                          ? ` · ${parseScheduleText(st.class_group.schedule_days, st.class_group.schedule_time)}`
                          : ""}
                      </Text>
                    : <Text style={[s.childClass, { color: C.textMuted }]}>반 배정 전</Text>
                  }
                </View>
                <ChevronRight size={18} color={C.textMuted} />
              </Pressable>
            );
          })
        )}

        {/* ─ 신청 현황 ─ */}
        {requests.length > 0 && (
          <>
            <Text style={[s.sectionTitle, { color: C.text }]}>신청 현황</Text>
            {requests.map(req => (
              <View key={req.id} style={[s.reqCard, { backgroundColor: C.card }]}>
                <View style={[s.reqAvatar, { backgroundColor: C.tintLight }]}>
                  <User size={18} color={C.tint} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[s.childName, { color: C.text }]}>{req.child_name}</Text>
                  {req.memo ? <Text style={[s.childClass, { color: C.textMuted }]}>{req.memo}</Text> : null}
                </View>
                <View style={[s.reqStatus, { backgroundColor: statusColor(req.status) + "22" }]}>
                  <Text style={[s.reqStatusTxt, { color: statusColor(req.status) }]}>{statusLabel(req.status)}</Text>
                </View>
              </View>
            ))}
          </>
        )}

        {/* ─ 새 자녀 연결 요청 ─ */}
        <Text style={[s.sectionTitle, { color: C.text }]}>새 자녀 연결 요청</Text>
        <View style={[s.formCard, { backgroundColor: C.card }]}>
          <Text style={[s.formLabel, { color: C.textSecondary }]}>자녀 이름 *</Text>
          <TextInput
            style={[s.input, { backgroundColor: "#FFFFFF", color: C.text }]}
            placeholder="자녀 이름을 입력하세요"
            placeholderTextColor={C.textMuted}
            value={childName}
            onChangeText={setChildName}
          />
          <Text style={[s.formLabel, { color: C.textSecondary }]}>생년월일 (YYYY-MM-DD)</Text>
          <TextInput
            style={[s.input, { backgroundColor: "#FFFFFF", color: C.text }]}
            placeholder="예: 2017-03-20"
            placeholderTextColor={C.textMuted}
            value={childBirth}
            onChangeText={t => setChildBirth(t.replace(/[^0-9-]/g, ""))}
            keyboardType="numbers-and-punctuation"
            maxLength={10}
          />
          <Text style={[s.formLabel, { color: C.textSecondary }]}>전달 메모 (선택)</Text>
          <TextInput
            style={[s.input, s.inputMulti, { backgroundColor: "#FFFFFF", color: C.text }]}
            placeholder="관리자에게 전달할 내용이 있으면 입력하세요"
            placeholderTextColor={C.textMuted}
            value={memo}
            onChangeText={setMemo}
            multiline
            numberOfLines={3}
          />
          <Text style={[s.formNote, { color: C.textMuted }]}>
            * 요청 후 수영장 관리자가 확인하면 연결됩니다
          </Text>
          <Pressable
            style={[s.submitBtn, { backgroundColor: C.button, opacity: !childName.trim() || submitting ? 0.5 : 1 }]}
            disabled={!childName.trim() || submitting}
            onPress={() => setSubmitConfirm(true)}
          >
            <Text style={s.submitBtnTxt}>{submitting ? "신청 중..." : "연결 요청 보내기"}</Text>
          </Pressable>
        </View>
      </ScrollView>

      <ConfirmModal
        visible={submitConfirm}
        title="자녀 연결 요청"
        message={`이름: ${childName}${childBirth ? `\n생년월일: ${childBirth}` : ""}\n\n관리자가 확인 후 연결됩니다.`}
        confirmText="요청"
        onConfirm={async () => { setSubmitConfirm(false); await submitRequest(); }}
        onCancel={() => setSubmitConfirm(false)}
      />
      <ConfirmModal
        visible={submitDone}
        title="신청 완료"
        message="연결 요청이 접수되었습니다.\n관리자가 확인 후 연결해드립니다."
        confirmText="확인"
        onConfirm={() => setSubmitDone(false)}
        onCancel={() => setSubmitDone(false)}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  sectionTitle: { fontSize: 16, fontFamily: "Pretendard-Regular", marginTop: 4 },

  emptyBox: { borderRadius: 16, padding: 28, alignItems: "center", gap: 8 },
  emptyTxt: { fontSize: 14, fontFamily: "Pretendard-Regular" },

  childCard: {
    borderRadius: 16, padding: 14, flexDirection: "row", alignItems: "center", gap: 12,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  childAvatar: { width: 48, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  childAvatarTxt: { fontSize: 20, fontFamily: "Pretendard-Regular" },
  childName: { fontSize: 15, fontFamily: "Pretendard-Regular" },
  childClass: { fontSize: 12, fontFamily: "Pretendard-Regular" },

  reqCard: {
    borderRadius: 14, padding: 14, flexDirection: "row", alignItems: "center", gap: 12,
  },
  reqAvatar: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  reqStatus: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  reqStatusTxt: { fontSize: 12, fontFamily: "Pretendard-Regular" },

  formCard: { borderRadius: 16, padding: 16, gap: 10 },
  formLabel: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  formNote: { fontSize: 12, fontFamily: "Pretendard-Regular", lineHeight: 18 },
  input: {
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, fontFamily: "Pretendard-Regular",
  },
  inputMulti: { minHeight: 72, textAlignVertical: "top" },
  submitBtn: { borderRadius: 14, paddingVertical: 14, alignItems: "center", marginTop: 4 },
  submitBtnTxt: { fontSize: 15, fontFamily: "Pretendard-Regular", color: "#fff" },
});
