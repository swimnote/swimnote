import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform,
  Pressable, RefreshControl, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useParent } from "@/context/ParentContext";

const C = Colors.light;

interface StudentNote { id: string; note_content: string; is_edited: boolean; }
interface DiaryEntry {
  id: string; lesson_date: string; common_content: string;
  teacher_name: string; is_edited: boolean; created_at: string;
  student_note?: StudentNote | null;
  reactions?: string[];
  has_message?: boolean;
}
interface DiaryMessage {
  id: string; sender_id: string; sender_name: string; sender_role: string;
  content: string; is_deleted: boolean; created_at: string;
}

function parseLessonDate(d: string) {
  const dt = new Date(d.includes("T") ? d : d + "T00:00:00");
  const wd = ["일", "월", "화", "수", "목", "금", "토"];
  return { month: dt.getMonth() + 1, day: dt.getDate(), weekday: wd[dt.getDay()] };
}

function Toast({ msg, visible }: { msg: string; visible: boolean }) {
  if (!visible) return null;
  return (
    <View style={ts.toast} pointerEvents="none">
      <Feather name="check-circle" size={14} color="#fff" />
      <Text style={ts.toastTxt}>{msg}</Text>
    </View>
  );
}

function MessageModal({
  diaryId, diaryDate, teacherName, visible, onClose,
}: {
  diaryId: string; diaryDate: string; teacherName: string;
  visible: boolean; onClose: () => void;
}) {
  const { token, parentAccount } = useAuth();
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<DiaryMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [deletedSet, setDeletedSet] = useState<Set<string>>(new Set());
  const scrollRef = useRef<ScrollView>(null);

  const load = useCallback(async () => {
    if (!diaryId || !visible) return;
    setLoading(true);
    try {
      const res = await apiRequest(token, `/parent/diary/${diaryId}/messages`);
      if (res.ok) setMessages(await res.json());
    } finally { setLoading(false); }
  }, [diaryId, visible, token]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (messages.length) setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100); }, [messages.length]);

  async function send() {
    if (!input.trim() || sending) return;
    setSending(true);
    try {
      const res = await apiRequest(token, `/parent/diary/${diaryId}/messages`, {
        method: "POST", body: JSON.stringify({ content: input.trim() }),
      });
      if (res.ok) {
        const msg = await res.json();
        setMessages(prev => [...prev, msg]);
        setInput("");
      }
    } finally { setSending(false); }
  }

  async function softDelete(msgId: string) {
    const res = await apiRequest(token, `/parent/diary/${diaryId}/messages/${msgId}`, { method: "DELETE" });
    if (res.ok) {
      setDeletedSet(prev => new Set([...prev, msgId]));
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, is_deleted: true } : m));
    }
  }

  async function restore(msgId: string) {
    const res = await apiRequest(token, `/parent/diary/${diaryId}/messages/${msgId}/restore`, { method: "POST" });
    if (res.ok) {
      setDeletedSet(prev => { const s = new Set(prev); s.delete(msgId); return s; });
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, is_deleted: false } : m));
    }
  }

  async function hardDelete(msgId: string) {
    const res = await apiRequest(token, `/parent/diary/${diaryId}/messages/${msgId}/permanent`, { method: "DELETE" });
    if (res.ok) setMessages(prev => prev.filter(m => m.id !== msgId));
  }

  const myId = parentAccount?.id ?? "";

  function fmtTime(d: string) {
    return new Date(d).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={ts.overlay}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={ts.sheet}
        >
          <View style={[ts.sheetInner, { paddingBottom: insets.bottom }]}>
            {/* 헤더 */}
            <View style={ts.mHeader}>
              <View style={{ flex: 1 }}>
                <Text style={ts.mTitle}>쪽지함</Text>
                <Text style={ts.mSub}>{teacherName} 선생님 · {parseLessonDate(diaryDate).month}월 {parseLessonDate(diaryDate).day}일</Text>
              </View>
              <Pressable onPress={onClose} style={ts.mClose} hitSlop={8}>
                <Feather name="x" size={22} color={C.text} />
              </Pressable>
            </View>

            {/* 쪽지 목록 */}
            <ScrollView
              ref={scrollRef}
              style={ts.msgList}
              contentContainerStyle={{ padding: 14, gap: 8, paddingBottom: 8 }}
              showsVerticalScrollIndicator={false}
            >
              {loading ? (
                <ActivityIndicator color={C.tint} style={{ marginTop: 20 }} />
              ) : messages.length === 0 ? (
                <View style={ts.emptyMsg}>
                  <Text style={ts.emptyMsgEmoji}>✉️</Text>
                  <Text style={[ts.emptyMsgTxt, { color: C.textSecondary }]}>첫 쪽지를 보내보세요</Text>
                  <Text style={[ts.emptyMsgSub, { color: C.textMuted }]}>선생님이 확인 후 답변드립니다</Text>
                </View>
              ) : messages.map(msg => {
                const isMine = msg.sender_id === myId;
                const isDeleted = msg.is_deleted;
                return (
                  <View key={msg.id} style={[ts.msgRow, isMine && ts.msgRowRight]}>
                    {!isMine && (
                      <View style={ts.msgAvatar}>
                        <Feather name={msg.sender_role === "teacher" ? "user-check" : "shield"} size={14} color={C.tint} />
                      </View>
                    )}
                    <View style={{ maxWidth: "75%", gap: 2 }}>
                      {!isMine && <Text style={ts.msgSender}>{msg.sender_name}</Text>}
                      <View style={[ts.msgBubble,
                        isMine ? { backgroundColor: C.tint } : { backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
                        isDeleted && ts.msgBubbleDeleted
                      ]}>
                        {isDeleted ? (
                          <Text style={[ts.msgContent, { color: C.textMuted, fontStyle: "italic" }]}>삭제된 메시지</Text>
                        ) : (
                          <Text style={[ts.msgContent, isMine ? { color: "#fff" } : { color: C.text }]}>{msg.content}</Text>
                        )}
                      </View>
                      <View style={[ts.msgMeta, isMine && { alignSelf: "flex-end" }]}>
                        <Text style={ts.msgTime}>{fmtTime(msg.created_at)}</Text>
                        {isMine && !isDeleted && (
                          <TouchableOpacity onPress={() => softDelete(msg.id)}>
                            <Text style={ts.msgAction}>삭제</Text>
                          </TouchableOpacity>
                        )}
                        {isMine && isDeleted && (
                          <>
                            <TouchableOpacity onPress={() => restore(msg.id)}>
                              <Text style={[ts.msgAction, { color: C.tint }]}>복구</Text>
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => hardDelete(msg.id)}>
                              <Text style={[ts.msgAction, { color: C.absent }]}>영구삭제</Text>
                            </TouchableOpacity>
                          </>
                        )}
                      </View>
                    </View>
                  </View>
                );
              })}
            </ScrollView>

            {/* 입력창 */}
            <View style={[ts.inputRow, { borderTopColor: C.border }]}>
              <TextInput
                style={[ts.input, { backgroundColor: "#F3F4F6", color: C.text }]}
                placeholder="쪽지 내용을 입력하세요"
                placeholderTextColor={C.textMuted}
                value={input}
                onChangeText={setInput}
                multiline
                maxLength={500}
                returnKeyType="default"
              />
              <Pressable
                onPress={send}
                disabled={!input.trim() || sending}
                style={[ts.sendBtn, { backgroundColor: C.tint, opacity: !input.trim() || sending ? 0.5 : 1 }]}
              >
                {sending
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Feather name="send" size={18} color="#fff" />
                }
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function DiaryCard({ entry, studentId }: { entry: DiaryEntry; studentId: string }) {
  const { token } = useAuth();
  const [open, setOpen] = useState(false);
  const [myReactions, setMyReactions] = useState<Set<string>>(new Set(entry.reactions ?? []));
  const [msgOpen, setMsgOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [toastVisible, setToastVisible] = useState(false);

  useEffect(() => {
    apiRequest(token, `/parent/diary/${entry.id}/reactions`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.myReactions) setMyReactions(new Set(d.myReactions)); })
      .catch(() => {});
  }, [entry.id]);

  function showToast(msg: string) {
    setToast(msg); setToastVisible(true);
    setTimeout(() => setToastVisible(false), 1800);
  }

  async function toggleReaction(type: "like" | "thank") {
    const res = await apiRequest(token, `/parent/diary/${entry.id}/reactions`, {
      method: "POST", body: JSON.stringify({ reaction_type: type }),
    });
    if (res.ok) {
      const data = await res.json();
      setMyReactions(prev => {
        const s = new Set(prev);
        data.active ? s.add(type) : s.delete(type);
        return s;
      });
      showToast(data.active ? (type === "like" ? "좋아요를 눌렀어요" : "감사합니다를 눌렀어요") : "취소했습니다");
    }
  }

  const { month, day, weekday } = parseLessonDate(entry.lesson_date);

  return (
    <View style={[ds.card, { backgroundColor: C.card }]}>
      <Pressable onPress={() => setOpen(o => !o)} style={ds.cardHeader}>
        <View style={[ds.dateBadge, { backgroundColor: C.tint }]}>
          <Text style={ds.dateMonth}>{month}월</Text>
          <Text style={ds.dateDay}>{day}</Text>
          <Text style={ds.dateWeekday}>{weekday}</Text>
        </View>
        <View style={ds.cardMeta}>
          <View style={ds.metaRow}>
            <Text style={[ds.teacher, { color: C.text }]}>{entry.teacher_name} 선생님</Text>
            {entry.student_note && (
              <View style={[ds.badge, { backgroundColor: "#EDE9FE" }]}>
                <Feather name="user" size={9} color="#7C3AED" />
                <Text style={[ds.badgeTxt, { color: "#7C3AED" }]}>개별 일지</Text>
              </View>
            )}
          </View>
          <Text style={[ds.preview, { color: C.textMuted }]} numberOfLines={2}>{entry.common_content}</Text>
        </View>
        <Feather name={open ? "chevron-up" : "chevron-down"} size={18} color={C.textMuted} />
      </Pressable>

      {open && (
        <View style={ds.body}>
          <View style={[ds.divider, { backgroundColor: C.border }]} />
          <View style={ds.section}>
            <View style={[ds.dot, { backgroundColor: C.tint }]} />
            <Text style={[ds.sectionLabel, { color: C.tint }]}>수업 내용</Text>
          </View>
          <Text style={[ds.content, { color: C.text }]}>{entry.common_content}</Text>

          {entry.student_note?.note_content ? (
            <View style={[ds.noteBox, { backgroundColor: "#F5F3FF", borderColor: "#DDD6FE" }]}>
              <View style={ds.section}>
                <Feather name="user" size={12} color="#7C3AED" />
                <Text style={ds.noteTitle}>우리 아이 개별 일지</Text>
              </View>
              <Text style={[ds.content, { color: "#374151" }]}>{entry.student_note.note_content}</Text>
            </View>
          ) : null}
        </View>
      )}

      {/* 반응 버튼 */}
      <View style={[ds.reactions, { borderTopColor: C.border }]}>
        <Pressable
          onPress={() => toggleReaction("like")}
          style={[ds.reactionBtn, myReactions.has("like") && { backgroundColor: "#DBEAFE" }]}
        >
          <Text style={[ds.reactionEmoji, myReactions.has("like") && { transform: [{ scale: 1.2 }] }]}>👍</Text>
          <Text style={[ds.reactionLabel, { color: myReactions.has("like") ? "#1D4ED8" : C.textSecondary }]}>좋아요</Text>
        </Pressable>
        <Pressable
          onPress={() => toggleReaction("thank")}
          style={[ds.reactionBtn, myReactions.has("thank") && { backgroundColor: "#FCE7F3" }]}
        >
          <Text style={[ds.reactionEmoji, myReactions.has("thank") && { transform: [{ scale: 1.2 }] }]}>🙏</Text>
          <Text style={[ds.reactionLabel, { color: myReactions.has("thank") ? "#BE185D" : C.textSecondary }]}>감사합니다</Text>
        </Pressable>
        <Pressable onPress={() => setMsgOpen(true)} style={ds.reactionBtn}>
          <Feather name="mail" size={17} color={C.textSecondary} />
          <Text style={[ds.reactionLabel, { color: C.textSecondary }]}>쪽지달기</Text>
        </Pressable>
      </View>

      <Toast msg={toast} visible={toastVisible} />

      <MessageModal
        visible={msgOpen}
        onClose={() => setMsgOpen(false)}
        diaryId={entry.id}
        diaryDate={entry.lesson_date}
        teacherName={entry.teacher_name}
      />
    </View>
  );
}

