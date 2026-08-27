/**
 * AI 커리큘럼 관리 허브 — PHASE 0/1 Shell
 * PHASE 4에서 KPI / 커리큘럼 INDEX / 학생 가나다 INDEX 구현 예정
 *
 * DATA SOURCE (PHASE 4):
 *   [교육 커리큘럼 섹션 — 독립]
 *     curriculum_versions + curriculum_items + student_curriculum_assignments
 *     assignments: student_id + swimming_pool_id 기준 (class_id 없음)
 *     student_class_history: student_id, class_group_id, swimming_pool_id, enrolled_at, left_at
 *
 *   [X Global AI 일지 템플릿 섹션 — 독립]
 *     global_template_sets (ACTIVE 1개, platform global)
 *     diary_templates WHERE scope='x_global' AND pool_id IS NULL
 *
 *   두 시스템은 FK 없음 — 화면에서 통합 표시 금지. 별개 섹션 유지.
 *
 *   curriculum_items 컬럼: sort_order, title, description, is_active
 *   (level/category 컬럼 없음 → 레벨 INDEX V1 제외, title 파싱 필요)
 */

import React from "react";
import { SafeAreaView, ScrollView, Text, View, StyleSheet } from "react-native";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import Colors from "@/constants/colors";

const C = Colors.light;

export default function CurriculumHubScreen() {
  return (
    <SafeAreaView style={s.safe}>
      <SubScreenHeader title="AI 커리큘럼" homePath="/(admin)/dashboard" />
      <ScrollView contentContainerStyle={s.body}>
        <View style={s.placeholder}>
          <Text style={s.placeholderTitle}>AI 커리큘럼 관리</Text>
          <Text style={s.placeholderSub}>PHASE 4에서 구현 예정</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:             { flex: 1, backgroundColor: C.background },
  body:             { padding: 20, flexGrow: 1 },
  placeholder:      { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 80 },
  placeholderTitle: { fontSize: 16, fontFamily: "Pretendard-SemiBold", color: C.textPrimary },
  placeholderSub:   { fontSize: 13, color: C.textMuted },
});
