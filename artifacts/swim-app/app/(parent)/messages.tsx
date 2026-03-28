/**
 * 학부모 쪽지 페이지 — 대화형 전체 화면
 *
 * params:
 *   diaryId     — 특정 일지에 연결된 쪽지 (없으면 일반 쪽지 목록)
 *   diaryDate   — 일지 날짜 표시용
 *   teacherName — 선생님 이름 표시용
 *   studentName — 자녀 이름 표시용
 *
 * 뒤로가기: router.back() → 이전 학부모 화면
 * 홈:      router.replace("/(parent)/home")
 */
import { Send } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { ParentScreenHeader } from "@/components/parent/ParentScreenHeader";
import { apiRequest, useAuth } from "@/context/AuthContext";

const C = Colors.light;

interface DiaryMessage {
  id: string;
  sender_id: string;
  sender_name: string;
  sender_role: string;
  content: string;
  is_deleted: boolean;
  created_at: string;
}

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

export default function MessagesScreen() {
  const insets = useSafeAreaInsets();
  const { token, parentAccount } = useAuth();
  const { diaryId, diaryDate, teacherName, studentName } = useLocalSearchParams<{
    diaryId: string;
    diaryDate: string;
    teacherName: string;
    studentName: string;
  }>();

  const [messages, setMessages] = useState<DiaryMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const myId = parentAccount?.id ?? "";

  const load = useCallback(async () => {
    if (!diaryId) return;
    setLoading(true);
    try {
      const res = await apiRequest(token, `/parent/diary/${diaryId}/messages`);
      if (res.ok) setMessages(await res.json());
    } finally { setLoading(false); }
  }, [diaryId, token]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (messages.length) setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }, [messages.length]);

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
      }
    } finally { setSending(false); }
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

  // 제목 라인 계산
  const subtitle = diaryId
    ? [teacherName && `${teacherName} 선생님`, diaryDate && parseLessonDate(diaryDate)].filter(Boolean).join(" · ")
    : undefined;

  return (
    <View style={[s.root, { backgroundColor: C.background }]}>
      <ParentScreenHeader
        title={`쪽지함${studentName ? ` — ${studentName}` : ""}`}
        subtitle={subtitle}
      />

      {/* ParentScreenHeader가 KAV 위에 있으므로 그 높이만큼 오프셋 지정 */}
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
        keyboardVerticalOffset={Platform.OS === "ios" ? insets.top + 60 : 0}
      >
        {/* 메시지 목록 */}
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: 12 }}
          showsVerticalScrollIndicator={false}
        >
          {!diaryId ? (
            <View style={s.noDiary}>
              <Text style={s.noDiaryEmoji}>✉️</Text>
              <Text style={[s.noDiaryTitle, { color: C.text }]}>쪽지를 보내려면</Text>
              <Text style={[s.noDiarySub, { color: C.textSecondary }]}>수업일지에서 쪽지달기 버튼을 눌러 선생님께 쪽지를 보내세요</Text>
              <Pressable
                style={[s.noDiaryBtn, { backgroundColor: C.button }]}
                onPress={() => router.push("/(parent)/diary" as any)}
              >
                <Text style={s.noDiaryBtnTxt}>수업일지 보러 가기</Text>
              </Pressable>
            </View>
          ) : loading ? (
            <ActivityIndicator color={C.tint} style={{ marginTop: 40 }} />
          ) : messages.length === 0 ? (
            <View style={s.emptyWrap}>
              <Text style={s.emptyEmoji}>✉️</Text>
              <Text style={[s.emptyTitle, { color: C.text }]}>첫 쪽지를 보내보세요</Text>
              <Text style={[s.emptySub, { color: C.textSecondary }]}>선생님이 확인 후 답변드립니다</Text>
            </View>
          ) : (
            messages.map(msg => {
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
                      isMine
                        ? { backgroundColor: C.tint }
                        : { backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
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
            })
          )}
        </ScrollView>

        {/* 입력창 */}
        {diaryId ? (
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
              {sending
                ? <ActivityIndicator color="#fff" size="small" />
                : <Send size={18} color="#fff" />
              }
            </Pressable>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },

  noDiary: { alignItems: "center", paddingTop: 60, gap: 12, paddingHorizontal: 20 },
  noDiaryEmoji: { fontSize: 56 },
  noDiaryTitle: { fontSize: 18, fontFamily: "Pretendard-SemiBold" },
  noDiarySub: { fontSize: 14, fontFamily: "Pretendard-Regular", textAlign: "center", lineHeight: 22 },
  noDiaryBtn: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 14, marginTop: 8 },
  noDiaryBtnTxt: { fontSize: 14, fontFamily: "Pretendard-Medium", color: "#fff" },

  emptyWrap: { alignItems: "center", paddingTop: 60, gap: 8 },
  emptyEmoji: { fontSize: 48 },
  emptyTitle: { fontSize: 16, fontFamily: "Pretendard-Medium" },
  emptySub: { fontSize: 13, fontFamily: "Pretendard-Regular", textAlign: "center" },

  msgRow: { flexDirection: "row", alignItems: "flex-end", gap: 8, marginBottom: 4 },
  msgRowRight: { flexDirection: "row-reverse" },
  msgAvatar: {
    width: 32, height: 32, borderRadius: 10, backgroundColor: C.tintLight,
    alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  msgSender: { fontSize: 11, fontFamily: "Pretendard-Medium", color: C.textSecondary, marginBottom: 2, paddingLeft: 2 },
  msgBubble: { borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10 },
  msgContent: { fontSize: 14, fontFamily: "Pretendard-Regular", lineHeight: 20 },
  msgMeta: { flexDirection: "row", alignItems: "center", gap: 6 },
  msgTime: { fontSize: 10, fontFamily: "Pretendard-Regular", color: C.textMuted },
  msgAction: { fontSize: 11, fontFamily: "Pretendard-Medium", color: C.textSecondary },

  inputRow: {
    flexDirection: "row", alignItems: "flex-end", gap: 8,
    paddingHorizontal: 16, paddingTop: 10, borderTopWidth: 1,
  },
  input: {
    flex: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 14, fontFamily: "Pretendard-Regular", maxHeight: 100, minHeight: 44,
  },
  sendBtn: { width: 44, height: 44, borderRadius: 13, alignItems: "center", justifyContent: "center" },
});