export default function ParentDiaryScreen() {
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const { selectedStudent } = useParent();
  const [entries, setEntries] = useState<DiaryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchEntries = useCallback(async () => {
    if (!selectedStudent?.id) { setLoading(false); return; }
    try {
      const res = await apiRequest(token, `/parent/students/${selectedStudent.id}/diary`);
      if (res.ok) setEntries(await res.json());
    } catch { }
    finally { setLoading(false); setRefreshing(false); }
  }, [token, selectedStudent?.id]);

  useEffect(() => { setLoading(true); fetchEntries(); }, [fetchEntries]);

  return (
    <View style={[ds.root, { backgroundColor: C.background }]}>
      <View style={[ds.header, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 20) }]}>
        <Text style={[ds.headerTitle, { color: C.text }]}>수업피드백</Text>
        {selectedStudent && (
          <View style={[ds.childChip, { backgroundColor: C.tintLight }]}>
            <Text style={[ds.childChipTxt, { color: C.tint }]}>{selectedStudent.name}</Text>
          </View>
        )}
      </View>

      {loading ? (
        <ActivityIndicator color={C.tint} style={{ marginTop: 60 }} />
      ) : !selectedStudent ? (
        <View style={ds.empty}>
          <Text style={ds.emptyEmoji}>👶</Text>
          <Text style={[ds.emptyTitle, { color: C.text }]}>자녀를 선택해주세요</Text>
          <Text style={[ds.emptySub, { color: C.textSecondary }]}>홈 화면에서 자녀를 선택하세요</Text>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchEntries(); }} />}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 100, paddingTop: 8, gap: 12 }}
        >
          {entries.length === 0 ? (
            <View style={ds.empty}>
              <Text style={ds.emptyEmoji}>📒</Text>
              <Text style={[ds.emptyTitle, { color: C.text }]}>아직 수업 일지가 없습니다</Text>
              <Text style={[ds.emptySub, { color: C.textSecondary }]}>선생님이 수업 후 일지를 작성하면{"\n"}여기에서 확인하실 수 있습니다</Text>
            </View>
          ) : (
            entries.map(e => <DiaryCard key={e.id} entry={e} studentId={selectedStudent.id} />)
          )}
        </ScrollView>
      )}
    </View>
  );
}

