/**
 * MessengerScreen — 업무 메신저 공유 컴포넌트
 * pool_admin / teacher 모두 동일한 화면 사용
 */
import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, FlatList, Image,
  Modal, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
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
const TAB_BAR_H = Platform.OS === "web" ? 84 : Platform.OS === "android" ? 56 : 49;

type FilterType = "all" | "photo" | "transfer";

interface Staff {
  id: string;
  name: string;
  role: string;
  position?: string;
}

interface Student {
  id: string;
  name: string;
  class_name?: string;
  weekly_sessions?: number;
}

interface Transfer {
  student_id: string;
  student_name: string;
  from_user_id: string;
  from_user_name: string;
  to_user_id: string;
  to_user_name: string;
  weekly_sessions?: number;
  remaining_makeups?: number;
  status: "pending" | "approved" | "rejected";
  transfer_notes?: string;
}

interface Message {
  id: string;
  sender_id: string;
  sender_name: string;
  sender_role: string;
  msg_type: "text" | "photo" | "member_transfer";
  content?: string;
  target_id?: string;
  target_name?: string;
  photo_url?: string;
  member_transfer_id?: string;
  created_at: string;
  transfer?: Transfer;
  // from JOIN
  student_id?: string;
  student_name?: string;
  from_user_id?: string;
  from_user_name?: string;
  to_user_id?: string;
  to_user_name?: string;
  weekly_sessions?: number;
  remaining_makeups?: number;
  transfer_status?: string;
  transfer_notes?: string;
}

const FILTER_LABELS: { key: FilterType; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "photo", label: "사진" },
  { key: "transfer", label: "회원이전" },
];

