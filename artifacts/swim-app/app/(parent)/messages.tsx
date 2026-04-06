/**
 * 학부모 쪽지함
 *
 * diaryId 없이 진입 → 쪽지 스레드 목록 (내가 쪽지 달린 일지 + 주고받은 내역)
 * diaryId 있을 때 진입 → 해당 일지 대화 화면
 */
import { ChevronLeft, ChevronRight, Send } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable,
  RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { ParentScreenHeader } from "@/components/parent/ParentScreenHeader";
import { apiRequest, useAuth } from "@/context/AuthContext";

const C = Colors.light;

/* ── 타입 ── */
interface Thread {
  diary_id: string;
  lesson_date: string;
  teacher_name: string;
  student_name: string;
  last_message: string | null;
  last_sender_role: string | null;
  last_sender_name: string | null;
  last_message_at: string | null;
  unread_count: number;
  message_count: number;
}

interface DiaryMessage {
  id: string;
  sender_id: string;
  sender_name: string;
  sender_role: string;
  content: string;
  is_deleted: boolean;
  created_at: string;
}

/* ── 유틸 ── */
function parseLessonDate(d: string) {
  const dt = new Date(d.includes("T") ? d : d + "T00:00:00");
  const m = dt.getMonth() + 1;
  const day = dt.getDate();
  const wd = ["일", "월", "화", "수", "목", "금", "토"][dt.getDay()];
  return `${m}월 ${day}일 (${wd})`;
}
function fmtTime(d: string) {
  return new Date(d).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}
function fmtRelative(d: string) {
  const diff = Date.now() - new Date(d).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1)   return "방금";
  if (min < 60)  return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24)   return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  if (day < 7)   return `${day}일 전`;
  const dt = new Date(d);
  return `${dt.getMonth()+1}/${dt.getDate()}`;
}

