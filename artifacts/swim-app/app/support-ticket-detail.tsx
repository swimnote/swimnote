/**
 * support-ticket-detail.tsx — 문의 상세 + 대화
 * 사용자와 슈퍼관리자 모두 이 화면 사용
 */
import { ChevronLeft, Image as ImageIcon, Send } from "lucide-react-native";
import { router, useLocalSearchParams } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Image, KeyboardAvoidingView, Modal,
  Platform, Pressable, RefreshControl, ScrollView,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";

const C = Colors.light;
const P = "#7C3AED";

const TYPE_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  general:   { label: "일반",  color: "#0284C7", bg: "#E0F2FE" },
  emergency: { label: "긴급",  color: "#DC2626", bg: "#FEF2F2" },
  security:  { label: "보안",  color: "#7C3AED", bg: "#EEDDF5" },
  refund:    { label: "환불",  color: "#D97706", bg: "#FFF7ED" },
  other:     { label: "기타",  color: "#64748B", bg: "#F8FAFC" },
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  open:        { label: "답변 대기중",  color: "#D97706" },
  in_progress: { label: "처리중",       color: "#0284C7" },
  resolved:    { label: "해결됨",       color: "#16A34A" },
  closed:      { label: "종료",         color: "#64748B" },
};

interface Reply {
  id: string;
  author_name: string;
  author_role: string;
  content: string;
  image_urls: string[];
  created_at: string;
}

interface Ticket {
  id: string; ticket_type: string; subject: string; description: string;
  status: string; consultation_requested: boolean; requester_name: string;
  created_at: string; image_urls: string[];
  replies: Reply[];
}

function relDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diff = Math.floor((now.getTime() - d.getTime()) / 1000);
  if (diff < 60) return "방금";
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  return d.toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" });
}

