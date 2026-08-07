/**
 * (parent)/notifications.tsx
 * 탭1: 받은 알림 (notifications)
 * 탭2: 내 요청 (parent_student_requests)
 *
 * URL params: tab=notifications|requests, requestId=<id> (딥링크용)
 */
import { LucideIcon } from "@/components/common/LucideIcon";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, FlatList, Keyboard, Modal, Platform,
  Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useParent } from "@/context/ParentContext";

const C = Colors.light;

// ── 타입 ─────────────────────────────────────────────────────────────────────

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  ref_id: string;
  ref_type: string;
  is_read: boolean;
  created_at: string;
  deep_link?: string | null;
}

interface ParentRequest {
  id: string;
  request_type: string;
  request_date: string | null;
  content: string | null;
  status: string;
  created_at: string;
  result_notified_at: string | null;
  student_name?: string | null;
}

// ── 상수 ─────────────────────────────────────────────────────────────────────

const TYPE_ICON_MAP: Record<string, { icon: "book-open" | "image" | "check-circle" | "x-circle" | "bell"; color: string; bg: string }> = {
  diary_upload:          { icon: "book-open",    color: "#2EC4B6", bg: "#E6FFFA" },
  photo_upload:          { icon: "image",        color: "#2EC4B6", bg: "#E6FFFA" },
  parent_request_result: { icon: "check-circle", color: "#059669", bg: "#ECFDF5" },
};

// 요청 목록 렌더링용 Record (key 기반 빠른 조회)
const REQUEST_TYPES: Record<string, { label: string; icon: string; color: string; bg: string }> = {
  absence:    { label: "결석 신청",  icon: "x-circle",       color: "#EF4444", bg: "#FEE2E2" },
  postpone:   { label: "연기 신청",  icon: "clock",          color: "#F59E0B", bg: "#FEF3C7" },
  makeup:     { label: "보강 요청",  icon: "refresh-cw",     color: "#3B82F6", bg: "#DBEAFE" },
  withdrawal: { label: "퇴원 신청",  icon: "log-out",        color: "#6B7280", bg: "#F3F4F6" },
  counseling: { label: "상담 요청",  icon: "message-circle", color: "#8B5CF6", bg: "#EDE9FE" },
  inquiry:    { label: "문의",       icon: "help-circle",    color: "#0EA5E9", bg: "#E0F2FE" },
};

// 요청 작성 Modal용 순서 배열 (UI 렌더링 순서 보장)
const REQUEST_TYPE_KEYS = [
  "absence", "postpone", "makeup", "withdrawal", "counseling", "inquiry",
] as const;
type RequestType = typeof REQUEST_TYPE_KEYS[number];

const STATUS_LABEL: Record<string, string> = {
  pending:   "처리 대기",
  done:      "처리 완료",
  rejected:  "거절됨",
  cancelled: "취소됨",
};
const STATUS_COLOR: Record<string, { text: string; bg: string }> = {
  pending:   { text: "#D97706", bg: "#FFF7ED" },
  done:      { text: "#059669", bg: "#ECFDF5" },
  rejected:  { text: "#EF4444", bg: "#FEF2F2" },
  cancelled: { text: "#9CA3AF", bg: "#F3F4F6" },
};

// ── 유틸 ─────────────────────────────────────────────────────────────────────

function timeAgo(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const diff = (Date.now() - date.getTime()) / 1000;
  if (!Number.isFinite(diff)) return "";
  if (diff < 60)    return "방금";
  if (diff < 3600)  return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  return `${Math.floor(diff / 86400)}일 전`;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });
}

// ── 컴포넌트 ─────────────────────────────────────────────────────────────────

