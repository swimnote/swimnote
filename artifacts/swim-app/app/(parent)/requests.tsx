/**
 * 학부모 수업 요청 화면 — 결석/보강/연기/퇴원/상담/문의
 */
import { CalendarDays, ChevronLeft, ClipboardList, Plus, Send } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import { DatePickerModal } from "@/components/common/DatePickerModal";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform,
  Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useParent } from "@/context/ParentContext";

const C = Colors.light;

const REQUEST_TYPES = [
  { key: "absence",    label: "결석 신청",   icon: "x-circle",        color: "#EF4444", bg: "#FEE2E2" },
  { key: "postpone",   label: "연기 신청",   icon: "clock",           color: "#F59E0B", bg: "#FEF3C7" },
  { key: "makeup",     label: "보강 요청",   icon: "refresh-cw",      color: "#3B82F6", bg: "#DBEAFE" },
  { key: "withdrawal", label: "퇴원 신청",   icon: "log-out",         color: "#6B7280", bg: "#F3F4F6" },
  { key: "counseling", label: "상담 요청",   icon: "message-circle",  color: "#8B5CF6", bg: "#EDE9FE" },
  { key: "inquiry",    label: "문의",        icon: "help-circle",     color: "#0EA5E9", bg: "#E0F2FE" },
] as const;

type RequestType = (typeof REQUEST_TYPES)[number]["key"];

const STATUS_LABEL: Record<string, string> = {
  pending:  "처리 대기",
  done:     "처리 완료",
  rejected: "거절됨",
};
const STATUS_COLOR: Record<string, { text: string; bg: string }> = {
  pending:  { text: "#D97706", bg: "#FFF7ED" },
  done:     { text: "#2EC4B6", bg: "#E6FFFA" },
  rejected: { text: "#EF4444", bg: "#FEF2F2" },
};

