/**
 * (teacher)/diary-reactions.tsx
 * 선생님이 일지 1개에 달린 학부모 반응(좋아요·감사합니다)과
 * 댓글 스레드를 확인하고 답글을 작성하는 화면
 */
import { LucideIcon } from "@/components/common/LucideIcon";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { apiRequest, useAuth } from "@/context/AuthContext";
import Colors from "@/constants/colors";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const C = Colors.light;

type Reply = {
  id: string;
  body: string;
  author_name: string;
  author_role: string;
  is_deleted: boolean;
  created_at: string;
};

type Thread = {
  id: string;
  body: string;
  author_name: string;
  author_role: string;
  student_name: string | null;
  display_name: string;
  is_deleted: boolean;
  created_at: string;
  replies: Reply[];
};

type ReactionGroup = {
  count: number;
  users: { parent_name: string; student_name: string }[];
};

function fmtDate(d: string) {
  if (!d) return "";
  const dt = new Date(d + "T00:00:00");
  const dow = ["일", "월", "화", "수", "목", "금", "토"][dt.getDay()];
  return `${dt.getMonth() + 1}월 ${dt.getDate()}일 (${dow})`;
}

function fmtTime(iso: string) {
  if (!iso) return "";
  const d = new Date(iso);
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  return `${hh}:${mm}`;
}

