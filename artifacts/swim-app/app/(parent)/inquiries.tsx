/**
 * (parent)/inquiries.tsx — 학부모 문의하기
 *
 * 목록: 내가 보낸 문의 + 미읽은 답변 배지
 * 상세: 문의 내용 + 답변 채팅 (KeyboardAwareScrollView)
 * 신규: 하단 시트 → 스윔노트에 문의 / 원장님에게 문의 선택
 */
import { LucideIcon } from "@/components/common/LucideIcon";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Modal,
  Platform, Pressable, RefreshControl, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { ParentScreenHeader } from "@/components/parent/ParentScreenHeader";
import { apiRequest, useAuth } from "@/context/AuthContext";

const C = Colors.light;

interface Inquiry {
  id: string;
  target: string;
  title: string;
  content: string;
  status: string;
  created_at: string;
  unread_reply_count: number;
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
  sender_uuid: string;
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

function targetLabel(target: string) {
  return target === "admin" ? "원장님" : "스윔노트";
}

export default function ParentInquiriesScreen() {
  const insets = useSafeAreaInsets();
  const { token, parentAccount } = useAuth();
  const { inquiryId } = useLocalSearchParams<{ inquiryId?: string }>();

  const [list, setList]         = useState<Inquiry[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [refreshing, setRefreshing]   = useState(false);

  const [detail, setDetail]     = useState<InquiryDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [currentId, setCurrentId] = useState<string | null>(inquiryId ?? null);

  const [input, setInput]       = useState("");
  const [sending, setSending]   = useState(false);
  const scrollRef = useRef<any>(null);

  const [sheetVisible, setSheetVisible] = useState(false);
  const [newTarget, setNewTarget]        = useState<"super" | "admin" | null>(null);
  const [newTitle, setNewTitle]          = useState("");
  const [newContent, setNewContent]      = useState("");
  const [submitting, setSubmitting]      = useState(false);

  const myId = parentAccount?.id ?? "";

  const loadList = useCallback(async () => {
    setListLoading(true);
    try {
      const res = await apiRequest(token, "/inquiries/sent");
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
        data.replies?.forEach((r: Reply) => {
          if (!r.is_read && r.replier_uuid !== myId) {
            apiRequest(token, `/inquiries/replies/${r.id}/read`, { method: "PATCH" }).catch(() => {});
          }
        });
      }
    } finally { setDetailLoading(false); }
  }, [token, myId]);

  useEffect(() => { loadList(); }, [loadList]);

  useFocusEffect(useCallback(() => {
    if (!currentId) loadList();
  }, [currentId, loadList]));

  useEffect(() => {
    if (currentId) loadDetail(currentId);
  }, [currentId, loadDetail]);

  useEffect(() => {
    if (detail?.replies?.length) {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 150);
    }
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
        setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
      } else {
        Alert.alert("오류", "전송에 실패했습니다.");
      }
    } catch { Alert.alert("오류", "네트워크 오류가 발생했습니다."); }
    finally { setSending(false); }
  }

  async function submitNewInquiry() {
    if (!newTitle.trim() || !newContent.trim() || !newTarget) return;
    setSubmitting(true);
    try {
      const res = await apiRequest(token, "/inquiries", {
        method: "POST",
        body: JSON.stringify({ title: newTitle.trim(), content: newContent.trim(), target: newTarget }),
      });
      if (res.ok) {
        setSheetVisible(false);
        setNewTitle(""); setNewContent(""); setNewTarget(null);
        await loadList();
      } else {
        Alert.alert("오류", "문의 전송에 실패했습니다.");
      }
    } catch { Alert.alert("오류", "네트워크 오류가 발생했습니다."); }
    finally { setSubmitting(false); }
  }

  if (currentId) {
    return (
      <View style={[s.root, { backgroundColor: C.background }]}>
        <View style={[s.detailHeader, { paddingTop: insets.top + 12 }]}>
          <Pressable onPress={() => { setCurrentId(null); setDetail(null); loadList(); }} hitSlop={10} style={s.backBtn}>
            <LucideIcon name="chevron-left" size={22} color={C.text} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={[s.detailTitle, { color: C.text }]} numberOfLines={1}>
              {detail?.title ?? "문의 상세"}
            </Text>
            {detail && (
              <Text style={[s.detailSub, { color: C.textMuted }]}>
                {targetLabel(detail.target)}에 문의 · {fmtRelative(detail.created_at)}
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
              <View style={[s.myBubble, { alignSelf: "flex-end" }]}>
                <Text style={s.myBubbleText}>{detail.content}</Text>
                <Text style={s.bubbleTime}>{fmtTime(detail.created_at)}</Text>
              </View>
            )}

            {detail?.replies.map(r => {
              const isMe = r.replier_uuid === myId;
              return (
                <View key={r.id} style={isMe ? s.myBubbleWrap : s.otherBubbleWrap}>
                  {!isMe && (
                    <Text style={s.senderName}>{r.replier_name || targetLabel(detail.target)}</Text>
                  )}
                  <View style={isMe ? s.myBubble : s.otherBubble}>
                    <Text style={isMe ? s.myBubbleText : s.otherBubbleText}>{r.content}</Text>
                    <Text style={s.bubbleTime}>{fmtTime(r.created_at)}</Text>
                  </View>
                </View>
              );
            })}
          </KeyboardAwareScrollView>
        )}

        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={0}
        >
          <View style={[s.inputBar, { paddingBottom: insets.bottom + 8 }]}>
            <TextInput
              style={s.textInput}
              value={input}
              onChangeText={setInput}
              placeholder="추가 문의 내용을 입력하세요"
              placeholderTextColor={C.textMuted}
              multiline
              maxLength={1000}
            />
            <TouchableOpacity
              style={[s.sendBtn, { backgroundColor: input.trim() ? C.primaryAction : C.border }]}
              onPress={sendReply}
              disabled={!input.trim() || sending}
            >
              {sending
                ? <ActivityIndicator color="#fff" size="small" />
                : <LucideIcon name="send" size={18} color="#fff" />}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </View>
    );
  }

  return (
    <View style={[s.root, { backgroundColor: C.background }]}>
      <ParentScreenHeader title="문의하기" showHome={false} />

      {listLoading && list.length === 0 ? (
        <ActivityIndicator color={C.tint} style={{ marginTop: 60 }} />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 100, gap: 10 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadList(); }} tintColor={C.tint} />}
        >
          {list.length === 0 && (
            <View style={s.empty}>
              <LucideIcon name="message-circle" size={40} color={C.textMuted} />
              <Text style={[s.emptyText, { color: C.textMuted }]}>아직 문의 내역이 없습니다</Text>
            </View>
          )}
          {list.map(item => {
            const chip = statusChip(item.status);
            return (
              <Pressable
                key={item.id}
                style={({ pressed }) => [s.card, { backgroundColor: C.card, opacity: pressed ? 0.8 : 1 }]}
                onPress={() => setCurrentId(item.id)}
              >
                <View style={s.cardTop}>
                  <Text style={[s.cardTarget, { color: C.textMuted }]}>{targetLabel(item.target)}에 문의</Text>
                  <View style={s.cardRight}>
                    {Number(item.unread_reply_count) > 0 && (
                      <View style={s.unreadBadge}>
                        <Text style={s.unreadBadgeText}>{item.unread_reply_count}</Text>
                      </View>
                    )}
                    <Text style={[s.cardTime, { color: C.textMuted }]}>{fmtRelative(item.created_at)}</Text>
                  </View>
                </View>
                <Text style={[s.cardTitle, { color: C.text }]} numberOfLines={1}>{item.title}</Text>
                <View style={s.cardBottom}>
                  <View style={[s.chip, { backgroundColor: chip.bg }]}>
                    <Text style={[s.chipText, { color: chip.color }]}>{chip.label}</Text>
                  </View>
                  {Number(item.reply_count) > 0 && (
                    <Text style={[s.replyCount, { color: C.textMuted }]}>답변 {item.reply_count}개</Text>
                  )}
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      <Pressable
        style={[s.fab, { bottom: insets.bottom + 24 }]}
        onPress={() => setSheetVisible(true)}
      >
        <LucideIcon name="plus" size={24} color="#fff" />
      </Pressable>

      <Modal visible={sheetVisible} transparent animationType="slide" onRequestClose={() => setSheetVisible(false)}>
        <Pressable style={s.overlay} onPress={() => { if (!newTarget) setSheetVisible(false); }} />
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={s.sheetWrap}>
          <View style={[s.sheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={s.sheetHeader}>
              <Text style={[s.sheetTitle, { color: C.text }]}>
                {newTarget ? (newTarget === "super" ? "스윔노트에 문의" : "원장님에게 문의") : "문의 대상 선택"}
              </Text>
              <Pressable onPress={() => { setSheetVisible(false); setNewTarget(null); setNewTitle(""); setNewContent(""); }}>
                <LucideIcon name="x" size={20} color={C.textMuted} />
              </Pressable>
            </View>

            {!newTarget ? (
              <View style={{ gap: 10, marginTop: 8 }}>
                <Pressable style={[s.targetBtn, { backgroundColor: "#E6FAF8" }]} onPress={() => setNewTarget("super")}>
                  <LucideIcon name="headphones" size={20} color={C.textPrimary} />
                  <View style={{ flex: 1 }}>
                    <Text style={[s.targetBtnLabel, { color: C.text }]}>스윔노트에 문의</Text>
                    <Text style={[s.targetBtnSub, { color: C.textMuted }]}>앱 이용 문제, 서비스 문의</Text>
                  </View>
                </Pressable>
                <Pressable style={[s.targetBtn, { backgroundColor: "#FFF7ED" }]} onPress={() => setNewTarget("admin")}>
                  <LucideIcon name="user-circle" size={20} color={C.textPrimary} />
                  <View style={{ flex: 1 }}>
                    <Text style={[s.targetBtnLabel, { color: C.text }]}>원장님에게 문의</Text>
                    <Text style={[s.targetBtnSub, { color: C.textMuted }]}>수업, 수영장 관련 문의</Text>
                  </View>
                </Pressable>
              </View>
            ) : (
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
                  style={[s.submitBtn, { backgroundColor: newTitle.trim() && newContent.trim() ? C.primaryAction : C.border, marginTop: 16 }]}
                  onPress={submitNewInquiry}
                  disabled={!newTitle.trim() || !newContent.trim() || submitting}
                >
                  {submitting
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={s.submitBtnText}>문의 보내기</Text>}
                </Pressable>
              </ScrollView>
            )}
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
    borderBottomWidth: 1, borderBottomColor: C.backgroundSoft,
  },
  backBtn: { padding: 4 },
  detailTitle: { fontSize: 16, fontFamily: "Pretendard-Regular" },
  detailSub: { fontSize: 12, fontFamily: "Pretendard-Regular", marginTop: 2 },
  myBubbleWrap: { alignItems: "flex-end" },
  otherBubbleWrap: { alignItems: "flex-start" },
  senderName: { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginBottom: 4, marginLeft: 4 },
  myBubble: {
    backgroundColor: "#0F2742", borderRadius: 16, borderBottomRightRadius: 4,
    padding: 12, maxWidth: "80%", alignSelf: "flex-end",
  },
  otherBubble: {
    backgroundColor: C.backgroundSoft, borderRadius: 16, borderBottomLeftRadius: 4,
    padding: 12, maxWidth: "80%",
  },
  myBubbleText: { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#fff", lineHeight: 20 },
  otherBubbleText: { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textPrimary, lineHeight: 20 },
  bubbleTime: { fontSize: 11, fontFamily: "Pretendard-Regular", color: "rgba(255,255,255,0.6)", marginTop: 4, textAlign: "right" },
  inputBar: {
    flexDirection: "row", alignItems: "flex-end", gap: 8,
    paddingHorizontal: 16, paddingTop: 10,
    borderTopWidth: 1, borderTopColor: C.backgroundSoft,
    backgroundColor: "#fff",
  },
  textInput: {
    flex: 1, borderWidth: 1, borderColor: C.border, borderRadius: 16,
    paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10,
    fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textPrimary,
    maxHeight: 100, minHeight: 42,
  },
  sendBtn: {
    width: 42, height: 42, borderRadius: 12,
    alignItems: "center", justifyContent: "center",
  },
  card: {
    borderRadius: 14, padding: 14, gap: 6,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 3, elevation: 1,
  },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardRight: { flexDirection: "row", alignItems: "center", gap: 6 },
  cardTarget: { fontSize: 12, fontFamily: "Pretendard-Regular" },
  cardTime: { fontSize: 12, fontFamily: "Pretendard-Regular" },
  cardTitle: { fontSize: 15, fontFamily: "Pretendard-Regular" },
  cardBottom: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 },
  chip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  chipText: { fontSize: 11, fontFamily: "Pretendard-Regular" },
  replyCount: { fontSize: 12, fontFamily: "Pretendard-Regular" },
  unreadBadge: {
    minWidth: 20, height: 20, borderRadius: 10, backgroundColor: "#D96C6C",
    alignItems: "center", justifyContent: "center", paddingHorizontal: 5,
  },
  unreadBadgeText: { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#fff" },
  fab: {
    position: "absolute", right: 20,
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: "#0F2742",
    alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2, shadowRadius: 8, elevation: 6,
  },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheetWrap: { justifyContent: "flex-end" },
  sheet: {
    backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20, maxHeight: "85%",
  },
  sheetHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  sheetTitle: { fontSize: 17, fontFamily: "Pretendard-Regular" },
  targetBtn: {
    flexDirection: "row", alignItems: "center", gap: 12,
    borderRadius: 14, padding: 16,
  },
  targetBtnLabel: { fontSize: 15, fontFamily: "Pretendard-Regular" },
  targetBtnSub: { fontSize: 12, fontFamily: "Pretendard-Regular", marginTop: 2 },
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
  submitBtn: {
    borderRadius: 14, padding: 15, alignItems: "center",
  },
  submitBtnText: { fontSize: 15, fontFamily: "Pretendard-Regular", color: "#fff" },
  empty: { alignItems: "center", justifyContent: "center", paddingVertical: 60, gap: 12 },
  emptyText: { fontSize: 14, fontFamily: "Pretendard-Regular" },
});
