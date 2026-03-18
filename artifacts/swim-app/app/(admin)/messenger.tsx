/**
 * (admin)/messenger.tsx — 관리자 업무 메신저
 */
import React from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import MessengerScreen from "@/components/common/MessengerScreen";

const C = Colors.light;

export default function AdminMessengerTab() {
  const { pool, adminUser } = useAuth();
  const insets = useSafeAreaInsets();

  if (!pool?.id || !adminUser?.id) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <Text style={styles.noPoolText}>수영장 정보를 불러오는 중...</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View style={styles.header}>
        <Text style={styles.headerTitle}>업무 메신저</Text>
      </View>
      <MessengerScreen
        poolId={pool.id}
        myUserId={adminUser.id}
        myRole="pool_admin"
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: C.background },
  noPoolText: { color: C.textSecondary, fontSize: 14, fontFamily: "Inter_400Regular" },
  header: {
    backgroundColor: "#fff",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  headerTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: C.text },
});