const ds = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerTitle: { fontSize: 22, fontFamily: "Inter_700Bold" },
  childChip: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 10 },
  childChipTxt: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  card: {
    borderRadius: 18, overflow: "hidden",
    shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 8, elevation: 3, shadowColor: "#00000014",
  },
  cardHeader: { flexDirection: "row", alignItems: "center", padding: 14, gap: 12 },
  dateBadge: { width: 52, borderRadius: 12, alignItems: "center", paddingVertical: 8, gap: 1, flexShrink: 0 },
  dateMonth: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: "rgba(255,255,255,0.8)" },
  dateDay: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#fff", lineHeight: 26 },
  dateWeekday: { fontSize: 11, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.8)" },
  cardMeta: { flex: 1, gap: 4 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  teacher: { fontSize: 14, fontFamily: "Inter_700Bold" },
  preview: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },
  badge: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  badgeTxt: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  body: { paddingHorizontal: 14, paddingBottom: 14, gap: 10 },
  divider: { height: 1, marginBottom: 4 },
  section: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  sectionLabel: { fontSize: 11, fontFamily: "Inter_700Bold", textTransform: "uppercase" },
  content: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 22, paddingLeft: 14 },
  noteBox: { borderRadius: 12, borderWidth: 1.5, padding: 12, gap: 8 },
  noteTitle: { fontSize: 12, fontFamily: "Inter_700Bold", color: "#7C3AED", flex: 1 },
  reactions: { flexDirection: "row", borderTopWidth: 1, paddingHorizontal: 8, paddingVertical: 6 },
  reactionBtn: { flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: 10, gap: 3, flexDirection: "row", justifyContent: "center" },
  reactionEmoji: { fontSize: 16 },
  reactionLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
  empty: { alignItems: "center", justifyContent: "center", paddingTop: 100, gap: 12 },
  emptyEmoji: { fontSize: 56 },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  emptySub: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 22 },
});