export default function ParentRequestsScreen() {
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const { students, selectedStudent } = useParent();

  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);

  const [selStudentId, setSelStudentId] = useState<string>(selectedStudent?.id || "");
  const [reqType, setReqType] = useState<RequestType>("absence");
  const [reqDate, setReqDate] = useState("");
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [datePickerVisible, setDatePickerVisible] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sid = selStudentId || students[0]?.id;
      if (!sid) { setRequests([]); setLoading(false); return; }
      const r = await apiRequest(token, `/parent/requests?student_id=${sid}`);
      if (r.ok) {
        const d = await r.json();
        setRequests(d.data || []);
      }
    } catch {}
    setLoading(false);
  }, [token, selStudentId, students]);

  useEffect(() => {
    if (selectedStudent?.id) setSelStudentId(selectedStudent.id);
  }, [selectedStudent?.id]);

  useEffect(() => { load(); }, [load]);

  async function handleSubmit() {
    if (!selStudentId) { setErrorMsg("자녀를 선택해주세요."); return; }
    setSubmitting(true); setErrorMsg("");
    try {
      const r = await apiRequest(token, "/parent/requests", {
        method: "POST",
        body: JSON.stringify({ student_id: selStudentId, request_type: reqType, request_date: reqDate || null, content: content || null }),
      });
      if (r.ok) {
        setModalVisible(false);
        setContent(""); setReqDate("");
        await load();
      } else {
        const d = await r.json();
        setErrorMsg(d.message || "요청 전송 실패");
      }
    } catch {
      setErrorMsg("네트워크 오류");
    }
    setSubmitting(false);
  }

  const PT = insets.top + (Platform.OS === "web" ? 68 : 16);

  return (
    <View style={[s.root, { backgroundColor: C.background }]}>
      {/* 헤더 */}
      <View style={[s.header, { paddingTop: PT }]}>
        <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={8}>
          <ChevronLeft size={24} color={C.text} />
        </Pressable>
        <Text style={[s.headerTitle, { color: C.text }]}>수업 요청</Text>
        <Pressable
          style={[s.addBtn, { backgroundColor: C.tint }]}
          onPress={() => { setReqType("absence"); setModalVisible(true); }}
        >
          <Plus size={18} color="#fff" />
        </Pressable>
      </View>

      {/* 자녀 탭 */}
      {students.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.studentTabs}>
          {students.map(st => (
            <Pressable
              key={st.id}
              style={[s.studentTab, { backgroundColor: selStudentId === st.id ? C.tint : C.card }]}
              onPress={() => setSelStudentId(st.id)}
            >
              <Text style={{ fontSize: 14, fontFamily: "Pretendard-Regular", color: selStudentId === st.id ? "#fff" : C.text }}>
                {st.name}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {/* 요청 목록 */}
      <ScrollView contentContainerStyle={[s.listContent, { paddingBottom: insets.bottom + 32 }]} showsVerticalScrollIndicator={false}>
        {loading ? (
          <ActivityIndicator color={C.tint} style={{ marginTop: 60 }} />
        ) : requests.length === 0 ? (
          <View style={s.emptyWrap}>
            <ClipboardList size={48} color={C.textMuted} />
            <Text style={[s.emptyText, { color: C.textMuted }]}>요청 내역이 없습니다</Text>
            <Text style={{ fontSize: 13, color: C.textMuted, fontFamily: "Pretendard-Regular", textAlign: "center" }}>
              + 버튼을 눌러 새 요청을 보내세요
            </Text>
          </View>
        ) : requests.map(req => {
          const typeCfg = REQUEST_TYPES.find(t => t.key === req.request_type);
          const statusCfg = STATUS_COLOR[req.status] || STATUS_COLOR.pending;
          return (
            <View key={req.id} style={[s.card, { backgroundColor: C.card }]}>
              <View style={s.cardTop}>
                <View style={[s.typeBadge, { backgroundColor: typeCfg?.bg || "#F3F4F6" }]}>
                  <LucideIcon name={(typeCfg?.icon || "help-circle") as any} size={14} color={typeCfg?.color || C.textMuted} />
                  <Text style={[s.typeText, { color: typeCfg?.color || C.textMuted }]}>
                    {typeCfg?.label || req.request_type}
                  </Text>
                </View>
                <View style={[s.statusBadge, { backgroundColor: statusCfg.bg }]}>
                  <Text style={[s.statusText, { color: statusCfg.text }]}>{STATUS_LABEL[req.status] || req.status}</Text>
                </View>
              </View>
              {req.request_date && (
                <Text style={[s.cardDate, { color: C.textSecondary }]}>신청일: {req.request_date}</Text>
              )}
              {req.content && (
                <Text style={[s.cardContent, { color: C.text }]}>{req.content}</Text>
              )}
              {req.admin_note && (
                <View style={[s.adminNote, { backgroundColor: "#F0FDF4" }]}>
                  <Text style={{ fontSize: 12, color: "#16A34A", fontFamily: "Pretendard-Regular" }}>
                    선생님 메모: {req.admin_note}
                  </Text>
                </View>
              )}
              <Text style={[s.cardCreatedAt, { color: C.textMuted }]}>
                {new Date(req.created_at).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" })}
              </Text>
            </View>
          );
        })}
      </ScrollView>

      {/* 요청 작성 모달 */}
      <Modal visible={modalVisible} animationType="slide" transparent onRequestClose={() => setModalVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={s.modalOverlay}>
          <View style={[s.modalSheet, { backgroundColor: C.background, paddingBottom: insets.bottom + 24 }]}>
            <View style={s.modalHeader}>
              <Text style={[s.modalTitle, { color: C.text }]}>새 요청 보내기</Text>
              <Pressable onPress={() => setModalVisible(false)} hitSlop={8}>
                <Text style={{ fontSize: 15, color: C.textMuted, fontFamily: "Pretendard-Regular" }}>취소</Text>
              </Pressable>
            </View>

            {students.length > 1 && (
              <>
                <Text style={[s.label, { color: C.textSecondary }]}>자녀 선택</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginBottom: 16 }}>
                  {students.map(st => (
                    <Pressable
                      key={st.id}
                      style={[s.studentTab, { backgroundColor: selStudentId === st.id ? C.tint : C.card }]}
                      onPress={() => setSelStudentId(st.id)}
                    >
                      <Text style={{ fontSize: 13, color: selStudentId === st.id ? "#fff" : C.text, fontFamily: "Pretendard-Regular" }}>{st.name}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </>
            )}

            <Text style={[s.label, { color: C.textSecondary }]}>요청 유형</Text>
            <View style={s.typeGrid}>
              {REQUEST_TYPES.map(t => (
                <Pressable
                  key={t.key}
                  style={[s.typeBtn, { backgroundColor: reqType === t.key ? t.bg : C.card, borderWidth: reqType === t.key ? 1.5 : 0.5, borderColor: reqType === t.key ? t.color : C.border }]}
                  onPress={() => setReqType(t.key)}
                >
                  <LucideIcon name={t.icon as any} size={18} color={t.color} />
                  <Text style={[s.typeBtnText, { color: t.color }]}>{t.label}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={[s.label, { color: C.textSecondary }]}>신청 날짜 (선택)</Text>
            <Pressable
              style={[s.datePicker, { backgroundColor: C.card, borderColor: reqDate ? C.tint : C.border }]}
              onPress={() => setDatePickerVisible(true)}
            >
              <CalendarDays size={16} color={reqDate ? C.tint : C.textMuted} />
              <Text style={[s.datePickerTxt, { color: reqDate ? C.text : C.textMuted }]}>
                {reqDate || "날짜 선택 (선택사항)"}
              </Text>
              {reqDate ? (
                <Pressable
                  hitSlop={8}
                  onPress={() => setReqDate("")}
                >
                  <Text style={{ fontSize: 13, color: C.textMuted }}>✕</Text>
                </Pressable>
              ) : null}
            </Pressable>
            <DatePickerModal
              visible={datePickerVisible}
              value={reqDate}
              onConfirm={setReqDate}
              onClose={() => setDatePickerVisible(false)}
            />

            <Text style={[s.label, { color: C.textSecondary }]}>메모 / 사유 (선택)</Text>
            <TextInput
              style={[s.input, s.multiline, { backgroundColor: C.card, color: C.text, borderColor: C.border }]}
              placeholder="선생님께 전달할 내용을 입력하세요"
              placeholderTextColor={C.textMuted}
              multiline
              numberOfLines={3}
              value={content}
              onChangeText={setContent}
            />

            {errorMsg ? <Text style={s.error}>{errorMsg}</Text> : null}

            <Pressable
              style={({ pressed }) => [s.submitBtn, { backgroundColor: C.tint, opacity: pressed || submitting ? 0.8 : 1 }]}
              onPress={handleSubmit}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Send size={16} color="#fff" />
                  <Text style={s.submitBtnText}>요청 보내기</Text>
                </>
              )}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 12, gap: 10 },
  backBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, fontSize: 18, fontFamily: "Pretendard-Regular", textAlign: "center", marginRight: 36 },
  addBtn: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  studentTabs: { paddingHorizontal: 16, gap: 8, paddingBottom: 12 },
  studentTab: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
  listContent: { paddingHorizontal: 16, paddingTop: 8, gap: 12 },
  emptyWrap: { alignItems: "center", gap: 12, paddingVertical: 80 },
  emptyText: { fontSize: 16, fontFamily: "Pretendard-Regular" },
  card: { borderRadius: 16, padding: 16, gap: 8, shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  typeBadge: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  typeText: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  statusText: { fontSize: 12, fontFamily: "Pretendard-Regular" },
  cardDate: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  cardContent: { fontSize: 14, fontFamily: "Pretendard-Regular", lineHeight: 20 },
  adminNote: { padding: 10, borderRadius: 8 },
  cardCreatedAt: { fontSize: 11, fontFamily: "Pretendard-Regular", textAlign: "right" },
  modalOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  modalSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  modalTitle: { fontSize: 18, fontFamily: "Pretendard-Regular" },
  label: { fontSize: 13, fontFamily: "Pretendard-Regular", marginBottom: 6 },
  typeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 16 },
  typeBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12 },
  typeBtnText: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, fontFamily: "Pretendard-Regular", marginBottom: 14 },
  datePicker:    { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, marginBottom: 14 },
  datePickerTxt: { flex: 1, fontSize: 14, fontFamily: "Pretendard-Regular" },
  multiline: { minHeight: 80, textAlignVertical: "top" },
  error: { color: "#EF4444", fontSize: 13, fontFamily: "Pretendard-Regular", marginBottom: 8 },
  submitBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 16, borderRadius: 16, marginTop: 4 },
  submitBtnText: { color: "#fff", fontSize: 16, fontFamily: "Pretendard-Regular" },
});