export default function DiaryReactionsScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const { diaryId, lessonDate } = useLocalSearchParams<{ diaryId: string; lessonDate: string }>();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [reactions, setReactions] = useState<Record<string, ReactionGroup>>({});
  const [commentCount, setCommentCount] = useState(0);

  const [replyTarget, setReplyTarget] = useState<Thread | null>(null);
  const [replyInput, setReplyInput] = useState("");
  const [sending, setSending] = useState(false);

  const scrollRef = useRef<ScrollView>(null);
  const inputRef = useRef<TextInput>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const r = await apiRequest(token, `/diaries/${diaryId}/comments`);
      if (r.ok) {
        const d = await r.json();
        setThreads(d.threads ?? []);
        setReactions(d.reactions ?? {});
        setCommentCount(d.comment_count ?? 0);
      }
    } catch { }
    setLoading(false);
    setRefreshing(false);
  }, [token, diaryId]);

  useEffect(() => { load(); }, [load]);

  async function sendReply() {
    if (!replyTarget || !replyInput.trim() || sending) return;
    setSending(true);
    try {
      const r = await apiRequest(token, `/diary-comments/${replyTarget.id}/replies`, {
        method: "POST",
        body: JSON.stringify({ body: replyInput.trim() }),
      });
      if (r.ok) {
        setReplyInput("");
        setReplyTarget(null);
        await load(true);
        setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 300);
      }
    } catch { }
    setSending(false);
  }

  const likeGroup = reactions["like"];
  const thankGroup = reactions["thanks"];
  const displayDate = lessonDate ? fmtDate(lessonDate) : "";

  return (
    <KeyboardAvoidingView
      style={[s.root, { backgroundColor: C.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <SubScreenHeader
        title="반응 & 댓글"
        subtitle={displayDate}
        onBack={() => router.back()}
      />

      {loading ? (
        <ActivityIndicator color={C.tint} style={{ marginTop: 60 }} />
      ) : (
        <ScrollView
          ref={scrollRef}
          style={s.scroll}
          contentContainerStyle={{ paddingBottom: 16 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(true); }} />}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* ─── 반응 섹션 ─── */}
          <View style={[s.section, { backgroundColor: C.card }]}>
            <Text style={[s.sectionTitle, { color: C.text }]}>학부모 반응</Text>
            <View style={s.reactionRow}>
              {/* 좋아요 */}
              <View style={[s.reactionCard, { borderColor: "#2EC4B620" }]}>
                <Text style={s.reactionEmoji}>👍</Text>
                <Text style={[s.reactionCount, { color: "#2EC4B6" }]}>{likeGroup?.count ?? 0}명</Text>
                {(likeGroup?.users ?? []).length > 0 && (
                  <Text style={[s.reactionNames, { color: C.textSecondary }]} numberOfLines={2}>
                    {likeGroup!.users.map(u => u.student_name ? `${u.parent_name}(${u.student_name})` : u.parent_name).join(", ")}
                  </Text>
                )}
              </View>
              {/* 감사합니다 */}
              <View style={[s.reactionCard, { borderColor: "#BE185D20" }]}>
                <Text style={s.reactionEmoji}>🙏</Text>
                <Text style={[s.reactionCount, { color: "#BE185D" }]}>{thankGroup?.count ?? 0}명</Text>
                {(thankGroup?.users ?? []).length > 0 && (
                  <Text style={[s.reactionNames, { color: C.textSecondary }]} numberOfLines={2}>
                    {thankGroup!.users.map(u => u.student_name ? `${u.parent_name}(${u.student_name})` : u.parent_name).join(", ")}
                  </Text>
                )}
              </View>
            </View>
          </View>

          {/* ─── 댓글 섹션 ─── */}
          <View style={[s.section, { backgroundColor: C.card }]}>
            <View style={s.sectionHeaderRow}>
              <Text style={[s.sectionTitle, { color: C.text }]}>댓글</Text>
              <Text style={[s.commentCountBadge, { color: "#6366F1" }]}>{commentCount}개</Text>
            </View>

            {threads.length === 0 ? (
              <View style={s.emptyComments}>
                <LucideIcon name="message-circle" size={32} color={C.textMuted} />
                <Text style={[s.emptyText, { color: C.textMuted }]}>아직 댓글이 없습니다</Text>
              </View>
            ) : (
              threads.map(thread => (
                <View key={thread.id} style={s.threadWrap}>
                  {/* 학부모 원댓글 */}
                  <View style={[s.bubble, s.bubbleParent]}>
                    <View style={s.bubbleHeader}>
                      <View style={{ flex: 1 }}>
                        <Text style={[s.bubbleName, { color: C.tint }]}>
                          {thread.display_name}
                          {thread.student_name ? <Text style={[s.bubbleStudentTag, { color: C.textMuted }]}>  {thread.student_name}</Text> : null}
                        </Text>
                        <Text style={[s.bubbleTime, { color: C.textMuted }]}>{fmtTime(thread.created_at)}</Text>
                      </View>
                      {!thread.is_deleted && (
                        <Pressable
                          style={[s.replyBtn, { backgroundColor: "#EEF2FF" }]}
                          onPress={() => { setReplyTarget(thread); setReplyInput(""); setTimeout(() => inputRef.current?.focus(), 100); }}
                        >
                          <LucideIcon name="corner-down-right" size={12} color="#6366F1" />
                          <Text style={[s.replyBtnText, { color: "#6366F1" }]}>답글</Text>
                        </Pressable>
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
                        s.bubbleReply,
                        reply.author_role === "teacher" || reply.author_role === "pool_admin"
                          ? { backgroundColor: "#F0F4FF" }
                          : { backgroundColor: C.tint + "12" },
                      ]}
                    >
                      <View style={s.bubbleHeader}>
                        <Text style={[s.bubbleName, {
                          color: reply.author_role === "teacher" || reply.author_role === "pool_admin"
                            ? "#3B82F6" : C.tint,
                        }]}>
                          {reply.author_role === "teacher" || reply.author_role === "pool_admin" ? "📘 " : ""}{reply.author_name}
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
          </View>
        </ScrollView>
      )}

      {/* 답글 입력창 */}
      {replyTarget && (
        <View style={[s.inputBar, { borderTopColor: C.border, backgroundColor: C.card, paddingBottom: Math.max(insets.bottom, 8) }]}>
          <View style={[s.replyContext, { backgroundColor: "#EEF2FF", borderLeftColor: "#6366F1" }]}>
            <Text style={[s.replyContextText, { color: "#6366F1" }]} numberOfLines={1}>
              {replyTarget.display_name}에게 답글
            </Text>
            <Pressable onPress={() => { setReplyTarget(null); setReplyInput(""); }} hitSlop={8}>
              <LucideIcon name="x" size={14} color={C.textMuted} />
            </Pressable>
          </View>
          <View style={s.inputRow}>
            <TextInput
              ref={inputRef}
              style={[s.textInput, { color: C.text, backgroundColor: C.background, borderColor: C.border }]}
              placeholder="답글을 입력하세요"
              placeholderTextColor={C.textMuted}
              value={replyInput}
              onChangeText={setReplyInput}
              multiline
              maxLength={500}
            />
            <Pressable
              onPress={sendReply}
              disabled={!replyInput.trim() || sending}
              style={[s.sendBtn, { backgroundColor: !replyInput.trim() || sending ? C.border : "#6366F1" }]}
            >
              {sending
                ? <ActivityIndicator size="small" color="#fff" />
                : <LucideIcon name="send" size={18} color="#fff" />}
            </Pressable>
          </View>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flex: 1 },
  section: { marginHorizontal: 12, marginTop: 12, borderRadius: 14, padding: 14, gap: 10 },
  sectionTitle: { fontSize: 14, fontFamily: "Pretendard-Regular", fontWeight: "600" },
  sectionHeaderRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  commentCountBadge: { fontSize: 13, fontFamily: "Pretendard-Regular" },

  reactionRow: { flexDirection: "row", gap: 10 },
  reactionCard: { flex: 1, borderWidth: 1.5, borderRadius: 12, padding: 12, alignItems: "center", gap: 4 },
  reactionEmoji: { fontSize: 22 },
  reactionCount: { fontSize: 16, fontFamily: "Pretendard-Regular", fontWeight: "700" },
  reactionNames: { fontSize: 11, fontFamily: "Pretendard-Regular", textAlign: "center", lineHeight: 16 },

  emptyComments: { alignItems: "center", paddingVertical: 28, gap: 10 },
  emptyText: { fontSize: 13, fontFamily: "Pretendard-Regular" },

  threadWrap: { gap: 4 },
  bubble: { borderRadius: 12, padding: 12, gap: 6 },
  bubbleParent: { backgroundColor: "#F8FAFC" },
  bubbleReply: { marginLeft: 20 },
  bubbleHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 },
  bubbleName: { fontSize: 13, fontFamily: "Pretendard-Regular", fontWeight: "600" },
  bubbleStudentTag: { fontSize: 11, fontFamily: "Pretendard-Regular" },
  bubbleTime: { fontSize: 11, fontFamily: "Pretendard-Regular", marginTop: 1 },
  bubbleBody: { fontSize: 14, fontFamily: "Pretendard-Regular", lineHeight: 20 },

  replyBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  replyBtnText: { fontSize: 12, fontFamily: "Pretendard-Regular" },

  inputBar: { borderTopWidth: 1, paddingTop: 8, paddingHorizontal: 12, gap: 6 },
  replyContext: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderLeftWidth: 3 },
  replyContextText: { flex: 1, fontSize: 12, fontFamily: "Pretendard-Regular" },
  inputRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  textInput: { flex: 1, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, fontFamily: "Pretendard-Regular", maxHeight: 120, minHeight: 44 },
  sendBtn: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
});
