/**
 * (admin)/messenger.tsx — 관리자 업무 메신저
 */
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import MessengerScreen from "@/components/common/MessengerScreen";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";

const C = Colors.light;

export default function AdminMessengerTab() {
  const { pool, adminUser } = useAuth();
  const insets = useSafeAreaInsets();

  if (!pool?.id || !adminUser?.id) {
    return (
      <View style={[styles.center]}>
        <Text style={styles.noPoolText}>수영장 정보를 불러오는 중...</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      <SubScreenHeader title="메신저" />
      <MessengerScreen
        poolId={pool.id}
        myUserId={adminUser.id}
        myRole="pool_admin"
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
    backgroundColor: C.background,
  },
  noPoolText: {
    color: C.textSecondary,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
});
