/**
 * 학부모 설정 화면
 * - 학부모 정보, 자녀 연결, 알림 설정, 약관, 로그아웃 등
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { useParent } from "@/context/ParentContext";
import { ConfirmModal } from "@/components/common/ConfirmModal";

const C = Colors.light;

function MenuItem({
  icon, label, sub, onPress, danger = false, rightEl,
}: {
  icon: any; label: string; sub?: string; onPress?: () => void; danger?: boolean; rightEl?: React.ReactNode;
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
      {rightEl ?? (!danger && <Feather name="chevron-right" size={16} color={C.textMuted} />)}
    </Pressable>
  );
}

function SectionLabel({ label }: { label: string }) {
  return <Text style={[s.sectionLabel, { color: C.textMuted }]}>{label}</Text>;
}

export default function ParentMoreScreen() {
  const insets = useSafeAreaInsets();
  const { parentAccount, logout } = useAuth();
  const { selectedStudent, students } = useParent();
  const [logoutConfirm, setLogoutConfirm] = React.useState(false);

  return (
    <View style={[s.root, { backgroundColor: C.background }]}>
      <View style={[s.header, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 20) }]}>
        <Text style={[s.headerTitle, { color: C.text }]}>설정</Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 100, gap: 6 }}
      >
        {/* 프로필 카드 */}
        {parentAccount && (
          <View style={[s.profileCard, { backgroundColor: C.tint }]}>
            <View style={s.profileAvatar}>
              <Text style={s.profileAvatarTxt}>{parentAccount.name?.[0] ?? "P"}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.profileName}>{parentAccount.name}님</Text>
              <Text style={s.profilePool}>{parentAccount.pool_name || "수영장"}</Text>
            </View>
          </View>
        )}

        {/* 연결된 자녀 */}
        {students.length > 0 && (
          <>
            <SectionLabel label="연결된 자녀" />
            <View style={[s.childrenCard, { backgroundColor: C.card }]}>
              {students.map((st, i) => (
                <View
                  key={st.id}
                  style={[s.childRow, i > 0 && { borderTopWidth: 1, borderTopColor: C.border }]}
                >
                  <View style={[s.childAvatar, { backgroundColor: C.tintLight }]}>
                    <Text style={[s.childAvatarTxt, { color: C.tint }]}>{st.name[0]}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.childName, { color: C.text }]}>{st.name}</Text>
                    {st.class_group?.name && (
                      <Text style={[s.childClass, { color: C.textMuted }]}>{st.class_group.name}</Text>
                    )}
                  </View>
                  {selectedStudent?.id === st.id && (
                    <View style={[s.selectedBadge, { backgroundColor: C.tintLight }]}>
                      <Feather name="check" size={12} color={C.tint} />
                      <Text style={[s.selectedTxt, { color: C.tint }]}>선택 중</Text>
                    </View>
                  )}
                </View>
              ))}
            </View>
          </>
        )}

        {/* 자녀 관리 */}
        <SectionLabel label="자녀 관리" />
        <MenuItem
          icon="user-plus"
          label="자녀 연결/추가"
          sub="초대코드로 자녀 연결"
          onPress={() => router.push("/(parent)/children" as any)}
        />

        {/* 수영장 소식 */}
        <SectionLabel label="수영장 소식" />
        <MenuItem
          icon="bell"
          label="공지사항"
          sub="전체공지 · 우리반공지 확인"
          onPress={() => router.push("/(parent)/notices" as any)}
        />
        <MenuItem
          icon="award"
          label="교육 프로그램"
          sub="수영장 교육 정보"
          onPress={() => router.push("/(parent)/program" as any)}
        />

        {/* 학습 기록 */}
        <SectionLabel label="학습 기록" />
        <MenuItem
          icon="book-open"
          label="수업일지"
          sub="선생님 수업 피드백"
          onPress={() => router.push("/(parent)/diary" as any)}
        />
        <MenuItem
          icon="award"
          label="레벨 기록"
          sub={selectedStudent ? `${selectedStudent.name}의 수영 레벨` : "자녀를 선택해주세요"}
          onPress={() => router.push("/(parent)/level" as any)}
        />

        {/* 고객센터 */}
        <SectionLabel label="고객센터 / 정보" />
        <MenuItem icon="help-circle" label="고객센터" sub="문의 및 도움말" onPress={() => {}} />
        <MenuItem icon="file-text" label="이용약관" onPress={() => {}} />
        <MenuItem icon="lock" label="개인정보 처리방침" onPress={() => {}} />

        {/* 계정 */}
        <SectionLabel label="계정" />
        <MenuItem
          icon="log-out"
          label="로그아웃"
          danger
          onPress={() => setLogoutConfirm(true)}
          rightEl={<View />}
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
  header: { paddingHorizontal: 20, paddingBottom: 12 },
  headerTitle: { fontSize: 22, fontFamily: "Inter_700Bold" },

  profileCard: {
    borderRadius: 20, padding: 18, flexDirection: "row", alignItems: "center",
    gap: 14, marginBottom: 4,
  },
  profileAvatar: {
    width: 52, height: 52, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.25)",
    alignItems: "center", justifyContent: "center",
  },
  profileAvatarTxt: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#fff" },
  profileName: { fontSize: 17, fontFamily: "Inter_700Bold", color: "#fff" },
  profilePool: { fontSize: 13, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.8)", marginTop: 2 },

  sectionLabel: {
    fontSize: 11, fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.4, textTransform: "uppercase",
    marginTop: 10, marginBottom: 2, paddingHorizontal: 4,
  },

  childrenCard: { borderRadius: 16, padding: 14, marginBottom: 2 },
  childRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
  childAvatar: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  childAvatarTxt: { fontSize: 15, fontFamily: "Inter_700Bold" },
  childName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  childClass: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  selectedBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8,
  },
  selectedTxt: { fontSize: 11, fontFamily: "Inter_600SemiBold" },

  menuItem: {
    flexDirection: "row", alignItems: "center", borderRadius: 14,
    padding: 14, gap: 12,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03, shadowRadius: 3, elevation: 1,
  },
  menuIcon: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  menuLabel: { fontSize: 15, fontFamily: "Inter_500Medium" },
  menuSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
});
