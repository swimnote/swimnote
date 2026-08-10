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
import { LucideIcon } from "@/components/common/LucideIcon";
import AppUpdateButton from "@/components/common/AppUpdateButton";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { ConfirmModal } from "@/components/common/ConfirmModal";
import { WithdrawalModal } from "@/components/common/WithdrawalModal";
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
      <View style={s.menuIcon}>
        <LucideIcon name={icon} size={18} color={ic} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[s.menuLabel, { color: danger ? "#D96C6C" : C.text }]}>{label}</Text>
        {sub ? <Text style={[s.menuSub, { color: C.textMuted }]}>{sub}</Text> : null}
      </View>
      {!danger && <LucideIcon name="chevron-right" size={16} color={C.textMuted} />}
    </Pressable>
  );
}

export default function ParentMoreScreen() {
  const insets = useSafeAreaInsets();
  const { parentAccount, logout, token, pool, parentPoolName } = useAuth();
  const { students } = useParent();
  const [logoutConfirm, setLogoutConfirm] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [inquiryBadge, setInquiryBadge] = useState(0);


  const fetchBadge = useCallback(async () => {
    if (!token) return;
    try {
      const res = await apiRequest(token, "/inquiries/unread-count");
      if (res.ok) { const d = await res.json(); setInquiryBadge(d.count ?? 0); }
    } catch { /* ignore */ }
  }, [token]);

  useEffect(() => { fetchBadge(); }, [fetchBadge]);
  useFocusEffect(useCallback(() => { fetchBadge(); }, [fetchBadge]));

  async function handleDeleteAccount(immediate: boolean) {
    setDeleteLoading(true);
    try {
      const res = await apiRequest(token, "/auth/account", {
        method: "DELETE",
        body: JSON.stringify({ immediate }),
      });
      if (res.ok) {
        setDeleteConfirm(false);
        await logout();
      }
    } catch { } finally { setDeleteLoading(false); }
  }

  return (
    <View style={[s.root, { backgroundColor: C.background }]}>
      <ParentScreenHeader title="설정" showHome={false} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 40, gap: 8, paddingTop: 12 }}
      >
        {/* 계정 요약 — 탭 시 내 정보 화면 */}
        {parentAccount && (
          <Pressable
            style={({ pressed }) => [s.accountCard, { backgroundColor: C.card, opacity: pressed ? 0.85 : 1 }]}
            onPress={() => router.push("/(parent)/my-info?backTo=more" as any)}
          >
            <View style={s.accountAvatar}>
              <LucideIcon name="user-round" size={26} color={C.tint} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[s.accountName, { color: C.text }]}>{parentAccount.name}님</Text>
              <Text style={[s.accountPool, { color: C.textMuted }]}>
                {parentPoolName || (parentAccount as any)?.pool_name || pool?.name || "수영장"} · 자녀 {students.length}명
              </Text>
            </View>
            <LucideIcon name="chevron-right" size={16} color={C.textMuted} />
          </Pressable>
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
        {students.length > 0 && (
          <MenuItem
            icon="user-plus"
            label="추가 보호자 관리"
            sub="두 번째·세 번째 보호자 번호 등록"
            iconColor={MINT_C} iconBg={MINT_BG}
            onPress={() => router.push("/(parent)/additional-guardians" as any)}
          />
        )}
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

        {/* 문의하기 */}
        <Pressable
          style={({ pressed }) => [s.menuItem, { backgroundColor: C.card, opacity: pressed ? 0.8 : 1 }]}
          onPress={() => router.push("/(parent)/inquiries" as any)}
        >
          <View style={s.menuIcon}>
            <LucideIcon name="help-circle" size={18} color={MINT_C} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[s.menuLabel, { color: C.text }]}>문의하기</Text>
            <Text style={[s.menuSub, { color: C.textMuted }]}>스윔노트 · 원장님에게 문의</Text>
          </View>
          {inquiryBadge > 0 && (
            <View style={s.badge}>
              <Text style={s.badgeText}>{inquiryBadge}</Text>
            </View>
          )}
          <LucideIcon name="chevron-right" size={16} color={C.textMuted} />
        </Pressable>

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
        {/* 앱 업데이트 — 학부모 메뉴에서 숨김 (OTA 자동 모달로 처리) */}
        {/* <AppUpdateButton /> */}

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
      <WithdrawalModal
        visible={deleteConfirm}
        onClose={() => setDeleteConfirm(false)}
        onConfirm={handleDeleteAccount}
        loading={deleteLoading}
        isPaidPlan={false}
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
  menuIcon: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: "transparent" },
  menuLabel: { fontSize: 15, fontFamily: "Pretendard-Regular" },
  menuSub: { fontSize: 12, fontFamily: "Pretendard-Regular" },
  badge: {
    minWidth: 22, height: 22, borderRadius: 11, backgroundColor: "#D96C6C",
    alignItems: "center", justifyContent: "center", paddingHorizontal: 5, marginRight: 4,
  },
  badgeText: { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#fff" },
});
