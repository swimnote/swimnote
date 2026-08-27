/**
 * AI 일지피드 관리 허브 — PHASE 0/1 Shell
 * PHASE 3에서 KPI / 날짜 INDEX / 반·선생님 필터 구현 예정
 *
 * DATA SOURCE (PHASE 3):
 *   class_diaries WHERE swimming_pool_id = pool
 *   columns: swimming_pool_id, teacher_id, class_group_id, class_datetime, content, ai_status
 *   ai_status: NULL=직접작성, PENDING/GENERATING/DONE/FAILED=AI관련
 *   parent feed 조건: content IS NOT NULL
 *   "오늘 수업수": class_diaries 기준 (class_schedules 테이블 없음)
 *
 * 이전 broken route /(admin)/diary-list 완전 교체
 */

import React from "react";
import { SafeAreaView, ScrollView, Text, View, StyleSheet } from "react-native";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import Colors from "@/constants/colors";

const C = Colors.light;

export default function DiaryHubScreen() {
  return (
    <SafeAreaView style={s.safe}>
      <SubScreenHeader title="AI 일지피드" homePath="/(admin)/dashboard" />
      <ScrollView contentContainerStyle={s.body}>
        <View style={s.placeholder}>
          <Text style={s.placeholderTitle}>AI 일지피드 관리</Text>
          <Text style={s.placeholderSub}>PHASE 3에서 구현 예정</Text>
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