export default function ParentNotificationsScreen() {
  const { token } = useAuth();
  const { students, selectedStudent } = useParent();
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const params = useLocalSearchParams<{ tab?: string; requestId?: string }>();

  // ── 키보드 높이 추적 ──────────────────────────────────────────────────────
  const [kbHeight, setKbHeight] = useState(0);

  // ── Modal 높이·위치 계산 ─────────────────────────────────────────────────
  const normalHeight = screenHeight * 0.88;
  const availableHeight = screenHeight - kbHeight - insets.top - 8;
  const modalHeight = kbHeight > 0
    ? Math.min(normalHeight, availableHeight)
    : normalHeight;
  // iOS: sheet를 키보드 상단으로 올림. Android: adjustResize로 자체 처리하므로 0 유지.
  const modalBottom = Platform.OS === "ios" && kbHeight > 0 ? kbHeight : 0;

  useEffect(() => {
    if (Platform.OS === "ios") {
      const change = Keyboard.addListener("keyboardWillChangeFrame",
        e => setKbHeight(e.endCoordinates.height),
      );
      const hide = Keyboard.addListener("keyboardWillHide",
        () => setKbHeight(0),
      );
      return () => { change.remove(); hide.remove(); };
    } else {
      const show = Keyboard.addListener("keyboardDidShow",
        e => setKbHeight(e.endCoordinates.height),
      );
      const hide = Keyboard.addListener("keyboardDidHide",
        () => setKbHeight(0),
      );
      return () => { show.remove(); hide.remove(); };
    }
  }, []);

  const [activeTab, setActiveTab] = useState<"notifications" | "requests">(
    params.tab === "requests" ? "requests" : "notifications"
  );

  // ── 알림 탭 상태 ─────────────────────────────────────────────────────────
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loadingNotif, setLoadingNotif] = useState(true);
  const [refreshingNotif, setRefreshingNotif] = useState(false);

  // ── 요청 탭 상태 ─────────────────────────────────────────────────────────
  const [requests, setRequests] = useState<ParentRequest[]>([]);
  const [loadingReqs, setLoadingReqs] = useState(true);
  const [refreshingReqs, setRefreshingReqs] = useState(false);
  const [selStudentId, setSelStudentId] = useState<string>(selectedStudent?.id || students[0]?.id || "");

  // 딥링크 target requestId (스크롤 하이라이트용)
  const [deepLinkRequestId, setDeepLinkRequestId] = useState<string | null>(params.requestId ?? null);
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── 요청 작성 Modal 상태 ─────────────────────────────────────────────────
  const [modalVisible, setModalVisible] = useState(false);
  const [reqType, setReqType] = useState<RequestType>("absence");
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // ── 알림 fetch ────────────────────────────────────────────────────────────
  const fetchNotifications = useCallback(async () => {
    try {
      const res = await apiRequest(token, "/notifications");
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications || []);
        setUnread(data.unread_count || 0);
      }
    } finally { setLoadingNotif(false); setRefreshingNotif(false); }
  }, [token]);

  // ── 요청 fetch ────────────────────────────────────────────────────────────
  const fetchRequests = useCallback(async (sid?: string) => {
    const studentId = sid ?? selStudentId;
    if (!studentId) { setRequests([]); setLoadingReqs(false); setRefreshingReqs(false); return; }
    try {
      const res = await apiRequest(token, `/parent/requests?student_id=${studentId}`);
      if (res.ok) {
        const d = await res.json();
        setRequests(d.data || []);
      }
    } finally { setLoadingReqs(false); setRefreshingReqs(false); }
  }, [token, selStudentId]);

  useEffect(() => { fetchNotifications(); }, [fetchNotifications]);
  useEffect(() => { fetchRequests(); }, [fetchRequests]);

  // 딥링크 하이라이트 3초 후 해제
  useEffect(() => {
    if (deepLinkRequestId) {
      highlightTimeoutRef.current = setTimeout(() => setDeepLinkRequestId(null), 3000);
    }
    return () => { if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current); };
  }, [deepLinkRequestId]);

  // 자녀 탭 변경 시
  useEffect(() => {
    if (selectedStudent?.id) setSelStudentId(selectedStudent.id);
  }, [selectedStudent?.id]);

  // ── 알림 탭 핸들러 ────────────────────────────────────────────────────────

  async function handleNotifPress(n: Notification) {
    if (!n.is_read) {
      await apiRequest(token, `/notifications/${n.id}/read`, { method: "POST" });
      setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, is_read: true } : x));
      setUnread(prev => Math.max(0, prev - 1));
    }
    // 딥링크 처리
    if (n.deep_link) {
      const dl = n.deep_link;
      if (dl.startsWith("/(parent)/notifications")) {
        const url = new URL("http://x" + dl);
        const tab = url.searchParams.get("tab");
        const rid = url.searchParams.get("requestId");
        if (tab === "requests") {
          setDeepLinkRequestId(rid ?? null);
          setActiveTab("requests");
          return;
        }
      }
    }
    // 타입별 기본 이동
    if (n.type === "parent_request_result") {
      setActiveTab("requests");
    } else if (n.ref_type === "diary" || n.type === "diary_upload") {
      router.push("/(parent)/children?backTo=notifications" as any);
    } else if (n.ref_type === "student" || n.type === "photo_upload") {
      router.push("/(parent)/children?backTo=notifications" as any);
    }
  }

  async function markAllRead() {
    await apiRequest(token, "/notifications/read-all", { method: "POST" });
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    setUnread(0);
  }

  async function deleteNotif(id: string) {
    await apiRequest(token, `/notifications/${id}`, { method: "DELETE" });
    setNotifications(prev => prev.filter(n => n.id !== id));
  }

  // ── 요청 작성 핸들러 ──────────────────────────────────────────────────────

  function openCreateModal() {
    setReqType("absence");
    setContent("");
    setErrorMsg("");
    setModalVisible(true);
  }

  function closeCreateModal() {
    if (submitting) return;
    setModalVisible(false);
    setContent("");
    setErrorMsg("");
  }

  async function handleSubmit() {
    if (!selStudentId) { setErrorMsg("자녀를 선택해주세요."); return; }
    if (submitting) return;
    setSubmitting(true);
    setErrorMsg("");
    try {
      const r = await apiRequest(token, "/parent/requests", {
        method: "POST",
        body: JSON.stringify({
          student_id: selStudentId,
          request_type: reqType,
          content: content.trim() || null,
        }),
      });
      if (r.ok) {
        setModalVisible(false);
        setContent("");
        setErrorMsg("");
        setActiveTab("requests");
        setLoadingReqs(true);
        fetchRequests();
      } else {
        const d = await r.json().catch(() => ({}));
        setErrorMsg((d as any).message || "요청 전송 실패");
      }
    } catch {
      setErrorMsg("네트워크 오류가 발생했습니다.");
    }
    setSubmitting(false);
  }

  // ── 렌더 헬퍼 ────────────────────────────────────────────────────────────

  const notifConfig = (type: string) =>
    TYPE_ICON_MAP[type] ?? { icon: "bell" as const, color: C.textSecondary, bg: C.border };

  const unreadCount = notifications.filter(n => !n.is_read).length;
  const unreadRequestCount = requests.filter(r => r.status === "pending").length;

  // ── 탭 헤더 오른쪽 버튼 ──────────────────────────────────────────────────
  const rightSlot = activeTab === "notifications" && unread > 0 ? (
    <Pressable style={[styles.readAllBtn, { borderColor: C.border }]} onPress={markAllRead}>
      <Text style={[styles.readAllText, { color: C.textSecondary }]}>모두 읽음</Text>
    </Pressable>
  ) : undefined;

  // ── 요청 추가 버튼 ────────────────────────────────────────────────────────
  const addBtn = activeTab === "requests" ? (
    <Pressable
      style={[styles.addBtn, { backgroundColor: C.tint }]}
      onPress={openCreateModal}
    >
      <LucideIcon name="plus" size={18} color="#fff" />
    </Pressable>
  ) : undefined;

  return (
    <View style={[styles.root, { backgroundColor: C.background }]}>
      <SubScreenHeader
        title={activeTab === "notifications" ? "알림" : "내 요청"}
        subtitle={
          activeTab === "notifications" && unread > 0
            ? `읽지 않은 알림 ${unread}개`
            : undefined
        }
        rightSlot={rightSlot ?? addBtn}
      />

      {/* 탭 */}
      <View style={styles.tabRow}>
        <Pressable
          style={[styles.tab, activeTab === "notifications" && { borderBottomColor: C.tint, borderBottomWidth: 2 }]}
          onPress={() => setActiveTab("notifications")}
        >
          <LucideIcon name="bell" size={15} color={activeTab === "notifications" ? C.tint : C.textMuted} />
          <Text style={[styles.tabTxt, { color: activeTab === "notifications" ? C.tint : C.textMuted }]}>
            받은 알림
          </Text>
          {unreadCount > 0 && (
            <View style={[styles.tabBadge, { backgroundColor: "#EF4444" }]}>
              <Text style={styles.tabBadgeTxt}>{unreadCount}</Text>
            </View>
          )}
        </Pressable>

        <Pressable
          style={[styles.tab, activeTab === "requests" && { borderBottomColor: C.tint, borderBottomWidth: 2 }]}
          onPress={() => setActiveTab("requests")}
        >
          <LucideIcon name="clipboard-list" size={15} color={activeTab === "requests" ? C.tint : C.textMuted} />
          <Text style={[styles.tabTxt, { color: activeTab === "requests" ? C.tint : C.textMuted }]}>
            내 요청
          </Text>
          {unreadRequestCount > 0 && (
            <View style={[styles.tabBadge, { backgroundColor: "#F59E0B" }]}>
              <Text style={styles.tabBadgeTxt}>{unreadRequestCount}</Text>
            </View>
          )}
        </Pressable>
      </View>

      {/* ── 알림 탭 ── */}
      {activeTab === "notifications" && (
        loadingNotif ? (
          <ActivityIndicator color="#2EC4B6" style={{ marginTop: 60 }} />
        ) : (
          <View style={{ flex: 1, minHeight: 0 }}>
            <FlatList
              style={{ flex: 1, minHeight: 0 }}
              removeClippedSubviews={false}
              data={notifications}
              keyExtractor={n => n.id}
              contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 100, gap: 10 }}
              showsVerticalScrollIndicator={false}
              refreshControl={
                <RefreshControl
                  refreshing={refreshingNotif}
                  onRefresh={() => { setRefreshingNotif(true); fetchNotifications(); }}
                  tintColor="#2EC4B6"
                />
              }
              ListEmptyComponent={
                <View style={styles.empty}>
                  <LucideIcon name="bell-off" size={40} color={C.textMuted} />
                  <Text style={[styles.emptyText, { color: C.textMuted }]}>알림이 없습니다</Text>
                  <Text style={[styles.emptySub, { color: C.textMuted }]}>
                    수영 일지나 사진이 업로드되면{"\n"}여기에 알림이 옵니다
                  </Text>
                </View>
              }
              renderItem={({ item: n }) => {
                const cfg = notifConfig(n.type);
                return (
                  <Pressable
                    style={({ pressed }) => [
                      styles.card,
                      { backgroundColor: n.is_read ? C.card : "#DDF2EF30", shadowColor: C.shadow, opacity: pressed ? 0.9 : 1 },
                    ]}
                    onPress={() => handleNotifPress(n)}
                  >
                    <View style={[styles.iconBox, { backgroundColor: cfg.bg }]}>
                      <LucideIcon name={cfg.icon} size={18} color={cfg.color} />
                    </View>
                    <View style={styles.cardContent}>
                      <Text style={[styles.cardTitle, { color: C.text }]}>{n.title}</Text>
                      <Text style={[styles.cardBody, { color: C.textSecondary }]} numberOfLines={2}>
                        {n.body}
                      </Text>
                      <Text style={[styles.cardTime, { color: C.textMuted }]}>{timeAgo(n.created_at)}</Text>
                    </View>
                    <View style={styles.cardRight}>
                      {!n.is_read && <View style={[styles.dot, { backgroundColor: "#2EC4B6" }]} />}
                      <Pressable onPress={() => deleteNotif(n.id)} hitSlop={8}>
                        <LucideIcon name="x" size={14} color={C.textMuted} />
                      </Pressable>
                    </View>
                  </Pressable>
                );
              }}
            />
          </View>
        )
      )}

      {/* ── 요청 탭 ── */}
      {activeTab === "requests" && (
        <>
          {/* 자녀 선택 탭 (자녀 2명 이상) */}
          {students.length > 1 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.studentTabs}
            >
              {students.map(st => (
                <Pressable
                  key={st.id}
                  style={[styles.studentTab, { backgroundColor: selStudentId === st.id ? C.tint : C.card }]}
                  onPress={() => {
                    setSelStudentId(st.id);
                    setLoadingReqs(true);
                    fetchRequests(st.id);
                  }}
                >
                  <Text style={{ fontSize: 14, fontFamily: "Pretendard-Regular", color: selStudentId === st.id ? "#fff" : C.text }}>
                    {st.name}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          )}

          {loadingReqs ? (
            <ActivityIndicator color="#2EC4B6" style={{ marginTop: 60 }} />
          ) : (
            <View style={{ flex: 1, minHeight: 0 }}>
              <FlatList
                style={{ flex: 1, minHeight: 0 }}
                removeClippedSubviews={false}
                data={requests}
                keyExtractor={req => req.id}
                contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 100, gap: 10 }}
                showsVerticalScrollIndicator={false}
                refreshControl={
                  <RefreshControl
                    refreshing={refreshingReqs}
                    onRefresh={() => { setRefreshingReqs(true); fetchRequests(); }}
                    tintColor="#2EC4B6"
                  />
                }
                ListEmptyComponent={
                  <View style={styles.empty}>
                    <LucideIcon name="clipboard-list" size={40} color={C.textMuted} />
                    <Text style={[styles.emptyText, { color: C.textMuted }]}>요청 내역이 없습니다</Text>
                    <Text style={[styles.emptySub, { color: C.textMuted }]}>
                      + 버튼을 눌러 새 요청을 보낼 수 있습니다
                    </Text>
                  </View>
                }
                renderItem={({ item: req }) => {
                  const typeCfg = REQUEST_TYPES[req.request_type];
                  const statusCfg = STATUS_COLOR[req.status] ?? STATUS_COLOR.pending;
                  const isHighlighted = req.id === deepLinkRequestId;

                  return (
                    <View
                      style={[
                        styles.reqCard,
                        { backgroundColor: C.card },
                        isHighlighted && { borderColor: "#2EC4B6", borderWidth: 2, backgroundColor: "#DDF2EF30" },
                      ]}
                    >
                      <View style={styles.reqCardTop}>
                        <View style={[styles.typeBadge, { backgroundColor: typeCfg?.bg ?? "#F3F4F6" }]}>
                          <LucideIcon name={(typeCfg?.icon ?? "help-circle") as any} size={13} color={typeCfg?.color ?? C.textMuted} />
                          <Text style={[styles.typeText, { color: typeCfg?.color ?? C.textMuted }]}>
                            {typeCfg?.label ?? req.request_type}
                          </Text>
                        </View>
                        <View style={[styles.statusBadge, { backgroundColor: statusCfg.bg }]}>
                          <Text style={[styles.statusText, { color: statusCfg.text }]}>
                            {STATUS_LABEL[req.status] ?? req.status}
                          </Text>
                        </View>
                      </View>

                      {req.request_date && (
                        <Text style={[styles.reqDate, { color: C.textSecondary }]}>신청일: {req.request_date}</Text>
                      )}
                      {req.content ? (
                        <Text style={[styles.reqContent, { color: C.text }]} numberOfLines={3}>{req.content}</Text>
                      ) : null}

                      <View style={styles.reqFooter}>
                        <Text style={[styles.reqCreatedAt, { color: C.textMuted }]}>{fmtDate(req.created_at)}</Text>
                        {req.result_notified_at && (
                          <View style={styles.notifiedBadge}>
                            <LucideIcon name="check-circle" size={11} color="#059669" />
                            <Text style={styles.notifiedText}>결과 알림 받음</Text>
                          </View>
                        )}
                      </View>
                    </View>
                  );
                }}
              />
            </View>
          )}
        </>
      )}

      {/* ── 요청 작성 Modal ── */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent
        onRequestClose={closeCreateModal}
      >
        {/* Root — 반투명 배경 */}
        <View style={styles.modalRoot}>
          {/* Backdrop — absoluteFillObject로 전체 화면 커버 (z 하단) */}
          <Pressable style={StyleSheet.absoluteFillObject} onPress={closeCreateModal} />
          {/* Sheet — KAV 없이 직접 높이 계산으로 빈 공간 제거 (z 상단) */}
          <View
            style={[
              styles.modalSheet,
              {
                height: modalHeight,
                bottom: modalBottom,
                backgroundColor: C.background,
                paddingBottom: kbHeight > 0 ? 8 : insets.bottom + 8,
              },
            ]}
          >
              {/* 헤더 — 고정 */}
              <View style={styles.modalHeader}>
                <Text style={[styles.modalTitle, { color: C.text }]}>새 요청 보내기</Text>
                <Pressable onPress={closeCreateModal} hitSlop={8}>
                  <Text style={{ fontSize: 15, color: C.textMuted, fontFamily: "Pretendard-Regular" }}>취소</Text>
                </Pressable>
              </View>

              {/* 스크롤 영역 — flex:1로 sheet 내부 남은 공간 모두 차지 */}
              <ScrollView
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.modalScrollContent}
                style={styles.modalScrollView}
                bounces
              >
                {/* 요청 유형 선택 */}
                <Text style={[styles.modalLabel, { color: C.textSecondary }]}>요청 유형</Text>
                <View style={styles.typeGrid}>
                  {REQUEST_TYPE_KEYS.map(key => {
                    const cfg = REQUEST_TYPES[key];
                    const selected = reqType === key;
                    return (
                      <Pressable
                        key={key}
                        style={[
                          styles.typeBtn,
                          {
                            backgroundColor: selected ? cfg.bg : C.card,
                            borderWidth: selected ? 1.5 : 1,
                            borderColor: selected ? cfg.color : C.border,
                          },
                        ]}
                        onPress={() => setReqType(key)}
                      >
                        <LucideIcon name={cfg.icon as any} size={14} color={selected ? cfg.color : C.textSecondary} />
                        <Text style={[styles.typeBtnText, { color: selected ? cfg.color : C.text }]}>
                          {cfg.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                {/* 학생 선택 (자녀 0명) */}
                {students.length === 0 && (
                  <Text style={[styles.modalHint, { color: C.textMuted, textAlign: "center", marginBottom: 16 }]}>
                    연결된 자녀가 없습니다. 자녀를 먼저 등록해 주세요.
                  </Text>
                )}

                {/* 학생 선택 (자녀 2명 이상) */}
                {students.length > 1 && (
                  <>
                    <Text style={[styles.modalLabel, { color: C.textSecondary }]}>학생 선택</Text>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      keyboardShouldPersistTaps="handled"
                      contentContainerStyle={{ gap: 8, marginBottom: 16 }}
                      nestedScrollEnabled
                    >
                      {students.map(st => (
                        <Pressable
                          key={st.id}
                          style={[styles.studentChip, { backgroundColor: selStudentId === st.id ? C.tint : C.card, borderColor: selStudentId === st.id ? C.tint : C.border }]}
                          onPress={() => setSelStudentId(st.id)}
                        >
                          <Text
                            numberOfLines={1}
                            style={{ fontSize: 13, color: selStudentId === st.id ? "#fff" : C.text, fontFamily: "Pretendard-Regular", maxWidth: 120 }}
                          >
                            {st.name}
                          </Text>
                        </Pressable>
                      ))}
                    </ScrollView>
                  </>
                )}

                {/* 요청 내용 입력 */}
                <Text style={[styles.modalLabel, { color: C.textSecondary }]}>요청 내용</Text>
                <TextInput
                  style={[styles.modalInput, styles.modalMultiline, { borderColor: C.border, color: C.text, backgroundColor: C.card }]}
                  placeholder="요청 내용을 입력해 주세요 (선택)"
                  placeholderTextColor={C.textMuted}
                  value={content}
                  onChangeText={setContent}
                  multiline
                  returnKeyType="default"
                  textAlignVertical="top"
                  maxLength={500}
                />

                {/* 안내 사항 */}
                <Text style={[styles.modalHint, { color: C.textMuted }]}>
                  요청은 담당 코치에게 전달됩니다. 결석·연기 신청은 수업 24시간 전까지 보내주세요.
                </Text>

                {/* 오류 메시지 */}
                {!!errorMsg && (
                  <Text style={styles.modalError}>{errorMsg}</Text>
                )}

                {/* 제출 버튼 */}
                <Pressable
                  style={[styles.submitBtn, { backgroundColor: (submitting || students.length === 0) ? C.textMuted : C.tint }]}
                  onPress={handleSubmit}
                  disabled={submitting || students.length === 0}
                >
                  {submitting ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <LucideIcon name="send" size={16} color="#fff" />
                      <Text style={styles.submitBtnText}>요청 보내기</Text>
                    </>
                  )}
                </Pressable>
              </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root:          { flex: 1 },

  tabRow:        { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: Colors.light.border },
  tab:           { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 12 },
  tabTxt:        { fontSize: 14, fontFamily: "Pretendard-Regular", lineHeight: 19 },
  tabBadge:      { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 8 },
  tabBadgeTxt:   { color: "#fff", fontSize: 11, lineHeight: 15, fontFamily: "Pretendard-Regular" },

  readAllBtn:    { borderWidth: 1.5, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6 },
  readAllText:   { fontSize: 13, fontFamily: "Pretendard-Regular" },
  addBtn:        { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },

  studentTabs:   { paddingHorizontal: 16, gap: 8, paddingBottom: 10, paddingTop: 10 },
  studentTab:    { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },

  empty:         { alignItems: "center", gap: 10, paddingTop: 80 },
  emptyText:     { fontSize: 16, fontFamily: "Pretendard-Regular" },
  emptySub:      { fontSize: 13, fontFamily: "Pretendard-Regular", textAlign: "center", lineHeight: 20 },

  card:          { flexDirection: "row", alignItems: "flex-start", gap: 12, borderRadius: 14, padding: 14, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 1, shadowRadius: 8, elevation: 2 },
  iconBox:       { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  cardContent:   { flex: 1, gap: 3 },
  cardTitle:     { fontSize: 14, fontFamily: "Pretendard-Regular" },
  cardBody:      { fontSize: 13, fontFamily: "Pretendard-Regular", lineHeight: 18 },
  cardTime:      { fontSize: 11, fontFamily: "Pretendard-Regular" },
  cardRight:     { alignItems: "center", gap: 8 },
  dot:           { width: 8, height: 8, borderRadius: 4 },

  reqCard:       { borderRadius: 14, padding: 14, gap: 8, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2, borderWidth: 1, borderColor: Colors.light.border },
  reqCardTop:    { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  typeBadge:     { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  typeText:      { fontSize: 12, fontFamily: "Pretendard-Regular" },
  statusBadge:   { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  statusText:    { fontSize: 12, fontFamily: "Pretendard-Regular" },
  reqDate:       { fontSize: 13, fontFamily: "Pretendard-Regular" },
  reqContent:    { fontSize: 14, fontFamily: "Pretendard-Regular", lineHeight: 20 },
  reqFooter:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 2 },
  reqCreatedAt:  { fontSize: 11, fontFamily: "Pretendard-Regular" },
  notifiedBadge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#ECFDF5", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  notifiedText:  { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#059669" },

  // ── 요청 작성 Modal 스타일 ─────────────────────────────────────────────────
  modalRoot:          { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.45)" },
  modalSheet:         { position: "absolute", left: 0, right: 0, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 24, paddingTop: 20 },
  modalHeader:        { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  modalTitle:         { fontSize: 18, fontFamily: "Pretendard-Regular" },
  modalScrollView:    { flex: 1 },
  modalScrollContent: { paddingBottom: 16 },
  modalLabel:         { fontSize: 13, fontFamily: "Pretendard-Regular", marginBottom: 8 },
  modalHint:          { fontSize: 12, fontFamily: "Pretendard-Regular", lineHeight: 18, marginBottom: 16 },
  studentChip:        { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  typeGrid:           { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 16 },
  typeBtn:            { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12 },
  typeBtnText:        { fontSize: 13, fontFamily: "Pretendard-Regular" },
  modalInput:         { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, fontFamily: "Pretendard-Regular", marginBottom: 10 },
  modalMultiline:     { minHeight: 100, textAlignVertical: "top" },
  modalError:         { color: "#EF4444", fontSize: 13, fontFamily: "Pretendard-Regular", marginBottom: 8 },
  submitBtn:          { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 16, borderRadius: 16, marginTop: 4, marginBottom: 8 },
  submitBtnText:      { color: "#fff", fontSize: 16, fontFamily: "Pretendard-Regular" },
});
