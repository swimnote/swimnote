/**
 * (admin)/inquiries.tsx — 관리자 문의하기
 *
 * 탭1 수신함: 학부모로부터 온 문의 목록 + 답변 작성
 * 탭2 발신함: 내가 스윔노트에 보낸 문의 + 답변 확인
 * 상세: 채팅형 (KeyboardAwareScrollView)
 */
import { LucideIcon } from "@/components/common/LucideIcon";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Modal,
  Platform, Pressable, RefreshControl, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { apiRequest, useAuth } from "@/context/AuthContext";

const C = Colors.light;

interface Inquiry {
  id: string;
  sender_uuid: string;
  sender_role: string;
  sender_name: string;
  pool_name: string;
  target: string;
  title: string;
  content: string;
  status: string;
  created_at: string;
  unread_reply_count?: number;
  reply_count?: number;
}

interface Reply {
  id: string;
  inquiry_id: string;
  replier_uuid: string;
  replier_role: string;
  replier_name: string;
  content: string;
  is_read: boolean;
  created_at: string;
}

interface InquiryDetail extends Inquiry {
  replies: Reply[];
}

function fmtRelative(raw: string): string {
  const dt = new Date(raw);
  if (isNaN(dt.getTime())) return "";
  const diff = Date.now() - dt.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  return `${dt.getMonth() + 1}/${dt.getDate()}`;
}

