/**
 * MessengerScreen.tsx — 업무 메신저 (대화/공지 2탭)
 *
 * 대화탭: 관리자+선생님 실시간 업무 채팅 (KakaoTalk 스타일)
 * 공지탭: 관리자 공지 + 이동/보강 시스템 메시지 (관리자만 작성)
 *
 * 키보드 처리: FlatList inverted + KeyboardAvoidingView (padding)
 */
import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Keyboard,
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
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";

const _DOMAIN = process.env.EXPO_PUBLIC_DOMAIN;
const API_BASE = process.env.EXPO_PUBLIC_API_URL || (_DOMAIN ? `https://${_DOMAIN}/api` : "/api");
const API_ORIGIN = API_BASE.replace(/\/api$/, "");

function photoUri(rawUrl: string): string {
  if (!rawUrl) return "";
  if (rawUrl.startsWith("http")) return rawUrl;
  return `${API_ORIGIN}${rawUrl}`;
}

const C = Colors.light;
type ChannelType = "talk" | "notice";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Message {
  id: string;
  sender_id: string;
  sender_name: string;
  sender_role: string;
  msg_type: "text" | "photo";
  channel_type: "talk" | "notice";
  message_type: "normal" | "notice" | "system_move" | "system_makeup";
  content?: string;
  photo_url?: string;
  member_transfer_id?: string;
  created_at: string;
  // member_transfer join columns (공지 탭에서도 표시용)
  student_id?: string;
  student_name?: string;
  from_user_name?: string;
  to_user_name?: string;
  transfer_status?: string;
}

interface Props {
  poolId: string;
  myUserId: string;
  myRole: "pool_admin" | "teacher";
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtTime(dateStr: string) {
  const d = new Date(dateStr);
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h < 12 ? "오전" : "오후";
  const hh = h % 12 === 0 ? 12 : h % 12;
  const mm = m.toString().padStart(2, "0");
  return `${ampm} ${hh}:${mm}`;
}

function fmtDate(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "short" });
}

