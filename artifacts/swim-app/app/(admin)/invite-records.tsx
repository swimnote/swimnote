/**
 * 학부모 초대 내역 — 관리자 화면
 * 문자앱 열기 / 링크 복사로 발송된 초대 기록 목록 + 상태 추적
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  Alert, FlatList, Linking, Platform, Pressable,
  Share, StyleSheet, Text, View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { ScreenLayout } from "@/components/common/ScreenLayout";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { FilterChips, FilterChipItem } from "@/components/common/FilterChips";
import { EmptyState } from "@/components/common/EmptyState";
import { useInviteRecordStore, InviteRecord, InviteStatus } from "@/store/inviteRecordStore";

const C = Colors.light;

// ── 상태 설정 ────────────────────────────────────────────────────
const STATUS_CFG: Record<InviteStatus, { label: string; color: string; bg: string; icon: string }> = {
  opened_sms_app:   { label: "문자앱 열기 완료", color: "#0891B2", bg: "#ECFEFF", icon: "message-circle" },
  copied_link:      { label: "링크 복사",        color: "#7C3AED", bg: "#F3E8FF", icon: "copy"           },
  signup_requested: { label: "가입 요청 옴",     color: "#D97706", bg: "#FEF3C7", icon: "user-plus"      },
  approved:         { label: "승인 완료",         color: "#059669", bg: "#D1FAE5", icon: "check-circle"   },
};

type FilterKey = "all" | InviteStatus;

const FILTER_CHIPS: FilterChipItem<FilterKey>[] = [
  { key: "all",             label: "전체",         icon: "list"          },
  { key: "opened_sms_app",  label: "문자앱",       icon: "message-circle", activeColor: STATUS_CFG.opened_sms_app.color,   activeBg: STATUS_CFG.opened_sms_app.bg   },
  { key: "copied_link",     label: "링크복사",     icon: "copy",           activeColor: STATUS_CFG.copied_link.color,      activeBg: STATUS_CFG.copied_link.bg      },
  { key: "signup_requested",label: "가입요청",     icon: "user-plus",      activeColor: STATUS_CFG.signup_requested.color, activeBg: STATUS_CFG.signup_requested.bg },
  { key: "approved",        label: "승인완료",     icon: "check-circle",   activeColor: STATUS_CFG.approved.color,         activeBg: STATUS_CFG.approved.bg         },
];

function formatDate(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ── 초대 카드 ────────────────────────────────────────────────────
function InviteCard({ record }: { record: InviteRecord }) {
  const sc = STATUS_CFG[record.status];
  const [expanded, setExpanded] = useState(false);

  async function handleResendSms() {
    if (!record.messageBody) return;
    const smsUrl = Platform.OS === "ios"
      ? `sms:${record.guardianPhone}&body=${encodeURIComponent(record.messageBody)}`
      : `sms:${record.guardianPhone}?body=${encodeURIComponent(record.messageBody)}`;
    const can = await Linking.canOpenURL(smsUrl);
    if (can) {
      await Linking.openURL(smsUrl);
    } else {
      await Share.share({ message: record.messageBody });
    }
  }

  async function handleCopyLink() {
    await Clipboard.setStringAsync(record.messageBody);
    Alert.alert("복사 완료", "초대 메시지가 클립보드에 복사되었습니다.");
  }

  return (
    <View style={[s.card, { backgroundColor: C.card }]}>
      {/* 헤더 */}
      <Pressable style={s.cardTop} onPress={() => setExpanded(v => !v)}>
        <View style={[s.methodIcon, { backgroundColor: sc.bg }]}>
          <Feather name={sc.icon as any} size={16} color={sc.color} />
        </View>
        <View style={s.cardInfo}>
          <View style={s.nameRow}>
            <Text style={s.studentName}>{record.studentName}</Text>
            <View style={[s.statusChip, { backgroundColor: sc.bg }]}>
              <Text style={[s.statusLabel, { color: sc.color }]}>{sc.label}</Text>
            </View>
          </View>
          <Text style={s.phone}>{record.guardianPhone}</Text>
          <Text style={s.meta}>
            {record.senderName} · {record.method === "sms_app" ? "문자앱" : "링크복사"} · {formatDate(record.createdAt)}
          </Text>
        </View>
        <Feather name={expanded ? "chevron-up" : "chevron-down"} size={16} color={C.textMuted} />
      </Pressable>

      {/* 펼침 영역 */}
      {expanded && (
        <View style={s.expandBody}>
          {/* 메시지 미리보기 */}
          <View style={[s.msgBox, { backgroundColor: C.background }]}>
            <Text style={s.msgText} numberOfLines={4}>{record.messageBody}</Text>
          </View>

          {/* 액션 버튼들 */}
          <View style={s.actions}>
            <Pressable style={[s.actionBtn, { backgroundColor: C.tintLight }]} onPress={handleResendSms}>
              <Feather name="message-circle" size={13} color={C.tint} />
              <Text style={[s.actionTxt, { color: C.tint }]}>다시 문자 열기</Text>
            </Pressable>
            <Pressable style={[s.actionBtn, { backgroundColor: "#F3E8FF" }]} onPress={handleCopyLink}>
              <Feather name="copy" size={13} color="#7C3AED" />
              <Text style={[s.actionTxt, { color: "#7C3AED" }]}>링크 다시 복사</Text>
            </Pressable>
          </View>
          <View style={s.actions}>
            {(record.status === "signup_requested" || record.status === "approved") && (
              <Pressable
                style={[s.actionBtn, { backgroundColor: "#FEF3C7", flex: 1 }]}
                onPress={() => router.push("/(admin)/approvals" as any)}
              >
                <Feather name="check-circle" size={13} color="#D97706" />
                <Text style={[s.actionTxt, { color: "#D97706" }]}>가입 요청 보기</Text>
              </Pressable>
            )}
          </View>

          {/* 발송자 역할 배지 */}
          <View style={s.senderRow}>
            <View style={[s.roleChip, { backgroundColor: record.senderRole === "teacher" ? "#EDE9FE" : "#DBEAFE" }]}>
              <Feather name={record.senderRole === "teacher" ? "user-check" : "shield"} size={11}
                color={record.senderRole === "teacher" ? "#7C3AED" : "#2563EB"} />
              <Text style={[s.roleLabel, { color: record.senderRole === "teacher" ? "#7C3AED" : "#2563EB" }]}>
                {record.senderRole === "teacher" ? "선생님" : "관리자"}
              </Text>
            </View>
            {record.relatedParentUserId && (
              <View style={[s.roleChip, { backgroundColor: "#D1FAE5" }]}>
                <Feather name="link" size={11} color="#059669" />
                <Text style={[s.roleLabel, { color: "#059669" }]}>학부모 계정 연결됨</Text>
              </View>
            )}
          </View>
        </View>
      )}
    </View>
  );
}

