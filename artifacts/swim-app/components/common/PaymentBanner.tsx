/**
 * PaymentBanner — 결제 실패 / 삭제 예약 / 삭제 완료 상태 안내 배너
 * 관리자 홈, 결제 관리 화면 최상단에 표시
 */
import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { useAuth } from "@/context/AuthContext";

type BannerKind = "payment_failed" | "pending_deletion" | "deleted" | null;

function getBannerKind(subscriptionStatus?: string): BannerKind {
  if (!subscriptionStatus) return null;
  if (subscriptionStatus === "payment_failed") return "payment_failed";
  if (subscriptionStatus === "pending_deletion") return "pending_deletion";
  if (subscriptionStatus === "deleted") return "deleted";
  return null;
}

interface Config {
  bg: string;
  border: string;
  icon: "alert-triangle" | "alert-circle" | "x-circle";
  iconColor: string;
  title: string;
  desc: (days: number | null | undefined) => string;
  action?: string;
}

const CONFIGS: Record<NonNullable<BannerKind>, Config> = {
  payment_failed: {
    bg: "#FFF1BF",
    border: "#F59E0B",
    icon: "alert-triangle",
    iconColor: "#D97706",
    title: "결제 실패 — 서비스 이용이 제한되었습니다",
    desc: (days) => days != null
      ? `지금 재결제하지 않으면 ${days}일 후 데이터가 삭제됩니다.`
      : "빠른 시일 내에 재결제를 진행해주세요.",
    action: "지금 결제하기",
  },
  pending_deletion: {
    bg: "#F9DEDA",
    border: "#D96C6C",
    icon: "alert-circle",
    iconColor: "#D96C6C",
    title: "데이터 삭제 예약됨",
    desc: (days) => days != null
      ? `${days}일 후 모든 데이터가 영구 삭제됩니다. 지금 결제하면 복구됩니다.`
      : "결제를 완료하면 데이터를 복구할 수 있습니다.",
    action: "지금 결제하기",
  },
  deleted: {
    bg: "#F1F0EF",
    border: "#9B9591",
    icon: "x-circle",
    iconColor: "#6F6B68",
    title: "계정이 삭제되었습니다",
    desc: () => "모든 데이터가 영구 삭제되었습니다. 새로 시작하려면 고객센터에 문의해주세요.",
  },
};

export function PaymentBanner() {
  const { pool, adminUser } = useAuth();
  const isAdmin = adminUser?.role === "pool_admin" || adminUser?.role === "sub_admin";
  if (!isAdmin) return null;

  const kind = getBannerKind(pool?.subscription_status);
  if (!kind) return null;

  const cfg = CONFIGS[kind];
  const days = pool?.days_until_deletion;

  return (
    <View style={[s.wrap, { backgroundColor: cfg.bg, borderColor: cfg.border }]}>
      <View style={s.row}>
        <Feather name={cfg.icon} size={18} color={cfg.iconColor} style={{ marginTop: 1 }} />
        <View style={s.texts}>
          <Text style={[s.title, { color: cfg.iconColor }]}>{cfg.title}</Text>
          <Text style={s.desc}>{cfg.desc(days)}</Text>
        </View>
      </View>
      {cfg.action && (
        <Pressable
          style={[s.btn, { borderColor: cfg.iconColor }]}
          onPress={() => router.push("/(admin)/billing")}
        >
          <Text style={[s.btnTxt, { color: cfg.iconColor }]}>{cfg.action}</Text>
        </Pressable>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    marginBottom: 8,
    borderRadius: 12,
    borderWidth: 1.5,
    padding: 14,
    gap: 10,
  },
  row: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  texts: { flex: 1, gap: 3 },
  title: { fontSize: 13, fontWeight: "700" },
  desc: { fontSize: 12, color: "#4A4540", lineHeight: 17 },
  btn: {
    alignSelf: "flex-start",
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1.5,
  },
  btnTxt: { fontSize: 13, fontWeight: "700" },
});
