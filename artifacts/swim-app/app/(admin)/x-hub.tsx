/**
 * SWIMNOTE X 관리 허브 — PHASE 0/1 Shell
 * PHASE 5에서 X 상태 대시보드 / 기능별 상태 / 사용량 구현 예정
 *
 * DATA SOURCE (PHASE 5):
 *   구독: GET /billing/x-subscription-status
 *     x_subscription_slots: purchased_at (X 시작일 기준), discount_started_at/ends_at
 *     swimming_pools: x_paid_entitlement, x_manual_entitlement, xmode_purchased_at (legacy)
 *   설정완성도: GET /x-setup/status
 *   저장공간: GET /admin/storage → {photo_bytes, video_bytes, messenger_bytes, diary_bytes, ...}
 *   AI 비용: event_logs.metadata->>'estimated_cost_usd' WHERE category='AI'
 *   기능 상태 (실제 기능 데이터 기준, fake status 금지):
 *     AI일지 → class_diaries.ai_status='DONE' COUNT
 *     성장추적 → growth_events 최근 활동 COUNT
 *     Parent AI → event_logs WHERE feature='curriculum_search' COUNT
 *     리포트 → growth_reports.product_status='PUBLISHED' COUNT
 *     커리큘럼 → student_curriculum_assignments WHERE is_active=true COUNT
 *
 *   API: GET /admin/x-hub/summary (PHASE 5 신규)
 *
 * PHASE 6 RELEASE GATE:
 *   x-hub AI일지 N  =  diary-hub AI생성 N
 *   x-hub 리포트 N  =  report-hub 발행완료 N
 *   x-hub 커리큘럼 N  =  curriculum-hub 배정학생 N
 */

import React from "react";
import { SafeAreaView, ScrollView, Text, View, StyleSheet } from "react-native";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import Colors from "@/constants/colors";

const C = Colors.light;

export default function XHubScreen() {
  return (
    <SafeAreaView style={s.safe}>
      <SubScreenHeader title="SWIMNOTE X 관리" homePath="/(admin)/dashboard" />
      <ScrollView contentContainerStyle={s.body}>
        <View style={s.placeholder}>
          <Text style={s.placeholderTitle}>SWIMNOTE X 관리</Text>
          <Text style={s.placeholderSub}>PHASE 5에서 구현 예정</Text>
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
