/**
 * MessengerScreen.tsx
 * 업무 메신저 — 대화/공지 2탭 + 업무 전달 도구 확장
 *
 * ▸ 대화 탭: 관리자+선생님 모두 카카오톡형 채팅 입력/전송
 *   - + 버튼: 파일 첨부 / 내 회원정보 올리기 메뉴
 *   - 참가인원 헤더 → 멤버 팝업 → 특정 멤버에게만 보내기
 *   - 회원정보 카드, 파일 첨부 메시지, 지정 메시지 렌더링
 * ▸ 공지 탭: 관리자만 작성 / 노란색 피드 / 자동메시지 수정불가
 *
 * 키보드: 부모가 paddingBottom = TAB_BAR_H + insets.bottom 처리 → KAV 정상 동작
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { useFocusEffect } from "expo-router";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";

const C = Colors.light;
const PRIMARY = C.tint;
const NOTICE_YELLOW_BG = "#FFFBEB";
const NOTICE_YELLOW_BORDER = "#FDE68A";
const AMBER_SOFT = "#FFF1BF";
const AMBER_TEXT = "#92400E";

/* ─── 타입 ──────────────────────────────────────────────── */
type ChannelType = "talk" | "notice";
type MsgType =
  | "normal"
  | "notice"
  | "system_move"
  | "system_makeup"
  | "member_profile_card"
  | "attachment_file"
  | "directed_message";

interface WorkMessage {
  id: number;
  pool_id: string;
  sender_id: string | null;
  sender_name: string | null;
  content: string;
  msg_type: string;
  channel_type: ChannelType;
  message_type: MsgType;
  extra_data?: Record<string, any> | null;
  created_at: string;
}

interface StaffMember {
  id: string;
  name: string;
  role: string;
  position?: string;
}

interface StudentMember {
  id: string;
  name: string;
  parent_phone: string;
  parent_name: string;
  class_name: string;
  schedule_days: string;
  schedule_time: string;
  teacher_user_id: string | null;
  teacher_name: string;
}

interface Props {
  poolId: string;
  myUserId: string;
  myRole: "pool_admin" | "teacher";
  /** iOS에서 KeyboardAvoidingView 위에 있는 헤더 높이(px). 입력창 가림 방지에 사용 */
  keyboardHeaderOffset?: number;
}