function fmtTime(raw: string): string {
  const dt = new Date(raw);
  if (isNaN(dt.getTime())) return "";
  return dt.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

function statusChip(status: string) {
  if (status === "replied") return { label: "답변완료", bg: "#D1FAE5", color: "#16A34A" };
  if (status === "read")    return { label: "확인중",   bg: "#FEF3C7", color: "#D97706" };
  return                           { label: "미답변",   bg: "#FEE2E2", color: "#D96C6C" };
}

function roleLabel(role: string) {
  if (role === "parent")    return "학부모";
  if (role === "teacher")   return "선생님";
  if (role === "pool_admin" || role === "sub_admin") return "관리자";
  return role;
}

export default function AdminInquiriesScreen() {
  const insets = useSafeAreaInsets();
  const { token, adminUser } = useAuth();
  const myId = adminUser?.id ?? "";

  const [tab, setTab] = useState<"received" | "sent">("received");
  const [received, setReceived] = useState<Inquiry[]>([]);
  const [sent, setSent] = useState<Inquiry[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [refreshing, setRefreshing]   = useState(false);

  const [currentId, setCurrentId] = useState<string | null>(null);
  const [detail, setDetail]       = useState<InquiryDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [input, setInput]   = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<KeyboardAwareScrollView>(null);

  const [newModal, setNewModal]     = useState(false);
  const [newTitle, setNewTitle]     = useState("");
  const [newContent, setNewContent] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const loadLists = useCallback(async () => {
    setListLoading(true);
    try {
      const [r1, r2] = await Promise.all([
        apiRequest(token, "/inquiries/received"),
        apiRequest(token, "/inquiries/sent"),
      ]);
      if (r1.ok) setReceived(await r1.json());
      if (r2.ok) setSent(await r2.json());
    } finally { setListLoading(false); setRefreshing(false); }
  }, [token]);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const res = await apiRequest(token, `/inquiries/${id}`);
      if (res.ok) {
        const data = await res.json();
        setDetail(data);
        await apiRequest(token, `/inquiries/${id}/read`, { method: "PATCH" });
        data.replies?.forEach((r: Reply) => {
          if (!r.is_read && r.replier_uuid !== myId) {
            apiRequest(token, `/inquiries/replies/${r.id}/read`, { method: "PATCH" }).catch(() => {});
          }
        });
      }
    } finally { setDetailLoading(false); }
  }, [token, myId]);

  useEffect(() => { loadLists(); }, [loadLists]);
  useFocusEffect(useCallback(() => { if (!currentId) loadLists(); }, [currentId, loadLists]));
  useEffect(() => { if (currentId) loadDetail(currentId); }, [currentId, loadDetail]);
  useEffect(() => {
    if (detail?.replies?.length) setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 150);
  }, [detail?.replies?.length]);

  async function sendReply() {
    if (!input.trim() || sending || !currentId) return;
    setSending(true);
    try {
      const res = await apiRequest(token, `/inquiries/${currentId}/reply`, {
        method: "POST",
        body: JSON.stringify({ content: input.trim() }),
      });
      if (res.ok) {
        const reply = await res.json();
        setDetail(prev => prev ? { ...prev, replies: [...prev.replies, reply] } : prev);
        setInput("");
        if (tab === "received") {
          setReceived(prev => prev.map(i => i.id === currentId ? { ...i, status: "replied" } : i));
        }
        setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
      } else {
        Alert.alert("오류", "전송에 실패했습니다.");
      }
    } catch { Alert.alert("오류", "네트워크 오류가 발생했습니다."); }
    finally { setSending(false); }
  }

  async function submitNewInquiry() {
    if (!newTitle.trim() || !newContent.trim()) return;
    setSubmitting(true);
    try {
      const res = await apiRequest(token, "/inquiries", {
        method: "POST",
        body: JSON.stringify({ title: newTitle.trim(), content: newContent.trim(), target: "super" }),
      });
      if (res.ok) {
        setNewModal(false); setNewTitle(""); setNewContent("");
        await loadLists();
      } else {
        Alert.alert("오류", "문의 전송에 실패했습니다.");
      }
    } catch { Alert.alert("오류", "네트워크 오류가 발생했습니다."); }
    finally { setSubmitting(false); }
  }

  if (currentId) {
    const isSent = detail ? detail.sender_uuid === myId : false;
    return (
      <View style={[s.root, { backgroundColor: C.background }]}>
        <View style={[s.detailHeader, { paddingTop: insets.top + 12 }]}>
          <Pressable onPress={() => { setCurrentId(null); setDetail(null); loadLists(); }} hitSlop={10} style={s.backBtn}>
            <LucideIcon name="chevron-left" size={22} color={C.text} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={[s.detailTitle, { color: C.text }]} numberOfLines={1}>{detail?.title ?? "문의 상세"}</Text>
            {detail && (
              <Text style={[s.detailSub, { color: C.textMuted }]}>
                {isSent ? "스윔노트에 문의" : `${detail.pool_name ?? ""} · ${roleLabel(detail.sender_role)} · ${detail.sender_name}`}
                {" · "}{fmtRelative(detail.created_at)}
              </Text>
            )}
          </View>
        </View>

        {detailLoading ? (
          <ActivityIndicator color={C.tint} style={{ marginTop: 60 }} />
        ) : (
          <KeyboardAwareScrollView
            ref={scrollRef}
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: 16, paddingBottom: 24, gap: 12 }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {detail && (
              <View style={detail.sender_uuid === myId ? s.myBubbleWrap : s.otherBubbleWrap}>
                {detail.sender_uuid !== myId && (
                  <Text style={s.senderName}>{detail.sender_name} ({roleLabel(detail.sender_role)})</Text>
                )}
                <View style={detail.sender_uuid === myId ? s.myBubble : s.otherBubble}>
                  <Text style={detail.sender_uuid === myId ? s.myText : s.otherText}>{detail.content}</Text>
                  <Text style={s.bubbleTime}>{fmtTime(detail.created_at)}</Text>
                </View>
              </View>
            )}
            {detail?.replies.map(r => {
              const isMe = r.replier_uuid === myId;
              return (
                <View key={r.id} style={isMe ? s.myBubbleWrap : s.otherBubbleWrap}>
                  {!isMe && <Text style={s.senderName}>{r.replier_name || "스윔노트"}</Text>}
                  <View style={isMe ? s.myBubble : s.otherBubble}>
                    <Text style={isMe ? s.myText : s.otherText}>{r.content}</Text>
                    <Text style={s.bubbleTime}>{fmtTime(r.created_at)}</Text>
                  </View>
                </View>
              );
            })}
          </KeyboardAwareScrollView>
        )}

        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={[s.inputBar, { paddingBottom: insets.bottom + 8 }]}>
            <TextInput
              style={s.textInput}
              value={input}
              onChangeText={setInput}
              placeholder="내용을 입력하세요"
              placeholderTextColor={C.textMuted}
              multiline
              maxLength={1000}
            />
            <TouchableOpacity
              style={[s.sendBtn, { backgroundColor: input.trim() ? C.tint : C.border }]}
              onPress={sendReply}
              disabled={!input.trim() || sending}
            >
              {sending ? <ActivityIndicator color="#fff" size="small" /> : <LucideIcon name="send" size={18} color="#fff" />}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </View>
    );
  }

  const currentList = tab === "received" ? received : sent;
  const unreadRecv = received.filter(i => i.status === "unread").length;
  const unreadSent = sent.reduce((acc, i) => acc + Number(i.unread_reply_count ?? 0), 0);

  return (
    <View style={[s.root, { backgroundColor: C.background }]}>
      <SubScreenHeader title="문의하기" homePath="/(admin)/home" />

      <View style={s.tabs}>
        {(["received", "sent"] as const).map(t => {
          const badge = t === "received" ? unreadRecv : unreadSent;
          return (
            <Pressable key={t} style={[s.tab, tab === t && s.tabActive]} onPress={() => setTab(t)}>
              <Text style={[s.tabText, { color: tab === t ? C.tint : C.textMuted }]}>
                {t === "received" ? "수신함" : "발신함"}
              </Text>
              {badge > 0 && (
                <View style={s.tabBadge}><Text style={s.tabBadgeText}>{badge}</Text></View>
              )}
            </Pressable>
          );
        })}
      </View>

      {listLoading && currentList.length === 0 ? (
        <ActivityIndicator color={C.tint} style={{ marginTop: 60 }} />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 100, gap: 10 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadLists(); }} tintColor={C.tint} />}
        >
          {currentList.length === 0 && (
            <View style={s.empty}>
              <LucideIcon name="message-circle" size={40} color={C.textMuted} />
              <Text style={[s.emptyText, { color: C.textMuted }]}>
                {tab === "received" ? "학부모 문의가 없습니다" : "아직 보낸 문의가 없습니다"}
              </Text>
            </View>
          )}
          {currentList.map(item => {
            const chip = statusChip(item.status);
            const unread = tab === "received"
              ? item.status === "unread" ? 1 : 0
              : Number(item.unread_reply_count ?? 0);
            return (
              <Pressable
                key={item.id}
                style={({ pressed }) => [s.card, { backgroundColor: C.card, opacity: pressed ? 0.8 : 1 }]}
                onPress={() => setCurrentId(item.id)}
              >
                {tab === "received" && (
                  <Text style={[s.cardSender, { color: C.textMuted }]}>
                    {item.sender_name} ({roleLabel(item.sender_role)})
                  </Text>
                )}
                <View style={s.cardTop}>
                  <Text style={[s.cardTitle, { color: C.text }]} numberOfLines={1}>{item.title}</Text>
                  <View style={s.cardRight}>
                    {unread > 0 && (
                      <View style={s.unreadBadge}><Text style={s.unreadBadgeText}>{unread}</Text></View>
                    )}
                    <Text style={[s.cardTime, { color: C.textMuted }]}>{fmtRelative(item.created_at)}</Text>
                  </View>
                </View>
                <View style={s.chipRow}>
                  <View style={[s.chip, { backgroundColor: chip.bg }]}>
                    <Text style={[s.chipText, { color: chip.color }]}>{chip.label}</Text>
                  </View>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      {tab === "sent" && (
        <Pressable style={[s.fab, { bottom: insets.bottom + 24 }]} onPress={() => setNewModal(true)}>
          <LucideIcon name="plus" size={24} color="#fff" />
        </Pressable>
      )}

      <Modal visible={newModal} transparent animationType="slide" onRequestClose={() => setNewModal(false)}>
        <Pressable style={s.overlay} onPress={() => setNewModal(false)} />
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={s.sheetWrap}>
          <View style={[s.sheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={s.sheetHeader}>
              <Text style={[s.sheetTitle, { color: C.text }]}>스윔노트에 문의</Text>
              <Pressable onPress={() => { setNewModal(false); setNewTitle(""); setNewContent(""); }}>
                <LucideIcon name="x" size={20} color={C.textMuted} />
              </Pressable>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" style={{ marginTop: 8 }}>
              <Text style={[s.fieldLabel, { color: C.textMuted }]}>제목</Text>
              <TextInput
                style={[s.fieldInput, { color: C.text, borderColor: C.border }]}
                value={newTitle}
                onChangeText={setNewTitle}
                placeholder="문의 제목을 입력하세요"
                placeholderTextColor={C.textMuted}
                maxLength={100}
              />
              <Text style={[s.fieldLabel, { color: C.textMuted, marginTop: 12 }]}>내용</Text>
              <TextInput
                style={[s.fieldTextarea, { color: C.text, borderColor: C.border }]}
                value={newContent}
                onChangeText={setNewContent}
                placeholder="문의 내용을 자세히 입력해주세요"
                placeholderTextColor={C.textMuted}
                multiline
                numberOfLines={6}
                maxLength={2000}
                textAlignVertical="top"
              />
              <Pressable
                style={[s.submitBtn, { backgroundColor: newTitle.trim() && newContent.trim() ? C.tint : C.border, marginTop: 16 }]}
                onPress={submitNewInquiry}
                disabled={!newTitle.trim() || !newContent.trim() || submitting}
              >
                {submitting
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={s.submitBtnText}>문의 보내기</Text>}
              </Pressable>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  detailHeader: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 16, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: "#F1F5F9",
  },
  backBtn: { padding: 4 },
  detailTitle: { fontSize: 16, fontFamily: "Pretendard-Regular" },
  detailSub: { fontSize: 12, fontFamily: "Pretendard-Regular", marginTop: 2 },
  tabs: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#F1F5F9" },
  tab: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12 },
  tabActive: { borderBottomWidth: 2, borderBottomColor: "#0F172A" },
  tabText: { fontSize: 15, fontFamily: "Pretendard-Regular" },
  tabBadge: {
    minWidth: 18, height: 18, borderRadius: 9, backgroundColor: "#D96C6C",
    alignItems: "center", justifyContent: "center", paddingHorizontal: 4,
  },
  tabBadgeText: { fontSize: 10, fontFamily: "Pretendard-Regular", color: "#fff" },
  myBubbleWrap: { alignItems: "flex-end" },
  otherBubbleWrap: { alignItems: "flex-start" },
  senderName: { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#64748B", marginBottom: 4, marginLeft: 4 },
  myBubble: {
    backgroundColor: "#0F172A", borderRadius: 16, borderBottomRightRadius: 4,
    padding: 12, maxWidth: "80%",
  },
  otherBubble: {
    backgroundColor: "#F1F5F9", borderRadius: 16, borderBottomLeftRadius: 4,
    padding: 12, maxWidth: "80%",
  },
  myText: { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#fff", lineHeight: 20 },
  otherText: { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#0F172A", lineHeight: 20 },
  bubbleTime: { fontSize: 11, fontFamily: "Pretendard-Regular", color: "rgba(255,255,255,0.55)", marginTop: 4, textAlign: "right" },
  inputBar: {
    flexDirection: "row", alignItems: "flex-end", gap: 8,
    paddingHorizontal: 16, paddingTop: 10,
    borderTopWidth: 1, borderTopColor: "#F1F5F9", backgroundColor: "#fff",
  },
  textInput: {
    flex: 1, borderWidth: 1, borderColor: "#E2E8F0", borderRadius: 16,
    paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10,
    fontSize: 14, fontFamily: "Pretendard-Regular", color: "#0F172A",
    maxHeight: 100, minHeight: 42,
  },
  sendBtn: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  card: {
    borderRadius: 14, padding: 14, gap: 6,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 3, elevation: 1,
  },
  cardSender: { fontSize: 12, fontFamily: "Pretendard-Regular" },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  cardRight: { flexDirection: "row", alignItems: "center", gap: 6 },
  cardTitle: { fontSize: 15, fontFamily: "Pretendard-Regular", flex: 1 },
  cardTime: { fontSize: 12, fontFamily: "Pretendard-Regular" },
  chipRow: { flexDirection: "row", gap: 8 },
  chip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  chipText: { fontSize: 11, fontFamily: "Pretendard-Regular" },
  unreadBadge: {
    minWidth: 20, height: 20, borderRadius: 10, backgroundColor: "#D96C6C",
    alignItems: "center", justifyContent: "center", paddingHorizontal: 5,
  },
  unreadBadgeText: { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#fff" },
  fab: {
    position: "absolute", right: 20, width: 52, height: 52, borderRadius: 26,
    backgroundColor: "#0F172A", alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 6,
  },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheetWrap: { justifyContent: "flex-end" },
  sheet: {
    backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20, maxHeight: "85%",
  },
  sheetHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  sheetTitle: { fontSize: 17, fontFamily: "Pretendard-Regular" },
  fieldLabel: { fontSize: 13, fontFamily: "Pretendard-Regular", marginBottom: 6 },
  fieldInput: {
    borderWidth: 1, borderRadius: 12, paddingHorizontal: 14,
    paddingVertical: 12, fontSize: 14, fontFamily: "Pretendard-Regular",
  },
  fieldTextarea: {
    borderWidth: 1, borderRadius: 12, paddingHorizontal: 14,
    paddingTop: 12, paddingBottom: 12, fontSize: 14, fontFamily: "Pretendard-Regular",
    minHeight: 140,
  },
  submitBtn: { borderRadius: 14, padding: 15, alignItems: "center" },
  submitBtnText: { fontSize: 15, fontFamily: "Pretendard-Regular", color: "#fff" },
  empty: { alignItems: "center", justifyContent: "center", paddingVertical: 60, gap: 12 },
  emptyText: { fontSize: 14, fontFamily: "Pretendard-Regular" },
});
