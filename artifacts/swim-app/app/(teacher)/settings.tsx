/**
 * (teacher)/settings.tsx — 설정
 *
 * 섹션:
 *  1. 저장공간
 *  2. 알림 설정
 *  3. 앱 설정
 *  4. 피드백 기본 설정
 *  5. 사진·영상 앨범 바로가기
 *  6. 기타
 */
import { Bell, Camera, ChevronRight, FileText, HardDrive, Pencil } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
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
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { useTabScrollReset } from "@/hooks/useTabScrollReset";

const C = Colors.light;

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

export default function TeacherSettingsScreen() {
  const { token } = useAuth();
  const { themeColor } = useBrand();
  const insets = useSafeAreaInsets();
  const scrollRef = useTabScrollReset("settings");

  const [storageUsage, setStorageUsage] = useState<StorageUsage | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [refreshing,   setRefreshing]   = useState(false);

  /* 알림 설정 */
  const [notiMessage,  setNotiMessage]  = useState(true);
  const [notiMakeup,   setNotiMakeup]   = useState(true);
  const [notiDiary,    setNotiDiary]    = useState(true);

  const savePushSetting = useCallback(async (key: string, value: boolean) => {
    try {
      await apiRequest(token, "/push-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: { [key]: value } }),
      });
    } catch { /* ignore */ }
  }, [token]);

  const load = useCallback(async () => {
    try {
      const [storageRes, pushRes] = await Promise.all([
        apiRequest(token, "/teacher/me/storage"),
        apiRequest(token, "/push-settings"),
      ]);
      if (storageRes.ok) setStorageUsage(await storageRes.json());
      if (pushRes.ok) {
        const { settings } = await pushRes.json();
        if (settings.messenger !== undefined)       setNotiMessage(Boolean(settings.messenger));
        if (settings.makeup_request !== undefined)  setNotiMakeup(Boolean(settings.makeup_request));
        if (settings.diary_reminder !== undefined)  setNotiDiary(Boolean(settings.diary_reminder));
      }
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

  const used  = storageUsage?.total_bytes ?? 0;
  const quota = storageUsage?.quota_bytes ?? 5 * 1024 ** 3;
  const pct   = quota > 0 ? Math.min(100, (used / quota) * 100) : 0;
  const gaugeColor = pct >= 90 ? "#D96C6C" : pct >= 70 ? "#E4A93A" : themeColor;

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="설정" homePath="/(teacher)/today-schedule" />

      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: insets.bottom + 60 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={themeColor} />}
      >

        {/* ── 공지함 ── */}
        <Pressable
          style={[s.actionBtn, { backgroundColor: "#E6FAF8", borderColor: "#0F172A" }]}
          onPress={() => router.push("/(teacher)/notices" as any)}
        >
          <Bell size={18} color="#0F172A" />
          <Text style={[s.actionBtnText, { color: "#0F172A" }]}>공지함</Text>
          <ChevronRight size={16} color="#0F172A" />
        </Pressable>

        {/* ── 피드백 기본 설정 ── */}
        <Pressable
          style={[s.actionBtn, { backgroundColor: "#E6FAF8", borderColor: "#0F172A" }]}
          onPress={() => router.push("/(teacher)/feedback-custom" as any)}
        >
          <Pencil size={18} color="#0F172A" />
          <Text style={[s.actionBtnText, { color: "#0F172A" }]}>피드백 기본 설정</Text>
          <ChevronRight size={16} color="#0F172A" />
        </Pressable>

        {/* ── 사진·영상 앨범 ── */}
        <Pressable
          style={[s.actionBtn, { backgroundColor: "#E6FAF8", borderColor: "#0F172A" }]}
          onPress={() => router.push("/(teacher)/photos" as any)}
        >
          <Camera size={18} color="#0F172A" />
          <Text style={[s.actionBtnText, { color: "#0F172A" }]}>사진·영상 앨범</Text>
          <ChevronRight size={16} color="#0F172A" />
        </Pressable>

        {/* ── 알림 설정 ── */}
        <View style={s.card}>
          <View style={s.cardHeader}>
            <Bell size={15} color={themeColor} />
            <Text style={s.cardTitle}>알림 설정</Text>
          </View>
          <View style={s.switchSection}>
            <View style={s.switchRow}>
              <View>
                <Text style={s.switchLabel}>쪽지·메신저 알림</Text>
                <Text style={s.switchSub}>새 메시지 수신 시 알림</Text>
              </View>
              <Switch
                value={notiMessage}
                onValueChange={v => { setNotiMessage(v); savePushSetting("messenger", v); }}
                trackColor={{ false: C.border, true: themeColor + "80" }}
                thumbColor={notiMessage ? themeColor : C.textMuted}
              />
            </View>
            <View style={[s.switchRow, { borderTopWidth: 1, borderTopColor: C.border }]}>
              <View>
                <Text style={s.switchLabel}>보강 신청 알림</Text>
                <Text style={s.switchSub}>새 보강 요청 수신 시 알림</Text>
              </View>
              <Switch
                value={notiMakeup}
                onValueChange={v => { setNotiMakeup(v); savePushSetting("makeup_request", v); }}
                trackColor={{ false: C.border, true: themeColor + "80" }}
                thumbColor={notiMakeup ? themeColor : C.textMuted}
              />
            </View>
            <View style={[s.switchRow, { borderTopWidth: 1, borderTopColor: C.border }]}>
              <View>
                <Text style={s.switchLabel}>일지 리마인더</Text>
                <Text style={s.switchSub}>미작성 일지 알림</Text>
              </View>
              <Switch
                value={notiDiary}
                onValueChange={v => { setNotiDiary(v); savePushSetting("diary_reminder", v); }}
                trackColor={{ false: C.border, true: themeColor + "80" }}
                thumbColor={notiDiary ? themeColor : C.textMuted}
              />
            </View>
          </View>
        </View>

        {/* ── 저장공간 (데이터 정보) ── */}
        <View style={s.card}>
          <View style={s.cardHeader}>
            <HardDrive size={15} color={themeColor} />
            <Text style={s.cardTitle}>저장공간</Text>
          </View>
          <View style={{ padding: 16, gap: 14 }}>
            <View style={[s.storageSummary, { borderColor: gaugeColor + "40", backgroundColor: gaugeColor + "08" }]}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 10 }}>
                <View>
                  <Text style={[s.storageUsedLabel, { color: gaugeColor }]}>사용 중</Text>
                  <Text style={[s.storageUsedBytes, { color: gaugeColor }]}>{fmtBytes(used)}</Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={s.storageQuotaLabel}>제공 용량</Text>
                  <Text style={s.storageQuotaBytes}>{fmtBytes(quota)}</Text>
                </View>
              </View>
              <View style={s.gaugeWrap}>
                <View style={[s.gaugeBar, { width: `${pct}%` as any, backgroundColor: gaugeColor }]} />
              </View>
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6 }}>
                <Text style={[s.gaugePct, { color: gaugeColor }]}>{pct.toFixed(1)}% 사용</Text>
                <Text style={s.gaugeRemain}>남은 용량 {fmtBytes(Math.max(0, quota - used))}</Text>
              </View>
            </View>

            {([
              { icon: "image"          as const, bg: "#E6FAF8", color: "#EA580C", label: "사진",     sub: `${storageUsage?.photo_count||0}개`,   bytes: storageUsage?.photo_bytes    ?? 0 },
              { icon: "video"          as const, bg: "#E6FAF8", color: "#7C3AED", label: "영상",     sub: `${storageUsage?.video_count||0}개`,   bytes: storageUsage?.video_bytes    ?? 0 },
              { icon: "message-square" as const, bg: "#E6FAF8", color: "#7C3AED", label: "메신저",   sub: "텍스트 데이터",                         bytes: storageUsage?.messenger_bytes ?? 0 },
              { icon: "book-open"      as const, bg: "#E6FAF8", color: "#16A34A", label: "수영일지", sub: "일지·메모 데이터",                       bytes: storageUsage?.diary_bytes    ?? 0 },
              { icon: "bell"           as const, bg: "#E6FAF8", color: "#F59E0B", label: "공지",     sub: "공지 본문 데이터",                       bytes: storageUsage?.notice_bytes   ?? 0 },
              { icon: "cpu"            as const, bg: "#E6FAF8", color: "#0369A1", label: "시스템",   sub: "기본 계정 데이터",                       bytes: storageUsage?.system_bytes   ?? 0 },
            ]).map(item => (
              <View key={item.label} style={s.usageRow}>
                <View style={[s.usageIcon, { backgroundColor: item.bg }]}>
                  <LucideIcon name={item.icon} size={16} color={item.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.usageLabel}>{item.label}</Text>
                  <Text style={s.usageSub}>{item.sub}</Text>
                </View>
                <Text style={s.usageBytes}>{fmtBytes(item.bytes)}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* ── 약관 및 정책 ── */}
        <View style={s.card}>
          <View style={s.cardHeader}>
            <FileText size={15} color={themeColor} />
            <Text style={s.cardTitle}>약관 및 정책</Text>
          </View>
          {[
            { label: "이용약관",          path: "/terms"   },
            { label: "개인정보처리방침",   path: "/privacy" },
            { label: "환불 및 결제 정책", path: "/refund"  },
          ].map((item, i) => (
            <Pressable
              key={item.label}
              style={[
                s.policyRow,
                i > 0 && { borderTopWidth: 1, borderTopColor: C.border },
              ]}
              onPress={() => router.push(item.path as any)}
            >
              <Text style={s.policyLabel}>{item.label}</Text>
              <ChevronRight size={16} color={C.textMuted} />
            </Pressable>
          ))}
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:             { flex: 1, backgroundColor: "#FFFFFF" },
  card:             { backgroundColor: C.card, borderRadius: 16, overflow: "hidden", shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1 },
  cardHeader:       { flexDirection: "row", alignItems: "center", gap: 8, padding: 16, borderBottomWidth: 1, borderBottomColor: "#FFFFFF" },
  cardTitle:        { fontSize: 15, fontFamily: "Pretendard-Regular", color: C.text },
  storageSummary:   { padding: 14, borderRadius: 14, borderWidth: 1 },
  storageUsedLabel: { fontSize: 12, fontFamily: "Pretendard-Regular", marginBottom: 2 },
  storageUsedBytes: { fontSize: 22, fontFamily: "Pretendard-Regular" },
  storageQuotaLabel:{ fontSize: 12, fontFamily: "Pretendard-Regular", color: "#64748B", marginBottom: 2 },
  storageQuotaBytes:{ fontSize: 15, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  gaugeWrap:        { height: 10, backgroundColor: "#E5E7EB", borderRadius: 5, overflow: "hidden" },
  gaugeBar:         { height: 10, borderRadius: 5 },
  gaugePct:         { fontSize: 12, fontFamily: "Pretendard-Regular" },
  gaugeRemain:      { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#64748B" },
  usageRow:         { flexDirection: "row", alignItems: "center", gap: 12 },
  usageIcon:        { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  usageLabel:       { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.text },
  usageSub:         { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textMuted },
  usageBytes:       { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  switchSection:    {},
  switchRow:        { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14 },
  switchLabel:      { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.text },
  switchSub:        { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textMuted, marginTop: 2 },
  infoRow:          { flexDirection: "row", alignItems: "center", gap: 8 },
  actionBtn:        { flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderRadius: 16, borderWidth: 1.5 },
  actionBtnText:    { flex: 1, fontSize: 14, fontFamily: "Pretendard-Regular" },
  policyRow:        { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 15 },
  policyLabel:      { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.text },
});