/* ─── 헬퍼 ──────────────────────────────────────────────── */
function fmtDate(iso: string): string {
  const d = new Date(iso);
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${days[d.getDay()]}요일`;
}
function fmtTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours(), m = d.getMinutes();
  return `${h < 12 ? "오전" : "오후"} ${h % 12 || 12}:${String(m).padStart(2, "0")}`;
}
function sameDay(a: string, b: string): boolean {
  return a.slice(0, 10) === b.slice(0, 10);
}

/* ─────────────────────────────────────────────────────────
   메인 컴포넌트
───────────────────────────────────────────────────────── */
export default function MessengerScreen({ poolId, myUserId, myRole, keyboardHeaderOffset = 0 }: Props) {
  const { token } = useAuth();
  const isAdmin = myRole === "pool_admin";

  /* ── 메시지 상태 ── */
  const [activeTab, setActiveTab] = useState<ChannelType>("talk");
  const [talkMessages, setTalkMessages] = useState<WorkMessage[]>([]);
  const [noticeMessages, setNoticeMessages] = useState<WorkMessage[]>([]);
  const [talkInput, setTalkInput] = useState("");
  const [noticeInput, setNoticeInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [noticeUnread, setNoticeUnread] = useState(false);

  /* ── 참가인원 상태 ── */
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [showStaffModal, setShowStaffModal] = useState(false);

  /* ── 지정 메시지 상태 ── */
  const [targetUser, setTargetUser] = useState<StaffMember | null>(null);

  /* ── 첨부 메뉴 상태 ── */
  const [showAttachMenu, setShowAttachMenu] = useState(false);

  /* ── 회원정보 카드 상태 ── */
  const [showStudentPicker, setShowStudentPicker] = useState(false);
  const [myStudents, setMyStudents] = useState<StudentMember[]>([]);
  const [loadingStudents, setLoadingStudents] = useState(false);

  /* ── 회원카드 상세 팝업 ── */
  const [selectedCard, setSelectedCard] = useState<Record<string, any> | null>(null);

  const talkInputRef = useRef<TextInput>(null);

  /* ── 데이터 로드 ── */
  const loadMessages = useCallback(async () => {
    if (!poolId || !token) return;
    try {
      const [talkRes, noticeRes, readRes, staffRes] = await Promise.all([
        apiRequest(token, `/messenger/messages?pool_id=${poolId}&channel_type=talk`),
        apiRequest(token, `/messenger/messages?pool_id=${poolId}&channel_type=notice`),
        apiRequest(token, `/messenger/read-state?pool_id=${poolId}`),
        apiRequest(token, `/messenger/staff?pool_id=${poolId}`),
      ]);
      if (talkRes.ok) {
        const d = await talkRes.json();
        setTalkMessages(Array.isArray(d.messages) ? d.messages : []);
      }
      if (noticeRes.ok) {
        const d = await noticeRes.json();
        setNoticeMessages(Array.isArray(d.messages) ? d.messages : []);
      }
      if (readRes.ok) {
        const d = await readRes.json();
        setNoticeUnread((d.unreadCount ?? d.unread_count ?? 0) > 0);
      }
      if (staffRes.ok) {
        const d = await staffRes.json();
        setStaff(Array.isArray(d.staff) ? d.staff : []);
      }
    } catch (e) {
      console.error("[messenger] load error", e);
    } finally {
      setLoading(false);
    }
  }, [poolId, token]);

  useEffect(() => { loadMessages(); }, [loadMessages]);

  /* ── 탭 이탈 시에만 지정 대상 초기화 ── */
  useFocusEffect(
    useCallback(() => {
      // 화면 진입 시 — 아무것도 하지 않음 (targetUser 유지)
      return () => {
        // 화면 이탈 시 (다른 하단 탭으로 이동) — 초기화
        setTargetUser(null);
      };
    }, [])
  );

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
      const body: Record<string, any> = {
        pool_id: poolId,
        content: text,
        channel_type: "talk",
        message_type: "normal",
      };
      if (targetUser) {
        body.target_user_id = targetUser.id;
        body.target_user_name = targetUser.name;
      }
      const res = await apiRequest(token, "/messenger/messages", {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const d = await res.json();
        if (d.message) setTalkMessages((prev) => [d.message, ...prev]);
      }
      setTalkInput("");
      // targetUser는 여기서 초기화하지 않음 — X 버튼 또는 탭 이탈 시에만 초기화
    } catch (e) {
      console.error("[messenger] sendTalk error", e);
    } finally {
      setSending(false);
    }
  }, [talkInput, sending, poolId, token, targetUser]);

  /* ── 공지 전송 ── */
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
        if (d.message) setNoticeMessages((prev) => [d.message, ...prev]);
      }
      setNoticeInput("");
    } catch (e) {
      console.error("[messenger] sendNotice error", e);
    } finally {
      setSending(false);
    }
  }, [noticeInput, sending, poolId, isAdmin, token]);

  /* ── + 버튼: 첨부 메뉴 열기 ── */
  const handlePlusBtn = useCallback(() => {
    Keyboard.dismiss();
    setShowAttachMenu(true);
  }, []);

  /* ── 파일 첨부 ── */
  const handleFileAttach = useCallback(async () => {
    setShowAttachMenu(false);
    if (!token) return;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];

      setSending(true);
      const formData = new FormData();
      formData.append("pool_id", poolId);
      formData.append("file", {
        uri: asset.uri,
        name: asset.name,
        type: asset.mimeType || "application/octet-stream",
      } as any);

      const res = await apiRequest(token, "/messenger/send-attachment", {
        method: "POST",
        headers: { "Content-Type": "multipart/form-data" },
        body: formData,
      });
      if (res.ok) {
        const d = await res.json();
        if (d.message) setTalkMessages((prev) => [d.message, ...prev]);
      } else {
        const d = await res.json();
        Alert.alert("오류", d.message || "파일 전송에 실패했습니다.");
      }
    } catch (e: any) {
      console.error("[messenger] fileAttach error", e);
      Alert.alert("오류", "파일 전송 중 문제가 발생했습니다.");
    } finally {
      setSending(false);
    }
  }, [poolId, token]);

  /* ── 내 회원정보 올리기 ── */
  const handleMemberCard = useCallback(async () => {
    setShowAttachMenu(false);
    if (!token) return;
    setLoadingStudents(true);
    try {
      const res = await apiRequest(token, `/messenger/my-students?pool_id=${poolId}`);
      if (res.ok) {
        const d = await res.json();
        const list = Array.isArray(d.students) ? d.students : [];
        setMyStudents(list);
        if (list.length === 0) {
          Alert.alert("담당 회원 없음", "현재 담당 중인 활성 회원이 없습니다.");
        } else {
          setShowStudentPicker(true);
        }
      }
    } catch (e) {
      console.error("[messenger] myStudents error", e);
    } finally {
      setLoadingStudents(false);
    }
  }, [poolId, token]);

  /* ── 회원 카드 전송 ── */
  const sendMemberCard = useCallback(
    async (student: StudentMember) => {
      setShowStudentPicker(false);
      if (!token) return;
      setSending(true);
      try {
        const res = await apiRequest(token, "/messenger/send-card", {
          method: "POST",
          body: JSON.stringify({ pool_id: poolId, student_id: student.id }),
        });
        if (res.ok) {
          const d = await res.json();
          if (d.message) setTalkMessages((prev) => [d.message, ...prev]);
        }
      } catch (e) {
        console.error("[messenger] sendCard error", e);
      } finally {
        setSending(false);
      }
    },
    [poolId, token]
  );

  /* ── 회원카드 클릭 ── */
  const handleCardPress = useCallback(
    (extra: Record<string, any>) => {
      const isAssignedTeacher = extra.teacher_user_id === myUserId;
      if (!isAssignedTeacher && !isAdmin) {
        Alert.alert("열람 제한", "담당 선생님만 상세 정보를 볼 수 있습니다.");
        return;
      }
      setSelectedCard(extra);
    },
    [myUserId, isAdmin]
  );

  /* ─────────────────────────────────────────────────────
     메시지 렌더러
  ───────────────────────────────────────────────────── */
  const renderTalkItem = useCallback(
    ({ item, index }: { item: WorkMessage; index: number }) => {
      const isMine = item.sender_id === myUserId;
      const prevMsg = talkMessages[index + 1];
      const nextMsg = talkMessages[index - 1];
      const showDateLine = !prevMsg || !sameDay(item.created_at, prevMsg.created_at);
      const showAvatar = !isMine && (!nextMsg || nextMsg.sender_id !== item.sender_id || !sameDay(item.created_at, nextMsg.created_at));
      const showTime = !nextMsg || nextMsg.sender_id !== item.sender_id || fmtTime(item.created_at) !== fmtTime(nextMsg.created_at);
      const extra = item.extra_data || {};

      /* 시스템 타입 처리 */
      if (item.message_type === "member_profile_card") {
        return (
          <>
            {showDateLine && <DateLine iso={item.created_at} />}
            <MemberCardBubble
              isMine={isMine}
              extra={extra}
              senderName={item.sender_name}
              time={fmtTime(item.created_at)}
              showTime={showTime}
              showAvatar={showAvatar}
              onPress={() => handleCardPress(extra)}
            />
          </>
        );
      }

      if (item.message_type === "attachment_file") {
        return (
          <>
            {showDateLine && <DateLine iso={item.created_at} />}
            <AttachFileBubble
              isMine={isMine}
              extra={extra}
              senderName={item.sender_name}
              time={fmtTime(item.created_at)}
              showTime={showTime}
              showAvatar={showAvatar}
            />
          </>
        );
      }

      /* 일반/지정 텍스트 메시지 */
      const isDirected = item.message_type === "directed_message";
      return (
        <>
          {showDateLine && <DateLine iso={item.created_at} />}
          <View style={[s.msgRow, isMine ? s.msgRowRight : s.msgRowLeft]}>
            {!isMine && (
              <View style={s.avatarCol}>
                {showAvatar ? (
                  <View style={[s.avatar, { backgroundColor: PRIMARY }]}>
                    <Text style={s.avatarText}>{(item.sender_name || "?").charAt(0)}</Text>
                  </View>
                ) : (
                  <View style={s.avatarPlaceholder} />
                )}
              </View>
            )}
            <View style={[s.bubbleCol, isMine ? s.bubbleColRight : s.bubbleColLeft]}>
              {!isMine && showAvatar && item.sender_name && (
                <Text style={s.senderName}>{item.sender_name}</Text>
              )}
              {isDirected && (
                <View style={[s.directedTag, isMine ? s.directedTagRight : s.directedTagLeft]}>
                  <Feather name="at-sign" size={10} color="#6B7280" />
                  <Text style={s.directedTagText}>
                    {isMine
                      ? `${extra.target_user_name}에게만`
                      : "나에게만"}
                  </Text>
                </View>
              )}
              <View style={[s.bubbleRow, isMine ? s.bubbleRowRight : s.bubbleRowLeft]}>
                {isMine && showTime && (
                  <Text style={[s.msgTime, { alignSelf: "flex-end", marginBottom: 3 }]}>{fmtTime(item.created_at)}</Text>
                )}
                <View style={[s.bubble, isMine ? [s.bubbleMine, { backgroundColor: PRIMARY }] : s.bubbleOther]}>
                  <Text style={[s.bubbleText, isMine ? s.bubbleTextMine : s.bubbleTextOther]}>
                    {item.content}
                  </Text>
                </View>
                {!isMine && showTime && (
                  <Text style={[s.msgTime, { alignSelf: "flex-end", marginBottom: 3 }]}>{fmtTime(item.created_at)}</Text>
                )}
              </View>
            </View>
          </View>
        </>
      );
    },
    [talkMessages, myUserId, handleCardPress]
  );

  const renderNoticeItem = useCallback(
    ({ item, index }: { item: WorkMessage; index: number }) => {
      const prevMsg = noticeMessages[index + 1];
      const showDateLine = !prevMsg || !sameDay(item.created_at, prevMsg.created_at);
      const isSystem = item.message_type === "system_move" || item.message_type === "system_makeup";

      return (
        <>
          {showDateLine && <DateLine iso={item.created_at} />}
          {isSystem ? (
            <View style={s.systemWrap}>
              <View style={s.systemBadge}>
                <Feather name={item.message_type === "system_move" ? "shuffle" : "calendar"} size={12} color={AMBER_TEXT} style={{ marginRight: 5 }} />
                <Text style={s.systemText}>{item.content}</Text>
              </View>
              <Text style={s.systemTime}>{fmtTime(item.created_at)}</Text>
            </View>
          ) : (
            <View style={s.noticeCardWrap}>
              <View style={s.noticeCard}>
                <View style={s.noticeCardHeader}>
                  <Feather name="bell" size={13} color={AMBER_TEXT} />
                  <Text style={s.noticeCardSender}>{item.sender_name || "관리자"}</Text>
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

  const keyExtractor = useCallback((item: WorkMessage) => String(item.id), []);
  const inputPad = Platform.OS === "android" ? 6 : 4;

  /* ─── 렌더 ────────────────────────────────────────────── */
  return (
    <KeyboardAvoidingView
      style={s.flex}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? keyboardHeaderOffset : 0}
    >
      {/* ── 상단 세그먼트 탭 + 참가인원 ── */}
      <View style={s.topBar}>
        <View style={s.segBar}>
          <TouchableOpacity
            style={[s.segBtn, activeTab === "talk" && s.segBtnActive]}
            onPress={() => handleTabChange("talk")}
            activeOpacity={0.7}
          >
            <Text style={[s.segText, activeTab === "talk" && s.segTextActive]}>대화</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.segBtn, activeTab === "notice" && s.segBtnActive]}
            onPress={() => handleTabChange("notice")}
            activeOpacity={0.7}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Text style={[s.segText, activeTab === "notice" && s.segTextActive]}>공지</Text>
              {noticeUnread && <View style={s.unreadDot} />}
            </View>
          </TouchableOpacity>
        </View>
        {/* 참가인원 버튼 */}
        <TouchableOpacity style={s.staffBtn} onPress={() => setShowStaffModal(true)} activeOpacity={0.7}>
          <Feather name="users" size={13} color={C.textSecondary} />
          <Text style={s.staffCount}>{staff.length}명</Text>
        </TouchableOpacity>
      </View>

      {/* ══════════════════ 대화 탭 ══════════════════ */}
      {activeTab === "talk" && (
        <>
          {loading ? (
            <View style={s.center}><ActivityIndicator color={PRIMARY} /></View>
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

          {/* 지정 메시지 대상 표시 */}
          {targetUser && (
            <View style={s.targetBadge}>
              <Feather name="at-sign" size={13} color={PRIMARY} />
              <Text style={s.targetBadgeText}>{targetUser.name}에게만 보냄</Text>
              <TouchableOpacity onPress={() => setTargetUser(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Feather name="x" size={14} color={C.textSecondary} />
              </TouchableOpacity>
            </View>
          )}

          {/* 대화 입력창 */}
          <View style={[s.inputArea, { paddingBottom: inputPad }]}>
            <View style={s.inputRow}>
              <TouchableOpacity style={s.sideBtn} onPress={handlePlusBtn} activeOpacity={0.7}>
                {loadingStudents ? (
                  <ActivityIndicator size="small" color={C.textSecondary} />
                ) : (
                  <Feather name="plus" size={22} color={PRIMARY} />
                )}
              </TouchableOpacity>
              <TextInput
                ref={talkInputRef}
                style={s.textInput}
                value={talkInput}
                onChangeText={setTalkInput}
                placeholder={targetUser ? `${targetUser.name}에게 메시지 입력` : "메시지 입력"}
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
                {sending ? <ActivityIndicator size="small" color="#fff" /> : <Feather name="send" size={16} color="#fff" />}
              </TouchableOpacity>
            </View>
          </View>
        </>
      )}

      {/* ══════════════════ 공지 탭 ══════════════════ */}
      {activeTab === "notice" && (
        <>
          {loading ? (
            <View style={s.center}><ActivityIndicator color={PRIMARY} /></View>
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
          {isAdmin ? (
            <View style={[s.inputArea, s.noticeInputArea, { paddingBottom: inputPad }]}>
              <View style={s.inputRow}>
                <TextInput
                  style={[s.textInput, s.noticeInput]}
                  value={noticeInput}
                  onChangeText={setNoticeInput}
                  placeholder="공지 내용 입력"
                  placeholderTextColor="#B45309"
                  multiline
                  maxLength={500}
                />
                <TouchableOpacity
                  style={[s.sendBtn, { backgroundColor: "#D97706" }, noticeInput.trim().length === 0 && s.sendBtnOff]}
                  onPress={sendNotice}
                  disabled={sending || noticeInput.trim().length === 0}
                  activeOpacity={0.7}
                >
                  {sending ? <ActivityIndicator size="small" color="#fff" /> : <Feather name="send" size={16} color="#fff" />}
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

      {/* ══════════════════ 첨부 메뉴 시트 ══════════════════ */}
      <Modal transparent visible={showAttachMenu} animationType="fade" onRequestClose={() => setShowAttachMenu(false)}>
        <Pressable style={s.backdrop} onPress={() => setShowAttachMenu(false)}>
          <Pressable style={s.attachSheet} onPress={() => {}}>
            <View style={s.sheetHandle} />
            <Text style={s.sheetTitle}>첨부</Text>
            <TouchableOpacity style={s.sheetItem} onPress={handleFileAttach} activeOpacity={0.7}>
              <View style={[s.sheetIcon, { backgroundColor: "#E6FFFA" }]}>
                <Feather name="paperclip" size={22} color="#4EA7D8" />
              </View>
              <View style={s.sheetItemText}>
                <Text style={s.sheetItemLabel}>파일 첨부</Text>
                <Text style={s.sheetItemSub}>이미지, 문서 파일 전송</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity style={s.sheetItem} onPress={handleMemberCard} activeOpacity={0.7}>
              <View style={[s.sheetIcon, { backgroundColor: "#DFF3EC" }]}>
                <Feather name="user" size={22} color="#2E9B6F" />
              </View>
              <View style={s.sheetItemText}>
                <Text style={s.sheetItemLabel}>내 회원정보 올리기</Text>
                <Text style={s.sheetItemSub}>담당 회원 정보 카드 공유</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity style={[s.sheetItem, { marginTop: 4 }]} onPress={() => setShowAttachMenu(false)} activeOpacity={0.7}>
              <Text style={[s.sheetItemLabel, { color: C.textSecondary, textAlign: "center", flex: 1 }]}>취소</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ══════════════════ 회원 선택 팝업 ══════════════════ */}
      <Modal transparent visible={showStudentPicker} animationType="slide" onRequestClose={() => setShowStudentPicker(false)}>
        <Pressable style={s.backdrop} onPress={() => setShowStudentPicker(false)}>
          <Pressable style={s.modalSheet} onPress={() => {}}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>회원 선택</Text>
              <TouchableOpacity onPress={() => setShowStudentPicker(false)}>
                <Feather name="x" size={20} color={C.text} />
              </TouchableOpacity>
            </View>
            <Text style={s.modalSub}>정보를 공유할 회원을 선택하세요</Text>
            <ScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false}>
              {myStudents.map((st) => (
                <TouchableOpacity
                  key={st.id}
                  style={s.studentRow}
                  onPress={() => sendMemberCard(st)}
                  activeOpacity={0.7}
                >
                  <View style={s.studentAvatar}>
                    <Text style={s.studentAvatarText}>{st.name.charAt(0)}</Text>
                  </View>
                  <View style={s.studentInfo}>
                    <Text style={s.studentName}>{st.name}</Text>
                    <Text style={s.studentMeta}>
                      {st.class_name || "미배정"} {st.schedule_days && `· ${st.schedule_days}`}
                    </Text>
                  </View>
                  <Feather name="send" size={16} color={PRIMARY} />
                </TouchableOpacity>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ══════════════════ 참가인원 팝업 ══════════════════ */}
      <Modal transparent visible={showStaffModal} animationType="slide" onRequestClose={() => setShowStaffModal(false)}>
        <Pressable style={s.backdrop} onPress={() => setShowStaffModal(false)}>
          <Pressable style={s.modalSheet} onPress={() => {}}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>참가인원 {staff.length}명</Text>
              <TouchableOpacity onPress={() => setShowStaffModal(false)}>
                <Feather name="x" size={20} color={C.text} />
              </TouchableOpacity>
            </View>
            <Text style={s.modalSub}>메시지를 보낼 대상을 선택하면 지정 메시지를 보낼 수 있습니다.</Text>
            <ScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false}>
              {staff.map((member) => {
                const isMe = member.id === myUserId;
                const isSelected = targetUser?.id === member.id;
                return (
                  <TouchableOpacity
                    key={member.id}
                    style={[s.staffRow, isSelected && s.staffRowSelected]}
                    onPress={() => {
                      if (!isMe) {
                        setTargetUser(isSelected ? null : member);
                      }
                      setShowStaffModal(false);
                    }}
                    activeOpacity={0.7}
                    disabled={isMe}
                  >
                    <View style={[s.staffAvatar, { backgroundColor: member.role === "pool_admin" ? C.tintLight : "#E0F2FE" }]}>
                      <Text style={[s.staffAvatarText, { color: member.role === "pool_admin" ? PRIMARY : "#0369A1" }]}>
                        {member.name.charAt(0)}
                      </Text>
                    </View>
                    <View style={s.staffInfoCol}>
                      <Text style={s.staffName}>{member.name}{isMe ? " (나)" : ""}</Text>
                      <Text style={s.staffRole}>{member.role === "pool_admin" ? "관리자" : "선생님"}{member.position ? ` · ${member.position}` : ""}</Text>
                    </View>
                    {isSelected && <Feather name="check-circle" size={18} color={PRIMARY} />}
                    {!isMe && !isSelected && <Feather name="at-sign" size={16} color={C.textSecondary} />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ══════════════════ 회원카드 상세 팝업 ══════════════════ */}
      <Modal transparent visible={!!selectedCard} animationType="fade" onRequestClose={() => setSelectedCard(null)}>
        <Pressable style={s.backdrop} onPress={() => setSelectedCard(null)}>
          <Pressable style={s.cardDetailSheet} onPress={() => {}}>
            {selectedCard && (
              <>
                <View style={s.modalHeader}>
                  <Text style={s.modalTitle}>회원 상세 정보</Text>
                  <TouchableOpacity onPress={() => setSelectedCard(null)}>
                    <Feather name="x" size={20} color={C.text} />
                  </TouchableOpacity>
                </View>
                <View style={s.cardDetailBody}>
                  <View style={s.cardDetailAvatar}>
                    <Text style={s.cardDetailAvatarText}>{(selectedCard.member_name || "?").charAt(0)}</Text>
                  </View>
                  <Text style={s.cardDetailName}>{selectedCard.member_name}</Text>
                  <View style={s.cardDetailRows}>
                    <DetailRow icon="layers" label="반" value={selectedCard.class_name || "미배정"} />
                    <DetailRow icon="calendar" label="수업일" value={selectedCard.schedule_days || "-"} />
                    <DetailRow icon="clock" label="수업시간" value={selectedCard.schedule_time || "-"} />
                    <DetailRow icon="phone" label="보호자 연락처" value={selectedCard.parent_phone || "-"} />
                    <DetailRow icon="user" label="담당 선생님" value={selectedCard.teacher_name || "-"} />
                  </View>
                </View>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

/* ─── 서브 컴포넌트: 날짜 구분선 ──────────────────────────── */
function DateLine({ iso }: { iso: string }) {
  const d = new Date(iso);
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  const label = `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${days[d.getDay()]}요일`;
  return (
    <View style={s.dateLine}>
      <View style={s.dateLineBar} />
      <Text style={s.dateLineText}>{label}</Text>
      <View style={s.dateLineBar} />
    </View>
  );
}

/* ─── 서브 컴포넌트: 회원정보 카드 버블 ──────────────────── */
function MemberCardBubble({
  isMine, extra, senderName, time, showTime, showAvatar, onPress,
}: {
  isMine: boolean;
  extra: Record<string, any>;
  senderName: string | null;
  time: string;
  showTime: boolean;
  showAvatar: boolean;
  onPress: () => void;
}) {
  return (
    <View style={[s.msgRow, isMine ? s.msgRowRight : s.msgRowLeft]}>
      {!isMine && (
        <View style={s.avatarCol}>
          {showAvatar ? (
            <View style={[s.avatar, { backgroundColor: PRIMARY }]}>
              <Text style={s.avatarText}>{(senderName || "?").charAt(0)}</Text>
            </View>
          ) : <View style={s.avatarPlaceholder} />}
        </View>
      )}
      <View style={[s.bubbleCol, isMine ? s.bubbleColRight : s.bubbleColLeft]}>
        {!isMine && showAvatar && senderName && (
          <Text style={s.senderName}>{senderName}</Text>
        )}
        <View style={[s.bubbleRow, isMine ? s.bubbleRowRight : s.bubbleRowLeft]}>
          {isMine && showTime && <Text style={[s.msgTime, { alignSelf: "flex-end", marginBottom: 3 }]}>{time}</Text>}
          <TouchableOpacity onPress={onPress} activeOpacity={0.8}>
            <View style={s.memberCard}>
              <View style={s.memberCardHeader}>
                <View style={s.memberCardIcon}>
                  <Feather name="user" size={14} color={PRIMARY} />
                </View>
                <Text style={s.memberCardLabel}>회원정보 카드</Text>
              </View>
              <Text style={s.memberCardName}>{extra.member_name || "-"}</Text>
              <View style={s.memberCardRow}>
                <Feather name="layers" size={11} color={C.textSecondary} />
                <Text style={s.memberCardMeta}>{extra.class_name || "미배정"}</Text>
              </View>
              {extra.schedule_days && (
                <View style={s.memberCardRow}>
                  <Feather name="calendar" size={11} color={C.textSecondary} />
                  <Text style={s.memberCardMeta}>{extra.schedule_days} {extra.schedule_time}</Text>
                </View>
              )}
              <View style={s.memberCardRow}>
                <Feather name="phone" size={11} color={C.textSecondary} />
                <Text style={s.memberCardMeta}>{extra.parent_phone || "-"}</Text>
              </View>
              <Text style={s.memberCardTap}>탭하여 상세 보기</Text>
            </View>
          </TouchableOpacity>
          {!isMine && showTime && <Text style={[s.msgTime, { alignSelf: "flex-end", marginBottom: 3 }]}>{time}</Text>}
        </View>
      </View>
    </View>
  );
}

/* ─── 서브 컴포넌트: 파일 첨부 버블 ──────────────────────── */
function AttachFileBubble({
  isMine, extra, senderName, time, showTime, showAvatar,
}: {
  isMine: boolean;
  extra: Record<string, any>;
  senderName: string | null;
  time: string;
  showTime: boolean;
  showAvatar: boolean;
}) {
  const ext = (extra.attachment_name || "").split(".").pop()?.toUpperCase() || "FILE";
  const isImage = ["JPG","JPEG","PNG","GIF","WEBP","HEIC"].includes(ext);
  return (
    <View style={[s.msgRow, isMine ? s.msgRowRight : s.msgRowLeft]}>
      {!isMine && (
        <View style={s.avatarCol}>
          {showAvatar ? (
            <View style={[s.avatar, { backgroundColor: PRIMARY }]}>
              <Text style={s.avatarText}>{(senderName || "?").charAt(0)}</Text>
            </View>
          ) : <View style={s.avatarPlaceholder} />}
        </View>
      )}
      <View style={[s.bubbleCol, isMine ? s.bubbleColRight : s.bubbleColLeft]}>
        {!isMine && showAvatar && senderName && (
          <Text style={s.senderName}>{senderName}</Text>
        )}
        <View style={[s.bubbleRow, isMine ? s.bubbleRowRight : s.bubbleRowLeft]}>
          {isMine && showTime && <Text style={[s.msgTime, { alignSelf: "flex-end", marginBottom: 3 }]}>{time}</Text>}
          <View style={s.fileCard}>
            <View style={[s.fileIconBox, { backgroundColor: isImage ? "#E6FFFA" : "#F1F5F9" }]}>
              <Feather name={isImage ? "image" : "file"} size={20} color={isImage ? "#4EA7D8" : C.textSecondary} />
            </View>
            <View style={s.fileInfo}>
              <Text style={s.fileName} numberOfLines={1}>{extra.attachment_name || "파일"}</Text>
              <Text style={s.fileExt}>{ext}</Text>
            </View>
          </View>
          {!isMine && showTime && <Text style={[s.msgTime, { alignSelf: "flex-end", marginBottom: 3 }]}>{time}</Text>}
        </View>
      </View>
    </View>
  );
}

/* ─── 서브 컴포넌트: 상세 행 ──────────────────────────────── */
function DetailRow({ icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <View style={s.detailRow}>
      <Feather name={icon} size={13} color={C.textSecondary} />
      <Text style={s.detailLabel}>{label}</Text>
      <Text style={s.detailValue}>{value}</Text>
    </View>
  );
}

/* ─── 스타일 ──────────────────────────────────────────────── */
const s = StyleSheet.create({
  flex: { flex: 1 },

  /* 상단 탭+참가인원 바 */
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  segBar: { flexDirection: "row", flex: 1 },
  segBtn: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 12 },
  segBtnActive: { borderBottomWidth: 2, borderBottomColor: PRIMARY },
  segText: { fontSize: 14, fontFamily: "Inter_400Regular", color: C.textSecondary },
  segTextActive: { color: PRIMARY, fontFamily: "Inter_600SemiBold" },
  unreadDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#D96C6C", marginTop: -8 },
  staffBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderLeftWidth: 1,
    borderLeftColor: C.border,
  },
  staffCount: { fontSize: 12, color: C.textSecondary, fontFamily: "Inter_400Regular" },

  /* 공통 */
  center: { flex: 1, justifyContent: "center", alignItems: "center", gap: 12 },
  emptyText: { fontSize: 14, color: C.textSecondary, fontFamily: "Inter_400Regular" },
  listContent: { paddingHorizontal: 12, paddingTop: 12, paddingBottom: 4, flexGrow: 1, justifyContent: "flex-end" },

  /* 날짜 구분선 */
  dateLine: { flexDirection: "row", alignItems: "center", marginVertical: 12, gap: 8 },
  dateLineBar: { flex: 1, height: 1, backgroundColor: C.border },
  dateLineText: { fontSize: 11, color: C.textSecondary, fontFamily: "Inter_400Regular" },

  /* 대화 말풍선 */
  msgRow: { flexDirection: "row", marginBottom: 2, alignItems: "flex-end" },
  msgRowLeft: { justifyContent: "flex-start" },
  msgRowRight: { justifyContent: "flex-end" },
  avatarCol: { width: 36, marginRight: 6, alignSelf: "flex-end" },
  avatar: { width: 34, height: 34, borderRadius: 17, justifyContent: "center", alignItems: "center" },
  avatarText: { color: "#fff", fontSize: 14, fontFamily: "Inter_700Bold" },
  avatarPlaceholder: { width: 34, height: 34 },
  senderName: { fontSize: 11, color: C.textSecondary, fontFamily: "Inter_400Regular", marginBottom: 2, marginLeft: 2 },
  bubbleCol: { maxWidth: "75%", flexDirection: "column" },
  bubbleColLeft: { alignItems: "flex-start" },
  bubbleColRight: { alignItems: "flex-end" },
  bubbleRow: { flexDirection: "row", alignItems: "flex-end", gap: 4 },
  bubbleRowLeft: { flexDirection: "row" },
  bubbleRowRight: { flexDirection: "row-reverse" },
  bubble: { borderRadius: 18, paddingHorizontal: 13, paddingVertical: 8 },
  bubbleMine: { borderBottomRightRadius: 4 },
  bubbleOther: { backgroundColor: "#fff", borderBottomLeftRadius: 4, borderWidth: 1, borderColor: C.border },
  bubbleText: { fontSize: 14, lineHeight: 20, fontFamily: "Inter_400Regular" },
  bubbleTextMine: { color: "#fff" },
  bubbleTextOther: { color: C.text },
  msgTime: { fontSize: 10, color: C.textSecondary, fontFamily: "Inter_400Regular" },

  /* 지정 메시지 태그 */
  directedTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "#F8FAFC",
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 2,
    marginBottom: 3,
    alignSelf: "flex-start",
  },
  directedTagRight: { alignSelf: "flex-end" },
  directedTagLeft: { alignSelf: "flex-start" },
  directedTagText: { fontSize: 10, color: C.textSecondary, fontFamily: "Inter_400Regular" },

  /* 공지 탭 */
  systemWrap: { alignItems: "center", marginVertical: 8, gap: 3 },
  systemBadge: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: AMBER_SOFT, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 5,
    borderWidth: 1, borderColor: NOTICE_YELLOW_BORDER, maxWidth: "90%",
  },
  systemText: { fontSize: 12, color: AMBER_TEXT, fontFamily: "Inter_400Regular", flexShrink: 1 },
  systemTime: { fontSize: 10, color: C.textSecondary, fontFamily: "Inter_400Regular" },
  noticeCardWrap: { marginVertical: 6, paddingHorizontal: 4 },
  noticeCard: { backgroundColor: NOTICE_YELLOW_BG, borderWidth: 1, borderColor: NOTICE_YELLOW_BORDER, borderRadius: 12, padding: 12, gap: 6 },
  noticeCardHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  noticeCardSender: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: AMBER_TEXT, flex: 1 },
  noticeCardTime: { fontSize: 10, color: "#B45309", fontFamily: "Inter_400Regular" },
  noticeCardContent: { fontSize: 14, color: "#1C1917", fontFamily: "Inter_400Regular", lineHeight: 20 },

  /* 회원정보 카드 */
  memberCard: {
    backgroundColor: "#fff",
    borderWidth: 1.5,
    borderColor: C.tintLight,
    borderRadius: 14,
    padding: 12,
    minWidth: 200,
    gap: 5,
  },
  memberCardHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 },
  memberCardIcon: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: C.tintLight, justifyContent: "center", alignItems: "center",
  },
  memberCardLabel: { fontSize: 11, color: PRIMARY, fontFamily: "Inter_600SemiBold" },
  memberCardName: { fontSize: 16, color: C.text, fontFamily: "Inter_700Bold" },
  memberCardRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  memberCardMeta: { fontSize: 12, color: C.textSecondary, fontFamily: "Inter_400Regular" },
  memberCardTap: { fontSize: 10, color: C.textMuted, fontFamily: "Inter_400Regular", marginTop: 4, textAlign: "right" },

  /* 파일 카드 */
  fileCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    padding: 10,
    gap: 10,
    minWidth: 180,
    maxWidth: 240,
  },
  fileIconBox: { width: 40, height: 40, borderRadius: 8, justifyContent: "center", alignItems: "center" },
  fileInfo: { flex: 1 },
  fileName: { fontSize: 13, color: C.text, fontFamily: "Inter_500Medium" },
  fileExt: { fontSize: 11, color: C.textSecondary, fontFamily: "Inter_400Regular", marginTop: 2 },

  /* 지정 메시지 대상 배지 */
  targetBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 6,
    backgroundColor: C.tintLight,
    borderTopWidth: 1,
    borderTopColor: C.tintLight,
  },
  targetBadgeText: { flex: 1, fontSize: 12, color: PRIMARY, fontFamily: "Inter_500Medium" },

  /* 입력창 */
  inputArea: { backgroundColor: "#F1F5F9", borderTopWidth: 1, borderTopColor: C.border, paddingTop: 8, paddingHorizontal: 8 },
  noticeInputArea: { backgroundColor: NOTICE_YELLOW_BG, borderTopColor: NOTICE_YELLOW_BORDER },
  inputRow: { flexDirection: "row", alignItems: "flex-end", gap: 6 },
  sideBtn: { width: 36, height: 38, justifyContent: "center", alignItems: "center" },
  textInput: {
    flex: 1, backgroundColor: "#fff", borderWidth: 1, borderColor: C.border, borderRadius: 20,
    paddingHorizontal: 14, paddingTop: Platform.OS === "ios" ? 9 : 7, paddingBottom: Platform.OS === "ios" ? 9 : 7,
    fontSize: 14, fontFamily: "Inter_400Regular", color: C.text, maxHeight: 120, minHeight: 38,
  },
  noticeInput: { borderColor: NOTICE_YELLOW_BORDER },
  sendBtn: { width: 38, height: 38, borderRadius: 19, justifyContent: "center", alignItems: "center" },
  sendBtnOff: { backgroundColor: C.border },
  readonlyBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingVertical: 12, backgroundColor: AMBER_SOFT,
    borderTopWidth: 1, borderTopColor: NOTICE_YELLOW_BORDER,
  },
  readonlyText: { fontSize: 12, color: AMBER_TEXT, fontFamily: "Inter_400Regular" },

  /* 백드롭 + 시트 공통 */
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: C.border, alignSelf: "center", marginBottom: 12 },

  /* 첨부 메뉴 시트 */
  attachSheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: Platform.OS === "ios" ? 36 : 20,
  },
  sheetTitle: { fontSize: 16, fontFamily: "Inter_700Bold", color: C.text, marginBottom: 12 },
  sheetItem: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 12 },
  sheetIcon: { width: 48, height: 48, borderRadius: 12, justifyContent: "center", alignItems: "center" },
  sheetItemText: { flex: 1 },
  sheetItemLabel: { fontSize: 15, fontFamily: "Inter_500Medium", color: C.text },
  sheetItemSub: { fontSize: 12, color: C.textSecondary, fontFamily: "Inter_400Regular", marginTop: 1 },

  /* 범용 모달 시트 */
  modalSheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: Platform.OS === "ios" ? 36 : 20,
    maxHeight: "80%",
  },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  modalTitle: { fontSize: 16, fontFamily: "Inter_700Bold", color: C.text },
  modalSub: { fontSize: 12, color: C.textSecondary, fontFamily: "Inter_400Regular", marginBottom: 12 },

  /* 회원 선택 목록 */
  studentRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  studentAvatar: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: C.tintLight, justifyContent: "center", alignItems: "center",
  },
  studentAvatarText: { fontSize: 15, fontFamily: "Inter_700Bold", color: PRIMARY },
  studentInfo: { flex: 1 },
  studentName: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: C.text },
  studentMeta: { fontSize: 12, color: C.textSecondary, fontFamily: "Inter_400Regular", marginTop: 1 },

  /* 스태프 목록 */
  staffRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  staffRowSelected: { backgroundColor: C.tintLight + "80" },
  staffAvatar: { width: 38, height: 38, borderRadius: 19, justifyContent: "center", alignItems: "center" },
  staffAvatarText: { fontSize: 15, fontFamily: "Inter_700Bold" },
  staffInfoCol: { flex: 1 },
  staffName: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: C.text },
  staffRole: { fontSize: 12, color: C.textSecondary, fontFamily: "Inter_400Regular", marginTop: 1 },

  /* 회원카드 상세 팝업 */
  cardDetailSheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: Platform.OS === "ios" ? 36 : 20,
  },
  cardDetailBody: { alignItems: "center", paddingTop: 8 },
  cardDetailAvatar: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: C.tintLight, justifyContent: "center", alignItems: "center", marginBottom: 8,
  },
  cardDetailAvatarText: { fontSize: 26, fontFamily: "Inter_700Bold", color: PRIMARY },
  cardDetailName: { fontSize: 20, fontFamily: "Inter_700Bold", color: C.text, marginBottom: 16 },
  cardDetailRows: { width: "100%", gap: 10 },
  detailRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  detailLabel: { fontSize: 13, color: C.textSecondary, fontFamily: "Inter_400Regular", width: 100 },
  detailValue: { flex: 1, fontSize: 13, color: C.text, fontFamily: "Inter_500Medium" },
});
