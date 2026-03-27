/**
 * PoolHeader.tsx
 * 로그인 후 앱 내부 상단 헤더
 *
 * 표시 형태 (수영장 로그인 시):
 *   [로고/이모지]  토이키즈스윔클럽 화정점
 *                  Powered by 스윔노트
 *
 * 표시 형태 (미로그인 / 슈퍼관리자):
 *   [S]  스윔노트
 */
import React from "react";
import {
  View, Text, Image, StyleSheet, Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBrand, APP_PLATFORM_NAME } from "@/context/BrandContext";

interface PoolHeaderProps {
  /** 우측 영역에 표시할 커스텀 버튼들 */
  right?: React.ReactNode;
  /** 좌측 back 버튼 등 */
  left?: React.ReactNode;
}

export function PoolHeader({ right, left }: PoolHeaderProps) {
  const { poolName, themeColor, logoUrl, logoEmoji, headerTitle, headerSubtitle } = useBrand();
  const insets = useSafeAreaInsets();

  const paddingTop = Platform.OS === "web" ? 12 : Math.max(insets.top, 12);

  return (
    <View style={[styles.container, { paddingTop, backgroundColor: "#fff" }]}>
      <View style={styles.row}>
        {/* 좌측 버튼 (뒤로가기 등) */}
        {left ? <View style={styles.side}>{left}</View> : null}

        {/* 로고 + 텍스트 */}
        <View style={styles.brand}>
          <LogoBadge
            logoUrl={logoUrl}
            logoEmoji={logoEmoji}
            poolName={poolName}
            themeColor={themeColor}
          />
          <View style={styles.titles}>
            <Text style={styles.title} numberOfLines={1}>{headerTitle}</Text>
            {headerSubtitle ? (
              <Text style={[styles.subtitle, { color: themeColor }]}>{headerSubtitle}</Text>
            ) : null}
          </View>
        </View>

        {/* 우측 버튼 */}
        {right ? <View style={styles.side}>{right}</View> : <View style={styles.side} />}
      </View>

      {/* 하단 구분선 */}
      <View style={styles.divider} />
    </View>
  );
}

/** 로고 뱃지: 이미지 > 이모지 > 이니셜 순으로 표시 */
function LogoBadge({
  logoUrl, logoEmoji, poolName, themeColor,
}: {
  logoUrl: string | null;
  logoEmoji: string | null;
  poolName: string | null;
  themeColor: string;
}) {
  if (logoUrl) {
    return (
      <Image
        source={{ uri: logoUrl }}
        style={[styles.logo, { borderColor: themeColor }]}
        resizeMode="cover"
      />
    );
  }
  const label = logoEmoji
    ? logoEmoji
    : poolName
      ? poolName.slice(0, 1)
      : APP_PLATFORM_NAME.slice(0, 1);

  return (
    <View style={[styles.logo, styles.logoBadge, { backgroundColor: themeColor }]}>
      <Text style={styles.logoText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 10,
    gap: 10,
  },
  side: {
    width: 40,
    alignItems: "center",
  },
  brand: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  logo: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: "transparent",
  },
  logoBadge: {
    justifyContent: "center",
    alignItems: "center",
  },
  logoText: {
    color: "#fff",
    fontSize: 16,
    fontFamily: "Pretendard-Bold",
  },
  titles: {
    flex: 1,
  },
  title: {
    fontSize: 15,
    fontFamily: "Pretendard-Bold",
    color: "#0F172A",
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 10,
    fontFamily: "Pretendard-Medium",
    marginTop: 1,
    letterSpacing: 0.2,
  },
  divider: {
    height: 1,
    backgroundColor: "#E5E7EB",
    marginHorizontal: 0,
  },
});
