/**
 * ScreenLayout — 고정 상단 + 스크롤 하단 레이아웃
 *
 * 상단(header)은 절대 스크롤되지 않음.
 * 하단(children)만 FlatList/SectionList 로 스크롤.
 *
 * 이 컴포넌트를 사용하면 필터 상태가 바뀌어도 상단 레이아웃은 항상 고정됨.
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import Colors from "@/constants/colors";

const C = Colors.light;

interface ScreenLayoutProps {
  /** 고정 상단 — PageHeader + MainTabs + FilterChips 등을 여기에 */
  header: React.ReactNode;
  /** 스크롤 영역 — FlatList / SectionList 로 채울 것 */
  children: React.ReactNode;
  backgroundColor?: string;
}

export function ScreenLayout({ header, children, backgroundColor }: ScreenLayoutProps) {
  return (
    <View style={[s.root, { backgroundColor: backgroundColor ?? C.background }]}>
      {/* 고정 상단 — overflow visible 로 칩/탭이 잘리지 않게 */}
      <View style={s.header}>{header}</View>
      {/* 스크롤 영역만 flex:1 */}
      <View style={s.body}>{children}</View>
    </View>
  );
}

const s = StyleSheet.create({
  root:   { flex: 1 },
  header: { overflow: "visible" },
  body:   { flex: 1 },
});
