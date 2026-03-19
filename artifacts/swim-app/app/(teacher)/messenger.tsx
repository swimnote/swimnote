/**
 * (teacher)/messenger.tsx — 선생님 업무 메신저
 */
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import MessengerScreen from "@/components/common/MessengerScreen";

const C = Colors.light;

export default function TeacherMessengerTab() {
  const { pool, adminUser } = useAuth();
  const { themeColor } = useBrand();
  const insets = useSafeAreaInsets();

  if (!pool?.id || !adminUser?.id) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <Text style={styles.noPoolText}>수영장 정보를 불러오는 중...</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={[styles.header, { borderBottomColor: C.border }]}>
        <Text style={[styles.headerTitle, { color: themeColor }]}>업무 메신저</Text>
      </View>
      <MessengerScreen
        poolId={pool.id}
        myUserId={adminUser.id}
        myRole="teacher"
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
  header: {
    backgroundColor: "#fff",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
  },
});
