import { LucideIcon } from "@/components/common/LucideIcon";
import React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import Colors from "@/constants/colors";
import { callPhone, sendSms, formatPhone, CALL_COLOR, SMS_COLOR } from "@/utils/phoneUtils";
import { ms } from "./memberDetailStyles";
import type { DetailData, ParentLink } from "./memberDetailTypes";

const C = Colors.light;

function normalizePhone(p: string): string {
  return (p || "").replace(/[^0-9]/g, "");
}

function getPhoneConnStatus(
  phone: string | null | undefined,
  parents: ParentLink[] | undefined
): "linked" | "waiting" {
  if (!phone) return "waiting";
  const norm = normalizePhone(phone);
  const linked = parents?.find(
    p => normalizePhone(p.phone) === norm && p.link_status === "approved"
  );
  return linked ? "linked" : "waiting";
}

interface MemberParentTabProps {
  data: DetailData;
  themeColor: string;
  connStatus: string;
  poolName: string;
  onAlert: (info: { title: string; msg: string }) => void;
}

export function MemberParentTab({ data, themeColor, connStatus, poolName, onAlert }: MemberParentTabProps) {
  const phones: Array<{ label: string; value: string | null | undefined }> = [
    { label: "보호자 1", value: data.parent_phone },
    { label: "보호자 2", value: (data as any).parent_phone2 },
    { label: "보호자 3", value: (data as any).parent_phone3 },
  ].filter(p => p.value);

  return (
    <ScrollView contentContainerStyle={ms.tabContent} showsVerticalScrollIndicator={false}>
      {/* ── 전체 연결 상태 ── */}
      <View style={ms.section}>
        <Text style={ms.sectionTitle}>학부모 앱 연결</Text>
        <View style={[ms.connCard, {
          backgroundColor: connStatus === "linked" ? C.brandSoft : "#FFFFFF",
        }]}>
          <LucideIcon
            name={connStatus === "linked" ? "check-circle" : "x-circle"}
            size={24}
            color={connStatus === "linked" ? C.brandStrong : C.textMuted}
          />
          <View style={{ flex: 1 }}>
            <Text style={[ms.connStatus, { color: connStatus === "linked" ? C.brandStrong : C.textMuted }]}>
              {connStatus === "linked" ? "학부모 앱 연결 완료" : "학부모 미연결"}
            </Text>
            {data.parent_account_name && (
              <Text style={{ fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginTop: 2 }}>
                연결 계정: {data.parent_account_name}
              </Text>
            )}
            {connStatus !== "linked" && (
              <Text style={{ fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textMuted, marginTop: 4 }}>
                학부모가 앱에서 가입하면 자동으로 연결됩니다
              </Text>
            )}
          </View>
        </View>
      </View>

      {/* ── 보호자 연락처 + 연결 상태 ── */}
      <View style={ms.section}>
        <Text style={ms.sectionTitle}>학부모 정보</Text>
        <View style={ms.infoRow}>
          <LucideIcon name="user" size={13} color={C.textMuted} />
          <Text style={ms.infoLabel}>이름</Text>
          <Text style={ms.infoValue}>{data.parent_name || "미입력"}</Text>
        </View>

        {phones.length === 0 ? (
          <View style={ms.infoRow}>
            <LucideIcon name="phone" size={13} color={C.textMuted} />
            <Text style={ms.infoLabel}>연락처</Text>
            <Text style={ms.infoValue}>미입력</Text>
          </View>
        ) : (
          phones.map(({ label, value: ph }) => {
            const status = getPhoneConnStatus(ph, (data as any).parents);
            return (
              <View key={label} style={[ms.infoRow, { alignItems: "flex-start", paddingVertical: 12 }]}>
                <LucideIcon name="phone" size={13} color={CALL_COLOR} style={{ marginTop: 2 }} />
                <Text style={ms.infoLabel}>{label}</Text>
                <View style={{ flex: 1, alignItems: "flex-end", gap: 4 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <Pressable
                      style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
                      onPress={() => callPhone(ph!)}
                      hitSlop={8}
                    >
                      <Text style={[ms.infoValue, { color: CALL_COLOR, flex: 0 }]}>{formatPhone(ph!)}</Text>
                    </Pressable>
                    <Pressable onPress={() => sendSms(ph!)} hitSlop={8}>
                      <LucideIcon name="message-square" size={13} color={SMS_COLOR} />
                    </Pressable>
                  </View>
                  <View style={[
                    {
                      flexDirection: "row", alignItems: "center", gap: 4,
                      paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20,
                      backgroundColor: status === "linked" ? C.brandSoft : "#FFF7ED",
                    }
                  ]}>
                    <LucideIcon
                      name={status === "linked" ? "check-circle" : "clock"}
                      size={10}
                      color={status === "linked" ? C.brandStrong : "#EA580C"}
                    />
                    <Text style={{
                      fontSize: 11, fontFamily: "Pretendard-Regular",
                      color: status === "linked" ? C.brandStrong : "#EA580C",
                    }}>
                      {status === "linked" ? "연결됨" : "가입 대기"}
                    </Text>
                  </View>
                </View>
              </View>
            );
          })
        )}
      </View>

      {/* ── 다중 보호자 연결 현황 ── */}
      {(data as any).parents && (data as any).parents.length > 0 && (
        <View style={ms.section}>
          <Text style={ms.sectionTitle}>연결된 학부모 계정</Text>
          {(data as any).parents.map((p: ParentLink) => (
            <View key={p.id} style={ms.infoRow}>
              <LucideIcon name="user-check" size={13} color={C.brandStrong} />
              <Text style={[ms.infoLabel, { width: 100 }]}>{p.name || "이름 없음"}</Text>
              <View style={{ flex: 1, alignItems: "flex-end" }}>
                <Text style={[ms.infoValue, { color: CALL_COLOR }]}>{formatPhone(p.phone)}</Text>
                <View style={[
                  {
                    flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2,
                    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10,
                    backgroundColor: p.link_status === "approved" ? C.brandSoft : C.backgroundSoft,
                  }
                ]}>
                  <Text style={{
                    fontSize: 10, fontFamily: "Pretendard-Regular",
                    color: p.link_status === "approved" ? C.brandStrong : C.textSecondary,
                  }}>
                    {p.link_status === "approved" ? "앱 연결됨" : p.link_status}
                  </Text>
                </View>
              </View>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}