// ── 메인 화면 ────────────────────────────────────────────────────
export default function InviteRecordsScreen() {
  const insets = useSafeAreaInsets();
  const { pool } = useAuth();
  const records  = useInviteRecordStore(s => s.records);

  const [filter, setFilter] = useState<FilterKey>("all");

  const operatorRecords = useMemo(
    () => records.filter(r => !pool?.id || r.operatorId === pool.id),
    [records, pool?.id],
  );

  const filtered = useMemo(
    () => filter === "all" ? operatorRecords : operatorRecords.filter(r => r.status === filter),
    [operatorRecords, filter],
  );

  // 집계
  const counts = useMemo(() => {
    const c: Record<InviteStatus, number> = {
      opened_sms_app: 0, copied_link: 0, signup_requested: 0, approved: 0,
    };
    operatorRecords.forEach(r => { c[r.status]++ });
    return c;
  }, [operatorRecords]);

  return (
    <ScreenLayout>
      <SubScreenHeader title="학부모 초대 내역" onBack={() => router.back()} />

      {/* 요약 카드 */}
      <View style={s.summaryRow}>
        {(["opened_sms_app", "copied_link", "signup_requested", "approved"] as InviteStatus[]).map(k => {
          const sc = STATUS_CFG[k];
          return (
            <View key={k} style={[s.summaryCard, { backgroundColor: sc.bg }]}>
              <Text style={[s.summaryNum, { color: sc.color }]}>{counts[k]}</Text>
              <Text style={[s.summaryLbl, { color: sc.color }]} numberOfLines={1}>
                {k === "opened_sms_app" ? "문자발송" : k === "copied_link" ? "링크복사" : k === "signup_requested" ? "가입요청" : "승인완료"}
              </Text>
            </View>
          );
        })}
      </View>

      {/* 필터 */}
      <FilterChips<FilterKey>
        chips={FILTER_CHIPS}
        value={filter}
        onChange={setFilter}
        style={{ paddingHorizontal: 16, marginBottom: 4 }}
      />

      {/* 목록 */}
      <FlatList
        data={filtered}
        keyExtractor={r => r.id}
        renderItem={({ item }) => <InviteCard record={item} />}
        contentContainerStyle={[
          s.list,
          { paddingBottom: insets.bottom + 24 },
          filtered.length === 0 && { flex: 1 },
        ]}
        ListEmptyComponent={
          <EmptyState icon="send" title="초대 내역이 없습니다"
            description="학생 목록에서 초대 문자를 보내면 여기에 기록됩니다." />
        }
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
      />
    </ScreenLayout>
  );
}

const s = StyleSheet.create({
  summaryRow:    { flexDirection: "row", gap: 8, paddingHorizontal: 16, marginBottom: 12, marginTop: 8 },
  summaryCard:   { flex: 1, borderRadius: 12, paddingVertical: 10, alignItems: "center" },
  summaryNum:    { fontSize: 20, fontFamily: "Inter_700Bold" },
  summaryLbl:    { fontSize: 10, fontFamily: "Inter_500Medium", marginTop: 2 },

  list:          { paddingHorizontal: 16, paddingTop: 8 },

  card:          { borderRadius: 14, overflow: "hidden" },
  cardTop:       { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  methodIcon:    { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  cardInfo:      { flex: 1, gap: 3 },
  nameRow:       { flexDirection: "row", alignItems: "center", gap: 8 },
  studentName:   { fontSize: 15, fontFamily: "Inter_700Bold", color: C.text },
  statusChip:    { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 20 },
  statusLabel:   { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  phone:         { fontSize: 13, fontFamily: "Inter_500Medium", color: C.textSecondary },
  meta:          { fontSize: 11, fontFamily: "Inter_400Regular", color: C.textMuted },

  expandBody:    { paddingHorizontal: 14, paddingBottom: 14, gap: 10 },
  msgBox:        { borderRadius: 10, padding: 12 },
  msgText:       { fontSize: 12, fontFamily: "Inter_400Regular", color: C.text, lineHeight: 18 },

  actions:       { flexDirection: "row", gap: 8 },
  actionBtn:     { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
                   gap: 6, paddingVertical: 9, borderRadius: 10 },
  actionTxt:     { fontSize: 12, fontFamily: "Inter_600SemiBold" },

  senderRow:     { flexDirection: "row", gap: 8 },
  roleChip:      { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8,
                   paddingVertical: 4, borderRadius: 20 },
  roleLabel:     { fontSize: 11, fontFamily: "Inter_500Medium" },
});
