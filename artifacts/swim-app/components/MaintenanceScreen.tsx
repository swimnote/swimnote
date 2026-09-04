import React, { useEffect } from "react";
import { BackHandler, Image, StatusBar, StyleSheet, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import Colors from "@/constants/colors";

const C = Colors.light;

export default function MaintenanceScreen() {
  const insets = useSafeAreaInsets();

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => subscription.remove();
  }, []);

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom", "left", "right"]}>
      <StatusBar barStyle="dark-content" backgroundColor={C.surface} />
      <View style={[styles.container, { paddingTop: Math.max(24, insets.top * 0.2) }]}>
        <Image
          source={require("@/assets/images/swimnote-logo.png")}
          style={styles.logo}
          resizeMode="contain"
          accessibilityLabel="SWIMNOTE"
        />

        <View style={styles.content}>
          <Text style={styles.title}>서버 점검 중입니다</Text>
          <View style={styles.accent} />
          <Text style={styles.description}>
            SWIMNOTE AI 대규모 업데이트로 서버 점검을 실시합니다.
          </Text>
          <Text style={styles.description}>
            더 안정적이고 향상된 AI 서비스를 제공하기 위해{"\n"}
            시스템 업데이트 및 서버 안정화 작업을 진행하고 있습니다.
          </Text>
          <Text style={styles.description}>
            작업이 완료되는 즉시 정상적으로 이용하실 수 있습니다.{"\n"}
            이용에 불편을 드려 죄송합니다.
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: C.surface,
  },
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  logo: {
    width: 178,
    height: 178,
    marginBottom: 28,
  },
  content: {
    width: "100%",
    maxWidth: 360,
    alignItems: "center",
  },
  title: {
    color: C.tintDark,
    fontFamily: "Pretendard-Bold",
    fontSize: 25,
    lineHeight: 34,
    textAlign: "center",
  },
  accent: {
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.brandPrimary,
    marginTop: 16,
    marginBottom: 24,
  },
  description: {
    color: C.textSecondary,
    fontFamily: "Pretendard-Regular",
    fontSize: 15,
    lineHeight: 24,
    textAlign: "center",
    marginBottom: 18,
  },
});