function isSameDay(a: string, b: string) {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

function roleLabel(role: string) {
  if (role === "pool_admin") return "관리자";
  if (role === "teacher") return "선생님";
  return "";
}

function avatarLetter(name: string) {
  return name ? name.charAt(0) : "?";
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function MessengerScreen({ poolId, myUserId, myRole }: Props) {
  const { token } = useAuth();
  const { themeColor } = useBrand();
  const insets = useSafeAreaInsets();

  const [activeTab, setActiveTab] = useState<ChannelType>("talk");
  const [talkMessages, setTalkMessages] = useState<Message[]>([]);
  const [noticeMessages, setNoticeMessages] = useState<Message[]>([]);
  const [talkLoading, setTalkLoading] = useState(true);
  const [noticeLoading, setNoticeLoading] = useState(true);
  const [talkHasMore, setTalkHasMore] = useState(false);
  const [noticeHasMore, setNoticeHasMore] = useState(false);
  const [talkCursor, setTalkCursor] = useState<string | null>(null);
  const [noticeCursor, setNoticeCursor] = useState<string | null>(null);
  const [talkLoadingMore, setTalkLoadingMore] = useState(false);
  const [noticeLoadingMore, setNoticeLoadingMore] = useState(false);

  const [text, setText] = useState("");
  const [noticeText, setNoticeText] = useState("");
  const [sending, setSending] = useState(false);

  const [photoFile, setPhotoFile] = useState<{ uri: string; name: string; type: string } | null>(null);
  const [photoModalUri, setPhotoModalUri] = useState<string | null>(null);

  const [noticeUnread, setNoticeUnread] = useState(false);

  const talkListRef = useRef<FlatList>(null);
  const noticeListRef = useRef<FlatList>(null);

  const isAdmin = myRole === "pool_admin";

  // ── Data Loading ────────────────────────────────────────────────────────────

  const loadChannel = useCallback(async (channel: ChannelType, reset = true) => {
    if (!token || !poolId) return;
    const isLoading = channel === "talk" ? talkLoadingMore : noticeLoadingMore;
    if (!reset && isLoading) return;

    try {
      if (reset) {
        channel === "talk" ? setTalkLoading(true) : setNoticeLoading(true);
      } else {
        channel === "talk" ? setTalkLoadingMore(true) : setNoticeLoadingMore(true);
      }

      const cursor = !reset ? (channel === "talk" ? talkCursor : noticeCursor) : null;
      const cursorParam = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
      const r = await apiRequest(token, `/messenger/messages?pool_id=${poolId}&channel_type=${channel}${cursorParam}`);
      if (!r.ok) return;
      const data = await r.json();
      const incoming: Message[] = data.messages || [];

      if (channel === "talk") {
        if (reset) setTalkMessages(incoming);
        else setTalkMessages(prev => [...prev, ...incoming]);
        setTalkHasMore(data.hasMore || false);
        setTalkCursor(data.nextCursor || null);
      } else {
        if (reset) setNoticeMessages(incoming);
        else setNoticeMessages(prev => [...prev, ...incoming]);
        setNoticeHasMore(data.hasMore || false);
        setNoticeCursor(data.nextCursor || null);
      }
    } finally {
      channel === "talk" ? setTalkLoading(false) : setNoticeLoading(false);
      channel === "talk" ? setTalkLoadingMore(false) : setNoticeLoadingMore(false);
    }
  }, [token, poolId, talkCursor, noticeCursor, talkLoadingMore, noticeLoadingMore]);

  const checkNoticeUnread = useCallback(async () => {
    if (!token || !poolId) return;
    try {
      const r = await apiRequest(token, `/messenger/read-state?pool_id=${poolId}&channel_type=notice`);
      if (r.ok) {
        const data = await r.json();
        setNoticeUnread((data.unreadCount || 0) > 0);
      }
    } catch (_) {}
  }, [token, poolId]);

  const markNoticeRead = useCallback(async () => {
    if (!token || !poolId) return;
    try {
      await apiRequest(token, "/messenger/read-state", {
        method: "POST",
        body: JSON.stringify({ pool_id: poolId, channel_type: "notice" }),
      });
      setNoticeUnread(false);
    } catch (_) {}
  }, [token, poolId]);

  // 초기 로드
  useEffect(() => {
    loadChannel("talk", true);
    loadChannel("notice", true);
    checkNoticeUnread();
  }, [poolId, token]);

  // 탭 전환 시
  const handleTabSwitch = (tab: ChannelType) => {
    if (tab === activeTab) return;
    Keyboard.dismiss();
    setActiveTab(tab);
    if (tab === "notice") {
      markNoticeRead();
    }
  };

  // ── Send ─────────────────────────────────────────────────────────────────────

  const sendTalkText = async () => {
    const trimmed = text.trim();
    if (!trimmed || !token || !poolId) return;
    setSending(true);
    try {
      const r = await apiRequest(token, "/messenger/messages", {
        method: "POST",
        body: JSON.stringify({ pool_id: poolId, content: trimmed }),
      });
      if (r.ok) {
        const data = await r.json();
        setTalkMessages(prev => [data.message, ...prev]);
        setText("");
      }
    } finally {
      setSending(false);
    }
  };

  const sendTalkPhoto = async () => {
    if (!photoFile || !token || !poolId) return;
    setSending(true);
    try {
      const formData = new FormData();
      formData.append("pool_id", poolId);
      if (Platform.OS === "web") {
        const resp = await fetch(photoFile.uri);
        const blob = await resp.blob();
        formData.append("photo", blob, photoFile.name);
      } else {
        (formData as any).append("photo", { uri: photoFile.uri, name: photoFile.name, type: photoFile.type } as any);
      }
      const r = await apiRequest(token, "/messenger/messages/photo", { method: "POST", body: formData });
      if (r.ok) {
        const data = await r.json();
        setTalkMessages(prev => [data.message, ...prev]);
        setPhotoFile(null);
      }
    } finally {
      setSending(false);
    }
  };

  const sendNotice = async () => {
    const trimmed = noticeText.trim();
    if (!trimmed || !token || !poolId || !isAdmin) return;
    setSending(true);
    try {
      const r = await apiRequest(token, "/messenger/notice", {
        method: "POST",
        body: JSON.stringify({ pool_id: poolId, content: trimmed }),
      });
      if (r.ok) {
        const data = await r.json();
        setNoticeMessages(prev => [data.message, ...prev]);
        setNoticeText("");
      }
    } finally {
      setSending(false);
    }
  };

  const pickPhoto = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
      allowsEditing: false,
    });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      setPhotoFile({
        uri: asset.uri,
        name: asset.fileName || `photo_${Date.now()}.jpg`,
        type: asset.mimeType || "image/jpeg",
      });
    }
  };

  // ── Render Helpers ────────────────────────────────────────────────────────────

  const bottomPad = insets.bottom + (Platform.OS === "android" ? 8 : 4);

  // 대화 탭 메시지 아이템
  const renderTalkItem = ({ item, index }: { item: Message; index: number }) => {
    const isMe = item.sender_id === myUserId;
    const msgs = talkMessages;
    const nextItem = msgs[index - 1]; // inverted: index-1 is the newer item above
    const prevItem = msgs[index + 1]; // inverted: index+1 is the older item below

    // 날짜 구분선: 이 메시지와 이전(더 오래된) 메시지가 다른 날
    const showDateSep = !prevItem || !isSameDay(item.created_at, prevItem.created_at);
    // 같은 발신자가 연속일 때 아바타/이름 숨김 (위 = 더 오래된 메시지)
    const showAvatar = !prevItem || prevItem.sender_id !== item.sender_id || !isSameDay(item.created_at, prevItem.created_at);
    // 시간 표시: 다음(더 최신) 메시지가 없거나 발신자 다르거나 시간 다를 때
    const hideTime = nextItem && nextItem.sender_id === item.sender_id &&
      isSameDay(item.created_at, nextItem.created_at) &&
      fmtTime(item.created_at) === fmtTime(nextItem.created_at);

    return (
      <View>
        {showDateSep && (
          <View style={s.dateSep}>
            <Text style={s.dateSepText}>{fmtDate(item.created_at)}</Text>
          </View>
        )}

        {isMe ? (
          // ── 내 메시지 (오른쪽) ──
          <View style={s.myRow}>
            <View style={s.myMeta}>
              {!hideTime && <Text style={s.timeText}>{fmtTime(item.created_at)}</Text>}
            </View>
            <View style={s.myBubbleWrap}>
              {showAvatar && (
                <Text style={s.myName}>{item.sender_name}</Text>
              )}
              {item.photo_url ? (
                <Pressable onPress={() => setPhotoModalUri(item.photo_url!)}>
                  <Image
                    source={{ uri: photoUri(item.photo_url), headers: { Authorization: `Bearer ${token}` } }}
                    style={s.bubblePhoto}
                    resizeMode="cover"
                  />
                </Pressable>
              ) : (
                <View style={[s.myBubble, { backgroundColor: themeColor }]}>
                  <Text style={s.myBubbleText}>{item.content}</Text>
                </View>
              )}
            </View>
          </View>
        ) : (
          // ── 상대방 메시지 (왼쪽) ──
          <View style={s.theirRow}>
            <View style={s.avatarCol}>
              {showAvatar ? (
                <View style={[s.avatar, { backgroundColor: themeColor + "20" }]}>
                  <Text style={[s.avatarText, { color: themeColor }]}>{avatarLetter(item.sender_name)}</Text>
                </View>
              ) : (
                <View style={s.avatarPlaceholder} />
              )}
            </View>
            <View style={s.theirBubbleWrap}>
              {showAvatar && (
                <View style={s.theirHeader}>
                  <Text style={s.theirName}>{item.sender_name}</Text>
                  <Text style={s.theirRole}>{roleLabel(item.sender_role)}</Text>
                </View>
              )}
              {item.photo_url ? (
                <Pressable onPress={() => setPhotoModalUri(item.photo_url!)}>
                  <Image
                    source={{ uri: photoUri(item.photo_url), headers: { Authorization: `Bearer ${token}` } }}
                    style={s.bubblePhoto}
                    resizeMode="cover"
                  />
                </Pressable>
              ) : (
                <View style={s.theirBubble}>
                  <Text style={s.theirBubbleText}>{item.content}</Text>
                </View>
              )}
            </View>
            <View style={s.theirMeta}>
              {!hideTime && <Text style={s.timeText}>{fmtTime(item.created_at)}</Text>}
            </View>
          </View>
        )}
      </View>
    );
  };

  // 공지 탭 메시지 아이템
  const renderNoticeItem = ({ item, index }: { item: Message; index: number }) => {
    const msgs = noticeMessages;
    const prevItem = msgs[index + 1]; // inverted: older is higher index
    const showDateSep = !prevItem || !isSameDay(item.created_at, prevItem.created_at);
    const isSystem = item.message_type === "system_move" || item.message_type === "system_makeup";

    return (
      <View>
        {showDateSep && (
          <View style={s.dateSep}>
            <Text style={s.dateSepText}>{fmtDate(item.created_at)}</Text>
          </View>
        )}

        {isSystem ? (
          // 시스템 메시지: 중앙 가로 표시
          <View style={s.systemMsgWrap}>
            <View style={s.systemMsg}>
              <Feather
                name={item.message_type === "system_move" ? "arrow-right-circle" : "calendar"}
                size={13}
                color="#6B7280"
              />
              <Text style={s.systemMsgText}>{item.content}</Text>
            </View>
          </View>
        ) : (
          // 공지 메시지: 카드 스타일
          <View style={s.noticeCard}>
            <View style={s.noticeCardHeader}>
              <Feather name="bell" size={13} color={themeColor} />
              <Text style={[s.noticeCardSender, { color: themeColor }]}>{item.sender_name}</Text>
              <Text style={s.noticeCardRole}>{roleLabel(item.sender_role)}</Text>
              <Text style={s.noticeCardTime}>{fmtTime(item.created_at)}</Text>
            </View>
            <Text style={s.noticeCardContent}>{item.content}</Text>
          </View>
        )}
      </View>
    );
  };

  // ── Input Bars ────────────────────────────────────────────────────────────────

  const TalkInputBar = () => (
    <View style={[s.inputArea, { paddingBottom: bottomPad }]}>
      {photoFile && (
        <View style={s.photoPreviewWrap}>
          <Image source={{ uri: photoFile.uri }} style={s.photoPreview} />
          <Pressable style={s.photoRemove} onPress={() => setPhotoFile(null)}>
            <Feather name="x" size={14} color="#fff" />
          </Pressable>
        </View>
      )}
      <View style={s.inputRow}>
        <Pressable style={s.inputIconBtn} onPress={pickPhoto}>
          <Feather name="plus" size={22} color={photoFile ? themeColor : C.textSecondary} />
        </Pressable>
        <TextInput
          style={s.textInput}
          value={text}
          onChangeText={setText}
          placeholder="메시지를 입력하세요"
          placeholderTextColor={C.textSecondary}
          multiline
          maxLength={1000}
          returnKeyType="default"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Pressable
          style={[s.sendBtn, { backgroundColor: (photoFile || text.trim()) ? themeColor : C.border }]}
          onPress={photoFile ? sendTalkPhoto : sendTalkText}
          disabled={sending || (!photoFile && !text.trim())}
        >
          {sending
            ? <ActivityIndicator color="#fff" size={14} />
            : <Feather name="send" size={16} color="#fff" />
          }
        </Pressable>
      </View>
    </View>
  );

  const NoticeInputBar = () => (
    <View style={[s.inputArea, { paddingBottom: bottomPad }]}>
      <View style={s.inputRow}>
        <TextInput
          style={[s.textInput, { flex: 1 }]}
          value={noticeText}
          onChangeText={setNoticeText}
          placeholder="공지를 입력하세요"
          placeholderTextColor={C.textSecondary}
          multiline
          maxLength={1000}
          returnKeyType="default"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Pressable
          style={[s.sendBtn, { backgroundColor: noticeText.trim() ? themeColor : C.border }]}
          onPress={sendNotice}
          disabled={sending || !noticeText.trim()}
        >
          {sending
            ? <ActivityIndicator color="#fff" size={14} />
            : <Feather name="send" size={16} color="#fff" />
          }
        </Pressable>
      </View>
    </View>
  );

  // ── Layout ────────────────────────────────────────────────────────────────────

  return (
    <KeyboardAvoidingView
      style={s.flex}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={0}
    >
      {/* ── 상단 탭 (대화 / 공지) ── */}
      <View style={s.segmentBar}>
        <Pressable
          style={[s.segmentTab, activeTab === "talk" && { borderBottomColor: themeColor, borderBottomWidth: 2 }]}
          onPress={() => handleTabSwitch("talk")}
        >
          <Text style={[s.segmentTabText, activeTab === "talk" && { color: themeColor, fontFamily: "Inter_600SemiBold" }]}>
            대화
          </Text>
        </Pressable>
        <Pressable
          style={[s.segmentTab, activeTab === "notice" && { borderBottomColor: themeColor, borderBottomWidth: 2 }]}
          onPress={() => handleTabSwitch("notice")}
        >
          <View style={s.segmentTabInner}>
            <Text style={[s.segmentTabText, activeTab === "notice" && { color: themeColor, fontFamily: "Inter_600SemiBold" }]}>
              공지
            </Text>
            {noticeUnread && activeTab !== "notice" && (
              <View style={[s.unreadDot, { backgroundColor: "#EF4444" }]} />
            )}
          </View>
        </Pressable>
      </View>

      {/* ── 대화 탭 ── */}
      {activeTab === "talk" && (
        <>
          {talkLoading ? (
            <View style={s.loadingWrap}>
              <ActivityIndicator color={themeColor} />
            </View>
          ) : (
            <FlatList
              ref={talkListRef}
              style={s.flex}
              inverted
              data={talkMessages}
              keyExtractor={item => item.id}
              renderItem={renderTalkItem}
              contentContainerStyle={s.listContent}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
              onEndReached={() => {
                if (talkHasMore && !talkLoadingMore) loadChannel("talk", false);
              }}
              onEndReachedThreshold={0.3}
              ListFooterComponent={
                talkLoadingMore
                  ? <ActivityIndicator color={themeColor} style={{ margin: 16 }} />
                  : null
              }
              ListEmptyComponent={
                <View style={s.emptyWrap}>
                  <Feather name="message-circle" size={40} color={C.border} />
                  <Text style={s.emptyText}>아직 메시지가 없습니다</Text>
                  <Text style={s.emptySubText}>첫 번째 메시지를 보내보세요</Text>
                </View>
              }
            />
          )}
          <TalkInputBar />
        </>
      )}

      {/* ── 공지 탭 ── */}
      {activeTab === "notice" && (
        <>
          {noticeLoading ? (
            <View style={s.loadingWrap}>
              <ActivityIndicator color={themeColor} />
            </View>
          ) : (
            <FlatList
              ref={noticeListRef}
              style={s.flex}
              inverted
              data={noticeMessages}
              keyExtractor={item => item.id}
              renderItem={renderNoticeItem}
              contentContainerStyle={s.listContent}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
              onEndReached={() => {
                if (noticeHasMore && !noticeLoadingMore) loadChannel("notice", false);
              }}
              onEndReachedThreshold={0.3}
              ListFooterComponent={
                noticeLoadingMore
                  ? <ActivityIndicator color={themeColor} style={{ margin: 16 }} />
                  : null
              }
              ListEmptyComponent={
                <View style={s.emptyWrap}>
                  <Feather name="bell" size={40} color={C.border} />
                  <Text style={s.emptyText}>공지사항이 없습니다</Text>
                  <Text style={s.emptySubText}>이동/보강 소식이 여기에 표시됩니다</Text>
                </View>
              }
            />
          )}
          {isAdmin && <NoticeInputBar />}
          {!isAdmin && <View style={{ height: bottomPad }} />}
        </>
      )}

      {/* ── 사진 전체보기 모달 ── */}
      <Modal visible={!!photoModalUri} transparent animationType="fade">
        <Pressable style={s.photoModalBg} onPress={() => setPhotoModalUri(null)}>
          <Image
            source={{ uri: photoUri(photoModalUri || ""), headers: { Authorization: `Bearer ${token}` } }}
            style={s.photoModalImg}
            resizeMode="contain"
          />
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  flex: { flex: 1 },

  // ── Segment bar ──
  segmentBar: {
    flexDirection: "row",
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  segmentTab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: "center",
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  segmentTabInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  segmentTabText: {
    fontSize: 15,
    fontFamily: "Inter_500Medium",
    color: C.textSecondary,
  },
  unreadDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginLeft: 2,
    marginBottom: 6,
  },

  // ── List ──
  listContent: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexGrow: 1,
    justifyContent: "flex-end",
  },
  loadingWrap: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  emptyWrap: {
    alignItems: "center",
    paddingVertical: 60,
    gap: 8,
  },
  emptyText: {
    fontSize: 15,
    color: C.textSecondary,
    fontFamily: "Inter_500Medium",
  },
  emptySubText: {
    fontSize: 13,
    color: C.textSecondary,
    fontFamily: "Inter_400Regular",
  },

  // ── Date separator ──
  dateSep: {
    alignItems: "center",
    marginVertical: 12,
  },
  dateSepText: {
    fontSize: 12,
    color: C.textSecondary,
    fontFamily: "Inter_400Regular",
    backgroundColor: "#F3F4F6",
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
    overflow: "hidden",
  },

  // ── Talk: My messages (right) ──
  myRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "flex-end",
    marginBottom: 2,
    paddingLeft: 60,
  },
  myMeta: {
    alignItems: "flex-end",
    justifyContent: "flex-end",
    marginRight: 4,
    marginBottom: 2,
  },
  myBubbleWrap: {
    alignItems: "flex-end",
  },
  myName: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    color: C.textSecondary,
    marginBottom: 2,
  },
  myBubble: {
    borderRadius: 18,
    borderBottomRightRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 9,
    maxWidth: "100%",
  },
  myBubbleText: {
    fontSize: 15,
    color: "#fff",
    fontFamily: "Inter_400Regular",
    lineHeight: 21,
  },

  // ── Talk: Their messages (left) ──
  theirRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    marginBottom: 2,
    paddingRight: 60,
  },
  avatarCol: {
    width: 36,
    marginRight: 6,
    alignItems: "center",
    justifyContent: "flex-end",
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  avatarPlaceholder: {
    width: 36,
    height: 36,
  },
  theirBubbleWrap: {
    flex: 1,
  },
  theirHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 3,
  },
  theirName: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: C.text,
  },
  theirRole: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: C.textSecondary,
  },
  theirBubble: {
    backgroundColor: "#fff",
    borderRadius: 18,
    borderBottomLeftRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: C.border,
    alignSelf: "flex-start",
  },
  theirBubbleText: {
    fontSize: 15,
    color: C.text,
    fontFamily: "Inter_400Regular",
    lineHeight: 21,
  },
  theirMeta: {
    marginLeft: 4,
    justifyContent: "flex-end",
    paddingBottom: 2,
  },
  timeText: {
    fontSize: 11,
    color: C.textSecondary,
    fontFamily: "Inter_400Regular",
  },
  bubblePhoto: {
    width: 200,
    height: 160,
    borderRadius: 12,
    backgroundColor: C.border,
  },

  // ── Notice tab ──
  systemMsgWrap: {
    alignItems: "center",
    marginVertical: 6,
  },
  systemMsg: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "#F3F4F6",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    maxWidth: "90%",
  },
  systemMsgText: {
    fontSize: 12,
    color: "#6B7280",
    fontFamily: "Inter_400Regular",
    flex: 1,
    lineHeight: 17,
  },
  noticeCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
    marginVertical: 4,
  },
  noticeCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginBottom: 8,
  },
  noticeCardSender: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  noticeCardRole: {
    fontSize: 11,
    color: C.textSecondary,
    fontFamily: "Inter_400Regular",
  },
  noticeCardTime: {
    fontSize: 11,
    color: C.textSecondary,
    fontFamily: "Inter_400Regular",
    marginLeft: "auto",
  },
  noticeCardContent: {
    fontSize: 14,
    color: C.text,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
  },

  // ── Input area ──
  inputArea: {
    backgroundColor: "#F9FAFB",
    borderTopWidth: 1,
    borderTopColor: C.border,
    paddingTop: 8,
    paddingHorizontal: 8,
  },
  photoPreviewWrap: {
    position: "relative",
    marginBottom: 8,
    alignSelf: "flex-start",
  },
  photoPreview: {
    width: 80,
    height: 80,
    borderRadius: 8,
    backgroundColor: C.border,
  },
  photoRemove: {
    position: "absolute",
    top: -6,
    right: -6,
    backgroundColor: "#374151",
    borderRadius: 10,
    width: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 6,
  },
  inputIconBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 1,
  },
  textInput: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === "ios" ? 9 : 6,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: C.text,
    maxHeight: 120,
    minHeight: 38,
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 1,
  },

  // ── Photo modal ──
  photoModalBg: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.9)",
    justifyContent: "center",
    alignItems: "center",
  },
  photoModalImg: {
    width: "100%",
    height: "100%",
  },
});
