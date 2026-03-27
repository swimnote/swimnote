/**
 * (admin)/invite-records.tsx — 초대 안내 기록
 * 플랫폼은 문자 전송 성공/실패를 추적하지 않음.
 * "문자 앱 호출 횟수"만 기록하며, 재안내 버튼으로 문자 앱을 다시 열 수 있음.
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  Alert, FlatList, Linking, Platform, Pressable,
  StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { ScreenLayout } from "@/components/common/ScreenLayout";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { FilterChips, FilterChipItem } from "@/components/common/FilterChips";
import { EmptyState } from "@/components/common/EmptyState";
import { useInviteRecordStore, InviteRecord, InviteTargetType } from "@/store/inviteRecordStore";

const C = Colors.light;

type FilterKey = "all" | InviteTargetType;

const _IC = "#1B4965"; const _IB = "#E6FAF8";
const FILTER_CHIPS: FilterChipItem<FilterKey>[] = [
  { key: "all",      label: "전체",   icon: "list"   },
  { key: "guardian", label: "학부모", icon: "users",      activeColor: _IC, activeBg: _IB },
  { key: "teacher",  label: "선생님", icon: "user-check", activeColor: _IC, activeBg: _IB },
];

const TARGET_CFG: Record<InviteTargetType, { label: string; color: string; bg: string; icon: string }> = {
  guardian: { label: "학부모", color: _IC, bg: _IB, icon: "users"      },
  teacher:  { label: "선생님", color: _IC, bg: _IB, icon: "user-check" },
};

function fmtDate(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ── 초대 안내 카드 ────────────────────────────────────────────────
function InviteCard({ record }: { record: InviteRecord }) {
  const reNotify    = useInviteRecordStore(s => s.reNotify);
  const tc          = TARGET_CFG[record.targetType];
  const [expanded, setExpanded] = useState(false);

  async function handleReNotify() {
    const smsUrl = Platform.OS === "ios"
      ? `sms:${record.targetPhone}&body=${encodeURIComponent(record.messageBody)}`
      : `sms:${record.targetPhone}?body=${encodeURIComponent(record.messageBody)}`;
    const can = await Linking.canOpenURL(smsUrl);
    if (can) {
      reNotify(record.id);
      await Linking.openURL(smsUrl);
    } else {
      Alert.alert("알림", "문자 앱을 열 수 없습니다. 기기 문자 앱에서 직접 발송해 주세요.");
    }
  }

  return (
    <View style={[s.card, { backgroundColor: C.card }]}>
      <Pressable style={s.cardTop} onPress={() => setExpanded(v => !v)}>
        {/* 대상 타입 아이콘 */}
        <View style={[s.typeIcon, { backgroundColor: tc.bg }]}>
          <Feather name={tc.icon as any} size={16} color={tc.color} />
        </View>

        <View style={s.cardInfo}>
          {/* 이름 + 대상 배지 + 호출 횟수 */}
          <View style={s.nameRow}>
            <Text style={s.targetName}>{record.targetName}</Text>
            <View style={[s.typeBadge, { backgroundColor: tc.bg }]}>
              <Text style={[s.typeBadgeTxt, { color: tc.color }]}>{tc.label}</Text>
            </View>
            <View style={[s.countBadge, { backgroundColor: record.callCount >= 3 ? "#F9DEDA" : "#F1F5F9" }]}>
              <Feather name="phone-call" size={10} color={record.callCount >= 3 ? "#D96C6C" : C.textMuted} />
              <Text style={[s.countTxt, { color: record.callCount >= 3 ? "#D96C6C" : C.textMuted }]}>
                {record.callCount}회
              </Text>
            </View>
          </View>

          {/* 학생 이름 (학부모 안내인 경우) */}
          {record.targetType === "guardian" && record.studentName && (
            <Text style={s.studentLine}>
              <Feather name="user" size={11} color={C.textMuted} /> 자녀: {record.studentName}
            </Text>
          )}

          {/* 전화번호 + 수영장명 */}
          <Text style={s.metaLine}>{record.targetPhone} · {record.operatorName}</Text>

          {/* 안내 일시 */}
          <Text style={s.dateLine}>
            첫 안내: {fmtDate(record.createdAt)}
            {record.lastReSentAt ? `  ·  마지막 재안내: ${fmtDate(record.lastReSentAt)}` : ""}
          </Text>
        </View>

        <Feather name={expanded ? "chevron-up" : "chevron-down"} size={16} color={C.textMuted} />
      </Pressable>

      {/* 펼침 영역 */}
      {expanded && (
        <View style={s.expandBody}>
          {/* 문자 미리보기 */}
          <View style={[s.msgBox, { backgroundColor: C.background }]}>
            <Text style={s.msgLabel}>문자 본문</Text>
            <Text style={s.msgText}>{record.messageBody}</Text>
          </View>

          {/* 발송자 정보 */}
          <View style={s.senderRow}>
            <View style={[s.roleBadge, { backgroundColor: record.senderRole === "teacher" ? "#EEDDF5" : "#E6FFFA" }]}>
              <Feather
                name={record.senderRole === "teacher" ? "user-check" : "shield"}
                size={11}
                color={record.senderRole === "teacher" ? "#7C3AED" : "#2EC4B6"}
              />
              <Text style={[s.roleLabel, { color: record.senderRole === "teacher" ? "#7C3AED" : "#2EC4B6" }]}>
                {record.senderRole === "teacher" ? "선생님" : "관리자"} · {record.senderName}
              </Text>
            </View>
          </View>

          {/* 재안내 버튼 */}
          <Pressable style={[s.reNotifyBtn, { backgroundColor: C.tintLight }]} onPress={handleReNotify}>
            <Feather name="message-circle" size={14} color={C.tint} />
            <Text style={[s.reNotifyTxt, { color: C.tint }]}>재안내 (문자 앱 열기)</Text>
          </Pressable>

          {record.lastReSentAt && (
            <Text style={s.reNotifyHint}>마지막 재안내: {fmtDate(record.lastReSentAt)} · 총 {record.callCount}회 발송</Text>
          )}
        </View>
      )}
    </View>
  );
}

