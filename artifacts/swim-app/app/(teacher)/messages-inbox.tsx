/**
 * (teacher)/messages-inbox.tsx — 쪽지보관함
 *
 * - 전체 쪽지 대화 목록 (일지별 그룹)
 * - 대화 클릭 → 전체 메시지 + 답장 입력 (텍스트 + 사진 첨부)
 * - URL param: diaryId (UnreadMessagesModal에서 직접 열 때)
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, Image, KeyboardAvoidingView,
  Platform, Pressable, ScrollView, StyleSheet, Text,
  TextInput, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { ChevronLeft, Image as ImageIcon, Mail, MessageSquare, Send, X } from "lucide-react-native";
import Colors from "@/constants/colors";
import { API_BASE, apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";

const C = Colors.light;

interface Thread {
  diary_id: string;
  lesson_date: string;
  class_name: string;
  parent_msg_count: number;
  unread_count: number;
  last_msg_at: string;
  last_content: string;
  last_sender_role: string;
  last_sender_name: string;
}

interface Message {
  id: string;
  diary_id: string;
  sender_name: string;
  sender_role: "parent" | "teacher";
  content: string;
  image_url?: string | null;
  read_at: string | null;
  created_at: string;
}

export default function MessagesInboxScreen() {
  const { token } = useAuth();
  const { themeColor } = useBrand();
  const params = useLocalSearchParams<{ diaryId?: string; backTo?: string }>();

  const [view, setView] = useState<"list" | "thread">("list");
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loadingThreads, setLoadingThreads] = useState(true);

  const [activeThread, setActiveThread] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);

  const [replyText, setReplyText] = useState("");
  const [replyImage, setReplyImage] = useState<{ uri: string; url?: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);

  const scrollRef = useRef<ScrollView>(null);

  const fetchThreads = useCallback(async () => {
    try {
      const res = await apiRequest(token, "/teacher/messages/threads");
      if (res.ok) setThreads(await res.json());
    } catch { /* ignore */ }
    finally { setLoadingThreads(false); }
  }, [token]);

  const openThread = useCallback(async (thread: Thread) => {
    setActiveThread(thread);
    setView("thread");
    setLoadingMsgs(true);
    setMessages([]);
    try {
      const res = await apiRequest(token, `/teacher/diary/${thread.diary_id}/messages`);
      if (res.ok) setMessages(await res.json());
      // 읽음 처리
      await apiRequest(token, "/teacher/messages/read-all", { method: "POST" }).catch(() => {});
    } catch { /* ignore */ }
    finally { setLoadingMsgs(false); }
  }, [token]);

  useEffect(() => {
    fetchThreads();
  }, [fetchThreads]);

  // URL param으로 특정 다이어리 직접 열기 (UnreadMessagesModal에서 진입)
  useEffect(() => {
    if (!params.diaryId || loadingThreads) return;
    const found = threads.find(t => t.diary_id === params.diaryId);
    if (found) {
      openThread(found);
    } else if (params.diaryId) {
      // 스레드 목록에 없더라도 직접 열기
      const synthetic: Thread = {
        diary_id: params.diaryId,
        lesson_date: "",
        class_name: "",
        parent_msg_count: 0,
        unread_count: 0,
        last_msg_at: "",
        last_content: "",
        last_sender_role: "parent",
        last_sender_name: "",
      };
      openThread(synthetic);
    }
  }, [params.diaryId, loadingThreads, threads]);

  async function pickImage() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("권한 필요", "사진 첨부를 위해 갤러리 접근 권한이 필요합니다.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
      allowsEditing: false,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setReplyImage({ uri: asset.uri });
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("images", {
        uri: asset.uri,
        name: "msg_photo.jpg",
        type: "image/jpeg",
      } as any);
      const uploadRes = await fetch(`${API_BASE}/uploads`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (uploadRes.ok) {
        const data = await uploadRes.json();
        const key = data.urls?.[0] || data.url || null;
        const url = key ? `${API_BASE}/uploads/${key}` : null;
        setReplyImage({ uri: asset.uri, url });
      } else {
        Alert.alert("업로드 실패", "사진 업로드에 실패했습니다. 다시 시도해주세요.");
        setReplyImage(null);
      }
    } catch {
      Alert.alert("업로드 실패", "네트워크 오류가 발생했습니다.");
      setReplyImage(null);
    } finally { setUploading(false); }
  }

  async function sendReply() {
    if (!activeThread) return;
    if (!replyText.trim() && !replyImage?.url) return;
    if (uploading) { Alert.alert("잠깐만요", "사진 업로드 중입니다."); return; }
    setSending(true);
    try {
      const res = await apiRequest(token, `/teacher/diary/${activeThread.diary_id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: replyText.trim(),
          image_url: replyImage?.url || null,
        }),
      });
      if (res.ok) {
        const newMsg: Message = await res.json();
        setMessages(prev => [...prev, newMsg]);
        setReplyText("");
        setReplyImage(null);
        setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
      } else {
        Alert.alert("전송 실패", "쪽지 전송에 실패했습니다.");
      }
    } catch { Alert.alert("전송 실패", "네트워크 오류가 발생했습니다."); }
    finally { setSending(false); }
  }

  function fmtDate(s: string) {
    if (!s) return "";
    const d = new Date(s);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
    return `${d.getMonth()+1}/${d.getDate()}`;
  }

  function fmtFull(s: string) {
    if (!s) return "";
    const d = new Date(s);
    return `${d.getMonth()+1}월 ${d.getDate()}일 ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  }

  // ── 목록 화면 ──
  if (view === "list") {
    return (
      <SafeAreaView style={s.safe} edges={["top"]}>
        <View style={s.header}>
          <Pressable onPress={() => router.back()} style={s.backBtn}>
            <ChevronLeft size={22} color={C.text} />
          </Pressable>
          <Text style={s.headerTitle}>쪽지보관함</Text>
          <View style={{ width: 40 }} />
        </View>

        {loadingThreads ? (
          <ActivityIndicator color={themeColor} style={{ marginTop: 60 }} />
        ) : threads.length === 0 ? (
          <View style={s.empty}>
            <Mail size={48} color={C.textMuted} />
            <Text style={[s.emptyTxt, { color: C.textMuted }]}>받은 쪽지가 없습니다</Text>
            <Text style={[s.emptySubTxt, { color: C.textMuted }]}>학부모가 수업일지에 쪽지를 보내면{"\n"}여기에 표시됩니다</Text>
          </View>
        ) : (
          <FlatList
            data={threads}
            keyExtractor={item => item.diary_id}
            contentContainerStyle={{ padding: 16, gap: 8 }}
            renderItem={({ item }) => (
              <Pressable
                style={({ pressed }) => [s.threadItem, { opacity: pressed ? 0.85 : 1 }]}
                onPress={() => openThread(item)}
              >
                <View style={[s.threadIcon, { backgroundColor: item.unread_count > 0 ? themeColor + "20" : "#F1F5F9" }]}>
                  <MessageSquare size={20} color={item.unread_count > 0 ? themeColor : C.textMuted} />
                </View>
                <View style={{ flex: 1, gap: 3 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text style={[s.threadClass, { color: C.text }]} numberOfLines={1}>
                      {item.class_name || "반 정보 없음"} · {item.lesson_date ? item.lesson_date.slice(0,10) : ""}
                    </Text>
                    {item.unread_count > 0 && (
                      <View style={[s.unreadBadge, { backgroundColor: C.error }]}>
                        <Text style={s.unreadBadgeTxt}>{item.unread_count}</Text>
                      </View>
                    )}
                  </View>
                  <Text style={[s.threadPreview, { color: C.textSecondary }]} numberOfLines={1}>
                    {item.last_sender_role === "teacher" ? "나: " : `${item.last_sender_name}: `}
                    {item.last_content || "사진"}
                  </Text>
                </View>
                <Text style={[s.threadTime, { color: C.textMuted }]}>{fmtDate(item.last_msg_at)}</Text>
              </Pressable>
            )}
          />
        )}
      </SafeAreaView>
    );
  }

  // ── 대화 화면 ──
  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      <View style={s.header}>
        <Pressable onPress={() => { setView("list"); setActiveThread(null); setReplyText(""); setReplyImage(null); }} style={s.backBtn}>
          <ChevronLeft size={22} color={C.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle} numberOfLines={1}>
            {activeThread?.class_name || "쪽지"}
          </Text>
          {activeThread?.lesson_date ? (
            <Text style={[s.headerSub, { color: C.textMuted }]}>
              {activeThread.lesson_date.slice(0,10)} 수업일지
            </Text>
          ) : null}
        </View>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={0}
      >
        {loadingMsgs ? (
          <ActivityIndicator color={themeColor} style={{ marginTop: 60 }} />
        ) : (
          <ScrollView
            ref={scrollRef}
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: 16, gap: 12 }}
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
            showsVerticalScrollIndicator={false}
          >
            {messages.length === 0 ? (
              <View style={s.empty}>
                <MessageSquare size={40} color={C.textMuted} />
                <Text style={[s.emptyTxt, { color: C.textMuted }]}>메시지가 없습니다</Text>
              </View>
            ) : (
              messages.map(msg => {
                const isTeacher = msg.sender_role === "teacher";
                return (
                  <View key={msg.id} style={[s.msgRow, isTeacher && s.msgRowRight]}>
                    {!isTeacher && (
                      <View style={[s.msgAvatar, { backgroundColor: themeColor + "20" }]}>
                        <Text style={[s.msgAvatarTxt, { color: themeColor }]}>
                          {(msg.sender_name || "학")[0]}
                        </Text>
                      </View>
                    )}
                    <View style={[s.msgBubbleWrap, isTeacher && { alignItems: "flex-end" }]}>
                      {!isTeacher && (
                        <Text style={[s.msgSenderName, { color: C.textSecondary }]}>{msg.sender_name}</Text>
                      )}
                      <View style={[
                        s.msgBubble,
                        isTeacher
                          ? { backgroundColor: themeColor, borderBottomRightRadius: 4 }
                          : { backgroundColor: "#F1F5F9", borderBottomLeftRadius: 4 }
                      ]}>
                        {msg.image_url ? (
                          <Image
                            source={{ uri: msg.image_url }}
                            style={s.msgImage}
                            resizeMode="cover"
                          />
                        ) : null}
                        {msg.content ? (
                          <Text style={[s.msgText, { color: isTeacher ? "#fff" : C.text }]}>
                            {msg.content}
                          </Text>
                        ) : null}
                      </View>
                      <Text style={[s.msgTime, { color: C.textMuted }]}>{fmtFull(msg.created_at)}</Text>
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>
        )}

        {/* 답장 입력 영역 */}
        <View style={s.inputWrap}>
          {replyImage && (
            <View style={s.imagePreviewRow}>
              <Image source={{ uri: replyImage.uri }} style={s.imagePreview} />
              {uploading && (
                <ActivityIndicator size="small" color={themeColor} style={StyleSheet.absoluteFill} />
              )}
              <Pressable style={s.removeImageBtn} onPress={() => setReplyImage(null)}>
                <X size={12} color="#fff" />
              </Pressable>
            </View>
          )}
          <View style={s.inputRow}>
            <Pressable style={s.imageBtn} onPress={pickImage} disabled={uploading || sending}>
              <ImageIcon size={20} color={uploading ? C.textMuted : themeColor} />
            </Pressable>
            <TextInput
              style={s.input}
              placeholder="답장을 입력하세요..."
              placeholderTextColor={C.textMuted}
              value={replyText}
              onChangeText={setReplyText}
              multiline
              maxLength={500}
              editable={!sending}
            />
            <Pressable
              style={[s.sendBtn, { backgroundColor: (replyText.trim() || replyImage?.url) && !sending ? themeColor : C.border }]}
              onPress={sendReply}
              disabled={sending || (!replyText.trim() && !replyImage?.url)}
            >
              {sending
                ? <ActivityIndicator size="small" color="#fff" />
                : <Send size={16} color="#fff" />
              }
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:           { flex: 1, backgroundColor: "#fff" },
  header:         { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border, gap: 4 },
  backBtn:        { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle:    { flex: 1, fontSize: 17, fontFamily: "Pretendard-Regular", color: C.text, textAlign: "center" },
  headerSub:      { fontSize: 12, fontFamily: "Pretendard-Regular", textAlign: "center" },
  empty:          { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingTop: 80 },
  emptyTxt:       { fontSize: 16, fontFamily: "Pretendard-Regular" },
  emptySubTxt:    { fontSize: 13, fontFamily: "Pretendard-Regular", textAlign: "center", lineHeight: 20 },
  threadItem:     { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: C.card, borderRadius: 14, padding: 14, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 3, elevation: 1 },
  threadIcon:     { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  threadClass:    { fontSize: 14, fontFamily: "Pretendard-Regular" },
  threadPreview:  { fontSize: 13, fontFamily: "Pretendard-Regular" },
  threadTime:     { fontSize: 12, fontFamily: "Pretendard-Regular" },
  unreadBadge:    { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  unreadBadgeTxt: { color: "#fff", fontSize: 11, fontFamily: "Pretendard-Regular" },

  msgRow:         { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  msgRowRight:    { flexDirection: "row-reverse" },
  msgAvatar:      { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  msgAvatarTxt:   { fontSize: 13, fontFamily: "Pretendard-Regular" },
  msgBubbleWrap:  { flex: 1, gap: 3 },
  msgSenderName:  { fontSize: 12, fontFamily: "Pretendard-Regular", marginLeft: 2 },
  msgBubble:      { maxWidth: "85%", borderRadius: 16, overflow: "hidden", paddingHorizontal: 14, paddingVertical: 10 },
  msgImage:       { width: 180, height: 180, borderRadius: 8, marginBottom: 6 },
  msgText:        { fontSize: 14, fontFamily: "Pretendard-Regular", lineHeight: 20 },
  msgTime:        { fontSize: 11, fontFamily: "Pretendard-Regular", marginHorizontal: 4 },

  inputWrap:      { borderTopWidth: 1, borderTopColor: C.border, padding: 10, backgroundColor: "#fff" },
  imagePreviewRow:{ flexDirection: "row", marginBottom: 8, position: "relative" },
  imagePreview:   { width: 72, height: 72, borderRadius: 10 },
  removeImageBtn: { position: "absolute", top: -6, right: -6, width: 20, height: 20, borderRadius: 10, backgroundColor: "#0008", alignItems: "center", justifyContent: "center" },
  inputRow:       { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  imageBtn:       { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  input:          { flex: 1, minHeight: 36, maxHeight: 100, borderWidth: 1, borderColor: C.border, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8, fontSize: 14, fontFamily: "Pretendard-Regular", color: C.text },
  sendBtn:        { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
});