/* ══════════════════════════════════════════
   메인 컴포넌트
══════════════════════════════════════════ */
export default function MessagesScreen() {
  const insets = useSafeAreaInsets();
  const { token, parentAccount } = useAuth();
  const { diaryId, diaryDate, teacherName, studentName } = useLocalSearchParams<{
    diaryId?: string; diaryDate?: string; teacherName?: string; studentName?: string;
  }>();

  /* ── 목록 모드 상태 ── */
  const [threads, setThreads] = useState<Thread[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listRefreshing, setListRefreshing] = useState(false);

  /* ── 채팅 모드 상태 ── */
  const [messages, setMessages] = useState<DiaryMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const myId = parentAccount?.id ?? "";

  const isChat = !!diaryId;

  /* ── 스레드 목록 로드 ── */
  const loadThreads = useCallback(async () => {
    setListLoading(true);
    try {
      const res = await apiRequest(token, "/parent/messages");
      if (res.ok) setThreads(await res.json());
    } finally { setListLoading(false); setListRefreshing(false); }
  }, [token]);

  /* ── 채팅 로드 ── */
  const loadChat = useCallback(async () => {
    if (!diaryId) return;
    setChatLoading(true);
    try {
      const res = await apiRequest(token, `/parent/diary/${diaryId}/messages`);
      if (res.ok) setMessages(await res.json());
    } finally { setChatLoading(false); }
  }, [diaryId, token]);

  useEffect(() => {
    if (isChat) loadChat();
    else loadThreads();
  }, [isChat, loadChat, loadThreads]);

  /* 10초 폴링 — 채팅 모드에서만 */
  useFocusEffect(useCallback(() => {
    if (!isChat) return;
    pollTimerRef.current = setInterval(async () => {
      if (!diaryId || !token) return;
      try {
        const res = await apiRequest(token, `/parent/diary/${diaryId}/messages`);
        if (res.ok) setMessages(await res.json());
      } catch { /* 무시 */ }
    }, 10_000);
    return () => { if (pollTimerRef.current) clearInterval(pollTimerRef.current); };
  }, [isChat, diaryId, token]));

  useEffect(() => {
    if (messages.length) setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }, [messages.length]);

  /* ── 쪽지 전송 ── */
  async function send() {
    if (!input.trim() || sending || !diaryId) return;
    setSending(true);
    try {
      const res = await apiRequest(token, `/parent/diary/${diaryId}/messages`, {
        method: "POST", body: JSON.stringify({ content: input.trim() }),
      });
      if (res.ok) {
        const msg = await res.json();
        setMessages(prev => [...prev, msg]);
        setInput("");
        setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
      } else {
        const err = await res.json().catch(() => ({}));
        Alert.alert("전송 실패", err.error ?? "쪽지 전송에 실패했습니다.");
      }
    } catch { Alert.alert("전송 실패", "네트워크 오류가 발생했습니다."); }
    finally { setSending(false); }
  }

  async function softDelete(msgId: string) {
    const res = await apiRequest(token, `/parent/diary/${diaryId}/messages/${msgId}`, { method: "DELETE" });
    if (res.ok) setMessages(prev => prev.map(m => m.id === msgId ? { ...m, is_deleted: true } : m));
  }
  async function restore(msgId: string) {
    const res = await apiRequest(token, `/parent/diary/${diaryId}/messages/${msgId}/restore`, { method: "POST" });
    if (res.ok) setMessages(prev => prev.map(m => m.id === msgId ? { ...m, is_deleted: false } : m));
  }
  async function hardDelete(msgId: string) {
    const res = await apiRequest(token, `/parent/diary/${diaryId}/messages/${msgId}/permanent`, { method: "DELETE" });
    if (res.ok) setMessages(prev => prev.filter(m => m.id !== msgId));
  }

  /* ══ 채팅 화면 렌더 ══ */
  if (isChat) {
    const subtitle = [teacherName && `${teacherName} 선생님`, diaryDate && parseLessonDate(diaryDate)]
      .filter(Boolean).join(" · ");
    return (
      <View style={[s.root, { backgroundColor: C.background }]}>
        <ParentScreenHeader
          title={`쪽지함${studentName ? ` — ${studentName}` : ""}`}
          subtitle={subtitle || undefined}
          leftSlot={
            <Pressable onPress={() => router.back()} hitSlop={10} style={s.backBtn}>
              <ChevronLeft size={22} color={C.text} />
            </Pressable>
          }
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={{ flex: 1 }}
          keyboardVerticalOffset={Platform.OS === "ios" ? insets.top + 60 : 0}
        >
          <ScrollView
            ref={scrollRef}
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: 12 }}
            showsVerticalScrollIndicator={false}
          >
            {chatLoading ? (
              <ActivityIndicator color={C.tint} style={{ marginTop: 40 }} />
            ) : messages.length === 0 ? (
              <View style={s.emptyWrap}>
                <Text style={s.emptyEmoji}>✉️</Text>
                <Text style={[s.emptyTitle, { color: C.text }]}>첫 쪽지를 보내보세요</Text>
                <Text style={[s.emptySub, { color: C.textSecondary }]}>선생님이 확인 후 답변드립니다</Text>
              </View>
            ) : messages.map(msg => {
              const isMine = msg.sender_id === myId;
              return (
                <View key={msg.id} style={[s.msgRow, isMine && s.msgRowRight]}>
                  {!isMine && (
                    <View style={s.msgAvatar}>
                      <LucideIcon name={msg.sender_role === "teacher" ? "user-check" : "shield"} size={14} color={C.tint} />
                    </View>
                  )}
                  <View style={{ maxWidth: "75%", gap: 2 }}>
                    {!isMine && <Text style={s.msgSender}>{msg.sender_name}</Text>}
                    <View style={[
                      s.msgBubble,
                      isMine ? { backgroundColor: C.tint } : { backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
                      msg.is_deleted && { opacity: 0.5 },
                    ]}>
                      <Text style={[s.msgContent, { color: isMine ? "#fff" : C.text }]}>
                        {msg.is_deleted ? "삭제된 메시지" : msg.content}
                      </Text>
                    </View>
                    <View style={[s.msgMeta, isMine && { alignSelf: "flex-end" }]}>
                      <Text style={s.msgTime}>{fmtTime(msg.created_at)}</Text>
                      {isMine && !msg.is_deleted && (
                        <TouchableOpacity onPress={() => softDelete(msg.id)}>
                          <Text style={s.msgAction}>삭제</Text>
                        </TouchableOpacity>
                      )}
                      {isMine && msg.is_deleted && (
                        <>
                          <TouchableOpacity onPress={() => restore(msg.id)}>
                            <Text style={[s.msgAction, { color: C.tint }]}>복구</Text>
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => hardDelete(msg.id)}>
                            <Text style={[s.msgAction, { color: "#D96C6C" }]}>영구삭제</Text>
                          </TouchableOpacity>
                        </>
                      )}
                    </View>
                  </View>
                </View>
              );
            })}
          </ScrollView>

          <View style={[s.inputRow, { borderTopColor: C.border, paddingBottom: insets.bottom + 8 }]}>
            <TextInput
              style={[s.input, { backgroundColor: "#FFFFFF", color: C.text }]}
              placeholder="쪽지 내용을 입력하세요"
              placeholderTextColor={C.textMuted}
              value={input}
              onChangeText={setInput}
              multiline
              maxLength={500}
            />
            <Pressable
              onPress={send}
              disabled={!input.trim() || sending}
              style={[s.sendBtn, { backgroundColor: C.button, opacity: !input.trim() || sending ? 0.5 : 1 }]}
            >
              {sending ? <ActivityIndicator color="#fff" size="small" /> : <Send size={18} color="#fff" />}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </View>
    );
  }

  /* ══ 목록(인박스) 화면 렌더 ══ */
  return (
    <View style={[s.root, { backgroundColor: C.background }]}>
      <ParentScreenHeader title="쪽지함" />

      {listLoading && threads.length === 0 ? (
        <ActivityIndicator color={C.tint} style={{ marginTop: 60 }} />
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: insets.bottom + 80 }}
          refreshControl={
            <RefreshControl
              refreshing={listRefreshing}
              onRefresh={() => { setListRefreshing(true); loadThreads(); }}
              tintColor={C.tint}
            />
          }
          showsVerticalScrollIndicator={false}
        >
          {threads.length === 0 ? (
            <View style={s.emptyWrap}>
              <Text style={s.emptyEmoji}>✉️</Text>
              <Text style={[s.emptyTitle, { color: C.text }]}>주고받은 쪽지가 없습니다</Text>
              <Text style={[s.emptySub, { color: C.textSecondary }]}>
                수업일지에서 쪽지달기 버튼을 눌러{"\n"}선생님께 쪽지를 보내보세요
              </Text>
              <Pressable
                style={[s.goBtn, { backgroundColor: C.button }]}
                onPress={() => router.push("/(parent)/diary" as any)}
              >
                <Text style={s.goBtnTxt}>수업일지 보러 가기</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <Text style={[s.listHint, { color: C.textMuted }]}>쪽지 {threads.length}건</Text>
              {threads.map(t => (
                <Pressable
                  key={t.diary_id}
                  style={[s.threadCard, { backgroundColor: C.card }]}
                  onPress={() => router.push({
                    pathname: "/(parent)/messages",
                    params: {
                      diaryId: t.diary_id,
                      diaryDate: t.lesson_date,
                      teacherName: t.teacher_name,
                      studentName: t.student_name,
                    },
                  } as any)}
                >
                  {/* 왼쪽: 아바타 */}
                  <View style={[s.threadAvatar, t.unread_count > 0 && { backgroundColor: C.tint }]}>
                    <LucideIcon
                      name="message-circle"
                      size={18}
                      color={t.unread_count > 0 ? "#fff" : C.tint}
                    />
                  </View>

                  {/* 중앙: 정보 */}
                  <View style={s.threadBody}>
                    <View style={s.threadTopRow}>
                      <Text style={[s.threadTitle, { color: C.text }]} numberOfLines={1}>
                        {parseLessonDate(t.lesson_date)} 일지
                      </Text>
                      {t.last_message_at && (
                        <Text style={[s.threadTime, { color: C.textMuted }]}>
                          {fmtRelative(t.last_message_at)}
                        </Text>
                      )}
                    </View>
                    <View style={s.threadMidRow}>
                      <Text style={[s.threadMeta, { color: C.textMuted }]}>
                        {t.teacher_name} 선생님 · {t.student_name}
                      </Text>
                      {t.unread_count > 0 && (
                        <View style={[s.unreadBadge, { backgroundColor: C.tint }]}>
                          <Text style={s.unreadTxt}>{t.unread_count}</Text>
                        </View>
                      )}
                    </View>
                    {t.last_message && (
                      <Text style={[s.threadPreview, {
                        color: t.unread_count > 0 ? C.text : C.textMuted,
                        fontFamily: t.unread_count > 0 ? "Pretendard-Regular" : "Pretendard-Regular",
                      }]} numberOfLines={1}>
                        {t.last_sender_role !== "parent" ? `${t.last_sender_name}: ` : "나: "}
                        {t.last_message}
                      </Text>
                    )}
                  </View>

                  {/* 오른쪽: 화살표 */}
                  <ChevronRight size={16} color={C.textMuted} />
                </Pressable>
              ))}
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },

  backBtn:     { padding: 4 },

  /* 목록 */
  listHint:    { fontSize: 12, fontFamily: "Pretendard-Regular", paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },

  threadCard:  {
    flexDirection: "row", alignItems: "center", gap: 12,
    marginHorizontal: 16, marginBottom: 10, borderRadius: 16,
    padding: 14,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 6, elevation: 2,
  },
  threadAvatar: {
    width: 44, height: 44, borderRadius: 14,
    backgroundColor: Colors.light.tintLight,
    alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  threadBody:   { flex: 1, gap: 3 },
  threadTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  threadTitle:  { fontSize: 14, fontFamily: "Pretendard-Regular", flex: 1 },
  threadTime:   { fontSize: 11, fontFamily: "Pretendard-Regular" },
  threadMidRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  threadMeta:   { fontSize: 12, fontFamily: "Pretendard-Regular" },
  threadPreview:{ fontSize: 13, fontFamily: "Pretendard-Regular" },

  unreadBadge:  { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, alignItems: "center", justifyContent: "center" },
  unreadTxt:    { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#fff" },

  /* 빈 상태 */
  emptyWrap:  { alignItems: "center", paddingTop: 80, gap: 10, paddingHorizontal: 32 },
  emptyEmoji: { fontSize: 52 },
  emptyTitle: { fontSize: 16, fontFamily: "Pretendard-Regular" },
  emptySub:   { fontSize: 13, fontFamily: "Pretendard-Regular", textAlign: "center", lineHeight: 22, color: Colors.light.textSecondary },
  goBtn:      { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 14, marginTop: 8 },
  goBtnTxt:   { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#fff" },

  /* 채팅 */
  msgRow:      { flexDirection: "row", alignItems: "flex-end", gap: 8, marginBottom: 4 },
  msgRowRight: { flexDirection: "row-reverse" },
  msgAvatar:   { width: 32, height: 32, borderRadius: 10, backgroundColor: Colors.light.tintLight, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  msgSender:   { fontSize: 11, fontFamily: "Pretendard-Regular", color: Colors.light.textSecondary, marginBottom: 2, paddingLeft: 2 },
  msgBubble:   { borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10 },
  msgContent:  { fontSize: 14, fontFamily: "Pretendard-Regular", lineHeight: 20 },
  msgMeta:     { flexDirection: "row", alignItems: "center", gap: 6 },
  msgTime:     { fontSize: 10, fontFamily: "Pretendard-Regular", color: Colors.light.textMuted },
  msgAction:   { fontSize: 11, fontFamily: "Pretendard-Regular", color: Colors.light.textSecondary },

  inputRow:    { flexDirection: "row", alignItems: "flex-end", gap: 8, paddingHorizontal: 16, paddingTop: 10, borderTopWidth: 1 },
  input:       { flex: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, fontFamily: "Pretendard-Regular", maxHeight: 100, minHeight: 44 },
  sendBtn:     { width: 44, height: 44, borderRadius: 13, alignItems: "center", justifyContent: "center" },
});
