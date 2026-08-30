/**
 * (teacher)/settings.tsx — 설정
 * Settings Design Rule: compact profile · section container · hairline divider
 *
 * 구조:
 *  1. 선생님 요약 (compact profile row)
 *  2. 핵심 기능 5개 (공지함 · 선생님설정 · 일지템플릿 · 알림함 · 사진영상)
 *  3. 분류 4개 inline expand
 *     A. 알림 및 개인 설정 (toggle 6개)
 *     B. 수업 및 운영 (납부체크 toggle + 납부현황)
 *     C. 저장공간 및 데이터 (compact summary + detail expand)
 *     D. 도움말 및 계정 (약관/정책/AI문의/문의하기/업데이트/회원탈퇴)
 *  4. 하단 버전
 */
import { LucideIcon } from "@/components/common/LucideIcon";
import AppUpdateButton from "@/components/common/AppUpdateButton";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Pressable,
  RefreshControl, ScrollView, StyleSheet, Switch, Text, View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { WithdrawalModal } from "@/components/common/WithdrawalModal";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { useTabScrollReset } from "@/hooks/useTabScrollReset";

const FEE_CHECK_KEY = "@swimnote:fee_check_enabled";
const C    = Colors.light;
const NAVY = "#0C1A2E";
const MUTED = C.textMuted;

// ── 저장공간 ──────────────────────────────────────────────────────────────────
interface StorageUsage {
  photo_bytes: number; photo_count: number;
  video_bytes: number; video_count: number;
  messenger_bytes: number;
  diary_bytes: number;
  notice_bytes: number;
  system_bytes: number;
  total_bytes: number;
  quota_bytes: number;
}

function fmtBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// ── 공통 Row 컴포넌트 ─────────────────────────────────────────────────────────
function SectionRow({
  icon, label, desc, last = false, right, onPress,
}: {
  icon: string; label: string; desc?: string; last?: boolean;
  right?: React.ReactNode; onPress?: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [r.row, !last && r.rowBorder, { opacity: pressed && !!onPress ? 0.7 : 1 }]}
      onPress={onPress}
      disabled={!onPress}
    >
      <LucideIcon name={icon as any} size={17} color={NAVY} />
      <View style={{ flex: 1 }}>
        <Text style={r.label}>{label}</Text>
        {!!desc && <Text style={r.desc}>{desc}</Text>}
      </View>
      {right ?? (onPress ? <LucideIcon name="chevron-right" size={15} color={MUTED} /> : null)}
    </Pressable>
  );
}

// ── 알림 토글 Row ─────────────────────────────────────────────────────────────
function ToggleRow({
  label, desc, value, onChange, last = false, themeColor,
}: {
  label: string; desc: string; value: boolean; onChange: (v: boolean) => void;
  last?: boolean; themeColor: string;
}) {
  return (
    <View style={[r.row, !last && r.rowBorder]}>
      <View style={{ flex: 1 }}>
        <Text style={r.label}>{label}</Text>
        <Text style={r.desc}>{desc}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: C.border, true: themeColor + "80" }}
        thumbColor={value ? themeColor : MUTED}
      />
    </View>
  );
}

