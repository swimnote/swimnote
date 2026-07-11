/**
 * 자녀 프로필 페이지
 * - 이름, 성별, 출생연도, 소속 수영장, 반 정보 표시
 * - ParentScreenHeader (홈 버튼 → 학부모 홈)
 */
import { Clock } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { ParentScreenHeader } from "@/components/parent/ParentScreenHeader";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useParent } from "@/context/ParentContext";
import { normalizeKoreanName } from "@/utils/validation";

const C = Colors.light;
const CHILD_COLORS = [C.tint, "#2EC4B6", "#7C3AED", "#D97706", "#0EA5E9"];
const DAY_ORDER = ["월", "화", "수", "목", "금", "토", "일"];

function parseScheduleChips(days: string, time: string): string[] {
  let parts: string[] = [];
  if (days.includes(",")) parts = days.split(",").map(d => d.trim()).filter(Boolean);
  else parts = days.split("").filter(d => DAY_ORDER.includes(d));
  parts.sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b));
  return parts.map(d => `${d}요일 ${time}`);
}

interface InfoRowProps { icon: any; label: string; value: string; accentColor?: string; }
function InfoRow({ icon, label, value, accentColor }: InfoRowProps) {
  return (
    <View style={ir.row}>
      <View style={[ir.iconBox, { backgroundColor: (accentColor || C.tint) + "15" }]}>
        <LucideIcon name={icon} size={16} color={accentColor || C.tint} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[ir.label, { color: C.textMuted }]}>{label}</Text>
        <Text style={[ir.value, { color: C.text }]}>{value}</Text>
      </View>
    </View>
  );
}
const ir = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
  iconBox: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  label: { fontSize: 11, fontFamily: "Pretendard-Regular" },
  value: { fontSize: 14, fontFamily: "Pretendard-Regular", marginTop: 1 },
});