function fmtTime(dateStr: string) {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60000) return "방금";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}분 전`;
  if (diff < 86400000) {
    return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" });
}

function roleLabel(role: string) {
  if (role === "pool_admin") return "관리자";
  if (role === "teacher") return "선생님";
  return role;
}

function statusColor(status: string) {
  if (status === "approved") return "#22C55E";
  if (status === "rejected") return "#EF4444";
  return "#F59E0B";
}

function statusLabel(status: string) {
  if (status === "approved") return "승인됨";
  if (status === "rejected") return "거절됨";
  return "대기중";
}

interface Props {
  poolId: string;
  myUserId: string;
  myRole: "pool_admin" | "teacher";
}

export default function MessengerScreen({ poolId, myUserId, myRole }: Props) {
  const { token } = useAuth();
  const { themeColor } = useBrand();
  const insets = useSafeAreaInsets();

  const [filter, setFilter] = useState<FilterType>("all");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  // send text
  const [text, setText] = useState("");
  const [targetUser, setTargetUser] = useState<Staff | null>(null);
  const [sending, setSending] = useState(false);

  // staff
  const [staff, setStaff] = useState<Staff[]>([]);
  const [showTargetModal, setShowTargetModal] = useState(false);

  // photo
  const [photoFile, setPhotoFile] = useState<{ uri: string; name: string; type: string } | null>(null);
  const [showSendMode, setShowSendMode] = useState<"text" | "photo" | "transfer">("text");

  // member transfer modal
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [students, setStudents] = useState<Student[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [transferTarget, setTransferTarget] = useState<Staff | null>(null);
  const [transferNotes, setTransferNotes] = useState("");
  const [transferring, setTransferring] = useState(false);

  // album
  const [showAlbum, setShowAlbum] = useState(false);
  const [albumPhotos, setAlbumPhotos] = useState<any[]>([]);
  const [selectedAlbumPhoto, setSelectedAlbumPhoto] = useState<string | null>(null);

  const listRef = useRef<FlatList>(null);

  // ── 데이터 로드 ────────────────────────────────────────────────────

  const loadMessages = useCallback(async (reset = true) => {
    if (!token || !poolId) return;
    try {
      if (reset) setLoading(true); else setLoadingMore(true);
      const cursorParam = (!reset && nextCursor) ? `&cursor=${encodeURIComponent(nextCursor)}` : "";
      const r = await apiRequest(token, `/messenger/messages?pool_id=${poolId}&filter=${filter}${cursorParam}`);
      if (r.ok) {
        const data = await r.json();
        // inverted FlatList: newest first (index 0 = bottom), oldest last (visual top)
        const incoming: Message[] = data.messages || [];
        if (reset) {
          setMessages(incoming);
        } else {
          // older messages go to the END (visual top in inverted list)
          setMessages(prev => [...prev, ...incoming]);
        }
        setHasMore(data.hasMore || false);
        setNextCursor(data.nextCursor || null);
      }
    } finally {
      setLoading(false);
      setLoadingMore(false);
      setRefreshing(false);
    }
  }, [token, poolId, filter, nextCursor]);

  const loadStaff = useCallback(async () => {
    if (!token || !poolId) return;
    const r = await apiRequest(token, `/messenger/staff?pool_id=${poolId}`);
    if (r.ok) {
      const data = await r.json();
      setStaff(data.staff || []);
    }
  }, [token, poolId]);

  const loadStudents = useCallback(async () => {
    if (!token || !poolId) return;
    const r = await apiRequest(token, `/messenger/transferable-students?pool_id=${poolId}`);
    if (r.ok) {
      const data = await r.json();
      setStudents(data.students || []);
    }
  }, [token, poolId]);

  const loadAlbum = useCallback(async () => {
    if (!token || !poolId) return;
    const r = await apiRequest(token, `/messenger/album?pool_id=${poolId}`);
    if (r.ok) {
      const data = await r.json();
      setAlbumPhotos(data.photos || []);
    }
  }, [token, poolId]);

  useEffect(() => {
    loadMessages(true);
  }, [filter, token, poolId]);

  useEffect(() => {
    loadStaff();
  }, [token, poolId]);

  // ── 메시지 전송 ─────────────────────────────────────────────────────

  const sendText = async () => {
    if (!text.trim() || !token || !poolId) return;
    setSending(true);
    try {
      const r = await apiRequest(token, "/messenger/messages", {
        method: "POST",
        body: JSON.stringify({
          pool_id: poolId,
          content: text.trim(),
          target_id: targetUser?.id || null,
          target_name: targetUser?.name || null,
        }),
      });
      if (r.ok) {
        const data = await r.json();
        // inverted list: newest at index 0 (bottom)
        setMessages(prev => [data.message, ...prev]);
        setText("");
        setTargetUser(null);
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
      const name = asset.fileName || `photo_${Date.now()}.jpg`;
      const type = asset.mimeType || "image/jpeg";
      setPhotoFile({ uri: asset.uri, name, type });
      setShowSendMode("photo");
    }
  };

  const sendPhoto = async () => {
    if (!photoFile || !token || !poolId) return;
    setSending(true);
    try {
      const formData = new FormData();
      formData.append("pool_id", poolId);
      if (text.trim()) formData.append("content", text.trim());
      if (targetUser) {
        formData.append("target_id", targetUser.id);
        formData.append("target_name", targetUser.name);
      }
      if (Platform.OS === "web") {
        const resp = await fetch(photoFile.uri);
        const blob = await resp.blob();
        formData.append("photo", blob, photoFile.name);
      } else {
        (formData as any).append("photo", {
          uri: photoFile.uri,
          name: photoFile.name,
          type: photoFile.type,
        } as any);
      }

      const r = await apiRequest(token, "/messenger/messages/photo", {
        method: "POST",
        body: formData,
      });
      if (r.ok) {
        const data = await r.json();
        // inverted list: newest at index 0 (bottom)
        setMessages(prev => [data.message, ...prev]);
        setPhotoFile(null);
        setText("");
        setTargetUser(null);
        setShowSendMode("text");
      }
    } finally {
      setSending(false);
    }
  };

  const sendTransfer = async () => {
    if (!selectedStudent || !transferTarget || !token || !poolId) return;
    setTransferring(true);
    try {
      const r = await apiRequest(token, "/messenger/member-transfers", {
        method: "POST",
        body: JSON.stringify({
          pool_id: poolId,
          student_id: selectedStudent.id,
          to_user_id: transferTarget.id,
          notes: transferNotes.trim() || null,
        }),
      });
      if (r.ok) {
        const data = await r.json();
        // inverted list: newest at index 0 (bottom)
        setMessages(prev => [data.message, ...prev]);
        setShowTransferModal(false);
        setSelectedStudent(null);
        setTransferTarget(null);
        setTransferNotes("");
      }
    } finally {
      setTransferring(false);
    }
  };

  const handleTransferAction = async (transferId: string, action: "approve" | "reject") => {
    if (!token) return;
    const r = await apiRequest(token, `/messenger/member-transfers/${transferId}`, {
      method: "PATCH",
      body: JSON.stringify({ action }),
    });
    if (r.ok) {
      const data = await r.json();
      setMessages(prev => prev.map(m => {
        if (m.member_transfer_id === transferId) {
          return { ...m, transfer_status: data.transfer.status };
        }
        return m;
      }));
    }
  };

  // ── 렌더링 ──────────────────────────────────────────────────────────

  const renderMessage = ({ item }: { item: Message }) => {
    const isMe = item.sender_id === myUserId;

    if (item.msg_type === "member_transfer") {
      return (
        <View style={styles.transferCard}>
          <View style={styles.transferCardHeader}>
            <Feather name="refresh-cw" size={14} color={themeColor} />
            <Text style={[styles.transferCardTitle, { color: themeColor }]}>회원 이전 요청</Text>
            <View style={[styles.statusBadge, { backgroundColor: statusColor(item.transfer_status || "pending") + "20" }]}>
              <Text style={[styles.statusBadgeText, { color: statusColor(item.transfer_status || "pending") }]}>
                {statusLabel(item.transfer_status || "pending")}
              </Text>
            </View>
          </View>
          <View style={styles.transferCardBody}>
            <View style={styles.transferRow}>
              <Feather name="user" size={13} color={C.textSecondary} />
              <Text style={styles.transferLabel}>회원</Text>
              <Text style={styles.transferValue}>{item.student_name}</Text>
            </View>
            <View style={styles.transferArrow}>
              <Text style={styles.transferFromTo}>{item.from_user_name}</Text>
              <Feather name="arrow-right" size={14} color={C.textSecondary} style={{ marginHorizontal: 6 }} />
              <Text style={styles.transferFromTo}>{item.to_user_name}</Text>
            </View>
            <View style={styles.transferRow}>
              <Feather name="calendar" size={13} color={C.textSecondary} />
              <Text style={styles.transferLabel}>주 {item.weekly_sessions ?? "-"}회</Text>
              <Text style={styles.transferLabel2}>보강 {item.remaining_makeups ?? 0}회 남음</Text>
            </View>
            {item.transfer_notes && (
              <Text style={styles.transferNotes}>메모: {item.transfer_notes}</Text>
            )}
          </View>
          {(item.transfer_status === "pending") && !isMe && (
            <View style={styles.transferActions}>
              <Pressable
                style={[styles.transferBtn, { backgroundColor: "#EF4444" }]}
                onPress={() => item.member_transfer_id && handleTransferAction(item.member_transfer_id, "reject")}
              >
                <Text style={styles.transferBtnText}>거절</Text>
              </Pressable>
              <Pressable
                style={[styles.transferBtn, { backgroundColor: "#22C55E" }]}
                onPress={() => item.member_transfer_id && handleTransferAction(item.member_transfer_id, "approve")}
              >
                <Text style={styles.transferBtnText}>승인</Text>
              </Pressable>
            </View>
          )}
          <View style={styles.msgMeta}>
            <Text style={styles.msgSender}>{item.sender_name} ({roleLabel(item.sender_role)})</Text>
            <Text style={styles.msgTime}>{fmtTime(item.created_at)}</Text>
          </View>
        </View>
      );
    }

    return (
      <View style={styles.msgRow}>
        <View style={styles.msgAvatar}>
          <Text style={styles.msgAvatarText}>{item.sender_name.charAt(0)}</Text>
        </View>
        <View style={styles.msgContent}>
          <View style={styles.msgHeader}>
            <Text style={styles.msgSender}>{item.sender_name}</Text>
            <Text style={styles.msgRoleBadge}>{roleLabel(item.sender_role)}</Text>
            {item.target_name && (
              <>
                <Feather name="arrow-right" size={11} color={C.textSecondary} />
                <Text style={[styles.msgRoleBadge, { color: themeColor }]}>{item.target_name}</Text>
              </>
            )}
            <Text style={styles.msgTime}>{fmtTime(item.created_at)}</Text>
          </View>
          {item.photo_url && (
            <Pressable onPress={() => setSelectedAlbumPhoto(item.photo_url!)}>
              <Image
                source={{ uri: photoUri(item.photo_url), headers: { Authorization: `Bearer ${token}` } }}
                style={styles.msgPhoto}
                resizeMode="cover"
              />
            </Pressable>
          )}
          {item.content && <Text style={styles.msgText}>{item.content}</Text>}
        </View>
      </View>
    );
  };

  const canSend = showSendMode === "photo" ? !!photoFile : text.trim().length > 0;

  return (
    <View style={styles.container}>
      {/* ── 필터 탭 ── */}
      <View style={styles.filterBar}>
        {FILTER_LABELS.map(f => (
          <Pressable
            key={f.key}
            style={[styles.filterBtn, filter === f.key && { borderBottomColor: themeColor, borderBottomWidth: 2 }]}
            onPress={() => setFilter(f.key)}
          >
            <Text style={[styles.filterText, filter === f.key && { color: themeColor, fontFamily: "Inter_600SemiBold" }]}>
              {f.label}
            </Text>
          </Pressable>
        ))}
        {filter === "photo" && (
          <Pressable style={styles.albumBtn} onPress={() => { loadAlbum(); setShowAlbum(true); }}>
            <Feather name="grid" size={16} color={themeColor} />
            <Text style={[styles.albumBtnText, { color: themeColor }]}>앨범</Text>
          </Pressable>
        )}
      </View>

      {/* ── 메시지 목록 (카카오톡식 inverted) ── */}
      {loading ? (
        <View style={[styles.center, { flex: 1 }]}>
          <ActivityIndicator color={themeColor} />
        </View>
      ) : (
        <FlatList
          ref={listRef}
          style={{ flex: 1 }}
          inverted
          data={messages}
          keyExtractor={item => item.id}
          renderItem={renderMessage}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          onEndReached={() => { if (hasMore && !loadingMore) loadMessages(false); }}
          onEndReachedThreshold={0.3}
          ListFooterComponent={loadingMore ? <ActivityIndicator color={themeColor} style={{ margin: 12 }} /> : null}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Feather name="message-circle" size={40} color={C.border} />
              <Text style={styles.emptyText}>메시지가 없습니다</Text>
            </View>
          }
        />
      )}

      {/* ── 전송 영역 ── */}
      <View style={[styles.inputArea, { paddingBottom: insets.bottom + (Platform.OS === "android" ? 8 : 4) }]}>
          {/* 대상 지정 표시 */}
          {targetUser && (
            <View style={styles.targetBadge}>
              <Feather name="at-sign" size={13} color={themeColor} />
              <Text style={[styles.targetBadgeText, { color: themeColor }]}>{targetUser.name}에게</Text>
              <Pressable onPress={() => setTargetUser(null)} hitSlop={8}>
                <Feather name="x" size={13} color={themeColor} />
              </Pressable>
            </View>
          )}

          {/* 사진 미리보기 */}
          {photoFile && (
            <View style={styles.photoPreviewWrap}>
              <Image source={{ uri: photoFile.uri }} style={styles.photoPreview} />
              <Pressable style={styles.photoRemove} onPress={() => { setPhotoFile(null); setShowSendMode("text"); }}>
                <Feather name="x" size={14} color="#fff" />
              </Pressable>
            </View>
          )}

          <View style={styles.inputRow}>
            {/* 대상 지정 버튼 */}
            <Pressable style={styles.iconBtn} onPress={() => setShowTargetModal(true)}>
              <Feather name="at-sign" size={20} color={targetUser ? themeColor : C.textSecondary} />
            </Pressable>

            {/* 사진 첨부 버튼 */}
            <Pressable style={styles.iconBtn} onPress={pickPhoto}>
              <Feather name="image" size={20} color={photoFile ? themeColor : C.textSecondary} />
            </Pressable>

            {/* 회원이전 버튼 */}
            <Pressable style={styles.iconBtn} onPress={() => { loadStudents(); setShowTransferModal(true); }}>
              <Feather name="refresh-cw" size={20} color={C.textSecondary} />
            </Pressable>

            {/* 텍스트 입력 */}
            <TextInput
              style={styles.textInput}
              value={text}
              onChangeText={setText}
              placeholder="메시지를 입력하세요"
              placeholderTextColor={C.textSecondary}
              multiline
              maxLength={1000}
              keyboardType="default"
              autoCapitalize="none"
              autoCorrect={false}
            />

            {/* 전송 버튼 */}
            <Pressable
              style={[styles.sendBtn, { backgroundColor: canSend ? themeColor : C.border }]}
              onPress={showSendMode === "photo" ? sendPhoto : sendText}
              disabled={!canSend || sending}
            >
              {sending
                ? <ActivityIndicator color="#fff" size={14} />
                : <Feather name="send" size={16} color="#fff" />
              }
            </Pressable>
          </View>
        </View>

      {/* ── 대상 선택 모달 ── */}
      <Modal visible={showTargetModal} transparent animationType="slide">
        <Pressable style={styles.modalOverlay} onPress={() => setShowTargetModal(false)}>
          <Pressable style={styles.bottomSheet} onPress={e => e.stopPropagation()}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>받는 사람 선택</Text>
            <ScrollView>
              <Pressable style={styles.sheetItem} onPress={() => { setTargetUser(null); setShowTargetModal(false); }}>
                <Feather name="users" size={16} color={C.textSecondary} />
                <Text style={styles.sheetItemText}>전체 공개</Text>
              </Pressable>
              {staff.map(s => (
                <Pressable key={s.id} style={styles.sheetItem} onPress={() => { setTargetUser(s); setShowTargetModal(false); }}>
                  <View style={[styles.staffAvatar, { backgroundColor: themeColor + "20" }]}>
                    <Text style={[styles.staffAvatarText, { color: themeColor }]}>{s.name.charAt(0)}</Text>
                  </View>
                  <View>
                    <Text style={styles.sheetItemText}>{s.name}</Text>
                    <Text style={styles.sheetItemSub}>{roleLabel(s.role)}{s.position ? ` · ${s.position}` : ""}</Text>
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── 회원이전 모달 ── */}
      <Modal visible={showTransferModal} transparent animationType="slide">
        <Pressable style={styles.modalOverlay} onPress={() => setShowTransferModal(false)}>
          <Pressable style={styles.bottomSheet} onPress={e => e.stopPropagation()}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>회원 이전 요청</Text>
            <ScrollView style={{ maxHeight: 500 }}>
              {/* 회원 선택 */}
              <Text style={styles.sheetSection}>이전할 회원</Text>
              {students.length === 0 ? (
                <Text style={styles.emptyText}>이전 가능한 회원이 없습니다</Text>
              ) : (
                students.map(s => (
                  <Pressable
                    key={s.id}
                    style={[styles.sheetItem, selectedStudent?.id === s.id && { backgroundColor: themeColor + "10" }]}
                    onPress={() => setSelectedStudent(s)}
                  >
                    <View style={[styles.staffAvatar, { backgroundColor: selectedStudent?.id === s.id ? themeColor + "30" : C.border + "60" }]}>
                      <Text style={[styles.staffAvatarText, { color: selectedStudent?.id === s.id ? themeColor : C.textSecondary }]}>
                        {s.name.charAt(0)}
                      </Text>
                    </View>
                    <View>
                      <Text style={styles.sheetItemText}>{s.name}</Text>
                      {s.class_name && <Text style={styles.sheetItemSub}>{s.class_name} · 주 {s.weekly_sessions ?? "-"}회</Text>}
                    </View>
                    {selectedStudent?.id === s.id && <Feather name="check" size={16} color={themeColor} style={{ marginLeft: "auto" }} />}
                  </Pressable>
                ))
              )}

              {/* 받는 선생님 선택 */}
              <Text style={styles.sheetSection}>이전받을 선생님</Text>
              {staff.filter(s => s.id !== myUserId).map(s => (
                <Pressable
                  key={s.id}
                  style={[styles.sheetItem, transferTarget?.id === s.id && { backgroundColor: themeColor + "10" }]}
                  onPress={() => setTransferTarget(s)}
                >
                  <View style={[styles.staffAvatar, { backgroundColor: transferTarget?.id === s.id ? themeColor + "30" : C.border + "60" }]}>
                    <Text style={[styles.staffAvatarText, { color: transferTarget?.id === s.id ? themeColor : C.textSecondary }]}>
                      {s.name.charAt(0)}
                    </Text>
                  </View>
                  <View>
                    <Text style={styles.sheetItemText}>{s.name}</Text>
                    <Text style={styles.sheetItemSub}>{roleLabel(s.role)}{s.position ? ` · ${s.position}` : ""}</Text>
                  </View>
                  {transferTarget?.id === s.id && <Feather name="check" size={16} color={themeColor} style={{ marginLeft: "auto" }} />}
                </Pressable>
              ))}

              {/* 메모 */}
              <Text style={styles.sheetSection}>메모 (선택)</Text>
              <TextInput
                style={styles.notesInput}
                value={transferNotes}
                onChangeText={setTransferNotes}
                placeholder="이전 사유 또는 메모..."
                placeholderTextColor={C.textSecondary}
                multiline
              />

              <Pressable
                style={[styles.transferSubmitBtn, { backgroundColor: selectedStudent && transferTarget ? themeColor : C.border }]}
                disabled={!selectedStudent || !transferTarget || transferring}
                onPress={sendTransfer}
              >
                {transferring
                  ? <ActivityIndicator color="#fff" size={14} />
                  : <Text style={styles.transferSubmitText}>이전 요청 전송</Text>
                }
              </Pressable>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── 사진 앨범 모달 ── */}
      <Modal visible={showAlbum} transparent animationType="slide">
        <View style={styles.albumModal}>
          <View style={styles.albumHeader}>
            <Text style={styles.sheetTitle}>사진 앨범</Text>
            <Pressable onPress={() => setShowAlbum(false)}>
              <Feather name="x" size={22} color={C.text} />
            </Pressable>
          </View>
          <FlatList
            data={albumPhotos}
            numColumns={3}
            keyExtractor={p => p.id}
            renderItem={({ item }) => (
              <Pressable style={styles.albumThumbWrap} onPress={() => { setSelectedAlbumPhoto(item.photo_url); setShowAlbum(false); }}>
                <Image source={{ uri: photoUri(item.photo_url), headers: { Authorization: `Bearer ${token}` } }} style={styles.albumThumb} />
              </Pressable>
            )}
            ListEmptyComponent={<Text style={[styles.emptyText, { margin: 32 }]}>사진이 없습니다</Text>}
          />
        </View>
      </Modal>

      {/* ── 사진 전체화면 ── */}
      <Modal visible={!!selectedAlbumPhoto} transparent animationType="fade">
        <Pressable style={styles.photoFullOverlay} onPress={() => setSelectedAlbumPhoto(null)}>
          <Image
            source={{ uri: selectedAlbumPhoto ? photoUri(selectedAlbumPhoto) : "", headers: { Authorization: `Bearer ${token}` } }}
            style={styles.photoFull}
            resizeMode="contain"
          />
          <Pressable style={styles.photoFullClose} onPress={() => setSelectedAlbumPhoto(null)}>
            <Feather name="x" size={24} color="#fff" />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },

  filterBar: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    backgroundColor: "#fff",
    paddingHorizontal: 16,
  },
  filterBtn: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  filterText: { fontSize: 14, fontFamily: "Inter_500Medium", color: C.textSecondary },
  albumBtn: { marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 12 },
  albumBtnText: { fontSize: 13, fontFamily: "Inter_500Medium" },

  listContent: { padding: 12, gap: 8 },
  emptyWrap: { flex: 1, justifyContent: "center", alignItems: "center", paddingVertical: 60, gap: 12 },
  emptyText: { color: C.textSecondary, fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center" },

  // message rows
  msgRow: { flexDirection: "row", gap: 10, marginBottom: 4 },
  msgAvatar: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: "#E5E7EB", justifyContent: "center", alignItems: "center",
  },
  msgAvatarText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#374151" },
  msgContent: { flex: 1, gap: 4 },
  msgHeader: { flexDirection: "row", alignItems: "center", gap: 5, flexWrap: "wrap" },
  msgSender: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: C.text },
  msgRoleBadge: { fontSize: 11, fontFamily: "Inter_400Regular", color: C.textSecondary, backgroundColor: C.border + "40", paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 },
  msgTime: { fontSize: 11, color: C.textSecondary, fontFamily: "Inter_400Regular", marginLeft: "auto" },
  msgText: { fontSize: 14, color: C.text, fontFamily: "Inter_400Regular", lineHeight: 20 },
  msgPhoto: { width: "100%", height: 180, borderRadius: 8, marginTop: 4 },

  // transfer card
  transferCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
    marginBottom: 4,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  transferCardHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 },
  transferCardTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold", flex: 1 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  statusBadgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  transferCardBody: { gap: 5, marginBottom: 10 },
  transferRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  transferLabel: { fontSize: 12, color: C.textSecondary, fontFamily: "Inter_400Regular" },
  transferLabel2: { fontSize: 12, color: C.textSecondary, fontFamily: "Inter_400Regular", marginLeft: 8 },
  transferValue: { fontSize: 13, color: C.text, fontFamily: "Inter_600SemiBold" },
  transferArrow: { flexDirection: "row", alignItems: "center", paddingVertical: 4 },
  transferFromTo: { fontSize: 13, color: C.text, fontFamily: "Inter_500Medium" },
  transferNotes: { fontSize: 12, color: C.textSecondary, fontFamily: "Inter_400Regular", marginTop: 4, fontStyle: "italic" },
  transferActions: { flexDirection: "row", gap: 8, marginBottom: 8 },
  transferBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center" },
  transferBtnText: { color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },

  // input area
  inputArea: {
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderTopColor: C.border,
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  targetBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginBottom: 6,
    backgroundColor: "#EFF6FF",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    alignSelf: "flex-start",
  },
  targetBadgeText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  photoPreviewWrap: { position: "relative", marginBottom: 8, alignSelf: "flex-start" },
  photoPreview: { width: 80, height: 80, borderRadius: 8 },
  photoRemove: {
    position: "absolute", top: -6, right: -6,
    backgroundColor: "#374151", borderRadius: 10, padding: 3,
  },
  inputRow: { flexDirection: "row", alignItems: "flex-end", gap: 6 },
  iconBtn: { padding: 8, justifyContent: "center", alignItems: "center" },
  textInput: {
    flex: 1,
    minHeight: 36,
    maxHeight: 100,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: C.text,
    backgroundColor: "#F9FAFB",
  },
  sendBtn: { width: 36, height: 36, borderRadius: 18, justifyContent: "center", alignItems: "center" },

  // modal / bottom sheet
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  bottomSheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingBottom: 32,
    maxHeight: "80%",
  },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: C.border, alignSelf: "center", marginVertical: 10 },
  sheetTitle: { fontSize: 17, fontFamily: "Inter_700Bold", color: C.text, marginBottom: 12 },
  sheetSection: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: C.textSecondary, marginTop: 14, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 },
  sheetItem: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderRadius: 8, paddingHorizontal: 4 },
  sheetItemText: { fontSize: 14, fontFamily: "Inter_500Medium", color: C.text },
  sheetItemSub: { fontSize: 12, color: C.textSecondary, fontFamily: "Inter_400Regular" },
  staffAvatar: { width: 32, height: 32, borderRadius: 16, justifyContent: "center", alignItems: "center" },
  staffAvatarText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  notesInput: {
    borderWidth: 1, borderColor: C.border, borderRadius: 8, padding: 10,
    fontSize: 14, fontFamily: "Inter_400Regular", color: C.text, minHeight: 60,
    marginBottom: 14,
  },
  transferSubmitBtn: {
    paddingVertical: 13, borderRadius: 10, alignItems: "center", marginBottom: 8,
  },
  transferSubmitText: { color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" },

  // album
  albumModal: { flex: 1, backgroundColor: "#fff" },
  albumHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: 1, borderBottomColor: C.border },
  albumThumbWrap: { flex: 1, margin: 1, aspectRatio: 1 },
  albumThumb: { width: "100%", height: "100%" },

  // full photo
  photoFullOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.9)", justifyContent: "center", alignItems: "center" },
  photoFull: { width: "100%", height: "100%" },
  photoFullClose: { position: "absolute", top: 50, right: 20, backgroundColor: "rgba(0,0,0,0.5)", borderRadius: 20, padding: 8 },

  msgMeta: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 },
});
