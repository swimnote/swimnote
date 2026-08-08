/**
 * RequestThreadModal — 선생님용 학부모 요청 업무 대화 Modal
 * 최초 요청 원문 + parent_request_messages 시간순 표시
 * 선생님 답장 가능 / 업무 상태는 별도 [확인/거절] 버튼 유지
 */
import { LucideIcon } from "@/components/common/LucideIcon";
import Colors from "@/constants/colors";
import { apiRequest } from "@/context/AuthContext";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const C = Colors.light;

interface RequestMessage {
  id: string;
  request_id: string;
  sender_type: "parent" | "teacher" | "system";
  sender_id: string | null;
  message_type: "message" | "system";
  content: string;
  created_at: string;
}

export interface ParentRequest {
  id: string;
  request_type: string;
  student_name: string;
  parent_name: string;
  content: string | null;
  status: string;
  created_at: string;
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

interface Props {
  visible: boolean;
  request: ParentRequest | null;
  token: string;
  themeColor: string;
  onClose: () => void;
  onRefreshList?: () => void;
}

export function RequestThreadModal({ visible, request, token, themeColor, onClose, onRefreshList }: Props) {
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<RequestMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const fetchingRef = useRef(false);       // 중복 GET 방지
  const prevMsgCountRef = useRef(0);       // 메시지 수 변화 감지 (불필요 scroll 방지)

  // silent=true: polling용 (로딩 UI 없음), false: 초기 로드 (로딩 UI 표시)
  const fetchMessages = useCallback(async (silent = false) => {
    if (!request) return;
    if (fetchingRef.current) return;      // 이미 요청 중이면 skip
    fetchingRef.current = true;
    if (!silent) setLoading(true);
    try {
      const res = await apiRequest(token, `/parent-requests/${request.id}/messages`);
      if (res.ok) {
        const d = await res.json();
        const msgs: RequestMessage[] = d.messages || [];
        setMessages(msgs);
        // 메시지 수가 늘었을 때만 scroll
        if (msgs.length > prevMsgCountRef.current) {
          const wasEmpty = prevMsgCountRef.current === 0;
          setTimeout(() => scrollRef.current?.scrollToEnd({ animated: !wasEmpty }), 120);
        }
        prevMsgCountRef.current = msgs.length;
      }
    } catch {}
    if (!silent) setLoading(false);
    fetchingRef.current = false;
  }, [request?.id, token]);

  // 초기 로드: visible/requestId 변경 시
  useEffect(() => {
    if (visible && request) {
      setMessages([]);
      setReplyText("");
      prevMsgCountRef.current = 0;
      fetchingRef.current = false;
      fetchMessages(false);
    }
  }, [visible, request?.id]);

  // 2초 polling: visible=true인 동안만, unmount/닫기 시 자동 정리
  useEffect(() => {
    if (!visible || !request) return;
    const interval = setInterval(() => fetchMessages(true), 2000);
    return () => clearInterval(interval);
  }, [visible, request?.id, fetchMessages]);

  async function sendMessage() {
    if (!request || !replyText.trim() || sending) return;
    setSending(true);
    const text = replyText.trim();
    // 텍스트는 전송 성공 후에만 초기화 (실패 시 유지)
    try {
      const res = await apiRequest(token, `/parent-requests/${request.id}/messages`, {
        method: "POST",
        body: JSON.stringify({ content: text }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        setReplyText("");          // 성공 시에만 초기화
        await fetchMessages(true); // POST 성공 → 즉시 재조회 (중복 bubble 방지)
        onRefreshList?.();
      } else {
        Alert.alert("전송 실패", d.message || `오류가 발생했습니다. (${res.status})`);
      }
    } catch {
      Alert.alert("전송 실패", "네트워크 오류가 발생했습니다. 다시 시도해주세요.");
    }
    setSending(false);
  }

  if (!request) return null;

  const typeColor = REQUEST_TYPE_COLOR[request.request_type] || "#6B7280";
  const typeLabel = REQUEST_TYPE_LABEL[request.request_type] || request.request_type;

  function fmtTime(iso: string) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  function fmtDate(iso: string | null | undefined) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <View style={[m.container, { paddingTop: insets.top }]}>
        {/* Header */}
        <View style={m.header}>
          <View style={[m.typeBadge, { backgroundColor: typeColor + "18" }]}>
            <Text style={[m.typeLabel, { color: typeColor }]}>{typeLabel}</Text>
          </View>
          <View style={m.headerMid}>
            <Text style={[m.headerStudent, { color: C.text }]}>{request.student_name}</Text>
            <Text style={[m.headerParent, { color: C.textMuted }]}>· {request.parent_name}</Text>
          </View>
          <Pressable onPress={onClose} style={m.closeBtn} hitSlop={8}>
            <LucideIcon name="x" size={22} color={C.textSecondary} />
          </Pressable>
        </View>

        {/* Message list */}
        {loading ? (
          <View style={m.loadingBox}>
            <ActivityIndicator color={themeColor} />
          </View>
        ) : (
          <ScrollView
            ref={scrollRef}
            style={m.scroll}
            contentContainerStyle={m.scrollContent}
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
          >
            {/* 최초 요청 원문 */}
            {request.content ? (
              <View style={m.originCard}>
                <Text style={[m.originLabel, { color: typeColor }]}>
                  최초 요청 · {fmtDate(request.created_at)}
                </Text>
                <Text style={[m.originContent, { color: C.text }]}>{request.content}</Text>
              </View>
            ) : null}

            {messages.length === 0 && !request.content && (
              <View style={m.emptyBox}>
                <LucideIcon name="message-circle" size={36} color={C.textMuted} />
                <Text style={[m.emptyTxt, { color: C.textMuted }]}>아직 대화가 없습니다</Text>
              </View>
            )}

            {/* 메시지 목록 */}
            {messages.map(msg => {
              if (msg.message_type === "system") {
                return (
                  <View key={msg.id} style={m.systemRow}>
                    <Text style={[m.systemTxt, { color: C.textMuted }]}>{msg.content}</Text>
                  </View>
                );
              }
              const isTeacher = msg.sender_type === "teacher";
              return (
                <View key={msg.id} style={[m.msgRow, isTeacher && m.msgRowRight]}>
                  <View
                    style={[
                      m.bubble,
                      isTeacher
                        ? { backgroundColor: themeColor }
                        : { backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
                    ]}
                  >
                    <Text style={[m.bubbleTxt, { color: isTeacher ? "#fff" : C.text }]}>
                      {msg.content}
                    </Text>
                    <Text
                      style={[
                        m.bubbleTime,
                        { color: isTeacher ? "rgba(255,255,255,0.7)" : C.textMuted },
                      ]}
                    >
                      {fmtTime(msg.created_at)}
                    </Text>
                  </View>
                </View>
              );
            })}
          </ScrollView>
        )}

        {/* Footer */}
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={insets.bottom + 10}
        >
          <View style={[m.footer, { paddingBottom: insets.bottom + 8, borderTopColor: C.border }]}>
            <TextInput
              style={[m.input, { backgroundColor: C.background, color: C.text, borderColor: C.border }]}
              value={replyText}
              onChangeText={setReplyText}
              placeholder="답변 입력..."
              placeholderTextColor={C.textMuted}
              multiline
              maxLength={500}
              returnKeyType="send"
              onSubmitEditing={Platform.OS === "ios" ? undefined : sendMessage}
            />
            <Pressable
              style={[m.sendBtn, { backgroundColor: replyText.trim() ? themeColor : C.border }]}
              onPress={sendMessage}
              disabled={!replyText.trim() || sending}
            >
              {sending ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <LucideIcon name="send" size={18} color="#fff" />
              )}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const m = StyleSheet.create({
  container:     { flex: 1, backgroundColor: "#F8FAFC" },
  header:        { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 14, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  typeBadge:     { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  typeLabel:     { fontSize: 13, fontFamily: "Pretendard-Regular", fontWeight: "600" },
  headerMid:     { flex: 1, flexDirection: "row", alignItems: "center", gap: 4 },
  headerStudent: { fontSize: 16, fontFamily: "Pretendard-Regular", fontWeight: "700" },
  headerParent:  { fontSize: 13, fontFamily: "Pretendard-Regular" },
  closeBtn:      { width: 36, height: 36, borderRadius: 10, backgroundColor: "#F3F4F6", alignItems: "center", justifyContent: "center" },
  loadingBox:    { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll:        { flex: 1 },
  scrollContent: { padding: 16, gap: 12 },
  originCard:    { backgroundColor: "#FFF7ED", borderRadius: 12, padding: 14, gap: 6, borderLeftWidth: 3, borderLeftColor: "#F59E0B" },
  originLabel:   { fontSize: 12, fontFamily: "Pretendard-Regular", fontWeight: "600" },
  originContent: { fontSize: 14, fontFamily: "Pretendard-Regular", lineHeight: 20 },
  emptyBox:      { alignItems: "center", gap: 10, paddingVertical: 40 },
  emptyTxt:      { fontSize: 14, fontFamily: "Pretendard-Regular" },
  systemRow:     { alignItems: "center", paddingVertical: 6 },
  systemTxt:     { fontSize: 12, fontFamily: "Pretendard-Regular", fontStyle: "italic" },
  msgRow:        { flexDirection: "row" },
  msgRowRight:   { flexDirection: "row-reverse" },
  bubble:        { maxWidth: "80%", borderRadius: 16, padding: 12, gap: 4 },
  bubbleTxt:     { fontSize: 14, fontFamily: "Pretendard-Regular", lineHeight: 20 },
  bubbleTime:    { fontSize: 11, fontFamily: "Pretendard-Regular", alignSelf: "flex-end" },
  footer:        { flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingTop: 10, borderTopWidth: 1, backgroundColor: "#fff" },
  input:         { flex: 1, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, fontFamily: "Pretendard-Regular", maxHeight: 100, minHeight: 44 },
  sendBtn:       { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
});
