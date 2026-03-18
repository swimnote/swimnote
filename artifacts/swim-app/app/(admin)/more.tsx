/**
 * 더보기 탭 — 설정 허브
 * 결제, 지점, 브랜드, 선생님 관리, 승인, 활동 로그, 모드 변경
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, FlatList, Modal, Pressable,
  RefreshControl, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { ROLE_CONFIGS } from "@/constants/auth";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { PageHeader } from "@/components/common/PageHeader";
import { useTabScrollReset } from "@/hooks/useTabScrollReset";

const C = Colors.light;
const TABS = ["설정 메뉴", "활동 로그", "이벤트 기록"] as const;
type Tab = typeof TABS[number];

function fmtBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

interface StaffStorage {
  id: string; name: string; role: string;
  photo_bytes: number; video_bytes: number;
  messenger_bytes: number; diary_bytes: number;
  notice_bytes: number; system_bytes: number; total_bytes: number;
}
interface AdminStorage {
  photo_bytes: number; video_bytes: number;
  messenger_bytes: number; diary_bytes: number;
  notice_bytes: number; system_bytes: number;
  total_bytes: number; quota_bytes: number;
  staff: StaffStorage[];
}

interface ActivityLog {
  id: string; target_name: string; action_type: string; target_type: string;
  before_value: string | null; after_value: string | null;
  actor_name: string; actor_role: string; note: string | null; created_at: string;
}

const ACTION_META: Record<string, { label: string; icon: string; color: string }> = {
  update:  { label: "정보 수정",  icon: "edit-2",      color: "#2563EB" },
  create:  { label: "신규 등록",  icon: "plus-circle", color: "#059669" },
  delete:  { label: "삭제",       icon: "trash-2",     color: "#DC2626" },
  restore: { label: "복구",       icon: "rotate-ccw",  color: "#7C3AED" },
  assign:  { label: "반 배정",    icon: "link",        color: "#D97706" },
};

const TYPE_LABEL: Record<string, string> = {
  status: "상태", info: "기본정보", class: "반", diary: "일지",
  attendance: "출결", parent: "학부모",
};

interface EventLogItem {
  id: string; pool_id: string; category: string;
  actor_id: string; actor_name: string; target: string | null;
  description: string; metadata: any; created_at: string;
}

const EVENT_CAT_META: Record<string, { icon: string; color: string; bg: string }> = {
  "삭제":     { icon: "trash-2",      color: "#DC2626", bg: "#FEE2E2" },
  "결제":     { icon: "credit-card",  color: "#059669", bg: "#D1FAE5" },
  "구독":     { icon: "star",         color: "#7C3AED", bg: "#EDE9FE" },
  "해지":     { icon: "x-circle",     color: "#F59E0B", bg: "#FEF3C7" },
  "권한":     { icon: "shield",       color: "#2563EB", bg: "#DBEAFE" },
  "선생님":   { icon: "user-check",   color: "#0D9488", bg: "#CCFBF1" },
  "저장공간": { icon: "hard-drive",   color: "#EC4899", bg: "#FCE7F3" },
  "휴무일":   { icon: "calendar",     color: "#6B7280", bg: "#F3F4F6" },
};
const EVENT_CATEGORIES = ["전체", "삭제", "결제", "구독", "해지", "권한", "선생님", "저장공간", "휴무일"] as const;

const KS_TYPES = [
  { key: "photo",  label: "사진",    icon: "image" as const,    color: "#F59E0B", bg: "#FEF3C7" },
  { key: "video",  label: "영상",    icon: "video" as const,    color: "#7C3AED", bg: "#EDE9FE" },
  { key: "record", label: "기록/일지", icon: "book-open" as const, color: "#059669", bg: "#D1FAE5" },
];

export default function MoreScreen() {
  const { token, adminUser, switchRole } = useAuth();
  const { themeColor } = useBrand();
  const insets = useSafeAreaInsets();
  const scrollRef = useTabScrollReset("more");

  const [tab, setTab] = useState<Tab>("설정 메뉴");
  const [switchModalVisible, setSwitchModalVisible] = useState(false);
  const [switching, setSwitching] = useState(false);

  const hasMultipleRoles = (adminUser?.roles?.length ?? 0) >= 2;

  /* ─ 저장공간 ─ */
  const [adminStorage, setAdminStorage] = useState<AdminStorage | null>(null);
  const [storageLoading, setStorageLoading] = useState(false);
  const [selectedStaff, setSelectedStaff] = useState<StaffStorage | null>(null);

  async function handleSwitchRole(role: string) {
    setSwitching(true);
    try {
      await switchRole(role);
      setSwitchModalVisible(false);
      const cfg = ROLE_CONFIGS[role];
      if (cfg) router.replace(cfg.route as any);
    } catch (e) { console.error(e); }
    finally { setSwitching(false); }
  }
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsPage, setLogsPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  /* ─ 이벤트 기록 ─ */
  const [eventLogs, setEventLogs] = useState<EventLogItem[]>([]);
  const [eventLogsLoading, setEventLogsLoading] = useState(false);
  const [eventLogsPage, setEventLogsPage] = useState(0);
  const [eventLogsHasMore, setEventLogsHasMore] = useState(true);
  const [eventLogsFilter, setEventLogsFilter] = useState<string>("전체");
  const [eventLogsRefreshing, setEventLogsRefreshing] = useState(false);

  /* ─ 킬 스위치 ─ */
  const [ksModalVisible, setKsModalVisible]         = useState(false);
  const [ksType,          setKsType]                = useState("photo");
  const [ksMonths,        setKsMonths]              = useState(3);
  const [ksPreview,       setKsPreview]             = useState<{ count: number; total_bytes: number } | null>(null);
  const [ksPreviewLoading, setKsPreviewLoading]     = useState(false);
  const [ksStep,          setKsStep]                = useState<"select" | "preview" | "confirm">("select");
  const [ksPassword,      setKsPassword]            = useState("");
  const [ksExecLoading,   setKsExecLoading]         = useState(false);
  const [ksResult,        setKsResult]              = useState<string | null>(null);

  const loadStorage = useCallback(async () => {
    setStorageLoading(true);
    try {
      const res = await apiRequest(token, "/admin/storage");
      if (res.ok) setAdminStorage(await res.json());
    } catch (e) { console.error(e); }
    finally { setStorageLoading(false); }
  }, [token]);

  useEffect(() => { loadStorage(); }, [loadStorage]);

  const loadLogs = useCallback(async (page = 0) => {
    if (logsLoading) return;
    setLogsLoading(true);
    try {
      const res = await apiRequest(token, `/admin/activity-logs?limit=30&offset=${page * 30}`);
      if (res.ok) {
        const data: ActivityLog[] = await res.json();
        if (page === 0) setLogs(data);
        else setLogs(prev => [...prev, ...data]);
        setHasMore(data.length === 30);
        setLogsPage(page);
      }
    } catch (e) { console.error(e); }
    finally { setLogsLoading(false); setRefreshing(false); }
  }, [token, logsLoading]);

  useEffect(() => {
    if (tab === "활동 로그") loadLogs(0);
  }, [tab]);

  const loadEventLogs = useCallback(async (page = 0, filter = eventLogsFilter) => {
    if (eventLogsLoading) return;
    setEventLogsLoading(true);
    try {
      const cat = filter === "전체" ? "" : `&category=${encodeURIComponent(filter)}`;
      const res = await apiRequest(token, `/admin/event-logs?limit=30&offset=${page * 30}${cat}`);
      if (res.ok) {
        const data: EventLogItem[] = await res.json();
        if (page === 0) setEventLogs(data);
        else setEventLogs(prev => [...prev, ...data]);
        setEventLogsHasMore(data.length === 30);
        setEventLogsPage(page);
      }
    } catch (e) { console.error(e); }
    finally { setEventLogsLoading(false); setEventLogsRefreshing(false); }
  }, [token, eventLogsLoading, eventLogsFilter]);

  useEffect(() => {
    if (tab === "이벤트 기록") loadEventLogs(0, eventLogsFilter);
  }, [tab, eventLogsFilter]);

  async function ksLoadPreview() {
    setKsPreviewLoading(true);
    try {
      const res = await apiRequest(token, "/admin/kill-switch/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ types: [ksType], months: ksMonths }),
      });
      if (res.ok) {
        const data = await res.json();
        setKsPreview({ count: data.count ?? 0, total_bytes: data.total_bytes ?? 0 });
        setKsStep("preview");
      }
    } catch (e) { console.error(e); }
    finally { setKsPreviewLoading(false); }
  }

  async function ksExecute() {
    setKsExecLoading(true);
    try {
      const res = await apiRequest(token, "/admin/kill-switch/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ types: [ksType], months: ksMonths, password: ksPassword }),
      });
      const data = await res.json();
      if (res.ok) {
        setKsResult(`삭제 완료: ${data.deleted_count ?? 0}건, ${fmtBytes(data.deleted_bytes ?? 0)} 정리됨`);
        setKsStep("confirm");
        setKsPassword("");
      } else {
        setKsResult(`오류: ${data.error || data.message || "알 수 없는 오류"}`);
      }
    } catch (e) { setKsResult("서버 오류가 발생했습니다."); }
    finally { setKsExecLoading(false); }
  }

  function ksReset() {
    setKsModalVisible(false);
    setKsStep("select");
    setKsPreview(null);
    setKsPassword("");
    setKsResult(null);
  }

  const settingGroups = [
    {
      title: "운영",
      items: [
        { label: "승인 관리",    icon: "check-circle" as const, color: "#059669", bg: "#D1FAE5", route: "/(admin)/approvals"          },
        { label: "선생님 관리",  icon: "user-check"   as const, color: "#7C3AED", bg: "#F3E8FF", route: "/(admin)/teachers"           },
        { label: "학부모 계정",  icon: "users"        as const, color: "#2563EB", bg: "#DBEAFE", route: "/(admin)/parents"            },
        { label: "수업 관리",    icon: "book-open"    as const, color: "#0D9488", bg: "#CCFBF1", route: "/(admin)/class-management"   },
        { label: "삭제/복구 센터", icon: "archive"      as const, color: "#DC2626", bg: "#FEE2E2", route: "/(admin)/withdrawn-members" },
      ],
    },
    {
      title: "정산 · 일정",
      items: [
        { label: "수업 단가표",  icon: "dollar-sign"  as const, color: "#7C3AED", bg: "#EDE9FE", route: "/(admin)/pool-settings" },
        { label: "휴무일 관리",  icon: "x-square"     as const, color: "#EF4444", bg: "#FEE2E2", route: "/(admin)/holidays"      },
      ],
    },
    {
      title: "설정",
      items: [
        { label: "브랜드 설정",  icon: "sliders"      as const, color: "#EC4899", bg: "#FCE7F3", route: "/(admin)/branding"      },
        { label: "지점 관리",    icon: "map-pin"      as const, color: "#0D9488", bg: "#CCFBF1", route: "/(admin)/branches"      },
        { label: "알림 설정",    icon: "bell"         as const, color: "#D97706", bg: "#FEF3C7", route: "/(admin)/notifications" },
        { label: "수영장 설정",  icon: "settings"     as const, color: "#6B7280", bg: "#F3F4F6", route: "/(admin)/pool-settings" },
      ],
    },
    {
      title: "앱 구독",
      items: [
        { label: "구독관리",     icon: "credit-card"  as const, color: "#D97706", bg: "#FEF3C7", route: "/(admin)/billing"       },
      ],
    },
    {
      title: "기타",
      items: [
        { label: "모드 변경",    icon: "grid"         as const, color: "#6B7280", bg: "#F3F4F6", route: "/(admin)/mode"          },
      ],
    },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <PageHeader title="더보기" />

      {/* 탭바 */}
      <View style={s.tabBar}>
        {TABS.map(t => (
          <Pressable key={t} style={[s.tabItem, tab === t && { borderBottomColor: themeColor, borderBottomWidth: 2 }]} onPress={() => setTab(t)}>
            <Text style={[s.tabText, { color: tab === t ? themeColor : C.textSecondary }]}>{t}</Text>
          </Pressable>
        ))}
      </View>

      {tab === "설정 메뉴" ? (
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={{ padding: 16, gap: 20, paddingBottom: insets.bottom + 100 }}
          showsVerticalScrollIndicator={false}
        >
          {/* 프로필 카드 */}
          <View style={[s.profileCard, { backgroundColor: C.card }]}>
            <View style={[s.profileAvatar, { backgroundColor: themeColor + "20" }]}>
              <Text style={[s.profileInitial, { color: themeColor }]}>{adminUser?.name?.[0] || "A"}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.profileName}>{adminUser?.name || "관리자"}</Text>
              <Text style={s.profileRole}>수영장 관리자</Text>
            </View>
            {hasMultipleRoles && (
              <Pressable
                style={[s.switchBtn, { borderColor: themeColor }]}
                onPress={() => setSwitchModalVisible(true)}
              >
                <Feather name="repeat" size={14} color={themeColor} />
                <Text style={[s.switchBtnText, { color: themeColor }]}>역할 전환</Text>
              </Pressable>
            )}
          </View>

          {/* 설정 그룹 */}
          {settingGroups.map(group => (
            <View key={group.title}>
              <Text style={s.groupTitle}>{group.title}</Text>
              <View style={[s.groupCard, { backgroundColor: C.card }]}>
                {group.items.map((item, idx) => (
                  <Pressable
                    key={item.label}
                    style={({ pressed }) => [
                      s.menuRow,
                      idx < group.items.length - 1 && s.menuRowBorder,
                      { opacity: pressed ? 0.7 : 1 },
                    ]}
                    onPress={() => router.push(item.route as any)}
                  >
                    <View style={[s.menuIcon, { backgroundColor: item.bg }]}>
                      <Feather name={item.icon} size={18} color={item.color} />
                    </View>
                    <Text style={s.menuLabel}>{item.label}</Text>
                    <Feather name="chevron-right" size={16} color={C.textMuted} style={{ marginLeft: "auto" }} />
                  </Pressable>
                ))}
              </View>
            </View>
          ))}

          {/* ── 데이터 관리 (킬 스위치) ── */}
          <View>
            <Text style={s.groupTitle}>데이터 관리</Text>
            <View style={[s.groupCard, { backgroundColor: C.card }]}>
              <Pressable
                style={({ pressed }) => [s.menuRow, { opacity: pressed ? 0.7 : 1 }]}
                onPress={() => { setKsStep("select"); setKsPreview(null); setKsPassword(""); setKsResult(null); setKsModalVisible(true); }}
              >
                <View style={[s.menuIcon, { backgroundColor: "#FEE2E2" }]}>
                  <Feather name="alert-triangle" size={18} color="#DC2626" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.menuLabel}>원본 데이터 삭제</Text>
                  <Text style={{ fontSize: 12, color: C.textMuted, fontFamily: "Inter_400Regular", marginTop: 1 }}>선택 기간 파일 영구 삭제 (킬 스위치)</Text>
                </View>
                <Feather name="chevron-right" size={16} color={C.textMuted} />
              </Pressable>
            </View>
          </View>

          {/* ── 저장공간 관리 ── */}
          <View>
            <Text style={s.groupTitle}>저장공간 관리</Text>
            <View style={[s.stCard, { backgroundColor: C.card }]}>
              {storageLoading ? (
                <ActivityIndicator color={themeColor} style={{ marginVertical: 24 }} />
              ) : (() => {
                const st = adminStorage;
                const used  = st?.total_bytes ?? 0;
                const quota = st?.quota_bytes ?? 5 * 1024 ** 3;
                const pct   = quota > 0 ? Math.min(100, (used / quota) * 100) : 0;
                const gaugeColor = pct >= 90 ? "#DC2626" : pct >= 70 ? "#F59E0B" : themeColor;
                return (
                  <>
                    {/* 총합 요약 카드 */}
                    <View style={[s.stSummary, { borderColor: gaugeColor + "30", backgroundColor: gaugeColor + "07" }]}>
                      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 10 }}>
                        <View>
                          <Text style={[s.stUsedLabel, { color: gaugeColor }]}>수영장 전체 사용량</Text>
                          <Text style={[s.stUsedBytes, { color: gaugeColor }]}>{fmtBytes(used)}</Text>
                        </View>
                        <View style={{ alignItems: "flex-end" }}>
                          <Text style={s.stQuotaLabel}>제공 용량</Text>
                          <Text style={s.stQuotaBytes}>{fmtBytes(quota)}</Text>
                        </View>
                      </View>
                      <View style={s.stGaugeWrap}>
                        <View style={[s.stGaugeBar, { width: `${pct}%` as any, backgroundColor: gaugeColor }]} />
                      </View>
                      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6 }}>
                        <Text style={[s.stGaugePct, { color: gaugeColor }]}>{pct.toFixed(1)}% 사용</Text>
                        <Text style={s.stGaugeRemain}>남은 용량 {fmtBytes(Math.max(0, quota - used))}</Text>
                      </View>
                    </View>

                    {/* 카테고리별 총합 */}
                    <View style={s.stSection}>
                      <Text style={s.stSectionTitle}>카테고리별 총합</Text>
                      {([
                        { icon: "image"          as const, bg: "#FEF3C7", color: "#F59E0B", label: "사진",    bytes: st?.photo_bytes    ?? 0 },
                        { icon: "video"          as const, bg: "#EDE9FE", color: "#7C3AED", label: "영상",    bytes: st?.video_bytes    ?? 0 },
                        { icon: "message-square" as const, bg: "#DBEAFE", color: "#2563EB", label: "메신저", bytes: st?.messenger_bytes ?? 0 },
                        { icon: "book-open"      as const, bg: "#D1FAE5", color: "#059669", label: "수영일지", bytes: st?.diary_bytes   ?? 0 },
                        { icon: "bell"           as const, bg: "#FCE7F3", color: "#EC4899", label: "공지",    bytes: st?.notice_bytes   ?? 0 },
                        { icon: "cpu"            as const, bg: "#F3F4F6", color: "#6B7280", label: "시스템",  bytes: st?.system_bytes   ?? 0 },
                      ]).map(item => (
                        <View key={item.label} style={s.stCatRow}>
                          <View style={[s.stCatIcon, { backgroundColor: item.bg }]}>
                            <Feather name={item.icon} size={14} color={item.color} />
                          </View>
                          <Text style={s.stCatLabel}>{item.label}</Text>
                          <Text style={[s.stCatBytes, { color: item.color }]}>{fmtBytes(item.bytes)}</Text>
                        </View>
                      ))}
                    </View>

                    {/* 선생님별 사용량 리스트 */}
                    {(st?.staff?.length ?? 0) > 0 && (
                      <View style={s.stSection}>
                        <Text style={s.stSectionTitle}>계정별 사용량</Text>
                        {st!.staff.map((staff, idx) => {
                          const staffPct = quota > 0 ? Math.min(100, (staff.total_bytes / quota) * 100) : 0;
                          return (
                            <Pressable
                              key={staff.id}
                              style={[s.stStaffRow, idx < st!.staff.length - 1 && { borderBottomWidth: 1, borderBottomColor: C.border }]}
                              onPress={() => setSelectedStaff(staff)}
                            >
                              <View style={[s.stStaffAvatar, { backgroundColor: themeColor + "20" }]}>
                                <Text style={[s.stStaffAvatarText, { color: themeColor }]}>{staff.name[0]}</Text>
                              </View>
                              <View style={{ flex: 1, gap: 4 }}>
                                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                                  <Text style={s.stStaffName}>{staff.name}</Text>
                                  <Text style={s.stStaffBytes}>{fmtBytes(staff.total_bytes)}</Text>
                                </View>
                                <View style={s.stMiniGaugeWrap}>
                                  <View style={[s.stMiniGaugeBar, { width: `${staffPct}%` as any, backgroundColor: themeColor + "99" }]} />
                                </View>
                                <Text style={s.stStaffPct}>전체 대비 {staffPct.toFixed(1)}%</Text>
                              </View>
                              <Feather name="chevron-right" size={14} color={C.textMuted} style={{ marginLeft: 8 }} />
                            </Pressable>
                          );
                        })}
                      </View>
                    )}
                  </>
                );
              })()}
            </View>
          </View>
        </ScrollView>
      ) : tab === "활동 로그" ? (
        /* 활동 로그 탭 */
        <FlatList
          data={logs}
          keyExtractor={(l, i) => l.id || String(i)}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); loadLogs(0); }}
              tintColor={themeColor}
            />
          }
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 100, paddingTop: 16, gap: 8 }}
          ListEmptyComponent={
            logsLoading ? (
              <ActivityIndicator color={themeColor} style={{ marginTop: 40 }} />
            ) : (
              <View style={s.empty}>
                <Feather name="activity" size={40} color={C.textMuted} />
                <Text style={s.emptyText}>활동 기록이 없습니다</Text>
              </View>
            )
          }
          onEndReached={() => { if (hasMore && !logsLoading) loadLogs(logsPage + 1); }}
          onEndReachedThreshold={0.3}
          ListFooterComponent={
            logsLoading && logs.length > 0 ? <ActivityIndicator color={themeColor} style={{ marginVertical: 16 }} /> : null
          }
          renderItem={({ item: log }) => {
            const meta = ACTION_META[log.action_type] || { label: log.action_type, icon: "activity", color: C.textSecondary };
            const typeLabel = TYPE_LABEL[log.target_type] || log.target_type;
            const dt = new Date(log.created_at);
            const dateStr = dt.toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
            const timeStr = `${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;
            return (
              <View style={[s.logCard, { backgroundColor: C.card }]}>
                <View style={s.logHeader}>
                  <View style={[s.logIcon, { backgroundColor: meta.color + "15" }]}>
                    <Feather name={meta.icon as any} size={16} color={meta.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.logName}>{log.target_name}</Text>
                    <Text style={[s.logAction, { color: meta.color }]}>
                      {typeLabel} {meta.label}
                    </Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={s.logDate}>{dateStr}</Text>
                    <Text style={s.logTime}>{timeStr}</Text>
                  </View>
                </View>
                {(log.before_value || log.after_value) && (
                  <View style={s.logChange}>
                    {log.before_value && (
                      <View style={s.logValueRow}>
                        <Text style={s.logValueLabel}>변경 전</Text>
                        <Text style={[s.logValue, { color: "#DC2626" }]}>{log.before_value}</Text>
                      </View>
                    )}
                    {log.after_value && (
                      <View style={s.logValueRow}>
                        <Text style={s.logValueLabel}>변경 후</Text>
                        <Text style={[s.logValue, { color: "#059669" }]}>{log.after_value}</Text>
                      </View>
                    )}
                  </View>
                )}
                {log.note && <Text style={s.logNote}>메모: {log.note}</Text>}
                <View style={s.logFooter}>
                  <Feather name="user" size={11} color={C.textMuted} />
                  <Text style={s.logActor}>{log.actor_name}</Text>
                  <Text style={s.logActorRole}>({log.actor_role === "pool_admin" ? "관리자" : "선생님"})</Text>
                </View>
              </View>
            );
          }}
        />
      ) : (
        /* 이벤트 기록 탭 */
        <View style={{ flex: 1 }}>
          {/* 카테고리 필터 */}
          <ScrollView
            horizontal showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 10, gap: 8, flexDirection: "row" }}
            style={{ borderBottomWidth: 1, borderBottomColor: C.border }}
          >
            {EVENT_CATEGORIES.map(cat => {
              const active = eventLogsFilter === cat;
              const meta = EVENT_CAT_META[cat];
              return (
                <Pressable
                  key={cat}
                  onPress={() => { setEventLogsFilter(cat); }}
                  style={[s.evtChip, active && { backgroundColor: (meta?.color ?? themeColor) + "20", borderColor: meta?.color ?? themeColor }]}
                >
                  {meta && <Feather name={meta.icon as any} size={12} color={active ? (meta.color ?? themeColor) : C.textMuted} />}
                  <Text style={[s.evtChipText, { color: active ? (meta?.color ?? themeColor) : C.textSecondary }]}>{cat}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <FlatList
            data={eventLogs}
            keyExtractor={(l, i) => l.id || String(i)}
            refreshControl={
              <RefreshControl
                refreshing={eventLogsRefreshing}
                onRefresh={() => { setEventLogsRefreshing(true); loadEventLogs(0, eventLogsFilter); }}
                tintColor={themeColor}
              />
            }
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 100, paddingTop: 12, gap: 10 }}
            ListEmptyComponent={
              eventLogsLoading ? (
                <ActivityIndicator color={themeColor} style={{ marginTop: 40 }} />
              ) : (
                <View style={s.empty}>
                  <Feather name="clock" size={40} color={C.textMuted} />
                  <Text style={s.emptyText}>이벤트 기록이 없습니다</Text>
                </View>
              )
            }
            onEndReached={() => { if (eventLogsHasMore && !eventLogsLoading) loadEventLogs(eventLogsPage + 1, eventLogsFilter); }}
            onEndReachedThreshold={0.3}
            ListFooterComponent={
              eventLogsLoading && eventLogs.length > 0 ? <ActivityIndicator color={themeColor} style={{ marginVertical: 16 }} /> : null
            }
            renderItem={({ item: ev }) => {
              const meta = EVENT_CAT_META[ev.category] || { icon: "activity", color: C.textSecondary, bg: "#F3F4F6" };
              const dt = new Date(ev.created_at);
              const dateStr = dt.toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
              const timeStr = `${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;
              return (
                <View style={[s.evtCard, { backgroundColor: C.card }]}>
                  <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
                    <View style={[s.evtIconWrap, { backgroundColor: meta.bg }]}>
                      <Feather name={meta.icon as any} size={16} color={meta.color} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 }}>
                        <View style={[s.evtCatBadge, { backgroundColor: meta.bg }]}>
                          <Text style={[s.evtCatText, { color: meta.color }]}>{ev.category}</Text>
                        </View>
                      </View>
                      <Text style={s.evtDesc}>{ev.description}</Text>
                      {ev.target && <Text style={s.evtTarget}>대상: {ev.target}</Text>}
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
                      <Text style={s.logDate}>{dateStr}</Text>
                      <Text style={s.logTime}>{timeStr}</Text>
                    </View>
                  </View>
                  <View style={s.logFooter}>
                    <Feather name="user" size={11} color={C.textMuted} />
                    <Text style={s.logActor}>{ev.actor_name}</Text>
                  </View>
                </View>
              );
            }}
          />
        </View>
      )}

      {/* ── 킬 스위치 모달 ── */}
      <Modal visible={ksModalVisible} transparent animationType="slide" onRequestClose={ksReset}>
        <Pressable style={sm.overlay} onPress={ksReset}>
          <Pressable style={[sm.sheet, { maxHeight: "90%" }]} onPress={e => e.stopPropagation()}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: "#FEE2E2", alignItems: "center", justifyContent: "center" }}>
                  <Feather name="alert-triangle" size={16} color="#DC2626" />
                </View>
                <Text style={[sm.title, { color: "#DC2626" }]}>원본 데이터 삭제</Text>
              </View>
              <Pressable onPress={ksReset} hitSlop={8}><Feather name="x" size={22} color={C.text} /></Pressable>
            </View>
            <Text style={[sm.sub, { color: "#DC2626", marginBottom: 12 }]}>삭제된 원본 파일은 복구할 수 없습니다. 이벤트 로그는 보존됩니다.</Text>

            {ksStep === "select" && (
              <>
                <Text style={s.stSectionTitle}>삭제할 데이터 종류</Text>
                <View style={{ gap: 8, marginBottom: 16 }}>
                  {KS_TYPES.map(kt => (
                    <Pressable
                      key={kt.key}
                      onPress={() => setKsType(kt.key)}
                      style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14, borderWidth: 1.5, borderColor: ksType === kt.key ? kt.color : C.border, backgroundColor: ksType === kt.key ? kt.bg : "#fff" }}
                    >
                      <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: kt.bg, alignItems: "center", justifyContent: "center" }}>
                        <Feather name={kt.icon} size={18} color={kt.color} />
                      </View>
                      <Text style={{ fontSize: 15, fontFamily: "Inter_600SemiBold", color: ksType === kt.key ? kt.color : C.text }}>{kt.label}</Text>
                      {ksType === kt.key && <Feather name="check" size={18} color={kt.color} style={{ marginLeft: "auto" }} />}
                    </Pressable>
                  ))}
                </View>
                <Text style={s.stSectionTitle}>삭제 기간</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
                  {[1, 3, 6, 12].map(m => (
                    <Pressable
                      key={m}
                      onPress={() => setKsMonths(m)}
                      style={{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10, borderWidth: 1.5, borderColor: ksMonths === m ? "#DC2626" : C.border, backgroundColor: ksMonths === m ? "#FEE2E2" : "#fff" }}
                    >
                      <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: ksMonths === m ? "#DC2626" : C.text }}>{m}개월 이상 전</Text>
                    </Pressable>
                  ))}
                </View>
                <Pressable
                  style={{ height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "#DC2626" }}
                  onPress={ksLoadPreview}
                  disabled={ksPreviewLoading}
                >
                  {ksPreviewLoading
                    ? <ActivityIndicator color="#fff" />
                    : <Text style={{ fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" }}>미리보기 →</Text>
                  }
                </Pressable>
              </>
            )}

            {ksStep === "preview" && ksPreview && (
              <>
                <View style={{ backgroundColor: "#FEF2F2", borderRadius: 14, padding: 16, gap: 8, marginBottom: 16 }}>
                  <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#DC2626", marginBottom: 4 }}>
                    {KS_TYPES.find(k => k.key === ksType)?.label} · {ksMonths}개월 이상 전
                  </Text>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ fontSize: 14, fontFamily: "Inter_500Medium", color: C.text }}>삭제 대상 건수</Text>
                    <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: "#DC2626" }}>{ksPreview.count.toLocaleString()}건</Text>
                  </View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ fontSize: 14, fontFamily: "Inter_500Medium", color: C.text }}>예상 정리 용량</Text>
                    <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: "#DC2626" }}>{fmtBytes(ksPreview.total_bytes)}</Text>
                  </View>
                </View>
                <Text style={[sm.sub, { marginBottom: 8 }]}>관리자 비밀번호를 입력해 영구 삭제를 승인하세요.</Text>
                <TextInput
                  style={s.pwInput}
                  placeholder="비밀번호"
                  secureTextEntry
                  value={ksPassword}
                  onChangeText={setKsPassword}
                  autoFocus
                />
                <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
                  <Pressable
                    style={{ flex: 1, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "#F3F4F6" }}
                    onPress={() => setKsStep("select")}
                  >
                    <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: C.textSecondary }}>← 수정</Text>
                  </Pressable>
                  <Pressable
                    style={{ flex: 2, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: ksPassword.length > 0 ? "#DC2626" : "#FCA5A5", opacity: ksExecLoading ? 0.7 : 1 }}
                    onPress={ksExecute}
                    disabled={ksExecLoading || ksPassword.length === 0}
                  >
                    {ksExecLoading
                      ? <ActivityIndicator color="#fff" />
                      : <Text style={{ fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" }}>영구 삭제</Text>
                    }
                  </Pressable>
                </View>
              </>
            )}

            {ksStep === "confirm" && (
              <>
                <View style={{ alignItems: "center", gap: 12, paddingVertical: 20 }}>
                  <View style={{ width: 60, height: 60, borderRadius: 20, backgroundColor: ksResult?.startsWith("삭제 완료") ? "#D1FAE5" : "#FEE2E2", alignItems: "center", justifyContent: "center" }}>
                    <Feather name={ksResult?.startsWith("삭제 완료") ? "check-circle" : "alert-circle"} size={30} color={ksResult?.startsWith("삭제 완료") ? "#059669" : "#DC2626"} />
                  </View>
                  <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: C.text, textAlign: "center" }}>{ksResult}</Text>
                </View>
                <Pressable style={sm.closeBtn} onPress={ksReset}>
                  <Text style={sm.closeBtnText}>확인</Text>
                </Pressable>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* 계정별 저장공간 상세 모달 */}
      <Modal visible={!!selectedStaff} transparent animationType="slide" onRequestClose={() => setSelectedStaff(null)}>
        <Pressable style={sm.overlay} onPress={() => setSelectedStaff(null)}>
          <Pressable style={sm.sheet} onPress={e => e.stopPropagation()}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <View>
                <Text style={[sm.title, { marginBottom: 2 }]}>{selectedStaff?.name}</Text>
                <Text style={sm.sub}>{selectedStaff?.role === "pool_admin" ? "관리자" : "선생님"} · 저장공간 상세</Text>
              </View>
              <Pressable onPress={() => setSelectedStaff(null)} hitSlop={8}>
                <Feather name="x" size={22} color={C.text} />
              </Pressable>
            </View>
            <View style={{ gap: 10 }}>
              {([
                { icon: "image"          as const, bg: "#FEF3C7", color: "#F59E0B", label: "사진",    bytes: selectedStaff?.photo_bytes    ?? 0 },
                { icon: "video"          as const, bg: "#EDE9FE", color: "#7C3AED", label: "영상",    bytes: selectedStaff?.video_bytes    ?? 0 },
                { icon: "message-square" as const, bg: "#DBEAFE", color: "#2563EB", label: "메신저",  bytes: selectedStaff?.messenger_bytes ?? 0 },
                { icon: "book-open"      as const, bg: "#D1FAE5", color: "#059669", label: "수영일지", bytes: selectedStaff?.diary_bytes    ?? 0 },
                { icon: "bell"           as const, bg: "#FCE7F3", color: "#EC4899", label: "공지",    bytes: selectedStaff?.notice_bytes   ?? 0 },
                { icon: "cpu"            as const, bg: "#F3F4F6", color: "#6B7280", label: "시스템",  bytes: selectedStaff?.system_bytes   ?? 0 },
              ]).map(item => (
                <View key={item.label} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <View style={[s.stCatIcon, { backgroundColor: item.bg }]}>
                    <Feather name={item.icon} size={14} color={item.color} />
                  </View>
                  <Text style={[s.stCatLabel, { flex: 1 }]}>{item.label}</Text>
                  <Text style={[s.stCatBytes, { color: item.color }]}>{fmtBytes(item.bytes)}</Text>
                </View>
              ))}
              <View style={[s.stSummary, { borderColor: themeColor + "30", backgroundColor: themeColor + "08", marginTop: 4 }]}>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: themeColor }}>합계</Text>
                  <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: themeColor }}>{fmtBytes(selectedStaff?.total_bytes ?? 0)}</Text>
                </View>
              </View>
            </View>
            <Pressable style={sm.closeBtn} onPress={() => setSelectedStaff(null)}>
              <Text style={sm.closeBtnText}>닫기</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* 역할 전환 모달 */}
      <Modal visible={switchModalVisible} transparent animationType="fade" onRequestClose={() => setSwitchModalVisible(false)}>
        <Pressable style={sm.overlay} onPress={() => setSwitchModalVisible(false)}>
          <Pressable style={sm.sheet} onPress={e => e.stopPropagation()}>
            <Text style={sm.title}>역할 전환</Text>
            <Text style={sm.sub}>전환할 역할을 선택하세요</Text>
            {(adminUser?.roles ?? []).map(role => {
              const cfg = ROLE_CONFIGS[role];
              if (!cfg) return null;
              const isActive = adminUser?.role === role;
              return (
                <Pressable
                  key={role}
                  style={[sm.roleRow, { borderColor: isActive ? cfg.color : C.border, backgroundColor: isActive ? cfg.color + "0A" : "#fff" }]}
                  onPress={() => !isActive && handleSwitchRole(role)}
                  disabled={isActive || switching}
                >
                  <View style={[sm.roleIcon, { backgroundColor: cfg.bgColor }]}>
                    <Feather name={cfg.icon as any} size={20} color={cfg.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[sm.roleLabel, { color: isActive ? cfg.color : C.text }]}>{cfg.title}</Text>
                    <Text style={sm.roleSub}>{cfg.subtitle}</Text>
                  </View>
                  {isActive
                    ? <View style={[sm.activeBadge, { backgroundColor: cfg.color + "20" }]}>
                        <Text style={[sm.activeBadgeText, { color: cfg.color }]}>현재</Text>
                      </View>
                    : switching
                      ? <ActivityIndicator color={cfg.color} size="small" />
                      : <Feather name="chevron-right" size={16} color={C.textMuted} />
                  }
                </Pressable>
              );
            })}
            <Pressable style={sm.closeBtn} onPress={() => setSwitchModalVisible(false)}>
              <Text style={sm.closeBtnText}>닫기</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const sm = StyleSheet.create({
  overlay:         { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", alignItems: "center", padding: 24 },
  sheet:           { backgroundColor: "#fff", borderRadius: 24, padding: 24, width: "100%", gap: 12 },
  title:           { fontSize: 18, fontFamily: "Inter_700Bold", color: C.text },
  sub:             { fontSize: 13, fontFamily: "Inter_400Regular", color: C.textSecondary, marginBottom: 4 },
  roleRow:         { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1.5, borderRadius: 14, padding: 14 },
  roleIcon:        { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  roleLabel:       { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  roleSub:         { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 2 },
  activeBadge:     { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  activeBadgeText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  closeBtn:        { marginTop: 4, height: 46, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "#F3F4F6" },
  closeBtnText:    { fontSize: 15, fontFamily: "Inter_600SemiBold", color: C.textSecondary },
});

const s = StyleSheet.create({
  tabBar: { flexDirection: "row", backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: C.border },
  tabItem: { flex: 1, paddingVertical: 14, alignItems: "center" },
  tabText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },

  profileCard: { flexDirection: "row", alignItems: "center", gap: 14, padding: 16, borderRadius: 18, shadowColor: "#00000010", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 6, elevation: 2 },
  profileAvatar: { width: 52, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  profileInitial: { fontSize: 20, fontFamily: "Inter_700Bold" },
  profileName: { fontSize: 18, fontFamily: "Inter_700Bold", color: C.text },
  profileRole: { fontSize: 13, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 2 },
  switchBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1.5 },
  switchBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  groupTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: C.textMuted, marginBottom: 8, paddingHorizontal: 4 },
  groupCard: { borderRadius: 18, overflow: "hidden", shadowColor: "#00000010", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 6, elevation: 2 },
  menuRow: { flexDirection: "row", alignItems: "center", gap: 14, padding: 16 },
  menuRowBorder: { borderBottomWidth: 1, borderBottomColor: C.border },
  menuIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  menuLabel: { fontSize: 15, fontFamily: "Inter_500Medium", color: C.text },

  empty: { alignItems: "center", paddingVertical: 60, gap: 12 },
  emptyText: { fontSize: 15, fontFamily: "Inter_400Regular", color: C.textMuted },

  stCard: { borderRadius: 18, overflow: "hidden", shadowColor: "#00000010", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 6, elevation: 2, padding: 16, gap: 16 },
  stSummary: { padding: 14, borderRadius: 14, borderWidth: 1 },
  stUsedLabel: { fontSize: 12, fontFamily: "Inter_500Medium", marginBottom: 2 },
  stUsedBytes: { fontSize: 24, fontFamily: "Inter_700Bold" },
  stQuotaLabel: { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textMuted, marginBottom: 2 },
  stQuotaBytes: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: C.textSecondary },
  stGaugeWrap: { height: 10, backgroundColor: "#E5E7EB", borderRadius: 5, overflow: "hidden" },
  stGaugeBar: { height: 10, borderRadius: 5 },
  stGaugePct: { fontSize: 12, fontFamily: "Inter_700Bold" },
  stGaugeRemain: { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textMuted },

  stSection: { gap: 8 },
  stSectionTitle: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: C.textMuted, marginBottom: 2 },
  stCatRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 },
  stCatIcon: { width: 32, height: 32, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  stCatLabel: { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium", color: C.text },
  stCatBytes: { fontSize: 14, fontFamily: "Inter_700Bold" },

  stStaffRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12 },
  stStaffAvatar: { width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  stStaffAvatarText: { fontSize: 14, fontFamily: "Inter_700Bold" },
  stStaffName: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: C.text },
  stStaffBytes: { fontSize: 14, fontFamily: "Inter_700Bold", color: C.text },
  stMiniGaugeWrap: { height: 5, backgroundColor: "#E5E7EB", borderRadius: 3, overflow: "hidden" },
  stMiniGaugeBar: { height: 5, borderRadius: 3 },
  stStaffPct: { fontSize: 11, fontFamily: "Inter_400Regular", color: C.textMuted },

  logCard: { borderRadius: 16, padding: 14, gap: 8, shadowColor: "#00000010", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 6, elevation: 2 },
  logHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  logIcon: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  logName: { fontSize: 15, fontFamily: "Inter_700Bold", color: C.text },
  logAction: { fontSize: 12, fontFamily: "Inter_600SemiBold", marginTop: 1 },
  logDate: { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textMuted },
  logTime: { fontSize: 11, fontFamily: "Inter_400Regular", color: C.textMuted, marginTop: 2 },
  logChange: { backgroundColor: "#F9FAFB", borderRadius: 10, padding: 10, gap: 4 },
  logValueRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  logValueLabel: { width: 50, fontSize: 12, fontFamily: "Inter_500Medium", color: C.textSecondary },
  logValue: { flex: 1, fontSize: 12, fontFamily: "Inter_600SemiBold" },
  logNote: { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary, fontStyle: "italic" },
  logFooter: { flexDirection: "row", alignItems: "center", gap: 4 },
  logActor: { fontSize: 11, fontFamily: "Inter_500Medium", color: C.textMuted },
  logActorRole: { fontSize: 11, fontFamily: "Inter_400Regular", color: C.textMuted },

  evtChip:     { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1.5, borderColor: C.border, backgroundColor: "#fff" },
  evtChipText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },

  evtCard:    { borderRadius: 16, padding: 14, gap: 8, backgroundColor: C.card, shadowColor: "#00000010", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 6, elevation: 2 },
  evtIconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  evtCatBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  evtCatText:  { fontSize: 11, fontFamily: "Inter_700Bold" },
  evtDesc:     { fontSize: 14, fontFamily: "Inter_600SemiBold", color: C.text, lineHeight: 20 },
  evtTarget:   { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 2 },

  pwInput: { height: 48, borderWidth: 1.5, borderColor: C.border, borderRadius: 14, paddingHorizontal: 14, fontSize: 15, fontFamily: "Inter_400Regular", backgroundColor: "#F9FAFB" },
});
