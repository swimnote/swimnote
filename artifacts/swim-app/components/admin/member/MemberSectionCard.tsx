/**
 * 공유 Section 카드 래퍼 — WP-M3 long-scroll 레이아웃 전용
 */
import React from "react";
import { Pressable, Text, View } from "react-native";
import Colors from "@/constants/colors";
import { LucideIcon } from "@/components/common/LucideIcon";

const C = Colors.light;

interface MemberSectionCardProps {
  title: string;
  /** 우상단 버튼 라벨 (생략 시 버튼 없음) */
  actionLabel?: string;
  actionIcon?: React.ComponentProps<typeof LucideIcon>["name"];
  actionColor?: string;
  onAction?: () => void;
  /** 저장/취소 버튼 (edit mode) */
  onSave?: () => void;
  onCancel?: () => void;
  saving?: boolean;
  editing?: boolean;
  children: React.ReactNode;
}

export function MemberSectionCard({
  title,
  actionLabel,
  actionIcon,
  actionColor,
  onAction,
  onSave,
  onCancel,
  saving,
  editing,
  children,
}: MemberSectionCardProps) {
  return (
    <View style={{
      backgroundColor: "#fff",
      borderRadius: 18,
      padding: 16,
      gap: 10,
      shadowColor: "#00000010",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 1,
      shadowRadius: 6,
      elevation: 2,
    }}>
      {/* 섹션 헤더 */}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={{ fontSize: 15, fontFamily: "Pretendard-Regular", color: C.text }}>{title}</Text>
        {editing ? (
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable
              onPress={onCancel}
              style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: C.border }}
            >
              <Text style={{ fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary }}>취소</Text>
            </Pressable>
            <Pressable
              onPress={onSave}
              disabled={saving}
              style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: actionColor || C.brandStrong }}
            >
              <Text style={{ fontSize: 13, fontFamily: "Pretendard-Regular", color: "#fff" }}>{saving ? "저장 중..." : "저장"}</Text>
            </Pressable>
          </View>
        ) : actionLabel ? (
          <Pressable
            onPress={onAction}
            style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: actionColor || C.brandStrong }}
          >
            {actionIcon && <LucideIcon name={actionIcon} size={13} color={actionColor || C.brandStrong} />}
            <Text style={{ fontSize: 13, fontFamily: "Pretendard-Regular", color: actionColor || C.brandStrong }}>{actionLabel}</Text>
          </Pressable>
        ) : null}
      </View>
      {children}
    </View>
  );
}

/** 공유 InfoRow */
export function InfoRow({ icon, label, value }: {
  icon?: React.ComponentProps<typeof LucideIcon>["name"];
  label: string;
  value?: string | null;
}) {
  return (
    <View style={{
      flexDirection: "row", alignItems: "center", gap: 8,
      paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.border,
    }}>
      {icon && <LucideIcon name={icon} size={13} color={C.textMuted} />}
      <Text style={{ width: 90, fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary }}>{label}</Text>
      <Text style={{ flex: 1, fontSize: 14, fontFamily: "Pretendard-Regular", color: C.text }}>{value || "미입력"}</Text>
    </View>
  );
}
