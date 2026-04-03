/**
 * invite-qr.tsx — 학부모 QR 초대 화면
 * QR 코드를 생성하여 출력하거나 카카오/링크로 공유
 */
import { Share2, Printer } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import { router } from "expo-router";
import React, { useRef, useState } from "react";
import {
  Alert, Pressable, ScrollView, Share,
  StyleSheet, Text, View,
} from "react-native";
import QRCode from "react-native-qrcode-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";

const C = Colors.light;

export default function InviteQrScreen() {
  const insets = useSafeAreaInsets();
  const { adminUser } = useAuth();
  const { themeColor, poolName } = useBrand();
  const qrRef = useRef<any>(null);
  const [tab, setTab] = useState<"parent" | "teacher">("parent");

  const poolId = (adminUser as any)?.swimming_pool_id || "";
  const displayName = poolName || "스윔노트";

  const parentUrl = `https://swimnote.app/join?pool=${poolId}&role=parent`;
  const teacherUrl = `https://swimnote.app/join?pool=${poolId}&role=teacher`;
  const currentUrl = tab === "parent" ? parentUrl : teacherUrl;

  async function handleShare() {
    try {
      await Share.share({
        message: tab === "parent"
          ? `${displayName} 학부모 앱 가입 링크입니다.\n\n${parentUrl}\n\n스윔노트 앱을 설치하고 위 링크를 통해 가입해 주세요.`
          : `${displayName} 선생님 앱 가입 링크입니다.\n\n${teacherUrl}\n\n스윔노트 앱을 설치하고 위 링크를 통해 가입해 주세요.`,
        url: currentUrl,
      });
    } catch {}
  }

  function handlePrintGuide() {
    Alert.alert(
      "인쇄 안내",
      "이 화면을 스크린샷 찍어 프린터로 인쇄하거나, 수영장 입구·프런트에 비치해 주세요.\n\n학부모·선생님이 카메라로 QR을 스캔하면 앱 가입 화면으로 바로 연결됩니다.",
      [{ text: "확인" }]
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <SubScreenHeader title="QR 초대" />

      <ScrollView contentContainerStyle={[s.container, { paddingBottom: insets.bottom + 40 }]}>

        {/* 탭: 학부모 / 선생님 */}
        <View style={s.tabRow}>
          {(["parent", "teacher"] as const).map(t => (
            <Pressable
              key={t}
              style={[s.tab, tab === t && { backgroundColor: themeColor, borderColor: themeColor }]}
              onPress={() => setTab(t)}
            >
              <Text style={[s.tabTxt, { color: tab === t ? "#fff" : C.textSecondary }]}>
                {t === "parent" ? "학부모용" : "선생님용"}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* QR 카드 */}
        <View style={s.qrCard}>
          <View style={s.qrHeader}>
            <View style={[s.qrBadge, { backgroundColor: themeColor + "15" }]}>
              <LucideIcon name="qr-code" size={16} color={themeColor} />
              <Text style={[s.qrBadgeTxt, { color: themeColor }]}>
                {tab === "parent" ? "학부모 가입 QR" : "선생님 가입 QR"}
              </Text>
            </View>
          </View>

          <Text style={s.poolName}>{displayName}</Text>
          <Text style={s.qrSub}>
            {tab === "parent"
              ? "학부모 앱 가입 · 수업 확인 · 알림 수신"
              : "선생님 앱 가입 · 수업 관리 · 출결 체크"}
          </Text>

          {/* QR 코드 */}
          <View style={s.qrWrap}>
            <View style={s.qrCorner} />
            <QRCode
              value={currentUrl}
              size={200}
              color="#0F172A"
              backgroundColor="#FFFFFF"
              getRef={qrRef}
            />
          </View>

          <View style={s.scanHint}>
            <LucideIcon name="camera" size={14} color={C.textMuted} />
            <Text style={s.scanHintTxt}>카메라로 스캔하면 바로 연결됩니다</Text>
          </View>
        </View>

        {/* 사용 안내 */}
        <View style={s.guideCard}>
          <Text style={s.guideTitle}>어떻게 사용하나요?</Text>
          {[
            { icon: "printer", text: "이 화면을 스크린샷 찍어 수영장 입구·프런트에 인쇄해 붙여두세요" },
            { icon: "smartphone", text: tab === "parent" ? "학부모가 카메라로 QR을 스캔하면 앱 가입 화면으로 연결됩니다" : "선생님이 카메라로 QR을 스캔하면 앱 가입 화면으로 연결됩니다" },
            { icon: "share-2", text: "아래 '링크 공유' 버튼으로 카카오톡에 바로 전송할 수도 있습니다" },
          ].map((item, i) => (
            <View key={i} style={s.guideRow}>
              <View style={[s.guideIconBox, { backgroundColor: themeColor + "15" }]}>
                <LucideIcon name={item.icon as any} size={15} color={themeColor} />
              </View>
              <Text style={s.guideTxt}>{item.text}</Text>
            </View>
          ))}
        </View>

        {/* 버튼 그룹 */}
        <View style={s.btnGroup}>
          <Pressable style={[s.btnMain, { backgroundColor: themeColor }]} onPress={handleShare}>
            <Share2 size={18} color="#fff" />
            <Text style={s.btnMainTxt}>링크 공유 (카카오·문자)</Text>
          </Pressable>
          <Pressable style={s.btnSub} onPress={handlePrintGuide}>
            <Printer size={16} color={C.textSecondary} />
            <Text style={s.btnSubTxt}>인쇄 방법 안내</Text>
          </Pressable>
        </View>

      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { padding: 20, gap: 16 },

  tabRow: { flexDirection: "row", gap: 8 },
  tab: { flex: 1, height: 40, borderRadius: 12, borderWidth: 1.5, borderColor: C.border, alignItems: "center", justifyContent: "center", backgroundColor: C.background },
  tabTxt: { fontSize: 14, fontFamily: "Pretendard-Regular" },

  qrCard: { backgroundColor: "#fff", borderRadius: 20, padding: 24, alignItems: "center", gap: 10, shadowColor: "#00000015", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 1, shadowRadius: 12, elevation: 4 },
  qrHeader: { width: "100%", alignItems: "center" },
  qrBadge: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  qrBadgeTxt: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  poolName: { fontSize: 20, fontFamily: "Pretendard-Regular", color: "#0F172A", textAlign: "center" },
  qrSub: { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textMuted, textAlign: "center" },
  qrWrap: { padding: 16, backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: C.border },
  qrCorner: {},
  scanHint: { flexDirection: "row", alignItems: "center", gap: 6 },
  scanHintTxt: { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textMuted },

  guideCard: { backgroundColor: "#fff", borderRadius: 18, padding: 18, gap: 14, shadowColor: "#00000010", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 6, elevation: 2 },
  guideTitle: { fontSize: 15, fontFamily: "Pretendard-Regular", color: "#0F172A", marginBottom: 2 },
  guideRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  guideIconBox: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  guideTxt: { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary, flex: 1, lineHeight: 20 },

  btnGroup: { gap: 10 },
  btnMain: { height: 52, borderRadius: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  btnMainTxt: { fontSize: 16, fontFamily: "Pretendard-Regular", color: "#fff" },
  btnSub: { height: 46, borderRadius: 14, borderWidth: 1.5, borderColor: C.border, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#fff" },
  btnSubTxt: { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textSecondary },
});
