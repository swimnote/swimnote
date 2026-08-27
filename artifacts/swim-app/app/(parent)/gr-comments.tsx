/**
 * (parent)/gr-comments.tsx — Growth Report 전용 댓글 화면 (PHASE 3-B1)
 *
 * route params:
 *   reportId     — growth_report_id (필수)
 *   studentId    — student_id (진입 검증용)
 *   studentName  — 표시 이름 (없으면 "우리 아이")
 *   reportPeriod — "YYYY-MM" → subtitle 변환
 *
 * API:
 *   GET    /parent/growth-reports/:reportId/comments
 *   POST   /parent/growth-reports/:reportId/comments  { body }
 *   DELETE /growth-report-comments/:commentId
 *
 * UX: diary-comments.tsx 구조 동일 (새 디자인 없음)
 * 제약: Server/DB/Render/OTA(Android) 수정 금지
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { LucideIcon } from "@/components/common/LucideIcon";
import { ParentScreenHeader } from "@/components/parent/ParentScreenHeader";
import Colors from "@/constants/colors";

const C = Colors.light;

// ─── Types ────────────────────────────────────────────────────────────────────

interface Reply {
  id:          string;
  body:        string;
  author_name: string;
  author_role: string;
  is_deleted?: boolean;
  created_at:  string;
}

interface CommentThread {
  id:          string;
  body:        string;
  author_name: string;
  author_role: string;
  student_id?: string;
  is_deleted?: boolean;
  created_at:  string;
  replies:     Reply[];
}

// ─── Util ─────────────────────────────────────────────────────────────────────

function fmtTime(raw: string): string {
  try {
    const dt = new Date(raw);
    if (isNaN(dt.getTime())) return "";
    return dt.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

/** "YYYY-MM" → "YYYY년 M월" */
function formatPeriod(period: string): string {
  const m = period?.match(/^(\d{4})-(\d{2})$/);
  if (!m) return period ?? "";
  const year  = m[1];
  const month = String(parseInt(m[2], 10));
  return `${year}년 ${month}월`;
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function GrCommentsScreen() {
  const insets = useSafeAreaInsets();
  const { token } = useAuth();

  const {
    reportId,
    studentName,
    reportPeriod,
  } = useLocalSearchParams<{
    reportId:     string;
    studentId?:   string;
    studentName?: string;
    reportPeriod?: string;
  }>();

  const [threads,    setThreads]    = useState<CommentThread[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [input,      setInput]      = useState("");
  const [sending,    setSending]    = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const scrollRef = useRef<ScrollView>(null);
  const mounted   = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const effectiveStudentName = studentName ?? "우리 아이";
  const periodLabel = reportPeriod ? formatPeriod(reportPeriod) : "";
  const subtitle = periodLabel
    ? `${effectiveStudentName} · ${periodLabel} AI 성장 리포트`
    : effectiveStudentName;

  // ── 조회 ───────────────────────────────────────────────────────────────────

  const load = useCallback(async (isRefresh = false) => {
    if (!reportId) return;
    if (!isRefresh) setLoading(true);
    try {
      const res = await apiRequest(token, `/parent/growth-reports/${encodeURIComponent(reportId)}/comments`);
      if (!mounted.current) return;
      if (res.ok) {
        const data = await res.json();
        setThreads(data.threads ?? []);
      } else {
        // 403/404 등 — 내부 원문 노출 금지
        Alert.alert("오류", "댓글을 불러올 수 없습니다.");
      }
    } catch {
      if (mounted.current) Alert.alert("오류", "네트워크 오류가 발생했습니다.");
    } finally {
      if (mounted.current) { setLoading(false); setRefreshing(false); }
    }
  }, [reportId, token]);

  useEffect(() => { load(); }, [load]);

  // ── 댓글 전송 ──────────────────────────────────────────────────────────────

  async function send() {
    const body = input.trim();
    if (!body || sending || !reportId) return;
    setSending(true);
    try {
      const res = await apiRequest(
        token,
        `/parent/growth-reports/${encodeURIComponent(reportId)}/comments`,
        { method: "POST", body: JSON.stringify({ body }) },
      );
      if (!mounted.current) return;
      if (res.ok) {
        const data = await res.json();
        const newThread: CommentThread = { ...data.comment, replies: data.comment.replies ?? [] };
        setThreads(prev => [...prev, newThread]);
        setInput("");
        setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 150);
      } else {
        const err = await res.json().catch(() => ({}));
        Alert.alert("오류", (err as any).error ?? "전송에 실패했습니다.");
      }
    } catch {
      Alert.alert("오류", "전송에 실패했습니다.");
    } finally {
      if (mounted.current) setSending(false);
    }
  }

  // ── 댓글 삭제 ──────────────────────────────────────────────────────────────

  function confirmDelete(commentId: string) {
    Alert.alert("댓글 삭제", "댓글을 삭제하시겠습니까?", [
      { text: "취소", style: "cancel" },
      { text: "삭제", style: "destructive", onPress: () => deleteComment(commentId) },
    ]);
  }

  async function deleteComment(commentId: string) {
    setDeletingId(commentId);
    try {
      const res = await apiRequest(token, `/growth-report-comments/${encodeURIComponent(commentId)}`, { method: "DELETE" });
      if (!mounted.current) return;
      if (res.ok) {
        // soft delete — UI 반영 (재조회 없이)
        setThreads(prev => prev.map(t =>
          t.id === commentId
            ? { ...t, is_deleted: true, body: "(삭제된 댓글입니다)" }
            : t,
        ));
      } else {
        Alert.alert("오류", "삭제에 실패했습니다.");
      }
    } catch {
      Alert.alert("오류", "삭제에 실패했습니다.");
    } finally {
      if (mounted.current) setDeletingId(null);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <KeyboardAvoidingView
      style={[s.root, { backgroundColor: C.background }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? insets.top : 0}
    >
      <ParentScreenHeader
        title="댓글"
        subtitle={subtitle}
        onBack={() => router.back()}
      />

      {loading ? (
        <ActivityIndicator color={C.brandStrong} style={{ marginTop: 60 }} />
      ) : (
        <ScrollView
          ref={scrollRef}
          style={s.scroll}
          contentContainerStyle={[s.scrollContent, { paddingBottom: 16 }]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(true); }}
            />
          }
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {threads.length === 0 ? (
            <View style={s.empty}>
              <LucideIcon name="message-circle" size={42} color={C.textMuted} />
              <Text style={[s.emptyTitle, { color: C.text }]}>아직 댓글이 없습니다</Text>
              <Text style={[s.emptySub, { color: C.textSecondary }]}>
                AI 성장 리포트에 소감이나 질문을 남겨보세요
              </Text>
            </View>
          ) : (
            threads.map(thread => (
              <View key={thread.id} style={s.threadWrap}>
                {/* 원댓글 — parent bubble */}
                <View style={[s.bubble, s.bubbleMine, { backgroundColor: C.brandSoft }]}>
                  <View style={s.bubbleHeader}>
                    <Text style={[s.bubbleName, { color: C.brandStrong }]}>
                      {thread.author_name}
                    </Text>
                    <Text style={[s.bubbleTime, { color: C.textMuted }]}>
                      {fmtTime(thread.created_at)}
                    </Text>
                    {!thread.is_deleted && thread.author_role === "parent" && (
                      <TouchableOpacity
                        onPress={() => confirmDelete(thread.id)}
                        disabled={deletingId === thread.id}
                        style={s.deleteBtn}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        {deletingId === thread.id
                          ? <ActivityIndicator size="small" color={C.textMuted} />
                          : <LucideIcon name="trash-2" size={12} color={C.textMuted} />}
                      </TouchableOpacity>
                    )}
                  </View>
                  <Text style={[s.bubbleBody, { color: thread.is_deleted ? C.textMuted : C.text }]}>
                    {thread.body}
                  </Text>
                </View>

                {/* Teacher replies — read-only */}
                {thread.replies.map(reply => (
                  <View
                    key={reply.id}
                    style={[
                      s.bubble,
                      reply.author_role === "teacher" ? s.bubbleTeacher : s.bubbleMine,
                      reply.author_role === "teacher"
                        ? { backgroundColor: "#F0F4FF" }
                        : { backgroundColor: C.brandSoft },
                    ]}
                  >
                    <View style={s.bubbleHeader}>
                      <Text style={[
                        s.bubbleName,
                        { color: reply.author_role === "teacher" ? "#3B82F6" : C.brandStrong },
                      ]}>
                        {reply.author_role === "teacher" ? "📘 " : ""}{reply.author_name}
                      </Text>
                      <Text style={[s.bubbleTime, { color: C.textMuted }]}>
                        {fmtTime(reply.created_at)}
                      </Text>
                    </View>
                    <Text style={[
                      s.bubbleBody,
                      { color: reply.is_deleted ? C.textMuted : C.text },
                    ]}>
                      {reply.body}
                    </Text>
                  </View>
                ))}
              </View>
            ))
          )}
        </ScrollView>
      )}

      {/* 입력창 */}
      <View style={[
        s.inputBar,
        { borderTopColor: C.border, backgroundColor: C.card, paddingBottom: Math.max(insets.bottom, 8) },
      ]}>
        <TextInput
          style={[s.textInput, { color: C.text, backgroundColor: C.background, borderColor: C.border }]}
          placeholder="AI 성장 리포트에 댓글을 남겨보세요"
          placeholderTextColor={C.textMuted}
          value={input}
          onChangeText={setInput}
          multiline
          maxLength={1000}
          returnKeyType="default"
          blurOnSubmit={false}
        />
        <Pressable
          onPress={send}
          disabled={!input.trim() || sending}
          style={[
            s.sendBtn,
            { backgroundColor: !input.trim() || sending ? C.border : C.primaryAction },
          ]}
        >
          {sending
            ? <ActivityIndicator size="small" color="#fff" />
            : <LucideIcon name="send" size={18} color="#fff" />}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root:         { flex: 1 },
  scroll:       { flex: 1 },
  scrollContent:{ padding: 16, gap: 8 },
  empty:        { alignItems: "center", paddingTop: 80, gap: 12 },
  emptyTitle:   { fontSize: 17, fontFamily: "Pretendard-Regular" },
  emptySub:     { fontSize: 13, fontFamily: "Pretendard-Regular", textAlign: "center", lineHeight: 20 },
  threadWrap:   { gap: 6, marginBottom: 8 },
  bubble:       { borderRadius: 14, padding: 12, gap: 5 },
  bubbleMine:   { marginLeft: 0, marginRight: 32 },
  bubbleTeacher:{ marginLeft: 16, marginRight: 0 },
  bubbleHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  bubbleName:   { fontSize: 12, fontFamily: "Pretendard-Regular", fontWeight: "600" },
  bubbleTime:   { fontSize: 11, fontFamily: "Pretendard-Regular", marginLeft: "auto" as any },
  bubbleBody:   { fontSize: 14, fontFamily: "Pretendard-Regular", lineHeight: 21 },
  deleteBtn:    { padding: 2 },
  inputBar: {
    flexDirection: "row", alignItems: "flex-end", gap: 8,
    paddingHorizontal: 12, paddingTop: 10, borderTopWidth: 1,
  },
  textInput: {
    flex: 1, borderRadius: 16, borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === "ios" ? 10 : 8,
    fontSize: 14, fontFamily: "Pretendard-Regular",
    maxHeight: 120, minHeight: 42,
  },
  sendBtn: {
    width: 42, height: 42, borderRadius: 21,
    alignItems: "center", justifyContent: "center",
    flexShrink: 0,
  },
});
