/**
 * 학부모 알림 통합 화면
 * 탭: [받은 알림] | [내 요청]
 * 내 요청 탭에서 [+] → 요청 작성 Modal (같은 화면)
 */
import { LucideIcon } from "@/components/common/LucideIcon";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useParent } from "@/context/ParentContext";
import { router, useLocalSearchParams } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Modal, Platform, Pressable,
  RefreshControl, ScrollView, StyleSheet, Text,
  TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const C = Colors.light;

/* ─── 타입 ─── */
interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  ref_id: string;
  ref_type: string;
  is_read: boolean;
  created_at: string;
}

/* ─── 요청 유형 ─── */
const REQUEST_TYPES = [
  { key: "absence",    label: "결석 신청", icon: "x-circle",       color: "#EF4444", bg: "#FEE2E2" },
  { key: "postpone",   label: "연기 신청", icon: "clock",          color: "#F59E0B", bg: "#FEF3C7" },
  { key: "makeup",     label: "보강 요청", icon: "refresh-cw",     color: "#3B82F6", bg: "#DBEAFE" },
  { key: "withdrawal", label: "퇴원 신청", icon: "log-out",        color: "#6B7280", bg: "#F3F4F6" },
  { key: "counseling", label: "상담 요청", icon: "message-circle", color: "#8B5CF6", bg: "#EDE9FE" },
  { key: "inquiry",    label: "문의",      icon: "help-circle",    color: "#0EA5E9", bg: "#E0F2FE" },
] as const;
type RequestType = (typeof REQUEST_TYPES)[number]["key"];

const STATUS_LABEL: Record<string, string> = { pending: "처리 대기", done: "처리 완료", rejected: "거절됨" };
const STATUS_COLOR: Record<string, { text: string; bg: string }> = {
  pending:  { text: "#D97706", bg: "#FFF7ED" },
  done:     { text: "#2EC4B6", bg: "#E6FFFA" },
  rejected: { text: "#EF4444", bg: "#FEF2F2" },
};

const NOTIF_CONFIG: Record<string, { icon: "book-open" | "image" | "bell" | "clipboard-list"; color: string; bg: string }> = {
  diary_upload:          { icon: "book-open",      color: "#2EC4B6", bg: "#E6FFFA" },
  photo_upload:          { icon: "image",          color: "#2EC4B6", bg: "#E6FFFA" },
  parent_request_result: { icon: "clipboard-list", color: "#3B82F6", bg: "#DBEAFE" },
};

/* ─── 유틸 ─── */
function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "방금";
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  return `${Math.floor(diff / 86400)}일 전`;
}

function safeDate(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });
}

