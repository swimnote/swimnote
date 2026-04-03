/**
 * 학부모 설정 화면 — 단순화 버전
 *
 * 항목:
 *   1. 부모 정보 수정
 *   2. 자녀 관리
 *   3. 이용약관
 *   4. 개인정보처리방침
 *   5. 로그아웃
 *
 * ParentScreenHeader (홈 버튼 → 학부모 홈, 관리자 경로 차단)
 */
import { ChevronRight } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import { router } from "expo-router";
import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { ConfirmModal } from "@/components/common/ConfirmModal";
import { ParentScreenHeader } from "@/components/parent/ParentScreenHeader";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useParent } from "@/context/ParentContext";

const C = Colors.light;

const MINT_C = "#2EC4B6"; const MINT_BG = "#E6FAF8";
const ORNG_C = "#F97316"; const ORNG_BG = "#FFF1E8";
const NAVY_C = "#0F172A"; const NAVY_BG = "#E6FAF8";

function MenuItem({
  icon, label, sub, onPress, danger = false,
  iconColor, iconBg,
}: {
  icon: any; label: string; sub?: string; onPress?: () => void; danger?: boolean;
  iconColor?: string; iconBg?: string;
}) {
  const ic = danger ? "#D96C6C" : (iconColor ?? NAVY_C);
  const bg = danger ? "#F9DEDA" : (iconBg ?? MINT_BG);
  return (
    <Pressable
      style={({ pressed }) => [s.menuItem, { backgroundColor: C.card, opacity: pressed ? 0.8 : 1 }]}
      onPress={onPress}
    >
      <View style={[s.menuIcon, { backgroundColor: bg }]}>
        <LucideIcon name={icon} size={18} color={ic} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[s.menuLabel, { color: danger ? "#D96C6C" : C.text }]}>{label}</Text>
        {sub ? <Text style={[s.menuSub, { color: C.textMuted }]}>{sub}</Text> : null}
      </View>
      {!danger && <ChevronRight size={16} color={C.textMuted} />}
    </Pressable>
  );
}