const ts = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { maxHeight: "85%" },
  sheetInner: { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, flex: 1 },
  mHeader: {
    flexDirection: "row", alignItems: "flex-start", padding: 20, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  mTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: C.text },
  mSub: { fontSize: 13, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 2 },
  mClose: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  msgList: { flex: 1 },
  emptyMsg: { alignItems: "center", paddingTop: 40, gap: 8 },
  emptyMsgEmoji: { fontSize: 40 },
  emptyMsgTxt: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  emptyMsgSub: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center" },
  msgRow: { flexDirection: "row", alignItems: "flex-end", gap: 8, marginBottom: 4 },
  msgRowRight: { flexDirection: "row-reverse" },
  msgAvatar: {
    width: 32, height: 32, borderRadius: 10, backgroundColor: C.tintLight,
    alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  msgSender: { fontSize: 11, fontFamily: "Inter_500Medium", color: C.textSecondary, marginBottom: 2, paddingLeft: 2 },
  msgBubble: { borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10 },
  msgBubbleDeleted: { opacity: 0.5 },
  msgContent: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
  msgMeta: { flexDirection: "row", alignItems: "center", gap: 6 },
  msgTime: { fontSize: 10, fontFamily: "Inter_400Regular", color: C.textMuted },
  msgAction: { fontSize: 11, fontFamily: "Inter_500Medium", color: C.textSecondary },
  inputRow: {
    flexDirection: "row", alignItems: "flex-end", gap: 8,
    padding: 12, paddingTop: 10, borderTopWidth: 1,
  },
  input: {
    flex: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 14, fontFamily: "Inter_400Regular", maxHeight: 100, minHeight: 44,
  },
  sendBtn: { width: 44, height: 44, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  toast: {
    position: "absolute", bottom: 80, alignSelf: "center",
    backgroundColor: "rgba(0,0,0,0.72)", flexDirection: "row", alignItems: "center",
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, gap: 6, zIndex: 999,
  },
  toastTxt: { color: "#fff", fontSize: 13, fontFamily: "Inter_500Medium" },
});
