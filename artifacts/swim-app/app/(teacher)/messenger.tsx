/**
 * (teacher)/messenger.tsx — 선생님 업무 메신저
 */
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import MessengerScreen from "@/components/common/MessengerScreen";

const C = Colors.light;

export default function TeacherMessengerTab() {
  const { pool, adminUser } = useAuth();

  if (!pool?.id || !adminUser?.id) {
    return (
      <View style={styles.center}>
        <Text style={styles.noPoolText}>수영장 정보를 불러오는 중...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <MessengerScreen
        poolId={pool.id}
        myUserId={adminUser.id}
        myRole="teacher"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: C.background },
  noPoolText: { color: C.textSecondary, fontSize: 14, fontFamily: "Inter_400Regular" },
});
