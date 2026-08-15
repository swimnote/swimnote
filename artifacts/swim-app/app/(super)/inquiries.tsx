/**
 * (super)/inquiries.tsx — 슈퍼관리자 문의함
 *
 * 전체 수신 문의 목록 (target=super)
 * 표시: 수영장이름 · 자격 · 이름
 * 필터: 전체 / 미답변 / 답변완료
 * 상세: 채팅형 + 답변 작성
 */
import { LucideIcon } from "@/components/common/LucideIcon";
import { ChevronLeft } from "lucide-react-native";
import { useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, KeyboardAvoidingView,
  Platform, Pressable, RefreshControl, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { apiRequest, useAuth } from "@/context/AuthContext";

const C = Colors.light;
const PURPLE = "#7C3AED";

interface Inquiry {
  id: string;
  sender_uuid: string;
  sender_role: string;
  sender_name: string;
  pool_name: string;
  title: string;
  content: string;
  status: string;
  created_at: string;
  reply_count: number;
}

interface Reply {
  id: string;
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

type FilterType = "all" | "unread" | "replied";

function fmtRelative(raw: string): string {
  const dt = new Date(raw);
  if (isNaN(dt.getTime())) return "";
  const diff = Date.now() - dt.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const d = dt;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function fmtTime(raw: string): string {
  const dt = new Date(raw);
  if (isNaN(dt.getTime())) return "";
  return dt.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

function roleLabel(role: string) {
  if (role === "parent")    return "학부모";
  if (role === "teacher")   return "선생님";
  if (role === "pool_admin" || role === "sub_admin") return "관리자";
  return role;
}

function statusChip(status: string) {
  if (status === "replied") return { label: "답변완료", bg: "#D1FAE5", color: "#16A34A" };
  if (status === "read")    return { label: "확인중",   bg: "#FEF3C7", color: "#D97706" };
  return                           { label: "미답변",   bg: "#FEE2E2", color: "#D96C6C" };
}

export default function SuperInquiriesScreen() {
  const insets = useSafeAreaInsets();
  const { token, adminUser } = useAuth();
  const myId = adminUser?.id ?? "";

  const [filter, setFilter] = useState<FilterType>("all");
  const [list, setList]     = useState<Inquiry[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [refreshing, setRefreshing]   = useState(false);

  const [currentId, setCurrentId] = useState<string | null>(null);
  const [detail, setDetail]       = useState<InquiryDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [input, setInput]   = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<any>(null);

  const loadList = useCallback(async () => {
    setListLoading(true);
    try {
      const res = await apiRequest(token, "/inquiries/received");
      if (res.ok) setList(await res.json());
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
      }
    } finally { setDetailLoading(false); }
  }, [token]);

  useEffect(() => { loadList(); }, [loadList]);
  useFocusEffect(useCallback(() => { if (!currentId) loadList(); }, [currentId, loadList]));
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
        setDetail(prev => prev ? { ...prev, replies: [...prev.replies, reply], status: "replied" } : prev);
        setList(prev => prev.map(i => i.id === currentId ? { ...i, status: "replied" } : i));
        setInput("");
        setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
      } else {
        Alert.alert("오류", "전송에 실패했습니다.");
      }
    } catch { Alert.alert("오류", "네트워크 오류가 발생했습니다."); }
    finally { setSending(false); }
  }

  const filtered = list.filter(i => {
    if (filter === "unread")  return i.status === "unread";
    if (filter === "replied") return i.status === "replied";
    return true;
  });

  const unreadCount = list.filter(i => i.status === "unread").length;

  if (currentId) {
    return (
      <View style={[s.root, { backgroundColor: C.background }]}>
        <View style={[s.detailHeader, { paddingTop: insets.top + 12 }]}>
          <Pressable onPress={() => { setCurrentId(null); setDetail(null); loadList(); }} hitSlop={10} style={s.backBtn}>
            <ChevronLeft size={22} color={C.text} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={[s.detailTitle, { color: C.text }]} numberOfLines={1}>
              {detail?.title ?? "문의 상세"}
            </Text>
            {detail && (
              <Text style={[s.detailSub, { color: C.textMuted }]}>
                {[detail.pool_name, roleLabel(detail.sender_role), detail.sender_name].filter(Boolean).join(" · ")}
                {" · "}{fmtRelative(detail.created_at)}
              </Text>
            )}
          </View>
        </View>

        {detailLoading ? (
          <ActivityIndicator color={PURPLE} style={{ marginTop: 60 }} />
        ) : (
          <KeyboardAwareScrollView
            ref={scrollRef}
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: 16, paddingBottom: 24, gap: 12 }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {detail && (
              <View style={s.otherBubbleWrap}>
                <Text style={s.senderName}>
                  {detail.sender_name} ({roleLabel(detail.sender_role)})
                </Text>
                <View style={s.otherBubble}>
                  <Text style={s.otherText}>{detail.content}</Text>
                  <Text style={[s.bubbleTime, { color: "rgba(0,0,0,0.4)" }]}>{fmtTime(detail.created_at)}</Text>
                </View>
              </View>
            )}
            {detail?.replies.map(r => {
              const isMe = r.replier_uuid === myId;
              return (
                <View key={r.id} style={isMe ? s.myBubbleWrap : s.otherBubbleWrap}>
                  {!isMe && (
                    <Text style={s.senderName}>{r.replier_name} ({roleLabel(r.replier_role)})</Text>
                  )}
                  <View style={isMe ? s.myBubble : s.otherBubble}>
                    <Text style={isMe ? s.myText : s.otherText}>{r.content}</Text>
                    <Text style={[s.bubbleTime, isMe ? {} : { color: "rgba(0,0,0,0.4)" }]}>
                      {fmtTime(r.created_at)}
                    </Text>
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
              placeholder="답변을 입력하세요"
              placeholderTextColor={C.textMuted}
              multiline
              maxLength={2000}
            />
            <TouchableOpacity
              style={[s.sendBtn, { backgroundColor: input.trim() ? PURPLE : C.border }]}
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

  return (
    <View style={[s.root, { backgroundColor: C.background }]}>
      <SubScreenHeader title="문의함" homePath="/(super)/dashboard" />

      <View style={s.filterBar}>
        {(["all", "unread", "replied"] as FilterType[]).map(f => (
          <Pressable
            key={f}
            style={[s.filterBtn, filter === f && { backgroundColor: PURPLE }]}
            onPress={() => setFilter(f)}
          >
            <Text style={[s.filterText, { color: filter === f ? "#fff" : C.textMuted }]}>
              {f === "all" ? "전체" : f === "unread" ? `미답변${unreadCount > 0 ? ` (${unreadCount})` : ""}` : "답변완료"}
            </Text>
          </Pressable>
        ))}
      </View>

      {listLoading && list.length === 0 ? (
        <ActivityIndicator color={PURPLE} style={{ marginTop: 60 }} />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40, gap: 10 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadList(); }} tintColor={PURPLE} />}
        >
          {filtered.length === 0 && (
            <View style={s.empty}>
              <LucideIcon name="message-circle" size={40} color={C.textMuted} />
              <Text style={[s.emptyText, { color: C.textMuted }]}>
                {filter === "unread" ? "미답변 문의가 없습니다" : filter === "replied" ? "답변 완료된 문의가 없습니다" : "접수된 문의가 없습니다"}
              </Text>
            </View>
          )}
          {filtered.map(item => {
            const chip = statusChip(item.status);
            return (
              <Pressable
                key={item.id}
                style={({ pressed }) => [s.card, { backgroundColor: C.card, opacity: pressed ? 0.8 : 1 }]}
                onPress={() => setCurrentId(item.id)}
              >
                <View style={s.cardMeta}>
                  <Text style={[s.cardMetaText, { color: C.textMuted }]}>
                    {[item.pool_name, roleLabel(item.sender_role), item.sender_name].filter(Boolean).join(" · ")}
                  </Text>
                  <Text style={[s.cardTime, { color: C.textMuted }]}>{fmtRelative(item.created_at)}</Text>
                </View>
                <Text style={[s.cardTitle, { color: C.text }]} numberOfLines={1}>{item.title}</Text>
                <View style={s.chipRow}>
                  <View style={[s.chip, { backgroundColor: chip.bg }]}>
                    <Text style={[s.chipText, { color: chip.color }]}>{chip.label}</Text>
                  </View>
                  {Number(item.reply_count) > 0 && (
                    <Text style={[s.replyCountText, { color: C.textMuted }]}>답변 {item.reply_count}개</Text>
                  )}
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
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
  filterBar: {
    flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: "#F1F5F9",
  },
  filterBtn: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
    backgroundColor: "#F1F5F9",
  },
  filterText: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  myBubbleWrap: { alignItems: "flex-end" },
  otherBubbleWrap: { alignItems: "flex-start" },
  senderName: { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#64748B", marginBottom: 4, marginLeft: 4 },
  myBubble: {
    backgroundColor: PURPLE, borderRadius: 16, borderBottomRightRadius: 4,
    padding: 12, maxWidth: "80%",
  },
  otherBubble: {
    backgroundColor: "#F1F5F9", borderRadius: 16, borderBottomLeftRadius: 4,
    padding: 12, maxWidth: "80%",
  },
  myText: { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#fff", lineHeight: 20 },
  otherText: { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#14283D", lineHeight: 20 },
  bubbleTime: { fontSize: 11, fontFamily: "Pretendard-Regular", color: "rgba(255,255,255,0.6)", marginTop: 4, textAlign: "right" },
  inputBar: {
    flexDirection: "row", alignItems: "flex-end", gap: 8,
    paddingHorizontal: 16, paddingTop: 10,
    borderTopWidth: 1, borderTopColor: "#F1F5F9", backgroundColor: "#fff",
  },
  textInput: {
    flex: 1, borderWidth: 1, borderColor: "#E2E8F0", borderRadius: 16,
    paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10,
    fontSize: 14, fontFamily: "Pretendard-Regular", color: "#14283D",
    maxHeight: 100, minHeight: 42,
  },
  sendBtn: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  card: {
    borderRadius: 14, padding: 14, gap: 6,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 3, elevation: 1,
  },
  cardMeta: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardMetaText: { fontSize: 12, fontFamily: "Pretendard-Regular", flex: 1 },
  cardTime: { fontSize: 12, fontFamily: "Pretendard-Regular" },
  cardTitle: { fontSize: 15, fontFamily: "Pretendard-Regular" },
  chipRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  chip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  chipText: { fontSize: 11, fontFamily: "Pretendard-Regular" },
  replyCountText: { fontSize: 12, fontFamily: "Pretendard-Regular" },
  empty: { alignItems: "center", justifyContent: "center", paddingVertical: 60, gap: 12 },
  emptyText: { fontSize: 14, fontFamily: "Pretendard-Regular" },
});
