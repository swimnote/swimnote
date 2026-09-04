/**
 * Section H — 회원 상태 / 관리 + Danger Zone
 * - 상태 표시 + [상태 변경] → MemberStatusChangeModal
 * - 복구 (withdrawn/deleted → active): /admin/students/:id/restore
 * - 아카이브 복구 (archived → active): /admin/students/:id/restore-archive (pool_admin)
 * - [위험 작업 ▼] 접힌 accordion:
 *     - 개인정보 소각 (purge) — withdrawn/deleted 상태 + pool_admin
 *     - 즉시 전체 삭제 (force-delete) — pool_admin, Danger Zone 격리
 *     - 영구 삭제 (permanent) — archived/deleted 상태 + pool_admin
 */
import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import Colors from "@/constants/colors";
import { LucideIcon } from "@/components/common/LucideIcon";
import { MemberSectionCard } from "./MemberSectionCard";
import { STATUS_META } from "./memberDetailTypes";
import type { DetailData } from "./memberDetailTypes";

const C = Colors.light;

interface Props {
  data: DetailData;
  themeColor: string;
  isPoolAdmin: boolean;
  saving: boolean;
  onShowStatusModal: () => void;
  onRestoreMember: () => void;
  onPurgeMember: () => void;
  onForceDelete: () => void;
}

export function SectionH_StatusMgmt({
  data, themeColor, isPoolAdmin, saving,
  onShowStatusModal, onRestoreMember, onPurgeMember, onForceDelete,
}: Props) {
  const [dangerExpanded, setDangerExpanded] = useState(false);

  const statusMeta = STATUS_META[data.status] || STATUS_META.active;
  const isWithdrawnOrDeleted = ["withdrawn", "deleted"].includes(data.status);
  const isArchived = data.status === "archived";
  const isRestoreable = isWithdrawnOrDeleted || isArchived;

  // pending 상태 표시
  const pendingMeta = (data as any).pending_status_change
    ? (STATUS_META[(data as any).pending_status_change] || null)
    : null;

  return (
    <View style={{ gap: 12 }}>
      {/* 상태 카드 */}
      <MemberSectionCard title="회원 상태">
        {/* 현재 상태 배지 */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <View style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: statusMeta.bg }}>
            <Text style={{ fontSize: 14, fontFamily: "Pretendard-Regular", color: statusMeta.color }}>{statusMeta.label}</Text>
          </View>
          {pendingMeta && (
            <View style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: pendingMeta.bg, borderWidth: 1, borderColor: pendingMeta.color + "60" }}>
              <Text style={{ fontSize: 12, fontFamily: "Pretendard-Regular", color: pendingMeta.color }}>예정: {pendingMeta.label}</Text>
            </View>
          )}
        </View>

        {/* 등록일/경로 */}
        <View style={{ gap: 6 }}>
          {data.created_at && (
            <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
              <LucideIcon name="calendar" size={12} color={C.textMuted} />
              <Text style={{ fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary }}>
                등록일: {new Date(data.created_at).toLocaleDateString("ko-KR")}
              </Text>
            </View>
          )}
        </View>

        {/* 액션 버튼 */}
        <View style={{ flexDirection: "row", gap: 8 }}>
          {!isRestoreable ? (
            <Pressable
              style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1.5, borderColor: themeColor }}
              onPress={onShowStatusModal}
              disabled={saving}
            >
              <LucideIcon name="edit-2" size={13} color={themeColor} />
              <Text style={{ fontSize: 13, fontFamily: "Pretendard-Regular", color: themeColor }}>상태 변경</Text>
            </Pressable>
          ) : (
            <Pressable
              style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1.5, borderColor: "#7C3AED" }}
              onPress={onRestoreMember}
              disabled={saving}
            >
              <LucideIcon name="rotate-ccw" size={13} color="#7C3AED" />
              <Text style={{ fontSize: 13, fontFamily: "Pretendard-Regular", color: "#7C3AED" }}>재원 복구</Text>
            </Pressable>
          )}
        </View>
      </MemberSectionCard>

      {/* Danger Zone — pool_admin 전용, 접힌 accordion */}
      {isPoolAdmin && (
        <View style={{ borderRadius: 18, borderWidth: 1.5, borderColor: "#FECDD3", overflow: "hidden" }}>
          <Pressable
            style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, backgroundColor: "#FFF1F2" }}
            onPress={() => setDangerExpanded(p => !p)}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <LucideIcon name="alert-triangle" size={16} color="#BE123C" />
              <Text style={{ fontSize: 14, fontFamily: "Pretendard-Regular", color: "#BE123C" }}>위험 작업</Text>
            </View>
            <LucideIcon name={dangerExpanded ? "chevron-up" : "chevron-down"} size={16} color="#BE123C" />
          </Pressable>

          {dangerExpanded && (
            <View style={{ backgroundColor: "#fff", padding: 16, gap: 14 }}>
              {/* 개인정보 소각: withdrawn/deleted + pool_admin */}
              {isWithdrawnOrDeleted && (
                <View style={{ backgroundColor: "#FEF2F2", borderRadius: 12, padding: 14, gap: 10 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <LucideIcon name="flame" size={15} color="#DC2626" />
                    <Text style={{ fontSize: 13, fontFamily: "Pretendard-Regular", color: "#DC2626" }}>개인정보 소각</Text>
                  </View>
                  <Text style={{ fontSize: 12, fontFamily: "Pretendard-Regular", color: "#7F1D1D", lineHeight: 18 }}>
                    이름·연락처·보호자 정보를 완전히 익명화합니다. 수업 기록은 유지되며 되돌릴 수 없습니다.
                  </Text>
                  <Pressable
                    style={{ backgroundColor: "#DC2626", padding: 10, borderRadius: 10, alignItems: "center" }}
                    onPress={onPurgeMember}
                    disabled={saving}
                  >
                    <Text style={{ color: "#fff", fontSize: 13, fontFamily: "Pretendard-Regular" }}>소각하기</Text>
                  </Pressable>
                </View>
              )}

              {/* 즉시 전체 삭제 (force-delete) — 항상 pool_admin에게 표시, Danger Zone 격리 */}
              <View style={{ backgroundColor: "#FFF1F2", borderRadius: 12, padding: 14, gap: 10, borderWidth: 1, borderColor: "#FECDD3" }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <LucideIcon name="trash-2" size={15} color="#BE123C" />
                  <Text style={{ fontSize: 13, fontFamily: "Pretendard-SemiBold", color: "#BE123C" }}>즉시 전체 삭제 (비상용)</Text>
                </View>
                <Text style={{ fontSize: 12, fontFamily: "Pretendard-Regular", color: "#9F1239", lineHeight: 18 }}>
                  출결·수영일지·학부모 정보까지 모든 데이터를 즉시 완전 삭제합니다.{"\n"}
                  이 작업은 절대 되돌릴 수 없습니다. 일반적인 퇴원에는 사용하지 마십시오.
                </Text>
                <Pressable
                  style={{ backgroundColor: "#BE123C", padding: 10, borderRadius: 10, alignItems: "center" }}
                  onPress={onForceDelete}
                  disabled={saving}
                >
                  <Text style={{ color: "#fff", fontSize: 13, fontFamily: "Pretendard-SemiBold" }}>즉시 삭제</Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      )}
    </View>
  );
}
