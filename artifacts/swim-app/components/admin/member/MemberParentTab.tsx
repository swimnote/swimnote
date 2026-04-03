import { MessageSquare, Phone, User } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import Colors from "@/constants/colors";
import { callPhone, sendSms, formatPhone, CALL_COLOR, SMS_COLOR } from "@/utils/phoneUtils";
import { ms } from "./memberDetailStyles";
import type { DetailData } from "./memberDetailTypes";

const C = Colors.light;

interface MemberParentTabProps {
  data: DetailData;
  themeColor: string;
  connStatus: string;
  poolName: string;
  onAlert: (info: { title: string; msg: string }) => void;
}

export function MemberParentTab({ data, themeColor, connStatus, poolName, onAlert }: MemberParentTabProps) {
  return (
    <ScrollView contentContainerStyle={ms.tabContent} showsVerticalScrollIndicator={false}>
      <View style={ms.section}>
        <Text style={ms.sectionTitle}>학부모 앱 연결</Text>
        <View style={[ms.connCard, {
          backgroundColor: connStatus === "linked" ? "#E6FFFA" : "#FFFFFF",
        }]}>
          <LucideIcon
            name={connStatus === "linked" ? "check-circle" : "x-circle"}
            size={24}
            color={connStatus === "linked" ? "#2EC4B6" : C.textMuted}
          />
          <View style={{ flex: 1 }}>
            <Text style={[ms.connStatus, { color: connStatus === "linked" ? "#2EC4B6" : C.textMuted }]}>
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

      <View style={ms.section}>
        <Text style={ms.sectionTitle}>학부모 정보</Text>
        <View style={ms.infoRow}>
          <User size={13} color={C.textMuted} />
          <Text style={ms.infoLabel}>이름</Text>
          <Text style={ms.infoValue}>{data.parent_name || "미입력"}</Text>
        </View>
        {[data.parent_phone, (data as any).parent_phone2].map((ph, i) => {
          const label = i === 0 ? "연락처" : "연락처2";
          const hasPhone = !!ph;
          return (
            <View key={label} style={ms.infoRow}>
              <Phone size={13} color={hasPhone ? CALL_COLOR : C.textMuted} />
              <Text style={ms.infoLabel}>{label}</Text>
              {hasPhone ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1, justifyContent: "flex-end" }}>
                  <Pressable
                    style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
                    onPress={() => callPhone(ph)}
                    hitSlop={8}
                  >
                    <Text style={[ms.infoValue, { color: CALL_COLOR, flex: 0 }]}>{formatPhone(ph)}</Text>
                  </Pressable>
                  <Pressable onPress={() => sendSms(ph)} hitSlop={8}>
                    <MessageSquare size={13} color={SMS_COLOR} />
                  </Pressable>
                </View>
              ) : (
                <Text style={ms.infoValue}>미입력</Text>
              )}
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}
