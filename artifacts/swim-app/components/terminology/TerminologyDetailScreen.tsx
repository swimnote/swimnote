/**
 * TerminologyDetailScreen — 공통 용어 상세 화면
 *
 * termId를 params로 받아 상세를 표시.
 * Inline link tap → router.push(same-role detail) → back stack 유지.
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { LucideIcon } from "@/components/common/LucideIcon";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { apiRequest, useAuth } from "@/context/AuthContext";
import Colors from "@/constants/colors";
import { TerminologyLinkedText, type TermSegment } from "./TerminologyLinkedText";

const C    = Colors.light;
const NAVY = "#0C1A2E";

// ─── Types (mirrors server contract) ─────────────────────────────────────────

interface TermSection {
  type: string;
  label: string;
  segments: TermSegment[];
}

interface TermRelated {
  term_id: string;
  canonical_name_ko: string;
}

interface TermDetail {
  term_id: string;
  canonical_name_ko: string;
  canonical_name_en: string;
  aliases: string[];
  summary: string;
  sections: TermSection[];
  related_terms: TermRelated[];
  terminology_version: string;
}

type Role = "parent" | "teacher";

interface Props {
  role: Role;
}

function detailPath(role: Role): string {
  return role === "parent"
    ? "/(parent)/terminology-detail"
    : "/(teacher)/terminology-detail";
}

// ─── Section label mapping ────────────────────────────────────────────────────

const SECTION_LABEL: Record<string, string> = {
  detail:            "자세히 알아보기",
  why_it_matters:    "왜 중요한가",
  how_it_is_used:    "수업·훈련에서는",
  common_confusions: "헷갈리기 쉬운 개념",
  examples:          "예시",
  cautions:          "주의할 점",
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionBlock({
  section,
  onTermPress,
}: {
  section: TermSection;
  onTermPress: (termId: string) => void;
}) {
  const label = section.label || SECTION_LABEL[section.type] || section.type;
  const hasContent = section.segments.some((s) => s.text.trim().length > 0);
  if (!hasContent) return null;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{label}</Text>
      <TerminologyLinkedText segments={section.segments} onTermPress={onTermPress} />
    </View>
  );
}

function RelatedTermChip({
  term,
  onPress,
}: {
  term: TermRelated;
  onPress: (termId: string) => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.chip, { opacity: pressed ? 0.7 : 1 }]}
      onPress={() => onPress(term.term_id)}
    >
      <Text style={styles.chipText}>{term.canonical_name_ko}</Text>
    </Pressable>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function TerminologyDetailScreen({ role }: Props) {
  const insets    = useSafeAreaInsets();
  const { token } = useAuth();
  const params    = useLocalSearchParams<{ termId: string }>();
  const termId    = params.termId ?? "";

  const [detail, setDetail]   = useState<TermDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const loadDetail = useCallback(async (id: string) => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest(token, `/terminology/terms/${encodeURIComponent(id)}`);
      if (res.status === 404) {
        setError("용어를 찾을 수 없습니다.");
      } else if (res.ok) {
        const data = await res.json();
        setDetail(data as TermDetail);
      } else {
        setError("용어 정보를 불러오지 못했습니다. 다시 시도해 주세요.");
      }
    } catch {
      setError("용어 정보를 불러오지 못했습니다. 다시 시도해 주세요.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (termId) loadDetail(termId);
  }, [termId, loadDetail]);

  const onTermPress = useCallback(
    (nextTermId: string) => {
      router.push({
        pathname: detailPath(role) as any,
        params: { termId: nextTermId },
      });
    },
    [role],
  );

  const headerTitle = detail?.canonical_name_ko ?? "용어 상세";

  // ── Render body ─────────────────────────────────────────────────────────────

  function renderBody() {
    if (loading) {
      return (
        <View style={styles.center}>
          <ActivityIndicator size="small" color={NAVY} />
        </View>
      );
    }

    if (error || !detail) {
      return (
        <View style={styles.center}>
          <LucideIcon name="alert-circle" size={36} color={C.textMuted} />
          <Text style={styles.errorText}>{error ?? "용어를 찾을 수 없습니다."}</Text>
          {error && !error.includes("찾을 수 없습니다") && (
            <Pressable style={styles.retryBtn} onPress={() => loadDetail(termId)}>
              <Text style={styles.retryText}>다시 시도</Text>
            </Pressable>
          )}
          <Pressable style={styles.backBtn} onPress={() => router.back()}>
            <Text style={styles.backBtnText}>뒤로가기</Text>
          </Pressable>
        </View>
      );
    }

    return (
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: insets.bottom + 32 },
        ]}
      >
        {/* ── 헤더 블록 ──────────────────────────────────────────────────── */}
        <View style={styles.headerBlock}>
          <Text style={styles.termKo}>{detail.canonical_name_ko}</Text>
          <Text style={styles.termEn}>{detail.canonical_name_en}</Text>
          {detail.aliases.length > 0 && (
            <Text style={styles.aliases}>{detail.aliases.join(" · ")}</Text>
          )}
        </View>

        {/* ── 한눈에 보는 뜻 ─────────────────────────────────────────────── */}
        <View style={styles.summaryBlock}>
          <Text style={styles.sectionLabel}>한눈에 보는 뜻</Text>
          <Text style={styles.summaryText}>{detail.summary}</Text>
        </View>

        {/* ── 섹션들 (ENGINE 순서 유지) ──────────────────────────────────── */}
        {detail.sections.map((section, i) => (
          <SectionBlock
            key={`${section.type}-${i}`}
            section={section}
            onTermPress={onTermPress}
          />
        ))}

        {/* ── 관련 용어 ──────────────────────────────────────────────────── */}
        {detail.related_terms.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>관련 용어</Text>
            <View style={styles.chipRow}>
              {detail.related_terms.map((rt) => (
                <RelatedTermChip key={rt.term_id} term={rt} onPress={onTermPress} />
              ))}
            </View>
          </View>
        )}
      </ScrollView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <SubScreenHeader title={headerTitle} showHome={false} />
      {renderBody()}
    </SafeAreaView>
  );
}

