/**
 * PaymentBanner — 결제 실패 / 삭제 예약 / 삭제 완료 상태 안내 배너
 *
 * 역할별 메시지 분리:
 * - pool_admin / sub_admin: 결제 직접 안내 + [지금 결제하기] 버튼
 * - teacher / parent_account: 결제·플랜 언급 없이 "관리자에게 문의" 안내만
 */
import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { useAuth } from "@/context/AuthContext";

type BannerKind = "payment_failed" | "pending_deletion" | "deleted" | null;

function getBannerKind(subscriptionStatus?: string): BannerKind {
  if (!subscriptionStatus) return null;
  if (subscriptionStatus === "payment_failed")   return "payment_failed";
  if (subscriptionStatus === "pending_deletion") return "pending_deletion";
  if (subscriptionStatus === "deleted")          return "deleted";
  return null;
}

interface BannerConfig {
  bg: string; border: string;
  icon: "alert-triangle" | "alert-circle" | "x-circle";
  iconColor: string;
  title: string;
  desc: (days: number | null | undefined) => string;
  action?: string;
}

const ADMIN_CONFIGS: Record<NonNullable<BannerKind>, BannerConfig> = {
  payment_failed: {
    bg: "#FFF1BF", border: "#F59E0B",
    icon: "alert-triangle", iconColor: "#D97706",
    title: "결제 실패로 인해 서비스 이용이 제한되었습니다",
    desc: (days) => days != null
      ? `재결제를 진행해주세요. 데이터 삭제까지 ${days}일 남았습니다.`
      : "빠른 시일 내에 재결제를 진행해주세요.",
    action: "지금 결제하기",
  },
  pending_deletion: {
    bg: "#F9DEDA", border: "#D96C6C",
    icon: "alert-circle", iconColor: "#D96C6C",
    title: "데이터 삭제 예약됨 — 결제를 완료해주세요",
    desc: (days) => days != null
      ? `데이터 삭제까지 ${days}일 남았습니다. 지금 결제하면 복구됩니다.`
      : "결제를 완료하면 데이터를 복구할 수 있습니다.",
    action: "지금 결제하기",
  },
  deleted: {
    bg: "#F1F0EF", border: "#9B9591",
    icon: "x-circle", iconColor: "#6B7280",
    title: "계정이 삭제되었습니다",
    desc: () => "모든 데이터가 영구 삭제되었습니다. 새로 시작하려면 고객센터에 문의해주세요.",
  },
};

const NON_ADMIN_CONFIG: BannerConfig = {
  bg: "#FFF8E1", border: "#F59E0B",
  icon: "alert-triangle", iconColor: "#D97706",
  title: "현재 일부 기능 이용이 제한되었습니다",
  desc: () => "관리자에게 문의해주세요.",
};

export function PaymentBanner() {
  const { pool, adminUser } = useAuth();

  const kind = getBannerKind(pool?.subscription_status);
  if (!kind) return null;

  const isAdmin = adminUser?.role === "pool_admin" || adminUser?.role === "sub_admin";
  const cfg = isAdmin ? ADMIN_CONFIGS[kind] : NON_ADMIN_CONFIG;
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
      {isAdmin && cfg.action && kind !== "deleted" && (
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
  wrap:   { marginBottom: 8, borderRadius: 12, borderWidth: 1.5, padding: 14, gap: 10 },
  row:    { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  texts:  { flex: 1, gap: 3 },
  title:  { fontSize: 13, fontWeight: "700" },
  desc:   { fontSize: 12, color: "#4A4540", lineHeight: 17 },
  btn:    { alignSelf: "flex-start", paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8, borderWidth: 1.5 },
  btnTxt: { fontSize: 13, fontWeight: "700" },
});
