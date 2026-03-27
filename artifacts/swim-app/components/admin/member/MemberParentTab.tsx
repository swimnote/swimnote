import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { Share } from "react-native";
import React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import Colors from "@/constants/colors";
import { callPhone, formatPhone, CALL_COLOR } from "@/utils/phoneUtils";
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
          backgroundColor: connStatus === "linked" ? "#E6FFFA" : connStatus === "pending" ? "#FFF1BF" : "#F8FAFC",
        }]}>
          <Feather
            name={connStatus === "linked" ? "check-circle" : connStatus === "pending" ? "clock" : "x-circle"}
            size={24}
            color={connStatus === "linked" ? "#2EC4B6" : connStatus === "pending" ? "#D97706" : C.textMuted}
          />
          <View style={{ flex: 1 }}>
            <Text style={[ms.connStatus, { color: connStatus === "linked" ? "#2EC4B6" : connStatus === "pending" ? "#D97706" : C.textMuted }]}>
              {connStatus === "linked" ? "학부모 앱 연결 완료" : connStatus === "pending" ? "연결 요청 대기 중" : "학부모미연결"}
            </Text>
            {data.parent_account_name && (
              <Text style={{ fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginTop: 2 }}>
                연결 계정: {data.parent_account_name}
              </Text>
            )}
          </View>
        </View>

        {data.invite_code && connStatus !== "linked" && (
          <View style={ms.inviteBox}>
            <Text style={{ fontSize: 13, fontFamily: "Pretendard-Medium", color: C.textSecondary, marginBottom: 4 }}>초대 코드</Text>
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
                style={[ms.outlineBtn, { borderColor: "#2EC4B6", paddingHorizontal: 12 }]}
                onPress={async () => {
                  const msg = buildInviteMessage({ poolName, studentName: data.name, inviteCode: data.invite_code!, appUrl: "https://swimnote.kr" });
                  await Share.share({ message: msg });
                }}
              >
                <Feather name="share-2" size={14} color="#2EC4B6" />
                <Text style={[ms.outlineBtnText, { color: "#2EC4B6" }]}>공유</Text>
              </Pressable>
            </View>
          </View>
        )}
      </View>

      <View style={ms.section}>
        <Text style={ms.sectionTitle}>보호자 정보</Text>
        <View style={ms.infoRow}>
          <Feather name="user" size={13} color={C.textMuted} />
          <Text style={ms.infoLabel}>이름</Text>
          <Text style={ms.infoValue}>{data.parent_name || "미입력"}</Text>
        </View>
        {[data.parent_phone, (data as any).parent_phone2].map((ph, i) => {
          const label = i === 0 ? "연락처" : "연락처2";
          const hasPhone = !!ph;
          return (
            <View key={label} style={ms.infoRow}>
              <Feather name="phone" size={13} color={hasPhone ? CALL_COLOR : C.textMuted} />
              <Text style={ms.infoLabel}>{label}</Text>
              {hasPhone ? (
                <Pressable
                  style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
                  onPress={() => callPhone(ph)}
                  hitSlop={8}
                >
                  <Text style={[ms.infoValue, { color: CALL_COLOR }]}>{formatPhone(ph)}</Text>
                </Pressable>
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