export default function SupportTicketDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token, kind, adminUser } = useAuth();
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);

  const [ticket,     setTicket]     = useState<Ticket | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [replyText,  setReplyText]  = useState("");
  const [replyImgs,  setReplyImgs]  = useState<string[]>([]);
  const [sending,    setSending]    = useState(false);
  const [previewImg, setPreviewImg] = useState<string | null>(null);

  const isSuper = kind === "admin" &&
    ["super_admin", "platform_admin", "super_manager"].includes(adminUser?.role ?? "");

  const load = useCallback(async (silent = false) => {
    if (!silent) { setLoading(true); }
    try {
      const res = await apiRequest(token, `/support/tickets/${id}`);
      if (res.ok) { const d = await res.json(); setTicket(d); }
    } catch {} finally { setLoading(false); setRefreshing(false); }
  }, [token, id]);

  useEffect(() => { load(); }, [load]);

  async function pickReplyImage() {
    if (replyImgs.length >= 2) return;

    if (Platform.OS === "web") {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.onchange = (e: any) => {
        const file: File = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
          const dataUrl = ev.target?.result as string;
          if (dataUrl) setReplyImgs(prev => [...prev, dataUrl]);
        };
        reader.readAsDataURL(file);
      };
      input.click();
      return;
    }

    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.35, base64: false,
    });
    if (result.canceled || !result.assets[0]) return;
    const base64 = await FileSystem.readAsStringAsync(result.assets[0].uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    setReplyImgs(prev => [...prev, `data:image/jpeg;base64,${base64}`]);
  }

  async function sendReply() {
    if (!replyText.trim()) return;
    setSending(true);
    try {
      const res = await apiRequest(token, `/support/tickets/${id}/replies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: replyText.trim(), image_urls: replyImgs }),
      });
      if (res.ok) {
        setReplyText("");
        setReplyImgs([]);
        await load(true);
        setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 300);
      }
    } catch {} finally { setSending(false); }
  }

  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={["top"]}>
        <View style={s.center}><ActivityIndicator color={P} /></View>
      </SafeAreaView>
    );
  }

  if (!ticket) {
    return (
      <SafeAreaView style={s.safe} edges={["top"]}>
        <View style={s.center}><Text style={s.emptyTxt}>문의를 찾을 수 없습니다.</Text></View>
      </SafeAreaView>
    );
  }

  const typeCfg   = TYPE_LABELS[ticket.ticket_type]  ?? TYPE_LABELS.other;
  const statusCfg = STATUS_LABELS[ticket.status]     ?? { label: ticket.status, color: "#64748B" };

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      {/* 헤더 */}
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.backBtn}>
          <ChevronLeft size={24} color={C.text} />
        </Pressable>
        <Text style={s.headerTitle} numberOfLines={1}>{ticket.subject}</Text>
        <View style={{ width: 36 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={{ padding: 14, gap: 12, paddingBottom: insets.bottom + 80 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          showsVerticalScrollIndicator={false}
        >

          {/* 문의 정보 카드 */}
          <View style={s.infoCard}>
            <View style={s.badgeRow}>
              <View style={[s.typeBadge, { backgroundColor: typeCfg.bg }]}>
                <Text style={[s.typeTxt, { color: typeCfg.color }]}>{typeCfg.label}</Text>
              </View>
              <Text style={[s.statusTxt, { color: statusCfg.color }]}>{statusCfg.label}</Text>
              {ticket.consultation_requested && (
                <Text style={s.consultTag}>📞 상담예약</Text>
              )}
            </View>
            <Text style={s.ticketSubject}>{ticket.subject}</Text>
            <Text style={s.ticketDate}>접수일 {new Date(ticket.created_at).toLocaleDateString("ko-KR")}</Text>
          </View>

          {/* 원본 내용 */}
          <View style={s.msgWrap}>
            <View style={s.msgBubble}>
              <Text style={s.msgContent}>{ticket.description}</Text>
              {Array.isArray(ticket.image_urls) && ticket.image_urls.filter(Boolean).length > 0 && (
                <View style={s.imgRow}>
                  {ticket.image_urls.filter(Boolean).map((uri, i) => (
                    <Pressable key={i} onPress={() => setPreviewImg(uri)}>
                      <Image source={{ uri }} style={s.msgImg} />
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
            <Text style={s.msgMeta}>{ticket.requester_name || "문의자"} · {relDate(ticket.created_at)}</Text>
          </View>

          {/* 답변 목록 */}
          {ticket.replies.map(reply => {
            const isAdmin = reply.author_role === "super_admin";
            return (
              <View key={reply.id} style={[s.msgWrap, isAdmin && s.msgWrapAdmin]}>
                <View style={[s.msgBubble, isAdmin && s.msgBubbleAdmin]}>
                  <Text style={[s.msgContent, isAdmin && s.msgContentAdmin]}>{reply.content}</Text>
                  {Array.isArray(reply.image_urls) && reply.image_urls.filter(Boolean).length > 0 && (
                    <View style={s.imgRow}>
                      {reply.image_urls.filter(Boolean).map((uri, i) => (
                        <Pressable key={i} onPress={() => setPreviewImg(uri)}>
                          <Image source={{ uri }} style={s.msgImg} />
                        </Pressable>
                      ))}
                    </View>
                  )}
                </View>
                <Text style={[s.msgMeta, isAdmin && s.msgMetaAdmin]}>
                  {isAdmin ? "스윔노트 고객센터" : (reply.author_name || "문의자")} · {relDate(reply.created_at)}
                </Text>
              </View>
            );
          })}

        </ScrollView>

        {/* 답변 입력 */}
        {ticket.status !== "resolved" && ticket.status !== "closed" && (
          <View style={[s.inputArea, { paddingBottom: insets.bottom + 8 }]}>
            {replyImgs.length > 0 && (
              <View style={s.replyImgRow}>
                {replyImgs.map((uri, i) => (
                  <View key={i} style={s.replyImgWrap}>
                    <Image source={{ uri }} style={s.replyThumb} />
                    <Pressable style={s.replyImgDel} onPress={() => setReplyImgs(p => p.filter((_, j) => j !== i))}>
                      <Text style={{ color: "#fff", fontSize: 10 }}>✕</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            )}
            <View style={s.inputRow}>
              <Pressable style={s.imgPickBtn} onPress={pickReplyImage}>
                <ImageIcon size={20} color={C.textMuted} />
              </Pressable>
              <TextInput
                style={s.textInput}
                placeholder={isSuper ? "답변을 입력하세요..." : "추가 문의를 입력하세요..."}
                placeholderTextColor={C.textMuted}
                value={replyText}
                onChangeText={setReplyText}
                multiline
                maxLength={500}
              />
              <Pressable
                style={[s.sendBtn, { opacity: (sending || !replyText.trim()) ? 0.4 : 1 }]}
                onPress={sendReply}
                disabled={sending || !replyText.trim()}
              >
                {sending
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Send size={18} color="#fff" />
                }
              </Pressable>
            </View>
          </View>
        )}
      </KeyboardAvoidingView>

      {/* 이미지 미리보기 모달 */}
      <Modal visible={!!previewImg} transparent animationType="fade" onRequestClose={() => setPreviewImg(null)}>
        <Pressable style={s.previewOverlay} onPress={() => setPreviewImg(null)}>
          {previewImg && <Image source={{ uri: previewImg }} style={s.previewImg} resizeMode="contain" />}
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: C.background },
  center:       { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyTxt:     { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textMuted },
  header:       { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12,
                  backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: C.border },
  backBtn:      { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  headerTitle:  { flex: 1, textAlign: "center", fontSize: 16, fontFamily: "Pretendard-Regular", color: C.text },

  infoCard:     { backgroundColor: "#fff", borderRadius: 14, padding: 14, borderWidth: 1, borderColor: C.border, gap: 6 },
  badgeRow:     { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  typeBadge:    { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  typeTxt:      { fontSize: 11, fontFamily: "Pretendard-Regular" },
  statusTxt:    { fontSize: 11, fontFamily: "Pretendard-Regular" },
  consultTag:   { fontSize: 11, fontFamily: "Pretendard-Regular", color: P },
  ticketSubject:{ fontSize: 15, fontFamily: "Pretendard-Regular", color: C.text, lineHeight: 22 },
  ticketDate:   { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted },

  msgWrap:      { gap: 4 },
  msgWrapAdmin: { alignItems: "flex-end" },
  msgBubble:    { backgroundColor: "#fff", borderRadius: 14, borderTopLeftRadius: 4, padding: 12,
                  borderWidth: 1, borderColor: C.border, alignSelf: "flex-start", maxWidth: "88%" },
  msgBubbleAdmin:{ backgroundColor: P, borderTopLeftRadius: 14, borderTopRightRadius: 4, borderWidth: 0, alignSelf: "flex-end" },
  msgContent:   { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.text, lineHeight: 20 },
  msgContentAdmin:{ color: "#fff" },
  msgMeta:      { fontSize: 10, fontFamily: "Pretendard-Regular", color: C.textMuted, marginLeft: 4 },
  msgMetaAdmin: { textAlign: "right", marginRight: 4, marginLeft: 0 },
  imgRow:       { flexDirection: "row", gap: 6, marginTop: 6, flexWrap: "wrap" },
  msgImg:       { width: 100, height: 100, borderRadius: 8 },

  inputArea:    { backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: C.border,
                  paddingHorizontal: 12, paddingTop: 8, gap: 6 },
  replyImgRow:  { flexDirection: "row", gap: 6 },
  replyImgWrap: { position: "relative" },
  replyThumb:   { width: 52, height: 52, borderRadius: 8 },
  replyImgDel:  { position: "absolute", top: 2, right: 2, width: 16, height: 16, borderRadius: 8,
                  backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center" },
  inputRow:     { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  imgPickBtn:   { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  textInput:    { flex: 1, backgroundColor: "#F8FAFC", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8,
                  fontSize: 14, fontFamily: "Pretendard-Regular", color: C.text, maxHeight: 100 },
  sendBtn:      { width: 36, height: 36, borderRadius: 18, backgroundColor: P,
                  alignItems: "center", justifyContent: "center" },

  previewOverlay:{ flex: 1, backgroundColor: "rgba(0,0,0,0.9)", alignItems: "center", justifyContent: "center" },
  previewImg:    { width: "90%", height: "80%" },
});
