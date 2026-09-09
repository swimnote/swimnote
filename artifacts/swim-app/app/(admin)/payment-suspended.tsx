/**
 * payment-suspended.tsx — 구독 결제 정지 화면
 *
 * PAYMENT_SUSPENDED 상태에서 진입 게이트로 리다이렉트되는 화면.
 * - pool_admin: "구독 갱신하기" CTA → 구독 화면
 * - teacher (리다이렉트로 도달): 관리자 문의 안내만
 * - 로그아웃 버튼 공통 제공
 */
import { LucideIcon } from "@/components/common/LucideIcon";
import { router } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";

const C = Colors.light;

export default function PaymentSuspendedScreen() {
  const insets = useSafeAreaInsets();
  const { adminUser, logout } = useAuth();
  const isAdmin = adminUser?.role === "pool_admin" || adminUser?.role === "sub_admin";

  return (
    <View style={[s.root, { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 32 }]}>
      <View style={s.content}>
        {/* 아이콘 */}
        <View style={s.iconBox}>
          <LucideIcon name="credit-card" size={48} color="#DC2626" />
        </View>

        {/* 제목 */}
        <Text style={s.title}>서비스가 일시 정지되었습니다</Text>

        {/* 설명 */}
        <Text style={s.message}>
          {isAdmin
            ? "구독 결제가 완료되지 않아 서비스가 일시 정지되었습니다.\n결제 수단을 확인하고 구독을 갱신해주세요."
            : "수영장의 구독 결제가 완료되지 않아\n서비스가 일시 정지되었습니다.\n\n관리자에게 문의해 주세요."}
        </Text>

        {/* 안내 카드 */}
        <View style={s.infoCard}>
          <InfoRow icon="shield" color="#2E9B6F" text="데이터는 안전하게 보존됩니다" />
          <InfoRow icon="refresh-cw" color={C.brandStrong} text="결제 완료 후 즉시 복구됩니다" />
          {isAdmin && (
            <InfoRow icon="credit-card" color="#D97706" text="카드 등록 또는 구독 갱신이 필요합니다" />
          )}
        </View>

        {/* 관리자: 구독 갱신 CTA */}
        {isAdmin && (
          <Pressable
            style={s.cta}
            onPress={() => router.replace("/(admin)/subscription" as any)}
          >
            <Text style={s.ctaText}>구독 갱신하기</Text>
          </Pressable>
        )}
      </View>

      {/* 로그아웃 */}
      <Pressable onPress={logout} style={s.logoutBtn}>
        <Text style={s.logoutText}>로그아웃</Text>
      </Pressable>
    </View>
  );
}

function InfoRow({ icon, color, text }: { icon: any; color: string; text: string }) {
  return (
    <View style={s.infoRow}>
      <LucideIcon name={icon} size={15} color={color} />
      <Text style={s.infoText}>{text}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.background,
    alignItems: "center",
  },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
    gap: 20,
    width: "100%",
  },
  iconBox: {
    width: 100,
    height: 100,
    borderRadius: 30,
    backgroundColor: "#FEE2E2",
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 22,
    fontFamily: "Pretendard-SemiBold",
    textAlign: "center",
    color: C.text,
  },
  message: {
    fontSize: 14,
    fontFamily: "Pretendard-Regular",
    textAlign: "center",
    lineHeight: 23,
    color: C.textSecondary,
  },
  infoCard: {
    width: "100%",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
    padding: 16,
    gap: 12,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  infoText: {
    fontSize: 13,
    fontFamily: "Pretendard-Regular",
    flex: 1,
    lineHeight: 19,
    color: C.textSecondary,
  },
  cta: {
    width: "100%",
    backgroundColor: C.brandStrong,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
  },
  ctaText: {
    fontSize: 16,
    fontFamily: "Pretendard-SemiBold",
    color: "#fff",
  },
  logoutBtn: {
    paddingBottom: 8,
  },
  logoutText: {
    fontSize: 13,
    fontFamily: "Pretendard-Regular",
    color: C.textMuted,
  },
});
