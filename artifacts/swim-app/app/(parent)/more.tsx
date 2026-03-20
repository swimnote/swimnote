/**
 * 학부모 설정 화면
 * - 부모 프로필 카드 + 수정 버튼
 * - 연결된 자녀 목록 (클릭 → 자녀 프로필)
 * - 기능 메뉴
 * - 로그아웃
 * - ParentScreenHeader (홈 버튼 → 학부모 홈)
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { ConfirmModal } from "@/components/common/ConfirmModal";
import { ParentScreenHeader } from "@/components/parent/ParentScreenHeader";
import { useAuth } from "@/context/AuthContext";
import { useParent } from "@/context/ParentContext";

const C = Colors.light;
const CHILD_COLORS = [C.tint, "#059669", "#7C3AED", "#D97706", "#0EA5E9"];

function SectionLabel({ label }: { label: string }) {
  return (
    <Text style={[s.sectionLabel, { color: C.textMuted }]}>{label}</Text>
  );
}

function MenuItem({
  icon, label, sub, onPress, danger = false,
}: {
  icon: any; label: string; sub?: string; onPress?: () => void; danger?: boolean;
}) {
  return (
    <Pressable
      style={({ pressed }) => [s.menuItem, { backgroundColor: C.card, opacity: pressed ? 0.8 : 1 }]}
      onPress={onPress}
    >
      <View style={[s.menuIcon, { backgroundColor: danger ? "#FEE2E2" : C.tintLight }]}>
        <Feather name={icon} size={18} color={danger ? "#DC2626" : C.tint} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[s.menuLabel, { color: danger ? "#DC2626" : C.text }]}>{label}</Text>
        {sub ? <Text style={[s.menuSub, { color: C.textMuted }]}>{sub}</Text> : null}
      </View>
      {!danger && <Feather name="chevron-right" size={16} color={C.textMuted} />}
    </Pressable>
  );
}

export default function ParentMoreScreen() {
  const insets = useSafeAreaInsets();
  const { parentAccount, logout } = useAuth();
  const { selectedStudent, students } = useParent();
  const [logoutConfirm, setLogoutConfirm] = useState(false);

  return (
    <View style={[s.root, { backgroundColor: C.background }]}>
      <ParentScreenHeader title="설정" />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 40, gap: 6 }}
      >
        {/* ─ 부모 프로필 카드 ─ */}
        {parentAccount && (
          <View style={[s.profileCard, { backgroundColor: C.tint }]}>
            <View style={s.profileAvatar}>
              <Text style={s.profileAvatarTxt}>{parentAccount.name?.[0] ?? "P"}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.profileName}>{parentAccount.name}님</Text>
              <Text style={s.profilePool}>{parentAccount.pool_name || "수영장"}</Text>
            </View>
            <Pressable
              style={s.editBtn}
              onPress={() => router.push("/(parent)/parent-profile" as any)}
            >
              <Feather name="edit-2" size={16} color="rgba(255,255,255,0.9)" />
              <Text style={s.editBtnTxt}>수정</Text>
            </Pressable>
          </View>
        )}

        {/* ─ 연결된 자녀 ─ */}
        {students.length > 0 && (
          <>
            <SectionLabel label="연결된 자녀" />
            <View style={[s.childrenCard, { backgroundColor: C.card }]}>
              {students.map((st, i) => {
                const color = CHILD_COLORS[i % CHILD_COLORS.length];
                const isSelected = selectedStudent?.id === st.id;
                return (
                  <Pressable
                    key={st.id}
                    style={[s.childRow, i > 0 && { borderTopWidth: 1, borderTopColor: C.border }]}
                    onPress={() => router.push({ pathname: "/(parent)/child-profile" as any, params: { id: st.id } })}
                  >
                    <View style={[s.childAvatar, { backgroundColor: color + "22" }]}>
                      <Text style={[s.childAvatarTxt, { color }]}>{st.name[0]}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[s.childName, { color: C.text }]}>{st.name}</Text>
                      {st.class_group?.name && (
                        <Text style={[s.childClass, { color: C.textMuted }]}>{st.class_group.name}</Text>
                      )}
                    </View>
                    {isSelected && (
                      <View style={[s.selectedBadge, { backgroundColor: C.tintLight }]}>
                        <Feather name="check" size={11} color={C.tint} />
                        <Text style={[s.selectedTxt, { color: C.tint }]}>선택 중</Text>
                      </View>
                    )}
                    <Feather name="chevron-right" size={16} color={C.textMuted} />
                  </Pressable>
                );
              })}
            </View>
          </>
        )}

        {/* ─ 자녀 관리 ─ */}
        <SectionLabel label="자녀 관리" />
        <MenuItem
          icon="user-plus"
          label="자녀 연결/추가"
          sub="초대코드로 자녀 연결"
          onPress={() => router.push("/(parent)/children" as any)}
        />

        {/* ─ 수영장 소식 ─ */}
        <SectionLabel label="수영장 소식" />
        <MenuItem
          icon="bell" label="공지사항" sub="전체공지 · 우리반공지"
          onPress={() => router.push("/(parent)/notices" as any)}
        />
        <MenuItem
          icon="award" label="교육 프로그램" sub="수영장 교육 정보"
          onPress={() => router.push("/(parent)/program" as any)}
        />

        {/* ─ 학습 기록 ─ */}
        <SectionLabel label="학습 기록" />
        <MenuItem
          icon="book-open" label="수업일지" sub="선생님 수업 피드백"
          onPress={() => router.push("/(parent)/diary" as any)}
        />
        <MenuItem
          icon="award" label="레벨 기록"
          sub={selectedStudent ? `${selectedStudent.name}의 수영 레벨` : "자녀를 선택해주세요"}
          onPress={() => router.push("/(parent)/level" as any)}
        />

        {/* ─ 고객센터 ─ */}
        <SectionLabel label="고객센터 / 정보" />
        <MenuItem icon="help-circle" label="고객센터" sub="문의 및 도움말" onPress={() => {}} />
        <MenuItem icon="file-text" label="이용약관" onPress={() => {}} />
        <MenuItem icon="lock" label="개인정보 처리방침" onPress={() => {}} />

        {/* ─ 계정 ─ */}
        <SectionLabel label="계정" />
        <MenuItem
          icon="log-out" label="로그아웃" danger
          onPress={() => setLogoutConfirm(true)}
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
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },

  profileCard: {
    borderRadius: 20, padding: 18, flexDirection: "row", alignItems: "center",
    gap: 14, marginTop: 8, marginBottom: 4,
  },
  profileAvatar: {
    width: 52, height: 52, borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.25)",
    alignItems: "center", justifyContent: "center",
  },
  profileAvatarTxt: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#fff" },
  profileName: { fontSize: 17, fontFamily: "Inter_700Bold", color: "#fff" },
  profilePool: { fontSize: 13, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.8)", marginTop: 2 },
  editBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: "rgba(255,255,255,0.2)", borderRadius: 10 },
  editBtnTxt: { fontSize: 13, fontFamily: "Inter_500Medium", color: "#fff" },

  sectionLabel: {
    fontSize: 11, fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.4, textTransform: "uppercase",
    marginTop: 10, marginBottom: 2, paddingHorizontal: 4,
  },

  childrenCard: { borderRadius: 16, padding: 14, marginBottom: 2 },
  childRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
  childAvatar: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  childAvatarTxt: { fontSize: 16, fontFamily: "Inter_700Bold" },
  childName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  childClass: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  selectedBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  selectedTxt: { fontSize: 11, fontFamily: "Inter_600SemiBold" },

  menuItem: {
    flexDirection: "row", alignItems: "center", borderRadius: 14, padding: 14, gap: 12,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.03, shadowRadius: 3, elevation: 1,
  },
  menuIcon: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  menuLabel: { fontSize: 15, fontFamily: "Inter_500Medium" },
  menuSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
});