// ── 분류 A: 알림 및 개인 설정 ─────────────────────────────────────────────────
function CategoryA({
  themeColor,
  notiMessage, setNotiMessage,
  notiMakeup, setNotiMakeup,
  notiDiary, setNotiDiary,
  notiNews, setNotiNews,
  notiNewsLike, setNotiNewsLike,
  notiNewsComment, setNotiNewsComment,
  savePushSetting,
}: {
  themeColor: string;
  notiMessage: boolean; setNotiMessage: (v: boolean) => void;
  notiMakeup: boolean; setNotiMakeup: (v: boolean) => void;
  notiDiary: boolean; setNotiDiary: (v: boolean) => void;
  notiNews: boolean; setNotiNews: (v: boolean) => void;
  notiNewsLike: boolean; setNotiNewsLike: (v: boolean) => void;
  notiNewsComment: boolean; setNotiNewsComment: (v: boolean) => void;
  savePushSetting: (key: string, value: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View>
      <Pressable
        style={({ pressed }) => [r.row, { opacity: pressed ? 0.7 : 1 }]}
        onPress={() => setOpen(v => !v)}
      >
        <LucideIcon name="bell" size={17} color={NAVY} />
        <View style={{ flex: 1 }}>
          <Text style={r.label}>알림 및 개인 설정</Text>
          <Text style={r.desc}>메시지 · 보강 · 일지 · 좋아요 · 댓글</Text>
        </View>
        <LucideIcon name={open ? "chevron-up" : "chevron-down"} size={15} color={MUTED} />
      </Pressable>
      {open && (
        <View style={r.subContainer}>
          <ToggleRow label="쪽지·메신저 알림" desc="새 메시지 수신 시 알림" value={notiMessage} themeColor={themeColor}
            onChange={v => { setNotiMessage(v); savePushSetting("messenger", v); }} />
          <ToggleRow label="보강 신청 알림" desc="새 보강 요청 수신 시 알림" value={notiMakeup} themeColor={themeColor}
            onChange={v => { setNotiMakeup(v); savePushSetting("makeup_request", v); }} />
          <ToggleRow label="일지 리마인더" desc="미작성 일지 알림" value={notiDiary} themeColor={themeColor}
            onChange={v => { setNotiDiary(v); savePushSetting("diary_reminder", v); }} />
          <ToggleRow label="소식 알림" desc="학부모 업무대화 새 메시지 알림" value={notiNews} themeColor={themeColor}
            onChange={v => { setNotiNews(v); savePushSetting("news", v); }} />
          <ToggleRow label="좋아요 알림" desc="학부모가 수업피드에 좋아요 시 알림" value={notiNewsLike} themeColor={themeColor}
            onChange={v => { setNotiNewsLike(v); savePushSetting("news_like", v); }} />
          <ToggleRow label="일지 댓글 알림" desc="학부모가 일지 댓글 작성 시 알림" value={notiNewsComment} themeColor={themeColor}
            last onChange={v => { setNotiNewsComment(v); savePushSetting("news_comment", v); }} />
        </View>
      )}
    </View>
  );
}

// ── 분류 B: 수업 및 운영 ──────────────────────────────────────────────────────
function CategoryB({
  themeColor, feeCheckEnabled, toggleFeeCheck,
}: {
  themeColor: string; feeCheckEnabled: boolean; toggleFeeCheck: (v: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View>
      <Pressable
        style={({ pressed }) => [r.row, { opacity: pressed ? 0.7 : 1 }]}
        onPress={() => setOpen(v => !v)}
      >
        <LucideIcon name="layout-grid" size={17} color={NAVY} />
        <View style={{ flex: 1 }}>
          <Text style={r.label}>수업 및 운영</Text>
          <Text style={r.desc}>납부 체크 · 수업 운영 · 보강</Text>
        </View>
        <LucideIcon name={open ? "chevron-up" : "chevron-down"} size={15} color={MUTED} />
      </Pressable>
      {open && (
        <View style={r.subContainer}>
          <View style={[r.row, feeCheckEnabled && r.rowBorder]}>
            <View style={{ flex: 1 }}>
              <Text style={r.label}>납부 체크 기능 사용</Text>
              <Text style={r.desc}>수영장 전산 이용 시 끄세요</Text>
            </View>
            <Switch
              value={feeCheckEnabled}
              onValueChange={toggleFeeCheck}
              trackColor={{ false: C.border, true: themeColor + "80" }}
              thumbColor={feeCheckEnabled ? themeColor : MUTED}
            />
          </View>
          {feeCheckEnabled && (
            <Pressable
              style={({ pressed }) => [r.row, { opacity: pressed ? 0.7 : 1 }]}
              onPress={() => router.push("/(teacher)/fee-check?backTo=settings" as any)}
            >
              <LucideIcon name="circle-dollar-sign" size={17} color={NAVY} />
              <Text style={[r.label, { flex: 1 }]}>납부 현황 보기</Text>
              <LucideIcon name="chevron-right" size={15} color={MUTED} />
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

// ── 분류 C: 저장공간 및 데이터 ───────────────────────────────────────────────
function CategoryC({
  storageUsage, themeColor,
}: {
  storageUsage: StorageUsage | null; themeColor: string;
}) {
  const [open, setOpen] = useState(false);
  const used  = storageUsage?.total_bytes ?? 0;
  const quota = storageUsage?.quota_bytes ?? 5 * 1024 ** 3;
  const pct   = quota > 0 ? Math.min(100, (used / quota) * 100) : 0;
  const gaugeColor = pct >= 90 ? "#D96C6C" : pct >= 70 ? "#E4A93A" : themeColor;

  return (
    <View>
      <Pressable
        style={({ pressed }) => [r.row, { opacity: pressed ? 0.7 : 1 }]}
        onPress={() => setOpen(v => !v)}
      >
        <LucideIcon name="hard-drive" size={17} color={NAVY} />
        <View style={{ flex: 1 }}>
          <Text style={r.label}>저장공간 및 데이터</Text>
          {storageUsage ? (
            <Text style={r.desc}>{fmtBytes(used)} / {fmtBytes(quota)} 사용</Text>
          ) : (
            <Text style={r.desc}>사진 · 영상 · 일지 · 저장용량</Text>
          )}
        </View>
        <LucideIcon name={open ? "chevron-up" : "chevron-down"} size={15} color={MUTED} />
      </Pressable>

      {open && storageUsage && (
        <View style={r.subContainer}>
          {/* compact gauge */}
          <View style={s.storageGaugeRow}>
            <View style={[s.gaugeWrap, { backgroundColor: C.border }]}>
              <View style={[s.gaugeBar, { width: `${pct}%` as any, backgroundColor: gaugeColor }]} />
            </View>
            <Text style={[s.gaugePct, { color: gaugeColor }]}>{pct.toFixed(1)}%</Text>
          </View>
          {/* detail rows */}
          {([
            { icon: "image"          as const, label: "사진",     sub: `${storageUsage.photo_count}개`,   bytes: storageUsage.photo_bytes    },
            { icon: "video"          as const, label: "영상",     sub: `${storageUsage.video_count}개`,   bytes: storageUsage.video_bytes    },
            { icon: "message-square" as const, label: "메신저",   sub: "텍스트 데이터",                    bytes: storageUsage.messenger_bytes },
            { icon: "book-open"      as const, label: "수영일지", sub: "일지·메모 데이터",                  bytes: storageUsage.diary_bytes    },
            { icon: "bell"           as const, label: "공지",     sub: "공지 본문 데이터",                  bytes: storageUsage.notice_bytes   },
            { icon: "cpu"            as const, label: "시스템",   sub: "기본 계정 데이터",                  bytes: storageUsage.system_bytes   },
          ]).map((item, idx, arr) => (
            <View key={item.label} style={[s.usageRow, idx < arr.length - 1 && r.rowBorder]}>
              <LucideIcon name={item.icon} size={15} color={MUTED} />
              <View style={{ flex: 1 }}>
                <Text style={s.usageLabel}>{item.label}</Text>
                <Text style={s.usageSub}>{item.sub}</Text>
              </View>
              <Text style={s.usageBytes}>{fmtBytes(item.bytes)}</Text>
            </View>
          ))}
        </View>
      )}

      {open && !storageUsage && (
        <View style={[r.subContainer, { padding: 16, alignItems: "center" }]}>
          <ActivityIndicator color={themeColor} />
        </View>
      )}
    </View>
  );
}

// ── 분류 D: 도움말 및 계정 ───────────────────────────────────────────────────
function CategoryD({
  themeColor, onDelete,
}: {
  themeColor: string; onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const items = [
    { label: "이용약관",          icon: "file-text",     route: "/terms" },
    { label: "개인정보처리방침",   icon: "shield",        route: "/privacy" },
    { label: "환불 및 결제 정책", icon: "file-check",    route: "/refund" },
    { label: "AI 문의",           icon: "message-circle",route: "/(teacher)/support-chat" },
    { label: "문의하기 (기존)",   icon: "help-circle",   route: "/(teacher)/inquiries" },
  ] as const;

  return (
    <View>
      <Pressable
        style={({ pressed }) => [r.row, { opacity: pressed ? 0.7 : 1 }]}
        onPress={() => setOpen(v => !v)}
      >
        <LucideIcon name="life-buoy" size={17} color={NAVY} />
        <View style={{ flex: 1 }}>
          <Text style={r.label}>도움말 및 계정</Text>
          <Text style={r.desc}>약관 · 정책 · AI · 문의 · 업데이트</Text>
        </View>
        <LucideIcon name={open ? "chevron-up" : "chevron-down"} size={15} color={MUTED} />
      </Pressable>

      {open && (
        <View style={r.subContainer}>
          {items.map((item, idx) => (
            <Pressable
              key={item.label}
              style={({ pressed }) => [r.subRow, idx < items.length - 1 && r.subRowBorder, { opacity: pressed ? 0.7 : 1 }]}
              onPress={() => router.push((item.route + "?backTo=settings") as any)}
            >
              <LucideIcon name={item.icon as any} size={15} color={MUTED} />
              <Text style={[r.subLabel, { flex: 1 }]}>{item.label}</Text>
              <LucideIcon name="chevron-right" size={13} color={MUTED} />
            </Pressable>
          ))}
          {/* 앱 업데이트 */}
          <View style={[r.subRowBorder, { paddingHorizontal: 14, paddingVertical: 10 }]}>
            <AppUpdateButton themeColor={themeColor} />
          </View>
          {/* 회원 탈퇴 — 위험 영역 */}
          <Pressable
            style={({ pressed }) => [r.subRow, { opacity: pressed ? 0.7 : 1 }]}
            onPress={onDelete}
          >
            <LucideIcon name="log-out" size={15} color="#D96C6C" />
            <Text style={[r.subLabel, { flex: 1, color: "#D96C6C" }]}>회원 탈퇴</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

// ── 메인 ─────────────────────────────────────────────────────────────────────
export default function TeacherSettingsScreen() {
  const { token, logout, adminUser, pool } = useAuth();
  const { themeColor } = useBrand();
  const insets = useSafeAreaInsets();
  const scrollRef = useTabScrollReset("settings");

  const [storageUsage, setStorageUsage] = useState<StorageUsage | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [refreshing,   setRefreshing]   = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  /* 알림 설정 */
  const [notiMessage,     setNotiMessage]     = useState(true);
  const [notiMakeup,      setNotiMakeup]      = useState(true);
  const [notiDiary,       setNotiDiary]       = useState(true);
  const [notiNews,        setNotiNews]        = useState(true);
  const [notiNewsLike,    setNotiNewsLike]    = useState(true);
  const [notiNewsComment, setNotiNewsComment] = useState(true);

  /* 납부 체크 */
  const [feeCheckEnabled, setFeeCheckEnabled] = useState(false);

  const savePushSetting = useCallback(async (key: string, value: boolean) => {
    try {
      await apiRequest(token, "/push-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: { [key]: value } }),
      });
    } catch { /* ignore */ }
  }, [token]);

  const toggleFeeCheck = useCallback(async (v: boolean) => {
    setFeeCheckEnabled(v);
    try { await AsyncStorage.setItem(FEE_CHECK_KEY, v ? "1" : "0"); }
    catch { /* ignore */ }
  }, []);

  async function handleDeleteAccount(immediate: boolean) {
    setDeleteLoading(true);
    try {
      const res = await apiRequest(token, "/auth/account", {
        method: "DELETE",
        body: JSON.stringify({ immediate }),
      });
      if (res.ok) { setDeleteConfirm(false); await logout(); }
    } catch { } finally { setDeleteLoading(false); }
  }

  const load = useCallback(async () => {
    try {
      const [storageRes, pushRes, feeRaw] = await Promise.all([
        apiRequest(token, "/teacher/me/storage"),
        apiRequest(token, "/push-settings"),
        AsyncStorage.getItem(FEE_CHECK_KEY),
      ]);
      if (storageRes.ok) setStorageUsage(await storageRes.json());
      if (pushRes.ok) {
        const { settings } = await pushRes.json();
        if (settings.messenger      !== undefined) setNotiMessage(Boolean(settings.messenger));
        if (settings.makeup_request !== undefined) setNotiMakeup(Boolean(settings.makeup_request));
        if (settings.diary_reminder !== undefined) setNotiDiary(Boolean(settings.diary_reminder));
        if (settings.news           !== undefined) setNotiNews(Boolean(settings.news));
        if (settings.news_like      !== undefined) setNotiNewsLike(Boolean(settings.news_like));
        if (settings.news_comment   !== undefined) setNotiNewsComment(Boolean(settings.news_comment));
      }
      setFeeCheckEnabled(feeRaw === "1");
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={[]}>
        <SubScreenHeader title="설정" homePath="/(teacher)/today-schedule" />
        <ActivityIndicator color={themeColor} style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="설정" homePath="/(teacher)/today-schedule" />

      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 60 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={themeColor} />
        }
      >
        {/* ── 1. 선생님 요약 ──────────────────────────────────────────────── */}
        <View style={[s.card, { marginBottom: 12 }]}>
          <View style={s.profileRow}>
            <View style={s.avatar}>
              <LucideIcon name="user-round" size={20} color={NAVY} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.profileName}>{adminUser?.name ?? "선생님"}선생님</Text>
              <Text style={s.profilePool}>{pool?.name ?? "수영장"}</Text>
            </View>
          </View>
        </View>

        {/* ── 2. 핵심 기능 5개 ────────────────────────────────────────────── */}
        <View style={[s.card, { marginBottom: 12 }]}>
          <Text style={s.sectionLabel}>핵심 기능</Text>
          <SectionRow icon="bell"   label="공지함"           desc="수영장 공지 확인"           onPress={() => router.push("/(teacher)/notices?backTo=settings" as any)} />
          <SectionRow icon="user-cog" label="선생님 설정"     desc="담당 수업 · 기본 설정"       onPress={() => router.push("/(teacher)/my-info?backTo=settings" as any)} />
          <SectionRow icon="edit"   label="일지 템플릿"       desc="수업 일지 작성 템플릿 관리"  onPress={() => router.push("/(teacher)/feedback-custom?backTo=settings" as any)} />
          <SectionRow icon="inbox"  label="알림함"            desc="좋아요 · 댓글 · 요청 · 소식 확인" onPress={() => router.push("/(teacher)/messages-inbox" as any)} />
          <SectionRow icon="camera" label="사진·영상 업로드/앨범" desc="수업 사진과 영상 관리" onPress={() => router.push("/(teacher)/photos?backTo=settings" as any)} />
          <SectionRow icon="search" label="수영·훈련용어 검색" desc="수영·훈련 용어 전자사전" last onPress={() => router.push("/(teacher)/terminology-search" as any)} />
        </View>

        {/* ── 3. 분류 4개 ─────────────────────────────────────────────────── */}
        <View style={[s.card, { marginBottom: 12 }]}>
          <CategoryA
            themeColor={themeColor}
            notiMessage={notiMessage} setNotiMessage={setNotiMessage}
            notiMakeup={notiMakeup}   setNotiMakeup={setNotiMakeup}
            notiDiary={notiDiary}     setNotiDiary={setNotiDiary}
            notiNews={notiNews}       setNotiNews={setNotiNews}
            notiNewsLike={notiNewsLike}       setNotiNewsLike={setNotiNewsLike}
            notiNewsComment={notiNewsComment} setNotiNewsComment={setNotiNewsComment}
            savePushSetting={savePushSetting}
          />
          <View style={r.catDivider} />
          <CategoryB
            themeColor={themeColor}
            feeCheckEnabled={feeCheckEnabled}
            toggleFeeCheck={toggleFeeCheck}
          />
          <View style={r.catDivider} />
          <CategoryC storageUsage={storageUsage} themeColor={themeColor} />
          <View style={r.catDivider} />
          <CategoryD themeColor={themeColor} onDelete={() => setDeleteConfirm(true)} />
        </View>

        {/* ── 4. 버전 ─────────────────────────────────────────────────────── */}
        <View style={{ alignItems: "center", paddingVertical: 16, gap: 2 }}>
          <Text style={s.versionApp}>SWIMNOTE</Text>
          <Text style={s.versionNum}>선생님 설정</Text>
        </View>
      </ScrollView>

      <WithdrawalModal
        visible={deleteConfirm}
        onClose={() => setDeleteConfirm(false)}
        onConfirm={handleDeleteAccount}
        loading={deleteLoading}
        isPaidPlan={false}
      />
    </SafeAreaView>
  );
}

// ── Row 스타일 ────────────────────────────────────────────────────────────────
const r = StyleSheet.create({
  row:          { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 13, paddingHorizontal: 14 },
  rowBorder:    { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#E2E8F0" },
  label:        { fontSize: 14, fontFamily: "Pretendard-Regular", fontWeight: "500", color: NAVY },
  desc:         { fontSize: 11, fontFamily: "Pretendard-Regular", color: MUTED, marginTop: 1 },
  catDivider:   { height: StyleSheet.hairlineWidth, backgroundColor: "#E2E8F0", marginHorizontal: 14 },
  subContainer: { backgroundColor: "#F8FAFC", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#E2E8F0" },
  subRow:       { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, paddingHorizontal: 20 },
  subRowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#EEF1F5" },
  subLabel:     { fontSize: 13, fontFamily: "Pretendard-Regular", color: NAVY },
});

// ── 메인 스타일 ───────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: C.surface },
  card:         { backgroundColor: C.card, borderRadius: 16, overflow: "hidden", shadowColor: "#0000000A", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 1, shadowRadius: 4, elevation: 1 },
  sectionLabel: { fontSize: 11, fontFamily: "Pretendard-Regular", color: MUTED, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 },

  profileRow:   { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  avatar:       { width: 42, height: 42, borderRadius: 13, backgroundColor: "#EEF2F8", alignItems: "center", justifyContent: "center" },
  profileName:  { fontSize: 15, fontFamily: "Pretendard-Regular", fontWeight: "600", color: NAVY },
  profilePool:  { fontSize: 12, fontFamily: "Pretendard-Regular", color: MUTED, marginTop: 1 },

  storageGaugeRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 10 },
  gaugeWrap:    { flex: 1, height: 4, borderRadius: 4, overflow: "hidden" },
  gaugeBar:     { height: 4, borderRadius: 4 },
  gaugePct:     { fontSize: 11, fontFamily: "Pretendard-Regular", minWidth: 38, textAlign: "right" },

  usageRow:     { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, paddingHorizontal: 14 },
  usageLabel:   { fontSize: 13, fontFamily: "Pretendard-Regular", color: NAVY },
  usageSub:     { fontSize: 11, fontFamily: "Pretendard-Regular", color: MUTED },
  usageBytes:   { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary },

  versionApp:   { fontSize: 12, fontFamily: "Pretendard-Regular", fontWeight: "600", color: MUTED },
  versionNum:   { fontSize: 11, fontFamily: "Pretendard-Regular", color: MUTED },
});