export default function ParentMoreScreen() {
  const insets = useSafeAreaInsets();
  const { parentAccount, logout, token } = useAuth();
  const { students } = useParent();
  const [logoutConfirm, setLogoutConfirm] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  async function handleDeleteAccount() {
    setDeleteLoading(true);
    try {
      const res = await apiRequest(token, "/auth/account", { method: "DELETE" });
      if (res.ok) { setDeleteConfirm(false); await logout(); }
    } catch { } finally { setDeleteLoading(false); }
  }

  return (
    <View style={[s.root, { backgroundColor: C.background }]}>
      <ParentScreenHeader title="설정" showHome={false} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 40, gap: 8, paddingTop: 12 }}
      >
        {/* 계정 요약 */}
        {parentAccount && (
          <View style={[s.accountCard, { backgroundColor: C.card }]}>
            <View style={[s.accountAvatar, { backgroundColor: C.tintLight }]}>
              <Text style={[s.accountAvatarTxt, { color: C.tint }]}>{parentAccount.name?.[0] ?? "P"}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[s.accountName, { color: C.text }]}>{parentAccount.name}님</Text>
              <Text style={[s.accountPool, { color: C.textMuted }]}>
                {parentAccount.pool_name || "수영장"} · 자녀 {students.length}명
              </Text>
            </View>
          </View>
        )}

        {/* 메뉴 목록 */}
        <MenuItem
          icon="user"
          label="부모 정보 수정"
          sub="이름·전화번호·비밀번호"
          iconColor={NAVY_C} iconBg={NAVY_BG}
          onPress={() => router.push("/(parent)/parent-profile?backTo=more" as any)}
        />
        <MenuItem
          icon="users"
          label="자녀 관리"
          sub={students.length > 0 ? `연결된 자녀 ${students.length}명` : "자녀를 연결해주세요"}
          iconColor={NAVY_C} iconBg={MINT_BG}
          onPress={() => router.push("/(parent)/children?backTo=more" as any)}
        />
        <MenuItem
          icon="clipboard-list"
          label="수업 요청"
          sub="결석·연기·퇴원·상담 신청"
          iconColor={ORNG_C} iconBg={ORNG_BG}
          onPress={() => router.push("/(parent)/requests?backTo=more" as any)}
        />
        <MenuItem
          icon="bell"
          label="공지함"
          sub="수영장 공지 전체 보기"
          iconColor={NAVY_C} iconBg={NAVY_BG}
          onPress={() => router.push("/(parent)/notices?backTo=more" as any)}
        />
        <MenuItem
          icon="settings"
          label="푸시 알림 설정"
          sub="공지·수업·일지·사진 알림 on/off"
          iconColor={NAVY_C} iconBg={NAVY_BG}
          onPress={() => router.push("/(parent)/push-settings?backTo=more" as any)}
        />
        {/* 약관 및 정책 */}
        <MenuItem
          icon="file-text"
          label="이용약관"
          iconColor={NAVY_C} iconBg={NAVY_BG}
          onPress={() => router.push("/terms" as any)}
        />
        <MenuItem
          icon="lock"
          label="개인정보처리방침"
          iconColor={NAVY_C} iconBg={NAVY_BG}
          onPress={() => router.push("/privacy" as any)}
        />
        {/* 앱 버전 */}
        <View style={[s.versionRow]}>
          <Text style={[s.versionTxt, { color: C.textMuted }]}>SwimNote v1.0.0</Text>
        </View>

        <MenuItem
          icon="log-out"
          label="로그아웃"
          danger
          onPress={() => setLogoutConfirm(true)}
        />
        <MenuItem
          icon="user-x"
          label="회원 탈퇴"
          sub="계정 및 데이터 영구 삭제"
          danger
          onPress={() => setDeleteConfirm(true)}
        />
      </ScrollView>

      <ConfirmModal
        visible={logoutConfirm}
        title="로그아웃"
        message="정말 로그아웃하시겠습니까?"
        confirmText="로그아웃"
        destructive
        onConfirm={async () => { setLogoutConfirm(false); await logout(); }}
        onCancel={() => setLogoutConfirm(false)}
      />
      <ConfirmModal
        visible={deleteConfirm}
        title="회원 탈퇴"
        message={"계정을 삭제하면 모든 데이터가 영구적으로\n삭제되며 복구할 수 없습니다.\n정말 탈퇴하시겠습니까?"}
        confirmText={deleteLoading ? "처리 중..." : "탈퇴하기"}
        destructive
        onConfirm={handleDeleteAccount}
        onCancel={() => setDeleteConfirm(false)}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },

  accountCard: {
    borderRadius: 16, padding: 16, flexDirection: "row", alignItems: "center",
    gap: 14, marginBottom: 8,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 3, elevation: 1,
  },
  accountAvatar: {
    width: 48, height: 48, borderRadius: 14,
    alignItems: "center", justifyContent: "center",
  },
  accountAvatarTxt: { fontSize: 20, fontFamily: "Pretendard-Regular" },
  accountName: { fontSize: 16, fontFamily: "Pretendard-Regular" },
  accountPool: { fontSize: 12, fontFamily: "Pretendard-Regular", marginTop: 2 },

  menuItem: {
    flexDirection: "row", alignItems: "center", borderRadius: 14, padding: 15, gap: 12,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03, shadowRadius: 3, elevation: 1,
  },
  menuIcon: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  menuLabel: { fontSize: 15, fontFamily: "Pretendard-Regular" },
  menuSub: { fontSize: 12, fontFamily: "Pretendard-Regular" },

  versionRow: { paddingVertical: 4, alignItems: "center" },
  versionTxt: { fontSize: 12, fontFamily: "Pretendard-Regular" },
});
