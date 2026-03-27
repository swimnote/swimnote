/**
 * (teacher)/messenger.tsx — 선생님 업무 메신저
 */
import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import MessengerScreen from "@/components/common/MessengerScreen";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const C = Colors.light;

export default function TeacherMessengerTab() {
  const { pool, adminUser } = useAuth();
  const { themeColor } = useBrand();
  const insets = useSafeAreaInsets();

  if (!pool?.id || !adminUser?.id) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <SubScreenHeader title="메신저" homePath="/(teacher)/today-schedule" />
        <View style={styles.center}>
          <Text style={styles.noPoolText}>수영장 정보를 불러오는 중...</Text>
        </View>
      </View>
    );
  }

  // SubScreenHeader 높이: paddingTop(insets.top+8) + 내용(38) + paddingBottom(14)
  const headerOffset = Platform.OS === "ios" ? insets.top + 60 : 0;

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      <SubScreenHeader title="메신저" homePath="/(teacher)/today-schedule" />
      <MessengerScreen
        poolId={pool.id}
        myUserId={adminUser.id}
        myRole="teacher"
        keyboardHeaderOffset={headerOffset}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.background,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  noPoolText: {
    color: C.textSecondary,
    fontSize: 14,
    fontFamily: "Pretendard-Regular",
  },
});