// ── 메인 화면 ────────────────────────────────────────────────────
export default function InviteRecordsScreen() {
  const insets = useSafeAreaInsets();
  const { pool }  = useAuth();
  const records   = useInviteRecordStore(s => s.records);
  const [filter, setFilter] = useState<FilterKey>("all");

  const operatorRecords = useMemo(
    () => records.filter(r => !pool?.id || r.operatorId === pool.id),
    [records, pool?.id],
  );

  const filtered = useMemo(
    () => filter === "all" ? operatorRecords : operatorRecords.filter(r => r.targetType === filter),
    [operatorRecords, filter],
  );

  const totalCalls = useMemo(
    () => operatorRecords.reduce((acc, r) => acc + r.callCount, 0),
    [operatorRecords],
  );
  const guardianCount = useMemo(() => operatorRecords.filter(r => r.targetType === "guardian").length, [operatorRecords]);
  const teacherCount  = useMemo(() => operatorRecords.filter(r => r.targetType === "teacher").length,  [operatorRecords]);

  return (
    <ScreenLayout>
      <SubScreenHeader title="초대 안내 기록" onBack={() => router.back()} />

      {/* 안내 배너 */}
      <View style={[s.infoBanner, { backgroundColor: "#DFF3EC" }]}>
        <Feather name="info" size={13} color="#2EC4B6" />
        <Text style={s.infoTxt}>
          플랫폼은 문자 전송 성공·실패를 추적하지 않습니다. "재안내" 버튼으로 문자 앱을 다시 열 수 있습니다.
        </Text>
      </View>

      {/* 요약 카드 */}
      <View style={s.summaryRow}>
        <View style={[s.summaryCard, { backgroundColor: "#F1F5F9", flex: 1 }]}>
          <Text style={[s.summaryNum, { color: C.text }]}>{operatorRecords.length}</Text>
          <Text style={[s.summaryLbl, { color: C.textSecondary }]}>전체 안내 건</Text>
        </View>
        <View style={[s.summaryCard, { backgroundColor: "#E6FFFA", flex: 1 }]}>
          <Text style={[s.summaryNum, { color: "#2EC4B6" }]}>{guardianCount}</Text>
          <Text style={[s.summaryLbl, { color: "#2EC4B6" }]}>학부모</Text>
        </View>
        <View style={[s.summaryCard, { backgroundColor: "#EEDDF5", flex: 1 }]}>
          <Text style={[s.summaryNum, { color: "#7C3AED" }]}>{teacherCount}</Text>
          <Text style={[s.summaryLbl, { color: "#7C3AED" }]}>선생님</Text>
        </View>
        <View style={[s.summaryCard, { backgroundColor: "#E6FFFA", flex: 1 }]}>
          <Text style={[s.summaryNum, { color: "#2EC4B6" }]}>{totalCalls}</Text>
          <Text style={[s.summaryLbl, { color: "#2EC4B6" }]}>총 호출</Text>
        </View>
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
          <EmptyState
            icon="send"
            title="초대 안내 기록이 없습니다"
            description="학생 목록에서 초대 문자를 보내면 여기에 기록됩니다."
          />
        }
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
      />
    </ScreenLayout>
  );
}