// ─── styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: C.background,
  },
  scroll: {
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 12,
  },
  errorText: {
    fontSize: 14,
    fontFamily: "Pretendard-Regular",
    color: C.textMuted,
    textAlign: "center",
  },
  retryBtn: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: NAVY,
  },
  retryText: {
    fontSize: 14,
    fontFamily: "Pretendard-Medium",
    color: "#FFFFFF",
  },
  backBtn: {
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  backBtnText: {
    fontSize: 14,
    fontFamily: "Pretendard-Regular",
    color: C.textMuted,
  },

  // ── Header block ────────────────────────────────────────────────────────────
  headerBlock: {
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    padding: 16,
    marginBottom: 12,
    gap: 4,
  },
  termKo: {
    fontSize: 22,
    fontFamily: "Pretendard-Bold",
    color: NAVY,
    lineHeight: 30,
  },
  termEn: {
    fontSize: 15,
    fontFamily: "Pretendard-Regular",
    color: C.textMuted,
    lineHeight: 22,
  },
  aliases: {
    fontSize: 13,
    fontFamily: "Pretendard-Regular",
    color: "#1559A0",
    marginTop: 4,
    lineHeight: 19,
  },

  // ── Summary block ───────────────────────────────────────────────────────────
  summaryBlock: {
    backgroundColor: "#F0F4FF",
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
    gap: 6,
  },
  summaryText: {
    fontSize: 15,
    fontFamily: "Pretendard-Regular",
    color: NAVY,
    lineHeight: 23,
  },

  // ── Generic section ─────────────────────────────────────────────────────────
  section: {
    backgroundColor: "#FFFFFF",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
    marginBottom: 10,
    gap: 8,
  },
  sectionLabel: {
    fontSize: 12,
    fontFamily: "Pretendard-SemiBold",
    color: C.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },

  // ── Related terms ───────────────────────────────────────────────────────────
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    backgroundColor: "#EEF2FF",
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipText: {
    fontSize: 13,
    fontFamily: "Pretendard-Medium",
    color: "#1559A0",
  },
});
