/**
 * MessengerScreen.tsx
 * 업무 메신저 공유 컴포넌트 (관리자/선생님)
 *
 * ▸ 대화 탭: 관리자+선생님 모두 카카오톡형 채팅 입력/전송
 * ▸ 공지 탭: 관리자만 작성 / 노란색 피드 / 이동·보강 자동메시지 수정불가
 *
 * 키보드 처리:
 *   부모(messenger.tsx)에서 paddingBottom = TAB_BAR_H + insets.bottom 적용
 *   → KAV behavior="padding" 이 탭바 위쪽 영역 기준으로 정확히 동작
 *   입력창 paddingBottom = 최소값(4~6px)만 사용
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";

const C = Colors.light;
const PRIMARY = C.tint;

/* ─── 타입 ─────────────────────────────────────────────── */
type ChannelType = "talk" | "notice";
type MsgType = "normal" | "notice" | "system_move" | "system_makeup";

interface WorkMessage {
  id: number;
  pool_id: string;
  sender_id: string | null;
  sender_name: string | null;
  content: string;
  msg_type: string;
  channel_type: ChannelType;
  message_type: MsgType;
  created_at: string;
}

interface Props {
  poolId: string;
  myUserId: string;
  myRole: "pool_admin" | "teacher";
}

/* ─── 헬퍼 ─────────────────────────────────────────────── */
function fmtDate(iso: string): string {
  const d = new Date(iso);
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${days[d.getDay()]}요일`;
}
function fmtTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes();
  return `${h < 12 ? "오전" : "오후"} ${h % 12 || 12}:${String(m).padStart(2, "0")}`;
}
function sameDay(a: string, b: string): boolean {
  return a.slice(0, 10) === b.slice(0, 10);
}
function isSystemMsg(msg: WorkMessage): boolean {
  return msg.message_type === "system_move" || msg.message_type === "system_makeup";
}

/* ─────────────────────────────────────────────────────────
   메인 컴포넌트
───────────────────────────────────────────────────────── */
export default function MessengerScreen({ poolId, myUserId, myRole }: Props) {
  const { token } = useAuth();
  const isAdmin = myRole === "pool_admin";

  const [activeTab, setActiveTab] = useState<ChannelType>("talk");
  const [talkMessages, setTalkMessages] = useState<WorkMessage[]>([]);
  const [noticeMessages, setNoticeMessages] = useState<WorkMessage[]>([]);
  const [talkInput, setTalkInput] = useState("");
  const [noticeInput, setNoticeInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [noticeUnread, setNoticeUnread] = useState(false);

  const talkInputRef = useRef<TextInput>(null);
  const noticeInputRef = useRef<TextInput>(null);

  /* ── 데이터 로드 ── */
  const loadMessages = useCallback(async () => {
    if (!poolId || !token) return;
    try {
      const [talkRes, noticeRes, readRes] = await Promise.all([
        apiRequest(token, `/messenger/messages?pool_id=${poolId}&channel_type=talk`),
        apiRequest(token, `/messenger/messages?pool_id=${poolId}&channel_type=notice`),
        apiRequest(token, `/messenger/read-state?pool_id=${poolId}`),
      ]);
      if (talkRes.ok) {
        const d = await talkRes.json();
        setTalkMessages(d.data ?? d ?? []);
      }
      if (noticeRes.ok) {
        const d = await noticeRes.json();
        setNoticeMessages(d.data ?? d ?? []);
      }
      if (readRes.ok) {
        const d = await readRes.json();
        const cnt = d.data?.unread_count ?? d.unread_count ?? 0;
        setNoticeUnread(cnt > 0);
      }
    } catch (e) {
      console.error("[messenger] load error", e);
    } finally {
      setLoading(false);
    }
  }, [poolId, token]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  /* ── 공지 읽음 처리 ── */
  const markNoticeRead = useCallback(async () => {
    if (!token) return;
    try {
      await apiRequest(token, "/messenger/read-state", {
        method: "POST",
        body: JSON.stringify({ pool_id: poolId }),
      });
      setNoticeUnread(false);
    } catch (_) {}
  }, [poolId, token]);

  const handleTabChange = useCallback(
    (tab: ChannelType) => {
      Keyboard.dismiss();
      setActiveTab(tab);
      if (tab === "notice") markNoticeRead();
    },
    [markNoticeRead]
  );

  /* ── 대화 전송 ── */
  const sendTalk = useCallback(async () => {
    const text = talkInput.trim();
    if (!text || sending || !token) return;
    setSending(true);
    try {
      const res = await apiRequest(token, "/messenger/messages", {
        method: "POST",
        body: JSON.stringify({
          pool_id: poolId,
          content: text,
          channel_type: "talk",
          message_type: "normal",
        }),
      });
      if (res.ok) {
        const d = await res.json();
        const msg: WorkMessage = d.data ?? d;
        setTalkMessages((prev) => [msg, ...prev]);
      }
      setTalkInput("");
    } catch (e) {
      console.error("[messenger] sendTalk error", e);
    } finally {
      setSending(false);
    }
  }, [talkInput, sending, poolId, token]);

  /* ── 공지 전송 (관리자 전용) ── */
  const sendNotice = useCallback(async () => {
    const text = noticeInput.trim();
    if (!text || sending || !isAdmin || !token) return;
    setSending(true);
    try {
      const res = await apiRequest(token, "/messenger/notice", {
        method: "POST",
        body: JSON.stringify({ pool_id: poolId, content: text }),
      });
      if (res.ok) {
        const d = await res.json();
        const msg: WorkMessage = d.data ?? d;
        setNoticeMessages((prev) => [msg, ...prev]);
      }
      setNoticeInput("");
    } catch (e) {
      console.error("[messenger] sendNotice error", e);
    } finally {
      setSending(false);
    }
  }, [noticeInput, sending, poolId, isAdmin, token]);

  /* ── 대화 탭 아이템 렌더 ── */
  const renderTalkItem = useCallback(
    ({ item, index }: { item: WorkMessage; index: number }) => {
      const isMine = item.sender_id === myUserId;
      // FlatList inverted: index 0 = 최신 메시지 = 화면 하단
      const prevMsg = talkMessages[index + 1]; // 시간상 이전 메시지
      const nextMsg = talkMessages[index - 1]; // 시간상 다음 메시지

      const showDateLine = !prevMsg || !sameDay(item.created_at, prevMsg.created_at);
      const showAvatar =
        !isMine &&
        (!nextMsg ||
          nextMsg.sender_id !== item.sender_id ||
          !sameDay(item.created_at, nextMsg.created_at));
      const showTime =
        !nextMsg ||
        nextMsg.sender_id !== item.sender_id ||
        fmtTime(item.created_at) !== fmtTime(nextMsg.created_at);

      return (
        <>
          {showDateLine && (
            <View style={s.dateLine}>
              <View style={s.dateLineBar} />
              <Text style={s.dateLineText}>{fmtDate(item.created_at)}</Text>
              <View style={s.dateLineBar} />
            </View>
          )}

          <View style={[s.msgRow, isMine ? s.msgRowRight : s.msgRowLeft]}>
            {!isMine && (
              <View style={s.avatarCol}>
                {showAvatar ? (
                  <View style={[s.avatar, { backgroundColor: PRIMARY }]}>
                    <Text style={s.avatarText}>
                      {(item.sender_name || "?").charAt(0)}
                    </Text>
                  </View>
                ) : (
                  <View style={s.avatarPlaceholder} />
                )}
              </View>
            )}

            <View
              style={[s.bubbleCol, isMine ? s.bubbleColRight : s.bubbleColLeft]}
            >
              {!isMine && showAvatar && item.sender_name && (
                <Text style={s.senderName}>{item.sender_name}</Text>
              )}

              <View
                style={[
                  s.bubbleRow,
                  isMine ? s.bubbleRowRight : s.bubbleRowLeft,
                ]}
              >
                {isMine && showTime && (
                  <Text style={[s.msgTime, { alignSelf: "flex-end", marginBottom: 3 }]}>
                    {fmtTime(item.created_at)}
                  </Text>
                )}

                <View
                  style={[
                    s.bubble,
                    isMine
                      ? [s.bubbleMine, { backgroundColor: PRIMARY }]
                      : s.bubbleOther,
                  ]}
                >
                  <Text
                    style={[
                      s.bubbleText,
                      isMine ? s.bubbleTextMine : s.bubbleTextOther,
                    ]}
                  >
                    {item.content}
                  </Text>
                </View>

                {!isMine && showTime && (
                  <Text style={[s.msgTime, { alignSelf: "flex-end", marginBottom: 3 }]}>
                    {fmtTime(item.created_at)}
                  </Text>
                )}
              </View>
            </View>
          </View>
        </>
      );
    },
    [talkMessages, myUserId]
  );

  /* ── 공지 탭 아이템 렌더 ── */
  const renderNoticeItem = useCallback(
    ({ item, index }: { item: WorkMessage; index: number }) => {
      const prevMsg = noticeMessages[index + 1];
      const showDateLine = !prevMsg || !sameDay(item.created_at, prevMsg.created_at);
      const isSystem = isSystemMsg(item);

      return (
        <>
          {showDateLine && (
            <View style={s.dateLine}>
              <View style={s.dateLineBar} />
              <Text style={s.dateLineText}>{fmtDate(item.created_at)}</Text>
              <View style={s.dateLineBar} />
            </View>
          )}

          {isSystem ? (
            /* 시스템 자동메시지: 중앙 배지 (수정 불가) */
            <View style={s.systemWrap}>
              <View style={s.systemBadge}>
                <Feather
                  name={item.message_type === "system_move" ? "shuffle" : "calendar"}
                  size={12}
                  color={AMBER_TEXT}
                  style={{ marginRight: 5 }}
                />
                <Text style={s.systemText}>{item.content}</Text>
              </View>
              <Text style={s.systemTime}>{fmtTime(item.created_at)}</Text>
            </View>
          ) : (
            /* 관리자 공지: 노란색 카드 */
            <View style={s.noticeCardWrap}>
              <View style={s.noticeCard}>
                <View style={s.noticeCardHeader}>
                  <Feather name="bell" size={13} color={AMBER_TEXT} />
                  <Text style={s.noticeCardSender}>
                    {item.sender_name || "관리자"}
                  </Text>
                  <Text style={s.noticeCardTime}>{fmtTime(item.created_at)}</Text>
                </View>
                <Text style={s.noticeCardContent}>{item.content}</Text>
              </View>
            </View>
          )}
        </>
      );
    },
    [noticeMessages]
  );

  const keyExtractor = useCallback(
    (item: WorkMessage) => String(item.id),
    []
  );

  /* 입력창 하단 패딩: 부모가 TAB_BAR_H + insets.bottom 처리 → 최소값만 */
  const inputPad = Platform.OS === "android" ? 6 : 4;

  /* ─── 렌더 ─────────────────────────────────────────────── */
  return (
    <KeyboardAvoidingView
      style={s.flex}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={0}
    >
      {/* ── 상단 세그먼트 탭 ── */}
      <View style={s.segBar}>
        <TouchableOpacity
          style={[s.segBtn, activeTab === "talk" && s.segBtnActive]}
          onPress={() => handleTabChange("talk")}
          activeOpacity={0.7}
        >
          <Text style={[s.segText, activeTab === "talk" && s.segTextActive]}>
            대화
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[s.segBtn, activeTab === "notice" && s.segBtnActive]}
          onPress={() => handleTabChange("notice")}
          activeOpacity={0.7}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Text style={[s.segText, activeTab === "notice" && s.segTextActive]}>
              공지
            </Text>
            {noticeUnread && <View style={s.unreadDot} />}
          </View>
        </TouchableOpacity>
      </View>

      {/* ══════════════════ 대화 탭 ══════════════════ */}
      {activeTab === "talk" && (
        <>
          {loading ? (
            <View style={s.center}>
              <ActivityIndicator color={PRIMARY} />
            </View>
          ) : (
            <FlatList
              data={talkMessages}
              keyExtractor={keyExtractor}
              renderItem={renderTalkItem}
              inverted
              contentContainerStyle={s.listContent}
              keyboardDismissMode="interactive"
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              style={s.flex}
            />
          )}

          {/* 대화 입력창 ─ 관리자 + 선생님 모두 */}
          <View style={[s.inputArea, { paddingBottom: inputPad }]}>
            <View style={s.inputRow}>
              <TouchableOpacity style={s.sideBtn} activeOpacity={0.7}>
                <Feather name="plus" size={22} color={C.textSecondary} />
              </TouchableOpacity>

              <TextInput
                ref={talkInputRef}
                style={s.textInput}
                value={talkInput}
                onChangeText={setTalkInput}
                placeholder="메시지 입력"
                placeholderTextColor={C.textSecondary}
                multiline
                maxLength={1000}
              />

              <TouchableOpacity style={s.sideBtn} activeOpacity={0.7}>
                <Feather name="smile" size={22} color={C.textSecondary} />
              </TouchableOpacity>

              <TouchableOpacity
                style={[s.sendBtn, { backgroundColor: PRIMARY }, talkInput.trim().length === 0 && s.sendBtnOff]}
                onPress={sendTalk}
                disabled={sending || talkInput.trim().length === 0}
                activeOpacity={0.7}
              >
                {sending ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Feather name="send" size={16} color="#fff" />
                )}
              </TouchableOpacity>
            </View>
          </View>
        </>
      )}

      {/* ══════════════════ 공지 탭 ══════════════════ */}
      {activeTab === "notice" && (
        <>
          {loading ? (
            <View style={s.center}>
              <ActivityIndicator color={PRIMARY} />
            </View>
          ) : noticeMessages.length === 0 ? (
            <View style={s.center}>
              <Feather name="bell-off" size={36} color={C.textSecondary} />
              <Text style={s.emptyText}>공지사항이 없습니다.</Text>
            </View>
          ) : (
            <FlatList
              data={noticeMessages}
              keyExtractor={keyExtractor}
              renderItem={renderNoticeItem}
              inverted
              contentContainerStyle={s.listContent}
              keyboardDismissMode="interactive"
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              style={s.flex}
            />
          )}

          {/* 공지 입력창 ─ 관리자만 / 선생님은 읽기전용 안내 */}
          {isAdmin ? (
            <View style={[s.inputArea, s.noticeInputArea, { paddingBottom: inputPad }]}>
              <View style={s.inputRow}>
                <TextInput
                  ref={noticeInputRef}
                  style={[s.textInput, s.noticeInput]}
                  value={noticeInput}
                  onChangeText={setNoticeInput}
                  placeholder="공지 내용 입력"
                  placeholderTextColor="#B45309"
                  multiline
                  maxLength={500}
                />
                <TouchableOpacity
                  style={[
                    s.sendBtn,
                    { backgroundColor: "#D97706" },
                    noticeInput.trim().length === 0 && s.sendBtnOff,
                  ]}
                  onPress={sendNotice}
                  disabled={sending || noticeInput.trim().length === 0}
                  activeOpacity={0.7}
                >
                  {sending ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Feather name="send" size={16} color="#fff" />
                  )}
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View style={s.readonlyBar}>
              <Feather name="lock" size={13} color={AMBER_TEXT} />
              <Text style={s.readonlyText}>관리자만 공지를 작성할 수 있습니다.</Text>
            </View>
          )}
        </>
      )}
    </KeyboardAvoidingView>
  );
}

/* ─── 공지 탭 색상 ──────────────────────────────────────── */
const YELLOW_BG = "#FFFBEB";
const YELLOW_BORDER = "#FDE68A";
const AMBER_SOFT = "#FEF3C7";
const AMBER_TEXT = "#92400E";

/* ─── 스타일 ─────────────────────────────────────────────── */
const s = StyleSheet.create({
  flex: { flex: 1 },

  /* ── 세그먼트 탭 ── */
  segBar: {
    flexDirection: "row",
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  segBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
  },
  segBtnActive: {
    borderBottomWidth: 2,
    borderBottomColor: PRIMARY,
  },
  segText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: C.textSecondary,
  },
  segTextActive: {
    color: PRIMARY,
    fontFamily: "Inter_600SemiBold",
  },
  unreadDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#EF4444",
    marginTop: -8,
  },

  /* ── 공통 ── */
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
  },
  emptyText: {
    fontSize: 14,
    color: C.textSecondary,
    fontFamily: "Inter_400Regular",
  },
  listContent: {
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 4,
    flexGrow: 1,
    justifyContent: "flex-end",
  },

  /* ── 날짜 구분선 ── */
  dateLine: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 12,
    gap: 8,
  },
  dateLineBar: { flex: 1, height: 1, backgroundColor: C.border },
  dateLineText: {
    fontSize: 11,
    color: C.textSecondary,
    fontFamily: "Inter_400Regular",
  },

  /* ══ 대화: 말풍선 ══ */
  msgRow: {
    flexDirection: "row",
    marginBottom: 2,
    alignItems: "flex-end",
  },
  msgRowLeft: { justifyContent: "flex-start" },
  msgRowRight: { justifyContent: "flex-end" },

  avatarCol: { width: 36, marginRight: 6, alignSelf: "flex-end" },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: "center",
    alignItems: "center",
  },
  avatarText: { color: "#fff", fontSize: 14, fontFamily: "Inter_700Bold" },
  avatarPlaceholder: { width: 34, height: 34 },

  senderName: {
    fontSize: 11,
    color: C.textSecondary,
    fontFamily: "Inter_400Regular",
    marginBottom: 2,
    marginLeft: 2,
  },

  bubbleCol: { maxWidth: "75%", flexDirection: "column" },
  bubbleColLeft: { alignItems: "flex-start" },
  bubbleColRight: { alignItems: "flex-end" },

  bubbleRow: { flexDirection: "row", alignItems: "flex-end", gap: 4 },
  bubbleRowLeft: { flexDirection: "row" },
  bubbleRowRight: { flexDirection: "row-reverse" },

  bubble: { borderRadius: 18, paddingHorizontal: 13, paddingVertical: 8 },
  bubbleMine: { borderBottomRightRadius: 4 },
  bubbleOther: {
    backgroundColor: "#fff",
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: C.border,
  },
  bubbleText: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: "Inter_400Regular",
  },
  bubbleTextMine: { color: "#fff" },
  bubbleTextOther: { color: C.text },

  msgTime: {
    fontSize: 10,
    color: C.textSecondary,
    fontFamily: "Inter_400Regular",
  },

  /* ══ 공지: 시스템 자동메시지 ══ */
  systemWrap: {
    alignItems: "center",
    marginVertical: 8,
    gap: 3,
  },
  systemBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: AMBER_SOFT,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: YELLOW_BORDER,
    maxWidth: "90%",
  },
  systemText: {
    fontSize: 12,
    color: AMBER_TEXT,
    fontFamily: "Inter_400Regular",
    flexShrink: 1,
  },
  systemTime: {
    fontSize: 10,
    color: C.textSecondary,
    fontFamily: "Inter_400Regular",
  },

  /* ══ 공지: 관리자 공지 카드 ══ */
  noticeCardWrap: { marginVertical: 6, paddingHorizontal: 4 },
  noticeCard: {
    backgroundColor: YELLOW_BG,
    borderWidth: 1,
    borderColor: YELLOW_BORDER,
    borderRadius: 12,
    padding: 12,
    gap: 6,
  },
  noticeCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  noticeCardSender: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: AMBER_TEXT,
    flex: 1,
  },
  noticeCardTime: {
    fontSize: 10,
    color: "#B45309",
    fontFamily: "Inter_400Regular",
  },
  noticeCardContent: {
    fontSize: 14,
    color: "#1C1917",
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
  },

  /* ══ 입력창 ══ */
  inputArea: {
    backgroundColor: "#F9FAFB",
    borderTopWidth: 1,
    borderTopColor: C.border,
    paddingTop: 8,
    paddingHorizontal: 8,
  },
  noticeInputArea: {
    backgroundColor: YELLOW_BG,
    borderTopColor: YELLOW_BORDER,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 6,
  },
  sideBtn: {
    width: 36,
    height: 38,
    justifyContent: "center",
    alignItems: "center",
  },
  textInput: {
    flex: 1,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingTop: Platform.OS === "ios" ? 9 : 7,
    paddingBottom: Platform.OS === "ios" ? 9 : 7,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: C.text,
    maxHeight: 120,
    minHeight: 38,
  },
  noticeInput: { borderColor: YELLOW_BORDER },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: "center",
    alignItems: "center",
  },
  sendBtnOff: { backgroundColor: C.border },

  /* 읽기전용 바 */
  readonlyBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    backgroundColor: AMBER_SOFT,
    borderTopWidth: 1,
    borderTopColor: YELLOW_BORDER,
  },
  readonlyText: {
    fontSize: 12,
    color: AMBER_TEXT,
    fontFamily: "Inter_400Regular",
  },
});