export default function ChildProfileScreen() {
  const { token, parentAccount } = useAuth();
  const { students, setSelectedStudentId, refresh } = useParent();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [student, setStudent] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [unlinking, setUnlinking] = useState(false);

  function handleUnlink() {
    if (!student) return;
    const hasClass = !!student.class_group?.name;
    if (hasClass) {
      Alert.alert(
        "삭제 불가",
        `${student.name}은(는) 현재 '${student.class_group.name}' 반에 배정되어 있습니다.\n\n선생님 모드에서 반 배정을 제외한 후 삭제할 수 있습니다.`,
        [{ text: "확인" }]
      );
      return;
    }
    Alert.alert(
      "자녀 연결 삭제",
      `${student.name}의 연결을 삭제할까요?\n삭제 후 홈 화면에서 다시 추가할 수 있습니다.`,
      [
        { text: "취소", style: "cancel" },
        {
          text: "삭제",
          style: "destructive",
          onPress: async () => {
            setUnlinking(true);
            try {
              const r = await apiRequest(token, `/parent/unlink-child/${id}`, { method: "DELETE" });
              const d = await r.json();
              if (r.ok && d.success) {
                await refresh();
                router.replace("/(parent)/home" as any);
              } else {
                Alert.alert("오류", d.message || "연결 삭제에 실패했습니다.");
              }
            } catch {
              Alert.alert("오류", "네트워크 오류가 발생했습니다.");
            } finally {
              setUnlinking(false);
            }
          },
        },
      ]
    );
  }

  const studentIdx = students.findIndex(s => s.id === id);
  const accentColor = CHILD_COLORS[Math.max(0, studentIdx) % CHILD_COLORS.length];

  useEffect(() => {
    if (!id) { setLoading(false); return; }
    (async () => {
      try {
        const r = await apiRequest(token, `/parent/students/${id}`);
        if (r.ok) {
          const data = await r.json();
          setStudent({ ...data, name: normalizeKoreanName(data.name) });
        }
      } catch {}
      finally { setLoading(false); }
    })();
  }, [id]);

  if (loading) {
    return (
      <View style={[s.root, { backgroundColor: C.background }]}>
        <ParentScreenHeader title="자녀 프로필" />
        <ActivityIndicator color={C.tint} style={{ marginTop: 60 }} />
      </View>
    );
  }
  if (!student) {
    return (
      <View style={[s.root, { backgroundColor: C.background }]}>
        <ParentScreenHeader title="자녀 프로필" />
        <View style={s.empty}>
          <Text style={[s.emptyTxt, { color: C.textSecondary }]}>자녀 정보를 찾을 수 없습니다</Text>
        </View>
      </View>
    );
  }

  const classGroup = student.class_group;
  const scheduleChips = classGroup?.schedule_days && classGroup?.schedule_time
    ? parseScheduleChips(classGroup.schedule_days, classGroup.schedule_time)
    : [];

  const birthYear = student.birth_year || (student.birth_date ? student.birth_date.split("-")[0] : null);

  return (
    <View style={[s.root, { backgroundColor: C.background }]}>
      <ParentScreenHeader title="자녀 프로필" />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
      >
        {/* 헤더 아바타 */}
        <View style={[s.hero, { backgroundColor: accentColor }]}>
          <View style={[s.avatar, { backgroundColor: "rgba(255,255,255,0.25)" }]}>
            <Text style={s.avatarTxt}>{student.name[0]}</Text>
          </View>
          <Text style={s.heroName}>{student.name}</Text>
          {classGroup?.name && (
            <Text style={s.heroClass}>{classGroup.name}</Text>
          )}
        </View>

        <View style={{ padding: 20, gap: 12 }}>
          {/* 기본 정보 */}
          <View style={[s.card, { backgroundColor: C.card }]}>
            <Text style={[s.cardTitle, { color: C.text }]}>기본 정보</Text>
            <View style={[s.divider, { backgroundColor: C.border }]} />
            <InfoRow icon="user" label="이름" value={student.name} accentColor={accentColor} />
            {birthYear && <InfoRow icon="calendar" label="출생연도" value={`${birthYear}년생`} accentColor={accentColor} />}
            {student.phone && <InfoRow icon="phone" label="전화번호" value={student.phone} accentColor={accentColor} />}
          </View>

          {/* 수영장 정보 */}
          <View style={[s.card, { backgroundColor: C.card }]}>
            <Text style={[s.cardTitle, { color: C.text }]}>수영장 정보</Text>
            <View style={[s.divider, { backgroundColor: C.border }]} />
            <InfoRow icon="map-pin" label="소속 수영장" value={parentAccount?.pool_name || "수영장"} accentColor={accentColor} />
            {classGroup?.name
              ? <InfoRow icon="users" label="반" value={classGroup.name} accentColor={accentColor} />
              : <InfoRow icon="users" label="반" value="배정 전" accentColor="#64748B" />
            }
            {scheduleChips.length > 0 && (
              <View style={ir.row}>
                <View style={[ir.iconBox, { backgroundColor: accentColor + "15" }]}>
                  <Clock size={16} color={accentColor} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[ir.label, { color: C.textMuted }]}>수업 일정</Text>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                    {scheduleChips.map((chip, i) => (
                      <View key={i} style={[s.chip, { backgroundColor: accentColor + "15" }]}>
                        <Text style={[s.chipTxt, { color: accentColor }]}>{chip}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              </View>
            )}
          </View>

          {/* 바로가기 */}
          <View style={[s.card, { backgroundColor: C.card }]}>
            <Text style={[s.cardTitle, { color: C.text }]}>바로가기</Text>
            <View style={[s.divider, { backgroundColor: C.border }]} />
            <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
              {[
                { icon: "book-open", label: "수업일지", path: "/(parent)/diary" },
                { icon: "calendar", label: "출결기록", path: "/(parent)/attendance-history" },
                { icon: "image",    label: "앨범",     path: "/(parent)/photos" },
                { icon: "award",    label: "레벨기록", path: "/(parent)/level" },
              ].map(btn => (
                <Pressable
                  key={btn.label}
                  style={({ pressed }) => [s.quickBtn, { backgroundColor: accentColor + "12", opacity: pressed ? 0.75 : 1 }]}
                  onPress={() => {
                    setSelectedStudentId(id);
                    router.push((btn.path + "?backTo=child-profile") as any);
                  }}
                >
                  <LucideIcon name={btn.icon as any} size={18} color={accentColor} />
                  <Text style={[s.quickBtnTxt, { color: accentColor }]}>{btn.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
          {/* 연결 삭제 / 잠금 */}
          {classGroup?.name ? (
            <View style={s.unlinkLocked}>
              <View style={s.unlinkLockedRow}>
                <LucideIcon name="lock" size={15} color="#94A3B8" />
                <Text style={s.unlinkLockedTxt}>자녀 연결 삭제</Text>
              </View>
              <Text style={s.unlinkLockedDesc}>
                반 배정이 되어 있어 삭제할 수 없습니다.{"\n"}선생님 모드에서 반 배정을 제외한 후 삭제할 수 있습니다.
              </Text>
            </View>
          ) : (
            <Pressable
              style={({ pressed }) => [s.unlinkBtn, { opacity: pressed || unlinking ? 0.7 : 1 }]}
              onPress={handleUnlink}
              disabled={unlinking}
            >
              {unlinking
                ? <ActivityIndicator size="small" color="#DC2626" />
                : <LucideIcon name="user-minus" size={16} color="#DC2626" />
              }
              <Text style={s.unlinkTxt}>자녀 연결 삭제</Text>
            </Pressable>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  hero: {
    alignItems: "center", paddingVertical: 32, paddingHorizontal: 20, gap: 8,
  },
  avatar: {
    width: 72, height: 72, borderRadius: 22,
    alignItems: "center", justifyContent: "center",
  },
  avatarTxt: { fontSize: 30, fontFamily: "Pretendard-Regular", color: "#fff" },
  heroName: { fontSize: 22, fontFamily: "Pretendard-Regular", color: "#fff" },
  heroClass: { fontSize: 14, fontFamily: "Pretendard-Regular", color: "rgba(255,255,255,0.85)" },

  card: {
    borderRadius: 16, padding: 16, gap: 4,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  cardTitle: { fontSize: 14, fontFamily: "Pretendard-Regular", marginBottom: 4 },
  divider: { height: 1, marginBottom: 4 },
  chip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  chipTxt: { fontSize: 12, fontFamily: "Pretendard-Regular" },

  quickBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12 },
  quickBtnTxt: { fontSize: 13, fontFamily: "Pretendard-Regular" },

  empty: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyTxt: { fontSize: 14, fontFamily: "Pretendard-Regular" },
  unlinkBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: "#FECACA", backgroundColor: "#FEF2F2" },
  unlinkTxt: { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#DC2626" },
  unlinkLocked: { borderRadius: 12, borderWidth: 1, borderColor: "#E2E8F0", backgroundColor: "#F8FAFC", padding: 14, gap: 6 },
  unlinkLockedRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  unlinkLockedTxt: { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#94A3B8" },
  unlinkLockedDesc: { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#94A3B8", lineHeight: 18 },
});