/* ─── 메인 컴포넌트 ─── */
export default function ParentNotificationsScreen() {
  const { token } = useAuth();
  const { students, selectedStudent } = useParent();
  const insets = useSafeAreaInsets();

  /* URL params — requests.tsx에서 redirect 또는 Push 딥링크로 전달 */
  const { tab: paramTab, requestId: paramRequestId } =
    useLocalSearchParams<{ tab?: string; requestId?: string }>();

  /* ── 탭 ── */
  const [activeTab, setActiveTab] = useState<"notifications" | "requests">(
    paramTab === "requests" ? "requests" : "notifications"
  );

  /* paramTab 변경 반응 (redirect 또는 딥링크) */
  useEffect(() => {
    if (paramTab === "requests") setActiveTab("requests");
  }, [paramTab]);

  /* ── 알림 상태 ── */
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [notifLoading, setNotifLoading] = useState(true);
  const [notifRefreshing, setNotifRefreshing] = useState(false);
  const [notifError, setNotifError] = useState<string | null>(null);
  const navigatingRef = useRef(false);

  /* ── 요청 상태 ── */
  const [requests, setRequests] = useState<any[]>([]);
  const [reqLoading, setReqLoading] = useState(true);
  const [reqRefreshing, setReqRefreshing] = useState(false);
  const [reqError, setReqError] = useState<string | null>(null);
  const [selStudentId, setSelStudentId] = useState<string>(
    selectedStudent?.id || students[0]?.id || ""
  );

  /* ── 강조 ── */
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [highlightId, setHighlightId] = useState<string | undefined>(paramRequestId);

  useEffect(() => {
    if (paramRequestId) {
      setHighlightId(paramRequestId);
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
      highlightTimer.current = setTimeout(() => setHighlightId(undefined), 3000);
    }
    return () => { if (highlightTimer.current) clearTimeout(highlightTimer.current); };
  }, [paramRequestId]);

  /* ── Modal 상태 ── */
  const [modalVisible, setModalVisible] = useState(false);
  const [reqType, setReqType] = useState<RequestType>("absence");
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  /* selectedStudent 변경 반응 */
  useEffect(() => {
    if (selectedStudent?.id) setSelStudentId(selectedStudent.id);
    else if (students.length > 0) setSelStudentId(students[0].id);
  }, [selectedStudent?.id, students]);

  /* ── fetchNotifications ── */
  const fetchNotifications = useCallback(async () => {
    setNotifError(null);
    try {
      const res = await apiRequest(token, "/notifications");
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications || []);
        setUnread(data.unread_count || 0);
      } else {
        setNotifError("알림을 불러오지 못했습니다.");
      }
    } catch {
      setNotifError("네트워크 오류가 발생했습니다.");
    } finally {
      setNotifLoading(false);
      setNotifRefreshing(false);
    }
  }, [token]);

  useEffect(() => { fetchNotifications(); }, [fetchNotifications]);

  /* ── fetchRequests ── */
  const fetchRequests = useCallback(async () => {
    setReqError(null);
    try {
      const sid = selStudentId || students[0]?.id;
      if (!sid) {
        setRequests([]);
        setReqLoading(false);
        setReqRefreshing(false);
        return;
      }
      const r = await apiRequest(token, `/parent/requests?student_id=${sid}`);
      if (r.ok) {
        const d = await r.json();
        setRequests(d.data || []);
      } else {
        setReqError("요청 목록을 불러오지 못했습니다.");
      }
    } catch {
      setReqError("네트워크 오류가 발생했습니다.");
    } finally {
      setReqLoading(false);
      setReqRefreshing(false);
    }
  }, [token, selStudentId, students]);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);

  /* ── 알림 핸들러 ── */
  async function handleNotifPress(n: Notification) {
    if (navigatingRef.current) return;
    if (!n.is_read) {
      await apiRequest(token, `/notifications/${n.id}/read`, { method: "POST" }).catch(() => {});
      setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, is_read: true } : x));
      setUnread(prev => Math.max(0, prev - 1));
    }
    if (n.ref_type === "request" || n.type === "parent_request_result") {
      /* 내 요청 탭으로 전환 + 강조 — navigation stack 증가 없음 */
      setActiveTab("requests");
      if (n.ref_id) {
        setHighlightId(n.ref_id);
        if (highlightTimer.current) clearTimeout(highlightTimer.current);
        highlightTimer.current = setTimeout(() => setHighlightId(undefined), 3000);
      }
    } else if (n.ref_type === "diary" || n.type === "diary_upload") {
      navigatingRef.current = true;
      router.push("/(parent)/children?backTo=notifications" as any);
      setTimeout(() => { navigatingRef.current = false; }, 1000);
    } else if (n.ref_type === "student" || n.type === "photo_upload") {
      navigatingRef.current = true;
      router.push("/(parent)/children?backTo=notifications" as any);
      setTimeout(() => { navigatingRef.current = false; }, 1000);
    }
  }

  async function markAllRead() {
    await apiRequest(token, "/notifications/read-all", { method: "POST" }).catch(() => {});
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    setUnread(0);
  }

  async function deleteNotif(id: string) {
    await apiRequest(token, `/notifications/${id}`, { method: "DELETE" }).catch(() => {});
    setNotifications(prev => prev.filter(n => n.id !== id));
  }

  /* ── 요청 제출 ── */
  async function handleSubmit() {
    const sid = students.length === 1 ? students[0].id : selStudentId;
    if (!sid) { setErrorMsg("자녀를 선택해주세요."); return; }
    setSubmitting(true); setErrorMsg("");
    try {
      const r = await apiRequest(token, "/parent/requests", {
        method: "POST",
        body: JSON.stringify({ student_id: sid, request_type: reqType, content: content || null }),
      });
      if (r.ok) {
        const newReq = await r.json().catch(() => null);
        setModalVisible(false);
        setContent("");
        const entry = newReq?.data ?? newReq?.request ?? newReq;
        if (entry?.id) {
          setRequests(prev => [entry, ...prev]);
        } else {
          setRequests(prev => [{
            id: `tmp_${Date.now()}`,
            request_type: reqType,
            content: content || null,
            status: "pending",
            created_at: new Date().toISOString(),
          }, ...prev]);
        }
      } else {
        const d = await r.json().catch(() => ({}));
        setErrorMsg(d.message || "요청 전송 실패");
      }
    } catch {
      setErrorMsg("네트워크 오류");
    }
    setSubmitting(false);
  }

  function openCreateModal() {
    setContent("");
    setErrorMsg("");
    setReqType("absence");
    if (students.length === 1) setSelStudentId(students[0].id);
    setModalVisible(true);
  }

  const notifConfig = (type: string) =>
    NOTIF_CONFIG[type] || { icon: "bell" as const, color: C.textSecondary, bg: C.border };

  /* ── 헤더 오른쪽 슬롯 ── */
  const rightSlot =
    activeTab === "notifications" ? (
      unread > 0 ? (
        <Pressable style={[st.readAllBtn, { borderColor: C.border }]} onPress={markAllRead}>
          <Text style={[st.readAllText, { color: C.textSecondary }]}>모두 읽음</Text>
        </Pressable>
      ) : undefined
    ) : (
      <Pressable style={[st.addBtn, { backgroundColor: C.tint }]} onPress={openCreateModal}>
        <LucideIcon name="plus" size={18} color="#fff" />
      </Pressable>
    );

  /* ── 탭 바 ── */
  const TabBar = () => (
    <View style={st.tabBar}>
      {(["notifications", "requests"] as const).map(tab => (
        <Pressable
          key={tab}
          style={[st.tabItem, activeTab === tab && st.tabItemActive]}
          onPress={() => setActiveTab(tab)}
        >
          <Text style={[st.tabText, { color: activeTab === tab ? C.tint : C.textMuted }]}>
            {tab === "notifications" ? "받은 알림" : "내 요청"}
          </Text>
          {tab === "notifications" && unread > 0 && activeTab !== "notifications" && (
            <View style={st.badgeDot} />
          )}
        </Pressable>
      ))}
    </View>
  );

  /* ─────────────── 렌더 ─────────────── */
  return (
    <View style={[st.root, { backgroundColor: C.background }]}>
      <SubScreenHeader
        title="알림"
        subtitle={activeTab === "notifications" && unread > 0 ? `읽지 않은 알림 ${unread}개` : undefined}
        rightSlot={rightSlot}
      />

      <TabBar />

      {/* ── 받은 알림 탭 ── */}
      {activeTab === "notifications" && (
        <>
          {notifLoading ? (
            <ActivityIndicator color="#2EC4B6" style={{ marginTop: 60 }} />
          ) : notifError ? (
            <View style={st.empty}>
              <LucideIcon name="wifi-off" size={40} color={C.textMuted} />
              <Text style={[st.emptyText, { color: C.textMuted }]}>{notifError}</Text>
              <Pressable
                style={[st.readAllBtn, { borderColor: C.border, marginTop: 8 }]}
                onPress={() => { setNotifLoading(true); fetchNotifications(); }}
              >
                <Text style={[st.readAllText, { color: C.textSecondary }]}>다시 시도</Text>
              </Pressable>
            </View>
          ) : (
            <ScrollView
              contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 100, gap: 10 }}
              refreshControl={
                <RefreshControl
                  refreshing={notifRefreshing}
                  onRefresh={() => { setNotifRefreshing(true); fetchNotifications(); }}
                  tintColor="#2EC4B6"
                />
              }
              showsVerticalScrollIndicator={false}
            >
              {notifications.length === 0 ? (
                <View style={st.empty}>
                  <LucideIcon name="bell-off" size={40} color={C.textMuted} />
                  <Text style={[st.emptyText, { color: C.textMuted }]}>알림이 없습니다</Text>
                  <Text style={[st.emptySub, { color: C.textMuted }]}>
                    수업 일지, 사진 업로드 또는{"\n"}요청 처리 결과를 알려드립니다
                  </Text>
                </View>
              ) : notifications.map(n => {
                const cfg = notifConfig(n.type);
                return (
                  <Pressable
                    key={n.id}
                    style={({ pressed }) => [
                      st.card,
                      { backgroundColor: n.is_read ? C.card : "#DDF2EF30", shadowColor: C.shadow, opacity: pressed ? 0.9 : 1 },
                    ]}
                    onPress={() => handleNotifPress(n)}
                  >
                    <View style={[st.iconBox, { backgroundColor: cfg.bg }]}>
                      <LucideIcon name={cfg.icon} size={18} color={cfg.color} />
                    </View>
                    <View style={st.cardContent}>
                      <Text style={[st.cardTitle, { color: C.text }]}>{n.title}</Text>
                      <Text style={[st.cardBody, { color: C.textSecondary }]} numberOfLines={2}>{n.body}</Text>
                      {timeAgo(n.created_at) ? (
                        <Text style={[st.cardTime, { color: C.textMuted }]}>{timeAgo(n.created_at)}</Text>
                      ) : null}
                    </View>
                    <View style={st.cardRight}>
                      {!n.is_read && <View style={[st.dot, { backgroundColor: "#2EC4B6" }]} />}
                      <Pressable onPress={() => deleteNotif(n.id)} hitSlop={8}>
                        <LucideIcon name="x" size={14} color={C.textMuted} />
                      </Pressable>
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
        </>
      )}

      {/* ── 내 요청 탭 ── */}
      {activeTab === "requests" && (
        <>
          {/* 자녀 2명+ 필터 탭 */}
          {students.length > 1 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={st.studentTabs}
            >
              {students.map(st2 => (
                <Pressable
                  key={st2.id}
                  style={[st.studentChip, { backgroundColor: selStudentId === st2.id ? C.tint : C.card }]}
                  onPress={() => setSelStudentId(st2.id)}
                >
                  <Text style={{ fontSize: 14, fontFamily: "Pretendard-Regular", color: selStudentId === st2.id ? "#fff" : C.text }}>
                    {st2.name}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          )}

          {reqLoading ? (
            <ActivityIndicator color={C.tint} style={{ marginTop: 60 }} />
          ) : reqError ? (
            <View style={st.empty}>
              <LucideIcon name="wifi-off" size={40} color={C.textMuted} />
              <Text style={[st.emptyText, { color: C.textMuted }]}>{reqError}</Text>
              <Pressable
                style={[st.readAllBtn, { borderColor: C.border, marginTop: 8 }]}
                onPress={() => { setReqLoading(true); fetchRequests(); }}
              >
                <Text style={[st.readAllText, { color: C.textSecondary }]}>다시 시도</Text>
              </Pressable>
            </View>
          ) : (
            <ScrollView
              contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: insets.bottom + 100, gap: 12 }}
              showsVerticalScrollIndicator={false}
              refreshControl={
                <RefreshControl
                  refreshing={reqRefreshing}
                  onRefresh={() => { setReqRefreshing(true); fetchRequests(); }}
                  tintColor={C.tint}
                />
              }
            >
              {requests.length === 0 ? (
                <View style={st.empty}>
                  <LucideIcon name="clipboard-list" size={48} color={C.textMuted} />
                  <Text style={[st.emptyText, { color: C.textMuted }]}>요청 내역이 없습니다</Text>
                  <Text style={{ fontSize: 13, color: C.textMuted, fontFamily: "Pretendard-Regular", textAlign: "center" }}>
                    우측 상단 + 버튼을 눌러{"\n"}새 요청을 보내세요
                  </Text>
                </View>
              ) : requests.map(req => {
                const typeCfg = REQUEST_TYPES.find(t => t.key === req.request_type);
                const statusCfg = STATUS_COLOR[req.status] || STATUS_COLOR.pending;
                const isHighlighted = highlightId && req.id === highlightId;
                return (
                  <View
                    key={req.id}
                    style={[
                      st.reqCard,
                      { backgroundColor: C.card },
                      isHighlighted && { borderWidth: 2, borderColor: "#2EC4B6", backgroundColor: "#E6FFFA" },
                    ]}
                  >
                    {isHighlighted && (
                      <View style={st.highlightBanner}>
                        <LucideIcon name="bell" size={12} color="#2EC4B6" />
                        <Text style={st.highlightText}>알림에서 이동한 요청</Text>
                      </View>
                    )}
                    <View style={st.reqCardTop}>
                      <View style={[st.typeBadge, { backgroundColor: typeCfg?.bg || "#F3F4F6" }]}>
                        <LucideIcon name={(typeCfg?.icon || "help-circle") as any} size={14} color={typeCfg?.color || C.textMuted} />
                        <Text style={[st.typeText, { color: typeCfg?.color || C.textMuted }]}>
                          {typeCfg?.label || req.request_type}
                        </Text>
                      </View>
                      <View style={[st.statusBadge, { backgroundColor: statusCfg.bg }]}>
                        <Text style={[st.statusText, { color: statusCfg.text }]}>{STATUS_LABEL[req.status] || req.status}</Text>
                      </View>
                    </View>
                    {req.content ? (
                      <Text style={[st.reqContent, { color: C.text }]}>{req.content}</Text>
                    ) : null}
                    {req.admin_note ? (
                      <View style={[st.adminNote, { backgroundColor: "#F0FDF4" }]}>
                        <Text style={{ fontSize: 12, color: "#16A34A", fontFamily: "Pretendard-Regular" }}>
                          선생님 메모: {req.admin_note}
                        </Text>
                      </View>
                    ) : null}
                    {safeDate(req.created_at) ? (
                      <Text style={[st.reqDate, { color: C.textMuted }]}>{safeDate(req.created_at)}</Text>
                    ) : null}
                  </View>
                );
              })}
            </ScrollView>
          )}
        </>
      )}

      {/* ── 요청 작성 Modal ── */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setModalVisible(false)}
      >
        {/* Backdrop — 절대 레이어, 탭 시 닫힘 */}
        <Pressable
          style={[StyleSheet.absoluteFillObject, st.backdrop]}
          onPress={() => setModalVisible(false)}
        />

        {/* Sheet — KeyboardAvoidingView + ScrollView */}
        <View style={{ flex: 1, justifyContent: "flex-end" }} pointerEvents="box-none">
          <View
            style={[
              st.modalSheet,
              { backgroundColor: C.background, paddingBottom: insets.bottom + 8 },
            ]}
          >
            {/* Header */}
            <View style={st.modalHeader}>
              <Text style={[st.modalTitle, { color: C.text }]}>새 요청 보내기</Text>
              <Pressable onPress={() => setModalVisible(false)} hitSlop={8}>
                <Text style={{ fontSize: 15, color: C.textMuted, fontFamily: "Pretendard-Regular" }}>취소</Text>
              </Pressable>
            </View>

            {/* Scroll 영역 */}
            <KeyboardAwareScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ paddingBottom: 24 }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {/* 자녀 선택 */}
              {students.length === 0 && (
                <View style={{ alignItems: "center", paddingVertical: 16 }}>
                  <LucideIcon name="user-x" size={28} color={C.textMuted} />
                  <Text style={[st.label, { color: C.textMuted, textAlign: "center", marginTop: 8 }]}>
                    연결된 자녀가 없습니다
                  </Text>
                </View>
              )}

              {students.length === 1 && (
                <View style={{ marginBottom: 16 }}>
                  <Text style={[st.label, { color: C.textSecondary }]}>자녀</Text>
                  <View style={[st.studentChip, { backgroundColor: C.tint, alignSelf: "flex-start" }]}>
                    <Text style={{ fontSize: 13, color: "#fff", fontFamily: "Pretendard-Regular" }}>
                      {students[0].name}
                    </Text>
                  </View>
                </View>
              )}

              {students.length > 1 && (
                <View style={{ marginBottom: 16 }}>
                  <Text style={[st.label, { color: C.textSecondary }]}>자녀 선택</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                    {students.map(s => (
                      <Pressable
                        key={s.id}
                        style={[st.studentChip, { backgroundColor: selStudentId === s.id ? C.tint : C.card }]}
                        onPress={() => setSelStudentId(s.id)}
                      >
                        <Text style={{ fontSize: 13, color: selStudentId === s.id ? "#fff" : C.text, fontFamily: "Pretendard-Regular" }}>
                          {s.name}
                        </Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
              )}

              {/* 요청 유형 */}
              <Text style={[st.label, { color: C.textSecondary }]}>요청 유형</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginBottom: 16 }}>
                {REQUEST_TYPES.map(t => (
                  <Pressable
                    key={t.key}
                    style={[
                      st.typeBtn,
                      {
                        backgroundColor: reqType === t.key ? t.bg : C.card,
                        borderWidth: reqType === t.key ? 1.5 : 0.5,
                        borderColor: reqType === t.key ? t.color : C.border,
                      },
                    ]}
                    onPress={() => setReqType(t.key)}
                  >
                    <LucideIcon name={t.icon as any} size={18} color={t.color} />
                    <Text style={[st.typeBtnText, { color: t.color }]}>{t.label}</Text>
                  </Pressable>
                ))}
              </ScrollView>

              {/* 내용 입력 */}
              <Text style={[st.label, { color: C.textSecondary }]}>내용 / 사유</Text>
              <TextInput
                style={[st.input, { backgroundColor: C.card, color: C.text, borderColor: C.border }]}
                placeholder="선생님께 전달할 내용을 입력하세요 (선택)"
                placeholderTextColor={C.textMuted}
                multiline
                numberOfLines={4}
                value={content}
                onChangeText={setContent}
                textAlignVertical="top"
              />

              {/* 안내 */}
              <Text style={[st.hint, { color: C.textMuted }]}>
                담당 선생님께 전달되며 처리 결과는 알림으로 안내드립니다.
              </Text>

              {/* 오류 */}
              {errorMsg ? <Text style={st.error}>{errorMsg}</Text> : null}

              {/* 제출 */}
              <Pressable
                style={({ pressed }) => [
                  st.submitBtn,
                  {
                    backgroundColor: students.length === 0 ? C.border : "#fff",
                    borderWidth: 1.5,
                    borderColor: students.length === 0 ? C.border : C.tint,
                    opacity: pressed || submitting || students.length === 0 ? 0.7 : 1,
                  },
                ]}
                onPress={handleSubmit}
                disabled={submitting || students.length === 0}
              >
                {submitting ? (
                  <ActivityIndicator color="#1B3A70" size="small" />
                ) : (
                  <>
                    <LucideIcon name="send" size={16} color="#1B3A70" />
                    <Text style={[st.submitBtnText, { color: "#1B3A70" }]}>요청 보내기</Text>
                  </>
                )}
              </Pressable>
            </KeyboardAwareScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1 },

  /* 탭 바 */
  tabBar: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  tabItem: { flex: 1, alignItems: "center", paddingVertical: 12, flexDirection: "row", justifyContent: "center", gap: 6 },
  tabItemActive: { borderBottomWidth: 2, borderBottomColor: "#2EC4B6" },
  tabText: { fontSize: 14, fontFamily: "Pretendard-Regular" },
  badgeDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#2EC4B6" },

  /* 공통 */
  readAllBtn: { borderWidth: 1.5, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6 },
  readAllText: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  addBtn: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  empty: { alignItems: "center", gap: 10, paddingTop: 80 },
  emptyText: { fontSize: 16, fontFamily: "Pretendard-Regular" },
  emptySub: { fontSize: 13, fontFamily: "Pretendard-Regular", textAlign: "center", lineHeight: 20 },

  /* 받은 알림 카드 */
  card: { flexDirection: "row", alignItems: "flex-start", gap: 12, borderRadius: 14, padding: 14, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 1, shadowRadius: 8, elevation: 2 },
  iconBox: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  cardContent: { flex: 1, gap: 3 },
  cardTitle: { fontSize: 14, fontFamily: "Pretendard-Regular" },
  cardBody: { fontSize: 13, fontFamily: "Pretendard-Regular", lineHeight: 18 },
  cardTime: { fontSize: 11, fontFamily: "Pretendard-Regular" },
  cardRight: { alignItems: "center", gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },

  /* 자녀 필터 */
  studentTabs: { paddingHorizontal: 16, gap: 8, paddingVertical: 10 },
  studentChip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },

  /* 요청 카드 */
  reqCard: { borderRadius: 16, padding: 16, gap: 8, shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  highlightBanner: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 2 },
  highlightText: { fontSize: 11, color: "#2EC4B6", fontFamily: "Pretendard-Regular" },
  reqCardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  typeBadge: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  typeText: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  statusText: { fontSize: 12, fontFamily: "Pretendard-Regular" },
  reqContent: { fontSize: 14, fontFamily: "Pretendard-Regular", lineHeight: 20 },
  adminNote: { padding: 10, borderRadius: 8 },
  reqDate: { fontSize: 11, fontFamily: "Pretendard-Regular", textAlign: "right" },

  /* Modal */
  backdrop: { backgroundColor: "rgba(0,0,0,0.4)" },
  modalSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    maxHeight: "90%",
    flex: 1,
    minHeight: 0,
  },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  modalTitle: { fontSize: 18, fontFamily: "Pretendard-Regular" },
  label: { fontSize: 13, fontFamily: "Pretendard-Regular", marginBottom: 6 },
  typeBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12 },
  typeBtnText: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, fontFamily: "Pretendard-Regular", marginBottom: 10, minHeight: 90, textAlignVertical: "top" },
  hint: { fontSize: 12, fontFamily: "Pretendard-Regular", lineHeight: 18, marginBottom: 12 },
  error: { color: "#EF4444", fontSize: 13, fontFamily: "Pretendard-Regular", marginBottom: 8 },
  submitBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 16, borderRadius: 16, marginTop: 4 },
  submitBtnText: { fontSize: 16, fontFamily: "Pretendard-Regular" },
});
