/**
 * 수영정보 페이지
 *
 * 항목:
 *   1. 수영장 소개
 *   2. 수업료 안내
 *   3. 레벨 테스트 안내
 *   4. 이벤트/소식
 *   5. 수영 용품 소개
 *
 * - 수영장별 정보를 /parent/pool-info에서 로드
 * - 섹션별 접기/펼치기
 * - ParentScreenHeader (홈 → 학부모 홈)
 */
import { Feather } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { ParentScreenHeader } from "@/components/parent/ParentScreenHeader";
import { LevelBadge, type LevelDef } from "@/components/common/LevelBadge";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useParent } from "@/context/ParentContext";

const C = Colors.light;

interface PoolInfo {
  introduction?: string | null;
  tuition_info?: string | null;
  level_test_info?: string | null;
  event_info?: string | null;
  equipment_info?: string | null;
  pool_name?: string | null;
  address?: string | null;
  phone?: string | null;
}

interface Section {
  key: keyof PoolInfo;
  icon: any;
  label: string;
  color: string;
  bg: string;
  placeholder: string;
}

const SECTIONS: Section[] = [
  {
    key: "introduction",
    icon: "map-pin",
    label: "수영장 소개",
    color: "#1F8F86",
    bg: "#DDF2EF",
    placeholder: "수영장 소개 정보가 등록되면 여기에 표시됩니다.",
  },
  {
    key: "tuition_info",
    icon: "credit-card",
    label: "수업료 안내",
    color: "#1F8F86",
    bg: "#DFF3EC",
    placeholder: "수업료 안내 정보가 등록되면 여기에 표시됩니다.",
  },
  {
    key: "level_test_info",
    icon: "award",
    label: "레벨 테스트 안내",
    color: "#7C3AED",
    bg: "#EEDDF5",
    placeholder: "레벨 테스트 안내 정보가 등록되면 여기에 표시됩니다.",
  },
  {
    key: "event_info",
    icon: "gift",
    label: "이벤트/소식",
    color: "#D97706",
    bg: "#FFF1BF",
    placeholder: "이벤트 및 소식이 등록되면 여기에 표시됩니다.",
  },
  {
    key: "equipment_info",
    icon: "shopping-bag",
    label: "수영 용품 소개",
    color: "#0EA5E9",
    bg: "#F0F9FF",
    placeholder: "수영 용품 소개가 등록되면 여기에 표시됩니다.",
  },
];

