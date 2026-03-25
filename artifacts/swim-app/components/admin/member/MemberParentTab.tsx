import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { Share } from "react-native";
import React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import Colors from "@/constants/colors";
import { buildInviteMessage } from "@/utils/studentUtils";
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
          backgroundColor: connStatus === "linked" ? "#DDF2EF" : connStatus === "pending" ? "#FFF1BF" : "#F6F3F1",
        }]}>
          <Feather
            name={connStatus === "linked" ? "check-circle" : connStatus === "pending" ? "clock" : "x-circle"}
            size={24}
            color={connStatus === "linked" ? "#1F8F86" : connStatus === "pending" ? "#D97706" : C.textMuted}
          />
          <View style={{ flex: 1 }}>
            <Text style={[ms.connStatus, { color: connStatus === "linked" ? "#1F8F86" : connStatus === "pending" ? "#D97706" : C.textMuted }]}>
              {connStatus === "linked" ? "학부모 앱 연결 완료" : connStatus === "pending" ? "연결 요청 대기 중" : "학부모미연결"}
            </Text>
            {data.parent_account_name && (
              <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 2 }}>
                연결 계정: {data.parent_account_name}
              </Text>
            )}
          </View>
        </View>

        {data.invite_code && connStatus !== "linked" && (
          <View style={ms.inviteBox}>
            <Text style={{ fontSize: 13, fontFamily: "Inter_500Medium", color: C.textSecondary, marginBottom: 4 }}>초대 코드</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Text style={[ms.inviteCode, { color: themeColor }]}>{data.invite_code}</Text>
              <Pressable
                style={[ms.outlineBtn, { borderColor: themeColor, paddingHorizontal: 12 }]}
                onPress={async () => {
                  const msg = buildInviteMessage({ poolName, studentName: data.name, inviteCode: data.invite_code!, appUrl: "https://swimnote.kr" });
                  await Clipboard.setStringAsync(msg);
                  onAlert({ title: "복사 완료", msg: "초대 문자가 클립보드에 복사되었습니다." });
                }}
              >
                <Feather name="copy" size={14} color={themeColor} />
                <Text style={[ms.outlineBtnText, { color: themeColor }]}>복사</Text>
              </Pressable>
              <Pressable
                style={[ms.outlineBtn, { borderColor: "#1F8F86", paddingHorizontal: 12 }]}
                onPress={async () => {
                  const msg = buildInviteMessage({ poolName, studentName: data.name, inviteCode: data.invite_code!, appUrl: "https://swimnote.kr" });
                  await Share.share({ message: msg });
                }}
              >
                <Feather name="share-2" size={14} color="#1F8F86" />
                <Text style={[ms.outlineBtnText, { color: "#1F8F86" }]}>공유</Text>
              </Pressable>
            </View>
          </View>
        )}
      </View>

      <View style={ms.section}>
        <Text style={ms.sectionTitle}>보호자 정보</Text>
        {[
          { icon: "user" as const, label: "보호자 이름", value: data.parent_name || "미입력" },
          { icon: "phone" as const, label: "연락처", value: data.parent_phone || "미입력" },
          { icon: "phone" as const, label: "연락처2", value: (data as any).parent_phone2 || "미입력" },
        ].map(({ icon, label, value }) => (
          <View key={label} style={ms.infoRow}>
            <Feather name={icon} size={13} color={C.textMuted} />
            <Text style={ms.infoLabel}>{label}</Text>
            <Text style={ms.infoValue}>{value}</Text>
          </View>
        ))}
        <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: C.textMuted, marginTop: 8 }}>
          * 보호자 정보 수정은 기본정보 탭에서 할 수 있습니다.
        </Text>
      </View>
    </ScrollView>
  );
}
