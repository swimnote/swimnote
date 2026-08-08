/**
 * 학부모 수업 요청 화면 — 결석/보강/연기/퇴원/상담/문의
 */
import { LucideIcon } from "@/components/common/LucideIcon";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Modal, Platform, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
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

/** null / undefined / Invalid Date 방어 */
function safeDate(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });
}

export default function ParentRequestsScreen() {
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const { students, selectedStudent } = useParent();
  const { requestId: highlightId } = useLocalSearchParams<{ requestId?: string }>();

  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalVisible, setModalVisible] = useState(false);

  const [selStudentId, setSelStudentId] = useState<string>(selectedStudent?.id || "");
  const [reqType, setReqType] = useState<RequestType>("absence");
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // 강조 해제 타이머
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [activeHighlight, setActiveHighlight] = useState<string | undefined>(highlightId);

  useEffect(() => {
    if (highlightId) {
      setActiveHighlight(highlightId);
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
      highlightTimer.current = setTimeout(() => setActiveHighlight(undefined), 3000);
    }
    return () => { if (highlightTimer.current) clearTimeout(highlightTimer.current); };
  }, [highlightId]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const sid = selStudentId || students[0]?.id;
      if (!sid) { setRequests([]); setLoading(false); setRefreshing(false); return; }
      const r = await apiRequest(token, `/parent/requests?student_id=${sid}`);
      if (r.ok) {
        const d = await r.json();
        setRequests(d.data || []);
      } else {
        setError("요청 목록을 불러오지 못했습니다.");
      }
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token, selStudentId, students]);

  useEffect(() => {
    if (selectedStudent?.id) setSelStudentId(selectedStudent.id);
  }, [selectedStudent?.id]);

  useEffect(() => { load(); }, [load]);

  async function handleRefresh() {
    setRefreshing(true);
    await load();
  }

  async function handleSubmit() {
    if (!selStudentId) { setErrorMsg("자녀를 선택해주세요."); return; }
    setSubmitting(true); setErrorMsg("");
    try {
      const r = await apiRequest(token, "/parent/requests", {
        method: "POST",
        body: JSON.stringify({ student_id: selStudentId, request_type: reqType, content: content || null }),
      });
      if (r.ok) {
        const newReq = await r.json().catch(() => null);
        setModalVisible(false);
        setContent("");
        const entry = newReq?.data ?? newReq?.request ?? newReq;
        if (entry?.id) {
          setRequests(prev => [entry, ...prev]);
        } else {
          setRequests(prev => [{
            id: `tmp_${Date.now()}`,
            request_type: reqType,
            content: content || null,
            status: "pending",
            created_at: new Date().toISOString(),
          }, ...prev]);
        }
      } else {
        const d = await r.json().catch(() => ({}));
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
          <LucideIcon name="chevron-left" size={24} color={C.text} />
        </Pressable>
        <Text style={[s.headerTitle, { color: C.text }]}>수업 요청</Text>
        <Pressable
          style={[s.addBtn, { backgroundColor: C.tint }]}
          onPress={() => { setReqType("absence"); setModalVisible(true); }}
        >
          <LucideIcon name="plus" size={18} color="#fff" />
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
      {loading ? (
        <ActivityIndicator color={C.tint} style={{ marginTop: 60 }} />
      ) : error ? (
        <View style={s.emptyWrap}>
          <LucideIcon name="wifi-off" size={48} color={C.textMuted} />
          <Text style={[s.emptyText, { color: C.textMuted }]}>{error}</Text>
          <Pressable
            style={[s.addBtn, { backgroundColor: C.tint, width: "auto", paddingHorizontal: 20, borderRadius: 12 }]}
            onPress={() => { setLoading(true); load(); }}
          >
            <Text style={{ color: "#fff", fontSize: 14, fontFamily: "Pretendard-Regular" }}>다시 시도</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[s.listContent, { paddingBottom: insets.bottom + 32 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={C.tint} />
          }
        >
          {requests.length === 0 ? (
            <View style={s.emptyWrap}>
              <LucideIcon name="clipboard-list" size={48} color={C.textMuted} />
              <Text style={[s.emptyText, { color: C.textMuted }]}>요청 내역이 없습니다</Text>
              <Text style={{ fontSize: 13, color: C.textMuted, fontFamily: "Pretendard-Regular", textAlign: "center" }}>
                + 버튼을 눌러 새 요청을 보내세요
              </Text>
            </View>
          ) : requests.map(req => {
            const typeCfg = REQUEST_TYPES.find(t => t.key === req.request_type);
            const statusCfg = STATUS_COLOR[req.status] || STATUS_COLOR.pending;
            const isHighlighted = activeHighlight && req.id === activeHighlight;
            return (
              <View
                key={req.id}
                style={[
                  s.card,
                  { backgroundColor: C.card },
                  isHighlighted && { borderWidth: 2, borderColor: "#2EC4B6", backgroundColor: "#E6FFFA" },
                ]}
              >
                {isHighlighted && (
                  <View style={s.highlightBanner}>
                    <LucideIcon name="bell" size={12} color="#2EC4B6" />
                    <Text style={s.highlightText}>알림에서 이동한 요청</Text>
                  </View>
                )}
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
                {req.request_date ? (
                  <Text style={[s.cardDate, { color: C.textSecondary }]}>신청일: {req.request_date}</Text>
                ) : null}
                {req.content ? (
                  <Text style={[s.cardContent, { color: C.text }]}>{req.content}</Text>
                ) : null}
                {req.admin_note ? (
                  <View style={[s.adminNote, { backgroundColor: "#F0FDF4" }]}>
                    <Text style={{ fontSize: 12, color: "#16A34A", fontFamily: "Pretendard-Regular" }}>
                      선생님 메모: {req.admin_note}
                    </Text>
                  </View>
                ) : null}
                {safeDate(req.created_at) ? (
                  <Text style={[s.cardCreatedAt, { color: C.textMuted }]}>
                    {safeDate(req.created_at)}
                  </Text>
                ) : null}
              </View>
            );
          })}
        </ScrollView>
      )}

      {/* 요청 작성 모달 */}
      <Modal visible={modalVisible} animationType="slide" transparent onRequestClose={() => setModalVisible(false)}>
        {/* Backdrop — 탭 시 닫힘 */}
        <Pressable style={s.modalOverlay} onPress={() => setModalVisible(false)}>
          {/* Sheet 내부 터치는 Backdrop으로 전파 차단 */}
          <Pressable
            style={[s.modalSheet, { backgroundColor: C.background, paddingBottom: insets.bottom + 8 }]}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={s.modalHeader}>
              <Text style={[s.modalTitle, { color: C.text }]}>새 요청 보내기</Text>
              <Pressable onPress={() => setModalVisible(false)} hitSlop={8}>
                <Text style={{ fontSize: 15, color: C.textMuted, fontFamily: "Pretendard-Regular" }}>취소</Text>
              </Pressable>
            </View>

            <KeyboardAwareScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ paddingBottom: 24 }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
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
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginBottom: 16 }}>
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
              </ScrollView>

              <Text style={[s.label, { color: C.textSecondary }]}>내용 / 사유</Text>
              <TextInput
                style={[s.input, s.multiline, { backgroundColor: C.card, color: C.text, borderColor: C.border }]}
                placeholder="선생님께 전달할 내용을 입력하세요 (선택)"
                placeholderTextColor={C.textMuted}
                multiline
                numberOfLines={3}
                value={content}
                onChangeText={setContent}
              />

              {errorMsg ? <Text style={s.error}>{errorMsg}</Text> : null}

              <Pressable
                style={({ pressed }) => [s.submitBtn, { backgroundColor: "#fff", borderWidth: 1.5, borderColor: C.tint, opacity: pressed || submitting ? 0.8 : 1 }]}
                onPress={handleSubmit}
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator color="#1B3A70" size="small" />
                ) : (
                  <>
                    <LucideIcon name="send" size={16} color="#1B3A70" />
                    <Text style={[s.submitBtnText, { color: "#1B3A70" }]}>요청 보내기</Text>
                  </>
                )}
              </Pressable>
            </KeyboardAwareScrollView>
          </Pressable>
        </Pressable>
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
  highlightBanner: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 2 },
  highlightText: { fontSize: 11, color: "#2EC4B6", fontFamily: "Pretendard-Regular" },
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
  modalSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, maxHeight: "85%" },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  modalTitle: { fontSize: 18, fontFamily: "Pretendard-Regular" },
  label: { fontSize: 13, fontFamily: "Pretendard-Regular", marginBottom: 6 },
  typeBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12 },
  typeBtnText: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, fontFamily: "Pretendard-Regular", marginBottom: 14 },
  multiline: { minHeight: 80, textAlignVertical: "top" },
  error: { color: "#EF4444", fontSize: 13, fontFamily: "Pretendard-Regular", marginBottom: 8 },
  submitBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 16, borderRadius: 16, marginTop: 4 },
  submitBtnText: { color: "#fff", fontSize: 16, fontFamily: "Pretendard-Regular" },
});
