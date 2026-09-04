/**
 * 학부모 일지 댓글 화면
 *
 * - 내 원댓글 + 선생님 답글 스레드 뷰
 * - 하단 고정 텍스트 입력창 (KeyboardAwareScrollView)
 * - 댓글 작성/삭제
 */
import { LucideIcon } from "@/components/common/LucideIcon";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { ParentScreenHeader } from "@/components/parent/ParentScreenHeader";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useParent } from "@/context/ParentContext";
import { parseDateSafe } from "@/domain/formatters";

const C = Colors.light;

/* ── 타입 ─────────────────────────────────────────────────────────────────── */
interface Reply {
  id: string;
  body: string;
  author_name: string;
  author_role: string;
  is_deleted?: boolean;
  created_at: string;
}

interface CommentThread {
  id: string;
  body: string;
  author_name: string;
  author_role: string;
  student_name?: string;
  student_id?: string;
  is_deleted?: boolean;
  created_at: string;
  replies: Reply[];
}

interface DiaryInfo {
  id: string;
  lesson_date: string;
  teacher_name: string;
}

/* ── 유틸 ──────────────────────────────────────────────────────────────────── */
function fmtTime(raw: string): string {
  const dt = parseDateSafe(raw);
  if (!dt) return "";
  return dt.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

function fmtDate(raw: string): string {
  const dt = parseDateSafe(raw.includes("T") ? raw : raw + "T00:00:00");
  if (!dt) return raw;
  const wd = ["일", "월", "화", "수", "목", "금", "토"][dt.getDay()];
  return `${dt.getMonth() + 1}월 ${dt.getDate()}일 (${wd})`;
}

/* ─────────────────────────────────────────────────────────────────────────── */
export default function DiaryCommentsScreen() {
  const insets = useSafeAreaInsets();
  const { token, parentAccount } = useAuth();
  const { selectedStudent } = useParent();
  const { diaryId, diaryDate, teacherName, studentId, studentName } = useLocalSearchParams<{
    diaryId: string; diaryDate?: string; teacherName?: string;
    studentId?: string; studentName?: string;
  }>();

  const [threads, setThreads] = useState<CommentThread[]>([]);
  const [diary, setDiary] = useState<DiaryInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const scrollRef = useRef<any>(null);

  const effectiveStudentId = studentId ?? selectedStudent?.id ?? "";
  const effectiveStudentName = studentName ?? selectedStudent?.name ?? "학생";

  /* ── 로드 ── */
  const load = useCallback(async (isRefresh = false) => {
    if (!diaryId) return;
    if (!isRefresh) setLoading(true);
    try {
      const res = await apiRequest(token, `/diaries/${diaryId}/comments`);
      if (res.ok) {
        const data = await res.json();
        setThreads(data.threads ?? []);
        setDiary(data.diary ?? null);
      }
    } catch { }
    finally { setLoading(false); setRefreshing(false); }
  }, [diaryId, token]);

  useEffect(() => { load(); }, [load]);

  /* ── 댓글 전송 ── */
  async function send() {
    const body = input.trim();
    if (!body || sending || !diaryId || !effectiveStudentId) return;
    setSending(true);
    try {
      const res = await apiRequest(token, `/diaries/${diaryId}/comments`, {
        method: "POST",
        body: JSON.stringify({ studentId: effectiveStudentId, body }),
      });
      if (res.ok) {
        const newThread: CommentThread = await res.json();
        setThreads(prev => [...prev, newThread]);
        setInput("");
        setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 150);
      } else {
        const err = await res.json().catch(() => ({}));
        Alert.alert("오류", err.error ?? "전송에 실패했습니다.");
      }
    } catch {
      Alert.alert("오류", "전송에 실패했습니다.");
    } finally { setSending(false); }
  }

  /* ── 댓글 삭제 ── */
  function confirmDelete(commentId: string) {
    Alert.alert("댓글 삭제", "댓글을 삭제하시겠습니까?", [
      { text: "취소", style: "cancel" },
      { text: "삭제", style: "destructive", onPress: () => deleteComment(commentId) },
    ]);
  }

  async function deleteComment(commentId: string) {
    setDeletingId(commentId);
    try {
      const res = await apiRequest(token, `/diary-comments/${commentId}`, { method: "DELETE" });
      if (res.ok) {
        setThreads(prev => prev.map(t =>
          t.id === commentId
            ? { ...t, is_deleted: true, body: "(삭제된 댓글입니다)" }
            : { ...t, replies: t.replies.map(r => r.id === commentId ? { ...r, is_deleted: true, body: "(삭제된 댓글입니다)" } : r) }
        ));
      }
    } catch { Alert.alert("오류", "삭제에 실패했습니다."); }
    finally { setDeletingId(null); }
  }

  const myId = parentAccount?.id ?? "";
  const displayDate = diary?.lesson_date ? fmtDate(diary.lesson_date) : (diaryDate ? fmtDate(diaryDate) : "");
  const displayTeacher = diary?.teacher_name ?? teacherName ?? "";

  return (
    <KeyboardAvoidingView
      style={[s.root, { backgroundColor: C.background }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? insets.top : 0}
    >
      <ParentScreenHeader
        title="댓글"
        subtitle={effectiveStudentName ? `${effectiveStudentName} · ${displayDate}` : displayDate}
        onBack={() => router.back()}
      />

      {/* 일지 정보 헤더 */}
      {displayTeacher ? (
        <View style={[s.diaryMeta, { backgroundColor: C.card, borderBottomColor: C.border }]}>
          <LucideIcon name="book-open" size={14} color={C.textMuted} />
          <Text style={[s.diaryMetaText, { color: C.textSecondary }]}>
            {displayDate}  ·  {displayTeacher} 선생님 수업일지
          </Text>
        </View>
      ) : null}

      {loading ? (
        <ActivityIndicator color={C.brandStrong} style={{ marginTop: 60 }} />
      ) : (
        <ScrollView
          ref={scrollRef}
          style={s.scroll}
          contentContainerStyle={[s.scrollContent, { paddingBottom: 16 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(true); }} />}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {threads.length === 0 ? (
            <View style={s.empty}>
              <LucideIcon name="message-circle" size={42} color={C.textMuted} />
              <Text style={[s.emptyTitle, { color: C.text }]}>아직 댓글이 없습니다</Text>
              <Text style={[s.emptySub, { color: C.textSecondary }]}>선생님께 감사 인사나 질문을 남겨보세요</Text>
            </View>
          ) : (
            threads.map(thread => (
              <View key={thread.id} style={s.threadWrap}>
                {/* 원댓글 */}
                <View style={[s.bubble, s.bubbleMine, { backgroundColor: C.brandSoft }]}>
                  <View style={s.bubbleHeader}>
                    <Text style={[s.bubbleName, { color: C.brandStrong }]}>{thread.author_name}</Text>
                    <Text style={[s.bubbleTime, { color: C.textMuted }]}>{fmtTime(thread.created_at)}</Text>
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

                {/* 답글들 */}
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
                      <Text style={[s.bubbleTime, { color: C.textMuted }]}>{fmtTime(reply.created_at)}</Text>
                    </View>
                    <Text style={[s.bubbleBody, { color: reply.is_deleted ? C.textMuted : C.text }]}>
                      {reply.body}
                    </Text>
                  </View>
                ))}
              </View>
            ))
          )}
        </ScrollView>
      )}

      {/* 입력창 — KeyboardAvoidingView가 키보드와 함께 올려줌 */}
      <View style={[s.inputBar, { borderTopColor: C.border, backgroundColor: C.card, paddingBottom: Math.max(insets.bottom, 8) }]}>
        <TextInput
          style={[s.textInput, { color: C.text, backgroundColor: C.background, borderColor: C.border }]}
          placeholder="선생님께 댓글을 남겨보세요"
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
          style={[s.sendBtn, { backgroundColor: !input.trim() || sending ? C.border : C.primaryAction }]}
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
  root: { flex: 1 },
  diaryMeta: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1,
  },
  diaryMetaText: { fontSize: 12, fontFamily: "Pretendard-Regular", flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, gap: 8 },
  empty: { alignItems: "center", paddingTop: 80, gap: 12 },
  emptyTitle: { fontSize: 17, fontFamily: "Pretendard-Regular" },
  emptySub: { fontSize: 13, fontFamily: "Pretendard-Regular", textAlign: "center", lineHeight: 20 },
  threadWrap: { gap: 6, marginBottom: 8 },
  bubble: { borderRadius: 14, padding: 12, gap: 5 },
  bubbleMine: { marginLeft: 0, marginRight: 32 },
  bubbleTeacher: { marginLeft: 16, marginRight: 0 },
  bubbleHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  bubbleName: { fontSize: 12, fontFamily: "Pretendard-Regular", fontWeight: "600" },
  bubbleTime: { fontSize: 11, fontFamily: "Pretendard-Regular", marginLeft: "auto" as any },
  bubbleBody: { fontSize: 14, fontFamily: "Pretendard-Regular", lineHeight: 21 },
  deleteBtn: { padding: 2 },
  inputBar: {
    flexDirection: "row", alignItems: "flex-end", gap: 8,
    paddingHorizontal: 12, paddingTop: 10, borderTopWidth: 1,
  },
  textInput: {
    flex: 1, borderRadius: 16, borderWidth: 1,
    paddingHorizontal: 14, paddingVertical: Platform.OS === "ios" ? 10 : 8,
    fontSize: 14, fontFamily: "Pretendard-Regular",
    maxHeight: 120, minHeight: 42,
  },
  sendBtn: {
    width: 42, height: 42, borderRadius: 21,
    alignItems: "center", justifyContent: "center",
    flexShrink: 0,
  },
});