const s = StyleSheet.create({
  infoBanner:    { flexDirection: "row", alignItems: "flex-start", gap: 8, marginHorizontal: 16, marginBottom: 12,
                   marginTop: 8, padding: 10, borderRadius: 10 },
  infoTxt:       { flex: 1, fontSize: 12, fontFamily: "Pretendard-Regular", color: "#2EC4B6", lineHeight: 17 },

  summaryRow:    { flexDirection: "row", gap: 8, paddingHorizontal: 16, marginBottom: 12 },
  summaryCard:   { borderRadius: 12, paddingVertical: 10, alignItems: "center" },
  summaryNum:    { fontSize: 20, fontFamily: "Pretendard-Bold" },
  summaryLbl:    { fontSize: 10, fontFamily: "Pretendard-Medium", marginTop: 2 },

  list:          { paddingHorizontal: 16, paddingTop: 8 },

  card:          { borderRadius: 14, overflow: "hidden" },
  cardTop:       { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  typeIcon:      { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  cardInfo:      { flex: 1, gap: 3 },

  nameRow:       { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  targetName:    { fontSize: 15, fontFamily: "Pretendard-Bold", color: C.text },
  typeBadge:     { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 20 },
  typeBadgeTxt:  { fontSize: 11, fontFamily: "Pretendard-SemiBold" },
  countBadge:    { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 20 },
  countTxt:      { fontSize: 11, fontFamily: "Pretendard-SemiBold" },

  studentLine:   { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  metaLine:      { fontSize: 13, fontFamily: "Pretendard-Medium", color: C.textSecondary },
  dateLine:      { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted },

  expandBody:    { paddingHorizontal: 14, paddingBottom: 14, gap: 10 },
  msgBox:        { borderRadius: 10, padding: 12 },
  msgLabel:      { fontSize: 11, fontFamily: "Pretendard-SemiBold", color: C.textMuted, marginBottom: 6 },
  msgText:       { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.text, lineHeight: 18 },

  senderRow:     { flexDirection: "row", gap: 8 },
  roleBadge:     { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20 },
  roleLabel:     { fontSize: 11, fontFamily: "Pretendard-Medium" },

  reNotifyBtn:   { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
                   paddingVertical: 11, borderRadius: 10 },
  reNotifyTxt:   { fontSize: 13, fontFamily: "Pretendard-SemiBold" },
  reNotifyHint:  { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted, textAlign: "center" },
});
