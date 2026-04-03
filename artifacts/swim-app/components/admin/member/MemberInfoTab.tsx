import { Flame, PenLine, RotateCcw, Save } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import React from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import Colors from "@/constants/colors";
import { getMemberPendingBadge } from "@/utils/studentUtils";
import { EditField } from "./EditField";
import { ms } from "./memberDetailStyles";
import type { DetailData } from "./memberDetailTypes";

const C = Colors.light;

interface MemberInfoTabProps {
  data: DetailData;
  themeColor: string;
  saving: boolean;
  editName: string; setEditName: (v: string) => void;
  editBirth: string; setEditBirth: (v: string) => void;
  editPhone: string; setEditPhone: (v: string) => void;
  editParentName: string; setEditParentName: (v: string) => void;
  editParentPhone: string; setEditParentPhone: (v: string) => void;
  editParentPhone2: string; setEditParentPhone2: (v: string) => void;
  infoChanged: boolean; setInfoChanged: (v: boolean) => void;
  onSave: () => void;
  onRestoreMember: () => void;
  onShowStatusModal: () => void;
  isArchived: boolean;
  statusMeta: { label: string; color: string; bg: string };
  isPoolAdmin?: boolean;
  onPurgeMember?: () => void;
}

export function MemberInfoTab({
  data, themeColor, saving,
  editName, setEditName, editBirth, setEditBirth,
  editPhone, setEditPhone, editParentName, setEditParentName,
  editParentPhone, setEditParentPhone, editParentPhone2, setEditParentPhone2,
  infoChanged, setInfoChanged, onSave, onRestoreMember, onShowStatusModal,
  isArchived, statusMeta,
  isPoolAdmin = false, onPurgeMember,
}: MemberInfoTabProps) {
  return (
    <ScrollView contentContainerStyle={ms.tabContent} showsVerticalScrollIndicator={false}>
      {isArchived && (
        <Pressable style={ms.restoreBanner} onPress={onRestoreMember}>
          <RotateCcw size={16} color="#7C3AED" />
          <Text style={ms.restoreText}>이 회원은 {statusMeta.label} 상태입니다. 탭하여 복구하기</Text>
        </Pressable>
      )}

      <View style={ms.section}>
        <View style={ms.sectionHeader}>
          <Text style={ms.sectionTitle}>기본 정보 편집</Text>
          {infoChanged && (
            <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: "#FFF1BF" }}>
              <Text style={{ fontSize: 11, fontFamily: "Pretendard-Regular", color: "#92400E" }}>변경됨</Text>
            </View>
          )}
        </View>
        <EditField label="이름" value={editName} onChangeText={v => { setEditName(v); setInfoChanged(true); }} />
        <EditField label="출생년도" value={editBirth} onChangeText={v => { setEditBirth(v); setInfoChanged(true); }} keyboardType="numeric" placeholder="예: 2015" />
        <EditField label="연락처" value={editPhone} onChangeText={v => { setEditPhone(v); setInfoChanged(true); }} keyboardType="phone-pad" />
        <EditField label="학부모 이름" value={editParentName} onChangeText={v => { setEditParentName(v); setInfoChanged(true); }} />
        <EditField label="학부모 연락처" value={editParentPhone} onChangeText={v => { setEditParentPhone(v); setInfoChanged(true); }} keyboardType="phone-pad" />
        <EditField label="학부모 연락처2" value={editParentPhone2} onChangeText={v => { setEditParentPhone2(v); setInfoChanged(true); }} keyboardType="phone-pad" placeholder="선택 입력" />

        <Pressable
          style={[ms.saveBtn, { backgroundColor: infoChanged ? themeColor : "#64748B" }]}
          onPress={onSave}
          disabled={saving || !infoChanged}
        >
          {saving ? <ActivityIndicator color="#fff" size="small" /> : (
            <><Save size={16} color="#fff" /><Text style={ms.saveBtnText}>정보 저장</Text></>
          )}
        </Pressable>
      </View>

      <View style={ms.section}>
        <Text style={ms.sectionTitle}>상태 관리</Text>
        <View style={ms.statusRow}>
          <View style={{ gap: 4 }}>
            <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
              <View style={[ms.statusBadgeLg, { backgroundColor: statusMeta.bg }]}>
                <Text style={[ms.statusBadgeLgText, { color: statusMeta.color }]}>현재: {statusMeta.label}</Text>
              </View>
              {(() => {
                const pending = getMemberPendingBadge(data as any);
                if (!pending) return null;
                return (
                  <View style={[ms.statusBadgeLg, { backgroundColor: pending.bg }]}>
                    <Text style={[ms.statusBadgeLgText, { color: pending.color }]}>{pending.label}</Text>
                  </View>
                );
              })()}
            </View>
          </View>
          {!isArchived ? (
            <Pressable style={ms.changeStatusBtn} onPress={onShowStatusModal} disabled={saving}>
              <PenLine size={14} color={themeColor} />
              <Text style={[ms.changeStatusText, { color: themeColor }]}>상태 변경</Text>
            </Pressable>
          ) : (
            <Pressable style={[ms.changeStatusBtn, { borderColor: "#7C3AED" }]} onPress={onRestoreMember} disabled={saving}>
              <RotateCcw size={14} color="#7C3AED" />
              <Text style={[ms.changeStatusText, { color: "#7C3AED" }]}>복구</Text>
            </Pressable>
          )}
        </View>

        {[
          { icon: "calendar" as const, label: "등록일", value: data.created_at ? new Date(data.created_at).toLocaleDateString("ko-KR") : "-" },
          { icon: "map-pin" as const, label: "등록 경로", value: data.registration_path === "admin_created" ? "관리자 직접" : "학부모 요청" },
        ].map(({ icon, label, value }) => (
          <View key={label} style={ms.infoRow}>
            <LucideIcon name={icon} size={13} color={C.textMuted} />
            <Text style={ms.infoLabel}>{label}</Text>
            <Text style={ms.infoValue}>{value}</Text>
          </View>
        ))}
      </View>

      {isPoolAdmin && isArchived && data.status === "withdrawn" && onPurgeMember && (
        <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
          <View style={{ backgroundColor: "#FEF2F2", borderRadius: 12, padding: 14, gap: 10 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Flame size={16} color="#DC2626" />
              <Text style={{ fontSize: 14, fontFamily: "Pretendard-Regular", color: "#DC2626" }}>개인정보 소각</Text>
            </View>
            <Text style={{ fontSize: 12, fontFamily: "Pretendard-Regular", color: "#7F1D1D", lineHeight: 18 }}>
              퇴원 회원의 이름, 연락처, 부모 정보를 완전히 익명화합니다. 수업 기록은 유지되며, 이 작업은 되돌릴 수 없습니다.
            </Text>
            <Pressable
              style={({ pressed }) => [{ backgroundColor: "#DC2626", padding: 12, borderRadius: 10, alignItems: "center", opacity: pressed || saving ? 0.8 : 1 }]}
              onPress={onPurgeMember}
              disabled={saving}
            >
              <Text style={{ color: "#fff", fontSize: 14, fontFamily: "Pretendard-Regular" }}>소각하기</Text>
            </Pressable>
          </View>
        </View>
      )}
    </ScrollView>
  );
}
