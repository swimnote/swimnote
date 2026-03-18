/**
 * 더보기 탭 — 설정 허브
 * 결제, 지점, 브랜드, 선생님 관리, 승인, 활동 로그, 모드 변경
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, FlatList, Modal, Pressable,
  RefreshControl, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { ROLE_CONFIGS } from "@/constants/auth";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { PageHeader } from "@/components/common/PageHeader";
import { useTabScrollReset } from "@/hooks/useTabScrollReset";

const C = Colors.light;
const TABS = ["설정 메뉴", "활동 로그"] as const;
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
      ) : (
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
      )}

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
});