function SectionCard({ section, content }: { section: Section; content?: string | null }) {
  const [open, setOpen] = useState(true);
  const hasContent = !!content?.trim();

  return (
    <View style={[cs.card, { backgroundColor: C.card }]}>
      <Pressable style={cs.cardHeader} onPress={() => setOpen(o => !o)}>
        <View style={[cs.iconBox, { backgroundColor: section.bg }]}>
          <Feather name={section.icon} size={20} color={section.color} />
        </View>
        <Text style={[cs.cardTitle, { color: C.text }]}>{section.label}</Text>
        <Feather
          name={open ? "chevron-up" : "chevron-down"}
          size={18} color={C.textMuted}
        />
      </Pressable>

      {open && (
        <View style={cs.cardBody}>
          <View style={[cs.divider, { backgroundColor: C.border }]} />
          {hasContent ? (
            <Text style={[cs.content, { color: C.text }]}>{content}</Text>
          ) : (
            <View style={cs.placeholder}>
              <Feather name="info" size={14} color={C.textMuted} />
              <Text style={[cs.placeholderTxt, { color: C.textMuted }]}>{section.placeholder}</Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

interface LevelInfo { current_level_order: number | null; current_level: LevelDef | null; next_level: LevelDef | null; }

export default function SwimInfoScreen() {
  const { token } = useAuth();
  const { selectedStudent } = useParent();
  const insets = useSafeAreaInsets();
  const [info, setInfo] = useState<PoolInfo | null>(null);
  const [levelInfo, setLevelInfo] = useState<LevelInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [poolRes, lvRes] = await Promise.all([
          apiRequest(token, "/parent/pool-info"),
          selectedStudent?.id ? apiRequest(token, `/parent/students/${selectedStudent.id}/level-info`) : Promise.resolve(null),
        ]);
        if (poolRes.ok) setInfo(await poolRes.json());
        else setInfo({});
        if (lvRes?.ok) setLevelInfo(await lvRes.json());
      } catch { setInfo({}); }
      finally { setLoading(false); }
    })();
  }, [selectedStudent?.id]);

  return (
    <View style={[s.root, { backgroundColor: C.background }]}>
      <ParentScreenHeader title="수영정보" />

      {loading ? (
        <ActivityIndicator color={C.tint} style={{ marginTop: 60 }} />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40, gap: 12 }}
        >
          {/* 수영장 기본 정보 칩 */}
          {(info?.pool_name || info?.address || info?.phone) && (
            <View style={[s.poolCard, { backgroundColor: C.tint }]}>
              {info.pool_name && (
                <Text style={s.poolName}>{info.pool_name}</Text>
              )}
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 4 }}>
                {info.address && (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                    <Feather name="map-pin" size={13} color="rgba(255,255,255,0.8)" />
                    <Text style={s.poolMeta}>{info.address}</Text>
                  </View>
                )}
                {info.phone && (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                    <Feather name="phone" size={13} color="rgba(255,255,255,0.8)" />
                    <Text style={s.poolMeta}>{info.phone}</Text>
                  </View>
                )}
              </View>
            </View>
          )}

          {/* 자녀 현재 레벨 카드 */}
          {selectedStudent && levelInfo && (
            <View style={[sl.levelCard, { backgroundColor: C.card }]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <LevelBadge level={levelInfo.current_level ?? null} size="md" />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: C.textSecondary }}>
                    {selectedStudent.name}의 현재 레벨
                  </Text>
                  <Text style={{ fontSize: 18, fontFamily: "Inter_700Bold", color: C.text, marginTop: 2 }}>
                    {levelInfo.current_level?.level_name ?? "미지정"}
                  </Text>
                  {levelInfo.current_level?.level_description ? (
                    <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 2 }} numberOfLines={2}>
                      {levelInfo.current_level.level_description}
                    </Text>
                  ) : null}
                </View>
                {levelInfo.next_level && (
                  <View style={{ alignItems: "center", gap: 2 }}>
                    <Text style={{ fontSize: 9, fontFamily: "Inter_400Regular", color: C.textMuted }}>다음 목표</Text>
                    <LevelBadge level={levelInfo.next_level} size="sm" />
                    <Text style={{ fontSize: 10, fontFamily: "Inter_500Medium", color: C.textSecondary }}>
                      {levelInfo.next_level.level_name}
                    </Text>
                  </View>
                )}
              </View>
              {levelInfo.current_level?.promotion_test_rule ? (
                <View style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.border }}>
                  <Text style={{ fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#D97706" }}>승급 기준</Text>
                  <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: C.text, marginTop: 4, lineHeight: 20 }}>
                    {levelInfo.current_level.promotion_test_rule}
                  </Text>
                </View>
              ) : null}
            </View>
          )}

          {/* 섹션 카드들 */}
          {SECTIONS.map(sec => (
            <SectionCard
              key={sec.key}
              section={sec}
              content={info?.[sec.key] as string | null}
            />
          ))}

          {/* 안내 문구 */}
          <View style={[s.notice, { backgroundColor: C.card }]}>
            <Feather name="info" size={14} color={C.textMuted} />
            <Text style={[s.noticeTxt, { color: C.textMuted }]}>
              수영장 정보는 관리자가 업데이트합니다.{"\n"}
              문의사항은 수영장으로 직접 연락해 주세요.
            </Text>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  poolCard: {
    borderRadius: 16, padding: 18, gap: 4,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1, shadowRadius: 6, elevation: 3,
  },
  poolName: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#fff" },
  poolMeta: { fontSize: 12, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.85)" },
  notice: {
    borderRadius: 12, padding: 14,
    flexDirection: "row", gap: 8, alignItems: "flex-start",
  },
  noticeTxt: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18, flex: 1 },
});

const sl = StyleSheet.create({
  levelCard: {
    borderRadius: 16, padding: 14,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
    borderWidth: 1, borderColor: "#E9E2DD",
  },
});

const cs = StyleSheet.create({
  card: {
    borderRadius: 16, overflow: "hidden",
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  cardHeader: {
    flexDirection: "row", alignItems: "center", gap: 12, padding: 16,
  },
  iconBox: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  cardTitle: { flex: 1, fontSize: 15, fontFamily: "Inter_600SemiBold" },
  cardBody: { paddingHorizontal: 16, paddingBottom: 16, gap: 10 },
  divider: { height: 1, marginBottom: 6 },
  content: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 23 },
  placeholder: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 4 },
  placeholderTxt: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
});
