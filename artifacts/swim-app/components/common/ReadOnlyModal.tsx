/**
 * ReadOnlyModal — 읽기전용/업로드차단 안내 모달
 * Alert.alert 대신 ConfirmModal과 동일한 스타일 시스템 사용
 */
import React from "react";
import { Modal, View, Text, Pressable, StyleSheet } from "react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import { router } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import type { WriteGuardModal } from "@/hooks/useWriteGuard";

interface Props {
  kind: WriteGuardModal;
  onClose: () => void;
}

export function ReadOnlyModal({ kind, onClose }: Props) {
  const { adminUser, pool } = useAuth();
  const isAdmin = adminUser?.role === "pool_admin" || adminUser?.role === "sub_admin";

  if (!kind) return null;

  const config = {
    readonly: {
      icon: "lock" as const,
      iconColor: "#D96C6C",
      title: "서비스 이용 제한",
      desc: isAdmin
        ? "결제 실패로 인해 쓰기 기능이 제한되었습니다.\n결제 관리 화면에서 재결제를 진행해주세요."
        : "현재 이 기능을 사용할 수 없습니다.\n관리자에게 문의해주세요.",
      action: isAdmin ? "결제 관리로 이동" : null,
      onAction: isAdmin
        ? () => { onClose(); router.push("/(admin)/billing"); }
        : null,
    },
    upload_blocked: {
      icon: "cloud-off" as const,
      iconColor: "#D97706",
      title: "저장공간 초과",
      desc: isAdmin
        ? "저장공간이 가득 차 업로드가 제한됩니다.\n추가 용량을 구매하거나 플랜을 업그레이드해주세요."
        : "저장공간이 가득 차 파일 업로드가 불가합니다.\n관리자에게 문의해주세요.",
      action: isAdmin ? "결제 관리로 이동" : null,
      onAction: isAdmin
        ? () => { onClose(); router.push("/(admin)/billing"); }
        : null,
    },
    member_limit: {
      icon: "users" as const,
      iconColor: "#D97706",
      title: "회원 정원 초과",
      desc: `현재 플랜(${pool?.subscription_tier?.toUpperCase() ?? "FREE"})의 등록 가능 인원을 모두 사용했습니다.\n플랜을 업그레이드해야 추가 등록이 가능합니다.`,
      action: isAdmin ? "플랜 업그레이드" : null,
      onAction: isAdmin
        ? () => { onClose(); router.push("/(admin)/billing"); }
        : null,
    },
  };

  const c = config[kind];

  return (
    <Modal transparent animationType="fade" visible statusBarTranslucent onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable style={s.card} onPress={e => e.stopPropagation()}>
          <View style={[s.iconWrap, { backgroundColor: c.iconColor + "18" }]}>
            <LucideIcon name={c.icon} size={28} color={c.iconColor} />
          </View>
          <Text style={s.title}>{c.title}</Text>
          <Text style={s.desc}>{c.desc}</Text>
          <View style={s.btnRow}>
            <Pressable style={s.cancelBtn} onPress={onClose}>
              <Text style={s.cancelTxt}>닫기</Text>
            </Pressable>
            {c.action && c.onAction && (
              <Pressable style={s.confirmBtn} onPress={c.onAction}>
                <Text style={s.confirmTxt}>{c.action}</Text>
              </Pressable>
            )}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", alignItems: "center", padding: 24 },
  card: { width: "100%", maxWidth: 340, backgroundColor: "#FFF", borderRadius: 18, padding: 24, alignItems: "center", gap: 12 },
  iconWrap: { width: 60, height: 60, borderRadius: 30, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  title: { fontSize: 17, fontWeight: "700", color: "#1A1714", textAlign: "center" },
  desc: { fontSize: 14, color: "#64748B", textAlign: "center", lineHeight: 21 },
  btnRow: { flexDirection: "row", gap: 8, marginTop: 8, width: "100%" },
  cancelBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: "#E5E7EB", alignItems: "center" },
  cancelTxt: { fontSize: 14, fontWeight: "600", color: "#64748B" },
  confirmBtn: { flex: 1.4, paddingVertical: 12, borderRadius: 10, backgroundColor: "#2EC4B6", alignItems: "center" },
  confirmTxt: { fontSize: 14, fontWeight: "700", color: "#FFF" },
});
