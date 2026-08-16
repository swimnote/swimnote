/**
 * (teacher)/messages-inbox.tsx — 알림함
 *
 * 탭1: 소식   — 학부모의 좋아요·감사합니다·일지 댓글 활동
 * 탭2: 쪽지함 — 일지별 쪽지 대화
 * 탭3: 학부모 요청 — 결석/보강/퇴원 등 학부모가 보낸 요청
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {ActivityIndicator, Alert, FlatList, Image,
  Platform, Pressable, RefreshControl, StyleSheet, Text,
  TextInput, View} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { LucideIcon } from "@/components/common/LucideIcon";
import Colors from "@/constants/colors";
import { API_BASE, apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { parseDateSafe } from "@/domain/formatters";
import { RequestThreadModal } from "@/components/teacher/RequestThreadModal";

const C = Colors.light;

interface Thread {
  diary_id: string;
  lesson_date: string;
  class_name: string;
  parent_msg_count: number;
  unread_count: number;
  unread_comment_count: number;
  last_msg_at: string;
  last_content: string;
  last_sender_role: string;
  last_sender_name: string;
  last_message_type?: string;
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

interface ParentRequest {
  id: string;
  student_id: string;
  student_name: string;
  parent_name: string;
  request_type: string;
  request_date: string | null;
  content: string | null;
  status: string;
  created_at: string;
  is_read_by_teacher: boolean;
  new_message_count?: number;
}

const REQUEST_TYPE_LABEL: Record<string, string> = {
  absence:    "결석 신청",
  makeup:     "보강 요청",
  postpone:   "연기 신청",
  withdrawal: "퇴원 신청",
  counseling: "상담 요청",
  inquiry:    "문의",
};
const REQUEST_TYPE_COLOR: Record<string, string> = {
  absence:    "#EF4444",
  makeup:     "#3B82F6",
  postpone:   "#F59E0B",
  withdrawal: "#6B7280",
  counseling: "#8B5CF6",
  inquiry:    "#0EA5E9",
};
const STATUS_LABEL: Record<string, string> = { pending: "처리 대기", done: "처리 완료", rejected: "거절됨" };
const STATUS_COLOR: Record<string, { text: string; bg: string }> = {
  pending:  { text: "#D97706", bg: "#FFF7ED" },
  done:     { text: "#059669", bg: "#ECFDF5" },
  rejected: { text: "#EF4444", bg: "#FEF2F2" },
};

export default function MessagesInboxScreen() {
  const { token } = useAuth();
  const { themeColor } = useBrand();
  const params = useLocalSearchParams<{ diaryId?: string; backTo?: string; tab?: string; requestId?: string }>();

  const [activeTab, setActiveTab] = useState<"news" | "messages" | "requests">(
    params.tab === "requests" ? "requests" : params.tab === "news" ? "news" : "messages"
  );
  const [highlightReqId, setHighlightReqId] = useState<string | null>(params.requestId || null);

  // 홈에서 특정 requestId로 진입 시 탭 전환 + 강조
  useEffect(() => {
    if (params.requestId) {
      setActiveTab("requests");
      setHighlightReqId(params.requestId);
      const timer = setTimeout(() => setHighlightReqId(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [params.requestId]);

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

  // ── 소식 탭 상태 ──
  interface NewsItem {
    id: string;
    type: "diary_like" | "diary_thanks" | "diary_comment";
    title: string;
    body: string;
    ref_id: string;   // diary_id
    is_read: boolean;
    created_at: string;
    lesson_date?: string;
    class_name?: string;
  }
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loadingNews, setLoadingNews] = useState(true);
  const [unreadNewsCount, setUnreadNewsCount] = useState(0);

  const fetchNews = useCallback(async () => {
    setLoadingNews(true);
    try {
      const res = await apiRequest(token, "/teacher/news", { _noCache: true } as any);
      if (res.ok) {
        const d = await res.json();
        setNews(d.news ?? []);
        setUnreadNewsCount(d.unread_count ?? 0);
      }
    } catch { }
    finally { setLoadingNews(false); }
  }, [token]);

  const [parentRequests, setParentRequests] = useState<ParentRequest[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(true);
  const [reqRefreshing, setReqRefreshing] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [threadModalReq, setThreadModalReq] = useState<ParentRequest | null>(null);

  const scrollRef = useRef<any>(null);
  const reqFlatListRef = useRef<any>(null);

  const fetchThreads = useCallback(async () => {
    setLoadingThreads(true);
    try {
      const res = await apiRequest(token, "/teacher/messages/threads");
      if (res.ok) setThreads(await res.json());
    } catch { }
    finally { setLoadingThreads(false); }
  }, [token]);

  const fetchRequests = useCallback(async () => {
    try {
      const res = await apiRequest(token, "/teacher/parent-requests");
      if (res.ok) {
        const d = await res.json();
        setParentRequests(d.data || []);
      }
    } catch { }
    finally { setLoadingRequests(false); setReqRefreshing(false); }
  }, [token]);

  const openThread = useCallback(async (thread: Thread) => {
    setActiveThread(thread);
    setView("thread");
    setLoadingMsgs(true);
    setMessages([]);
    try {
      const res = await apiRequest(token, `/teacher/diary/${thread.diary_id}/messages`);
      if (res.ok) setMessages(await res.json());
      await apiRequest(token, "/teacher/messages/read-all", { method: "POST" }).catch(() => {});
    } catch { }
    finally { setLoadingMsgs(false); }
  }, [token]);

  useEffect(() => { fetchThreads(); fetchRequests(); fetchNews(); }, [fetchThreads, fetchRequests, fetchNews]);

  // 강조 대상 requestId가 있으면 해당 아이템으로 스크롤
  useEffect(() => {
    if (activeTab === "requests" && highlightReqId && parentRequests.length > 0) {
      const idx = parentRequests.findIndex(r => r.id === highlightReqId);
      if (idx >= 0) {
        setTimeout(() => {
          reqFlatListRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.3 });
        }, 500);
      }
    }
  }, [activeTab, highlightReqId, parentRequests]);

  useEffect(() => {
    if (!params.diaryId || loadingThreads) return;
    const found = threads.find(t => t.diary_id === params.diaryId);
    if (found) {
      openThread(found);
    } else if (params.diaryId) {
      const synthetic: Thread = {
        diary_id: params.diaryId, lesson_date: "", class_name: "",
        parent_msg_count: 0, unread_count: 0, unread_comment_count: 0, last_msg_at: "",
        last_content: "", last_sender_role: "parent", last_sender_name: "",
      };
      openThread(synthetic);
    }
  }, [params.diaryId, loadingThreads, threads]);

  async function markAsRead(id: string) {
    // 낙관적 업데이트: 즉시 읽음으로 표시
    setParentRequests(prev => prev.map(r => r.id === id ? { ...r, is_read_by_teacher: true } : r));
    apiRequest(token, `/teacher/parent-requests/${id}/read`, { method: "PATCH" }).catch(() => {});
  }

  async function updateRequestStatus(id: string, status: "done" | "rejected") {
    setUpdatingId(id);
    // 상태 변경 시 읽음도 함께 처리 (낙관적)
    setParentRequests(prev => prev.map(r => r.id === id ? { ...r, is_read_by_teacher: true } : r));
    try {
      const res = await apiRequest(token, `/parent-requests/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        setParentRequests(prev => prev.map(r => r.id === id ? { ...r, status, is_read_by_teacher: true } : r));
      } else {
        Alert.alert("오류", "상태 변경에 실패했습니다.");
      }
    } catch {
      Alert.alert("오류", "네트워크 오류가 발생했습니다.");
    }
    setUpdatingId(null);
  }

  async function pickImage() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("권한 필요", "사진 첨부를 위해 갤러리 접근 권한이 필요합니다."); return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8, allowsEditing: false });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setReplyImage({ uri: asset.uri });
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("images", { uri: asset.uri, name: "msg_photo.jpg", type: "image/jpeg" } as any);
      const uploadRes = await fetch(`${API_BASE}/uploads`, {
        method: "POST", headers: { Authorization: `Bearer ${token}` }, body: formData,
      });
      if (uploadRes.ok) {
        const data = await uploadRes.json();
        const key = data.urls?.[0] || data.url || null;
        const url = key ? `${API_BASE}/uploads/${key}` : null;
        setReplyImage({ uri: asset.uri, url: url ?? undefined });
      } else {
        Alert.alert("업로드 실패", "사진 업로드에 실패했습니다."); setReplyImage(null);
      }
    } catch {
      Alert.alert("업로드 실패", "네트워크 오류가 발생했습니다."); setReplyImage(null);
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
        body: JSON.stringify({ content: replyText.trim(), image_url: replyImage?.url || null }),
      });
      if (res.ok) {
        const newMsg: Message = await res.json();
        setMessages(prev => [...prev, newMsg]);
        setReplyText(""); setReplyImage(null);
        setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
      } else {
        Alert.alert("전송 실패", "쪽지 전송에 실패했습니다.");
      }
    } catch { Alert.alert("전송 실패", "네트워크 오류가 발생했습니다."); }
    finally { setSending(false); }
  }

  /** 스레드 목록 시간: 오늘이면 "HH:MM", 아니면 "M/D" — Invalid이면 "" */
  function fmtDate(s: string | null | undefined): string {
    const d = parseDateSafe(s);
    if (!d) return "";
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }

  /** 메시지 상세 시간: "M월 D일 HH:MM" — Invalid이면 "" */
  function fmtFull(s: string | null | undefined): string {
    const d = parseDateSafe(s);
    if (!d) return "";
    return `${d.getMonth() + 1}월 ${d.getDate()}일 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  const unreadRequestCount = parentRequests.filter(r => !r.is_read_by_teacher).length;
  const unreadMsgCount = threads.reduce((sum, t) => sum + (t.unread_count ?? 0), 0);

  /** 소식 아이콘 반환 */
  function newsIcon(type: string) {
    if (type === "diary_like")    return { name: "heart" as const,        color: "#EF4444" };
    if (type === "diary_thanks")  return { name: "hand-heart" as const,   color: "#F59E0B" };
    if (type === "diary_comment") return { name: "message-circle" as const, color: "#10B981" };
    return { name: "bell" as const, color: "#6B7280" };
  }
  /** 소식 날짜 포맷 */
  function fmtNewsDate(s: string | null | undefined): string {
    const d = parseDateSafe(s);
    if (!d) return "";
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }

  // ── 대화 화면 (thread view) ──
  if (view === "thread") {
    return (
      <SafeAreaView style={s.safe} edges={["top"]}>
        <View style={s.header}>
          <Pressable onPress={() => { setView("list"); setActiveThread(null); setReplyText(""); setReplyImage(null); }} style={s.backBtn}>
            <LucideIcon name="chevron-left" size={22} color={C.text} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={s.headerTitle} numberOfLines={1}>{activeThread?.class_name || "쪽지"}</Text>
            {activeThread?.lesson_date ? (
              <Text style={[s.headerSub, { color: C.textMuted }]}>{activeThread.lesson_date.slice(0,10)} 수업일지</Text>
            ) : null}
          </View>
          <View style={{ width: 40 }} />
        </View>

        <View style={{ flex: 1 }}>
          {loadingMsgs ? (
            <ActivityIndicator color={themeColor} style={{ marginTop: 60 }} />
          ) : (
            <KeyboardAwareScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 12 }}
              onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })} showsVerticalScrollIndicator={false}>
              {messages.length === 0 ? (
                <View style={s.empty}>
                  <LucideIcon name="message-square" size={40} color={C.textMuted} />
                  <Text style={[s.emptyTxt, { color: C.textMuted }]}>메시지가 없습니다</Text>
                </View>
              ) : (
                messages.map(msg => {
                  const isTeacher = msg.sender_role === "teacher";
                  return (
                    <View key={msg.id} style={[s.msgRow, isTeacher && s.msgRowRight]}>
                      {!isTeacher && (
                        <View style={[s.msgAvatar, { backgroundColor: themeColor + "20" }]}>
                          <Text style={[s.msgAvatarTxt, { color: themeColor }]}>{(msg.sender_name || "학")[0]}</Text>
                        </View>
                      )}
                      <View style={[s.msgBubbleWrap, isTeacher && { alignItems: "flex-end" }]}>
                        {!isTeacher && <Text style={[s.msgSenderName, { color: C.textSecondary }]}>{msg.sender_name}</Text>}
                        <View style={[s.msgBubble, isTeacher
                          ? { backgroundColor: themeColor, borderBottomRightRadius: 4 }
                          : { backgroundColor: C.backgroundSoft, borderBottomLeftRadius: 4 }
                        ]}>
                          {msg.image_url ? <Image source={{ uri: msg.image_url }} style={s.msgImage} resizeMode="cover" /> : null}
                          {msg.content ? <Text style={[s.msgText, { color: isTeacher ? "#fff" : C.text }]}>{msg.content}</Text> : null}
                        </View>
                        <Text style={[s.msgTime, { color: C.textMuted }]}>{fmtFull(msg.created_at)}</Text>
                      </View>
                    </View>
                  );
                })
              )}
            </KeyboardAwareScrollView>
          )}

          <View style={s.inputWrap}>
            {replyImage && (
              <View style={s.imagePreviewRow}>
                <Image source={{ uri: replyImage.uri }} style={s.imagePreview} />
                {uploading && <ActivityIndicator size="small" color={themeColor} style={StyleSheet.absoluteFill} />}
                <Pressable style={s.removeImageBtn} onPress={() => setReplyImage(null)}>
                  <LucideIcon name="x" size={12} color="#fff" />
                </Pressable>
              </View>
            )}
            <View style={s.inputRow}>
              <Pressable style={s.imageBtn} onPress={pickImage} disabled={uploading || sending}>
                <LucideIcon name="image" size={20} color={uploading ? C.textMuted : themeColor} />
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
                {sending ? <ActivityIndicator size="small" color="#fff" /> : <LucideIcon name="send" size={16} color="#fff" />}
              </Pressable>
            </View>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ── 목록 화면 ──
  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.backBtn}>
          <LucideIcon name="chevron-left" size={22} color={C.text} />
        </Pressable>
        <Text style={s.headerTitle}>알림함</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* 탭 */}
      <View style={s.tabRow}>
        <Pressable style={[s.tab, activeTab === "news" && { borderBottomColor: themeColor, borderBottomWidth: 2 }]}
          onPress={() => setActiveTab("news")}>
          <LucideIcon name="heart" size={16} color={activeTab === "news" ? themeColor : C.textMuted} />
          <Text style={[s.tabTxt, { color: activeTab === "news" ? themeColor : C.textMuted }]}>소식</Text>
          {unreadNewsCount > 0 && (
            <View style={[s.tabBadge, { backgroundColor: "#EF4444" }]}>
              <Text style={s.tabBadgeTxt}>{unreadNewsCount}</Text>
            </View>
          )}
        </Pressable>
        <Pressable style={[s.tab, activeTab === "messages" && { borderBottomColor: themeColor, borderBottomWidth: 2 }]}
          onPress={() => setActiveTab("messages")}>
          <LucideIcon name="message-square" size={16} color={activeTab === "messages" ? themeColor : C.textMuted} />
          <Text style={[s.tabTxt, { color: activeTab === "messages" ? themeColor : C.textMuted }]}>쪽지함</Text>
          {unreadMsgCount > 0 && (
            <View style={[s.tabBadge, { backgroundColor: C.error }]}>
              <Text style={s.tabBadgeTxt}>{unreadMsgCount}</Text>
            </View>
          )}
        </Pressable>
        <Pressable style={[s.tab, activeTab === "requests" && { borderBottomColor: themeColor, borderBottomWidth: 2 }]}
          onPress={() => setActiveTab("requests")}>
          <LucideIcon name="clipboard-list" size={16} color={activeTab === "requests" ? themeColor : C.textMuted} />
          <Text style={[s.tabTxt, { color: activeTab === "requests" ? themeColor : C.textMuted }]}>학부모 요청</Text>
          {unreadRequestCount > 0 && (
            <View style={[s.tabBadge, { backgroundColor: C.error }]}>
              <Text style={s.tabBadgeTxt}>{unreadRequestCount}</Text>
            </View>
          )}
        </Pressable>
      </View>

      {/* 탭1: 소식 */}
      {activeTab === "news" && (
        loadingNews ? (
          <ActivityIndicator color={themeColor} style={{ marginTop: 60 }} />
        ) : news.length === 0 ? (
          <View style={s.empty}>
            <LucideIcon name="heart" size={48} color={C.textMuted} />
            <Text style={[s.emptyTxt, { color: C.textMuted }]}>새 소식이 없습니다</Text>
            <Text style={[s.emptySubTxt, { color: C.textMuted }]}>학부모가 수업피드에 반응하거나{"\n"}댓글을 남기면 여기에 표시됩니다</Text>
          </View>
        ) : (
          <FlatList
            data={news}
            keyExtractor={item => item.id}
            contentContainerStyle={{ padding: 16, gap: 8 }}
            renderItem={({ item }) => {
              const icon = newsIcon(item.type);
              return (
                <Pressable
                  style={({ pressed }) => [
                    s.newsCard,
                    !item.is_read && { borderColor: themeColor + "60", backgroundColor: themeColor + "06" },
                    { opacity: pressed ? 0.85 : 1 },
                  ]}
                  onPress={async () => {
                    // 읽음 처리
                    if (!item.is_read) {
                      setNews(prev => prev.map(n => n.id === item.id ? { ...n, is_read: true } : n));
                      setUnreadNewsCount(prev => Math.max(0, prev - 1));
                      apiRequest(token, `/notifications/${item.id}/read`, { method: "POST" }).catch(() => {});
                    }
                    // 해당 diary로 이동
                    if (item.ref_id) {
                      if (
                        item.type === "diary_comment" ||
                        item.type === "diary_like" ||
                        item.type === "diary_thanks"
                      ) {
                        // 반응·댓글 알림 → 반응/댓글 확인 화면
                        router.push({
                          pathname: "/(teacher)/diary-reactions",
                          params: { diaryId: item.ref_id, lessonDate: item.lesson_date ?? "", source: "news_inbox" },
                        } as any);
                      } else {
                        // 다른 notification type — 기존 동작 유지
                        router.push({
                          pathname: "/(teacher)/diary",
                          params: { editDiaryId: item.ref_id, backTo: "messages-inbox" },
                        } as any);
                      }
                    }
                  }}
                >
                  {!item.is_read && (
                    <View style={[s.unreadDotRow, { marginBottom: 2 }]}>
                      <View style={[s.unreadDot, { backgroundColor: themeColor }]} />
                      <Text style={[s.unreadLabel, { color: themeColor }]}>새 소식</Text>
                    </View>
                  )}
                  <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
                    <View style={[s.newsIconWrap, { backgroundColor: icon.color + "18" }]}>
                      <LucideIcon name={icon.name} size={20} color={icon.color} />
                    </View>
                    <View style={{ flex: 1, gap: 3 }}>
                      <Text style={[s.newsTitle, { color: C.text }]} numberOfLines={1}>{item.title}</Text>
                      <Text style={[s.newsBody, { color: C.textSecondary }]} numberOfLines={2}>{item.body}</Text>
                      {item.class_name || item.lesson_date ? (
                        <Text style={[s.newsMeta, { color: C.textMuted }]} numberOfLines={1}>
                          {[item.class_name, item.lesson_date?.slice(0, 10)].filter(Boolean).join(" · ")}
                        </Text>
                      ) : null}
                    </View>
                    <Text style={[s.newsDate, { color: C.textMuted }]}>{fmtNewsDate(item.created_at)}</Text>
                  </View>
                </Pressable>
              );
            }}
          />
        )
      )}

      {/* 탭2: 쪽지함 */}
      {activeTab === "messages" && (
        loadingThreads ? (
          <ActivityIndicator color={themeColor} style={{ marginTop: 60 }} />
        ) : threads.length === 0 ? (
          <View style={s.empty}>
            <LucideIcon name="mail" size={48} color={C.textMuted} />
            <Text style={[s.emptyTxt, { color: C.textMuted }]}>받은 쪽지가 없습니다</Text>
            <Text style={[s.emptySubTxt, { color: C.textMuted }]}>학부모가 수업일지에 쪽지를 보내면{"\n"}여기에 표시됩니다</Text>
          </View>
        ) : (
          <FlatList
            data={threads}
            keyExtractor={item => item.diary_id}
            contentContainerStyle={{ padding: 16, gap: 8 }}
            renderItem={({ item }) => {
              const isComment = item.last_message_type === "diary_comment";
              const totalUnread = (item.unread_count ?? 0) + (item.unread_comment_count ?? 0);
              const hasUnread = totalUnread > 0;
              return (
              <Pressable
                style={({ pressed }) => [s.threadItem, { opacity: pressed ? 0.85 : 1 }]}
                onPress={() => {
                  if (isComment) {
                    router.push({
                      pathname: "/(teacher)/diary-reactions",
                      params: {
                        diaryId: item.diary_id,
                        lessonDate: item.lesson_date ? item.lesson_date.slice(0, 10) : "",
                        source: "teacher_home_inbox",
                      },
                    } as any);
                  } else {
                    openThread(item);
                  }
                }}
              >
                <View style={[s.threadIcon, { backgroundColor: hasUnread ? (isComment ? "#10B98120" : themeColor + "20") : C.backgroundSoft }]}>
                  <LucideIcon name={isComment ? "message-circle" : "message-square"} size={20} color={hasUnread ? (isComment ? "#10B981" : themeColor) : C.textMuted} />
                </View>
                <View style={{ flex: 1, gap: 3 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    {isComment && (
                      <View style={{ backgroundColor: "#D1FAE5", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
                        <Text style={{ fontSize: 10, color: "#059669", fontFamily: "Pretendard-SemiBold" }}>새 댓글</Text>
                      </View>
                    )}
                    <Text style={[s.threadClass, { color: C.text }]} numberOfLines={1}>
                      {item.class_name || "반 정보 없음"} · {item.lesson_date ? item.lesson_date.slice(0,10) : ""}
                    </Text>
                    {totalUnread > 0 && (
                      <View style={[s.unreadBadge, { backgroundColor: isComment ? "#10B981" : C.error }]}>
                        <Text style={s.unreadBadgeTxt}>{totalUnread}</Text>
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
            );
          }}
          />
        )
      )}

      {/* 탭2: 학부모 요청 */}
      {activeTab === "requests" && (
        loadingRequests ? (
          <ActivityIndicator color={themeColor} style={{ marginTop: 60 }} />
        ) : parentRequests.length === 0 ? (
          <View style={s.empty}>
            <LucideIcon name="clipboard-list" size={48} color={C.textMuted} />
            <Text style={[s.emptyTxt, { color: C.textMuted }]}>받은 요청이 없습니다</Text>
            <Text style={[s.emptySubTxt, { color: C.textMuted }]}>학부모가 결석/보강 등을 신청하면{"\n"}여기에 표시됩니다</Text>
          </View>
        ) : (
          <FlatList
            ref={reqFlatListRef}
            data={parentRequests}
            keyExtractor={item => item.id}
            contentContainerStyle={{ padding: 16, gap: 10 }}
            onScrollToIndexFailed={() => {}}
            refreshControl={
              <RefreshControl
                refreshing={reqRefreshing}
                onRefresh={() => { setReqRefreshing(true); fetchRequests(); }}
                tintColor={themeColor}
              />
            }
            renderItem={({ item, index }) => {
              const typeColor = REQUEST_TYPE_COLOR[item.request_type] || "#6B7280";
              const typeLabel = REQUEST_TYPE_LABEL[item.request_type] || item.request_type;
              const statusStyle = STATUS_COLOR[item.status] || STATUS_COLOR.pending;
              const isUpdating = updatingId === item.id;
              const isUnread = !item.is_read_by_teacher;
              const isExpanded = expandedId === item.id;
              const isHighlighted = highlightReqId === item.id;
              return (
                <Pressable
                  style={({ pressed }) => [
                    s.reqCard,
                    isUnread && { borderColor: "#3B82F6", borderWidth: 1.5, backgroundColor: "#F0F7FF" },
                    isHighlighted && { borderColor: C.brandStrong, borderWidth: 2, backgroundColor: C.brandMist },
                    { opacity: pressed ? 0.92 : 1 },
                  ]}
                  onPress={() => {
                    if (isUnread) markAsRead(item.id);
                    setExpandedId(isExpanded ? null : item.id);
                  }}
                >
                  {/* 미읽음 표시 */}
                  {isUnread && (
                    <View style={s.unreadDotRow}>
                      <View style={s.unreadDot} />
                      <Text style={s.unreadLabel}>새 요청</Text>
                    </View>
                  )}
                  {/* 상단: 타입 뱃지 + 날짜 */}
                  <View style={s.reqCardTop}>
                    <View style={[s.reqTypeBadge, { backgroundColor: typeColor + "18" }]}>
                      <Text style={[s.reqTypeLabel, { color: typeColor }]}>{typeLabel}</Text>
                    </View>
                    <Text style={[s.reqDate, { color: C.textMuted }]}>{fmtDate(item.created_at)}</Text>
                  </View>
                  {/* 학생/학부모 */}
                  <Text style={[s.reqStudentName, { color: C.text }]}>
                    {item.student_name || "학생"} · {item.parent_name || "학부모"}
                  </Text>
                  {/* 요청일 */}
                  {item.request_date && (
                    <Text style={[s.reqInfo, { color: C.textSecondary }]}>
                      요청일: {item.request_date.slice(0, 10)}
                    </Text>
                  )}
                  {/* 내용 — 탭하면 전체 펼침 */}
                  {item.content ? (
                    <Text style={[s.reqContent, { color: C.textSecondary }]} numberOfLines={isExpanded ? undefined : 3}>
                      {item.content}
                    </Text>
                  ) : null}
                  {/* 펼치기 힌트 */}
                  {!isExpanded && item.content && item.content.length > 60 && (
                    <Text style={{ fontSize: 11, color: themeColor, fontFamily: "Pretendard-Regular", marginTop: -6 }}>
                      탭하여 전체 보기
                    </Text>
                  )}
                  {/* 액션 버튼 행: [업무 대화] [업무 처리] */}
                  <View style={s.actionRow}>
                    <Pressable
                      style={[s.chatBtn, { borderColor: themeColor + "70" }]}
                      onPress={() => {
                        if (isUnread) markAsRead(item.id);
                        setThreadModalReq(item);
                      }}
                    >
                      <LucideIcon name="message-circle" size={13} color={themeColor} />
                      <Text style={[s.chatBtnTxt, { color: themeColor }]}>
                        업무 대화
                        {(item.new_message_count ?? 0) > 0
                          ? ` (${item.new_message_count})`
                          : ""}
                      </Text>
                    </Pressable>
                    {(item.request_type === "absence" || item.request_type === "makeup") && (
                      <Pressable
                        style={s.workBtn}
                        onPress={() => {
                          if (isUnread) markAsRead(item.id);
                          if (item.request_type === "absence") {
                            router.push("/(teacher)/attendance" as any);
                          } else {
                            router.push("/(teacher)/makeups" as any);
                          }
                        }}
                      >
                        <LucideIcon name="arrow-right" size={12} color="#fff" />
                        <Text style={s.workBtnTxt}>업무 처리</Text>
                      </Pressable>
                    )}
                  </View>
                  {/* 상태 + 처리 버튼 */}
                  <View style={s.reqBottom}>
                    <View style={[s.statusBadge, { backgroundColor: statusStyle.bg }]}>
                      <Text style={[s.statusTxt, { color: statusStyle.text }]}>{STATUS_LABEL[item.status] || item.status}</Text>
                    </View>
                    {item.status === "pending" && (
                      <View style={s.reqActions}>
                        <Pressable
                          style={[s.reqBtn, { backgroundColor: "#ECFDF5", borderColor: "#059669" }]}
                          onPress={() => updateRequestStatus(item.id, "done")}
                          disabled={isUpdating}
                        >
                          {isUpdating ? <ActivityIndicator size="small" color="#059669" /> : <Text style={[s.reqBtnTxt, { color: "#059669" }]}>확인</Text>}
                        </Pressable>
                        <Pressable
                          style={[s.reqBtn, { backgroundColor: "#FEF2F2", borderColor: "#EF4444" }]}
                          onPress={() => updateRequestStatus(item.id, "rejected")}
                          disabled={isUpdating}
                        >
                          <Text style={[s.reqBtnTxt, { color: "#EF4444" }]}>거절</Text>
                        </Pressable>
                      </View>
                    )}
                  </View>
                </Pressable>
              );
            }}
          />
        )
      )}
      {/* 업무 대화 스레드 Modal */}
      <RequestThreadModal
        visible={!!threadModalReq}
        request={threadModalReq}
        token={token ?? ""}
        themeColor={themeColor}
        onClose={() => setThreadModalReq(null)}
        onRefreshList={fetchRequests}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:           { flex: 1, backgroundColor: "#fff" },
  header:         { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border, gap: 4 },
  backBtn:        { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle:    { flex: 1, fontSize: 17, fontFamily: "Pretendard-Regular", color: C.text, textAlign: "center" },
  headerSub:      { fontSize: 12, fontFamily: "Pretendard-Regular", textAlign: "center" },

  tabRow:         { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: C.border },
  tab:            { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12 },
  tabTxt:         { fontSize: 14, lineHeight: 19 },
  tabBadge:       { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 8 },
  tabBadgeTxt:    { color: "#fff", fontSize: 11, lineHeight: 15 },

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

  reqCard:        { backgroundColor: "#fff", borderRadius: 14, padding: 14, gap: 8, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2, borderWidth: 1, borderColor: C.border },
  unreadDotRow:   { flexDirection: "row", alignItems: "center", gap: 6 },
  unreadDot:      { width: 8, height: 8, borderRadius: 4, backgroundColor: "#3B82F6" },
  unreadLabel:    { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#3B82F6", fontWeight: "700" },
  reqCardTop:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  reqTypeBadge:   { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  reqTypeLabel:   { fontSize: 13, fontFamily: "Pretendard-Regular", fontWeight: "600" },
  reqDate:        { fontSize: 12, fontFamily: "Pretendard-Regular" },
  reqStudentName: { fontSize: 15, fontFamily: "Pretendard-Regular", fontWeight: "600" },
  reqInfo:        { fontSize: 13, fontFamily: "Pretendard-Regular" },
  reqContent:     { fontSize: 13, fontFamily: "Pretendard-Regular", lineHeight: 18 },
  reqBottom:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 },
  statusBadge:    { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  statusTxt:      { fontSize: 12, fontFamily: "Pretendard-Regular", fontWeight: "600" },
  reqActions:     { flexDirection: "row", gap: 8 },
  reqBtn:         { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8, borderWidth: 1 },
  reqBtnTxt:      { fontSize: 13, fontFamily: "Pretendard-Regular", fontWeight: "600" },
  actionRow:      { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 },
  chatBtn:        { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 9, borderWidth: 1 },
  chatBtnTxt:     { fontSize: 12, fontFamily: "Pretendard-Regular", fontWeight: "600" },
  workBtn:        { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 9, backgroundColor: "#0F2742" },
  workBtnTxt:     { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#fff" },

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

  newsCard:       { backgroundColor: "#fff", borderRadius: 14, padding: 14, gap: 6, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 3, elevation: 1, borderWidth: 1, borderColor: C.border },
  newsIconWrap:   { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  newsTitle:      { fontSize: 14, fontFamily: "Pretendard-Regular", fontWeight: "600" },
  newsBody:       { fontSize: 13, fontFamily: "Pretendard-Regular", lineHeight: 18 },
  newsMeta:       { fontSize: 11, fontFamily: "Pretendard-Regular" },
  newsDate:       { fontSize: 12, fontFamily: "Pretendard-Regular", flexShrink: 0 },

  inputWrap:      { borderTopWidth: 1, borderTopColor: C.border, padding: 10, backgroundColor: "#fff" },
  imagePreviewRow:{ flexDirection: "row", marginBottom: 8, position: "relative" },
  imagePreview:   { width: 72, height: 72, borderRadius: 10 },
  removeImageBtn: { position: "absolute", top: -6, right: -6, width: 20, height: 20, borderRadius: 10, backgroundColor: "#0008", alignItems: "center", justifyContent: "center" },
  inputRow:       { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  imageBtn:       { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  input:          { flex: 1, minHeight: 36, maxHeight: 100, borderWidth: 1, borderColor: C.border, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8, fontSize: 14, fontFamily: "Pretendard-Regular", color: C.text },
  sendBtn:        { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
});
