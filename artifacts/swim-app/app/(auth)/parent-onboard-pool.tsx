/**
 * parent-onboard-pool.tsx — STEP 1: 수영장 검색
 * operatorsStore의 활성 운영자를 목록으로 사용 (API 없음)
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  FlatList, Platform, Pressable, StyleSheet,
  Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { useOperatorsStore } from "@/store/operatorsStore";

const C = Colors.light;

export default function ParentOnboardPoolScreen() {
  const insets    = useSafeAreaInsets();
  const operators = useOperatorsStore(s => s.operators);
  const [query, setQuery] = useState("");

  const pools = useMemo(() => {
    const active = operators.filter(o => o.status === "active");
    if (!query.trim()) return active;
    const q = query.trim().toLowerCase();
    return active.filter(
      o =>
        o.name.toLowerCase().includes(q) ||
        (o.address ?? "").toLowerCase().includes(q) ||
        (o.phone ?? "").includes(q)
    );
  }, [operators, query]);

  function selectPool(id: string, name: string) {
    router.push({ pathname: "/parent-onboard-child", params: { pool_id: id, pool_name: name } } as any);
  }

  return (
    <View style={[styles.root, { backgroundColor: C.background }]}>
      {/* 헤더 */}
      <View style={[styles.header, { paddingTop: insets.top + (Platform.OS === "web" ? 68 : 20) }]}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Feather name="arrow-left" size={22} color={C.text} />
        </Pressable>
        <StepBar current={1} />
      </View>

      <View style={styles.content}>
        <Text style={[styles.title, { color: C.text }]}>수영장 선택</Text>
        <Text style={[styles.sub, { color: C.textSecondary }]}>
          자녀가 다니는 수영장을 검색하여 선택해주세요.
        </Text>

        {/* 검색 입력 */}
        <View style={[styles.searchRow, { backgroundColor: C.card, borderColor: query ? C.tint : C.border }]}>
          <Feather name="search" size={18} color={query ? C.tint : C.textMuted} />
          <TextInput
            style={[styles.searchInput, { color: C.text }]}
            value={query}
            onChangeText={setQuery}
            placeholder="수영장 이름 또는 지역 입력"
            placeholderTextColor={C.textMuted}
            autoFocus
            returnKeyType="search"
          />
          {!!query && (
            <Pressable onPress={() => setQuery("")} hitSlop={8}>
              <Feather name="x" size={16} color={C.textMuted} />
            </Pressable>
          )}
        </View>

        {/* 안내 배너 */}
        {!query.trim() && (
          <View style={[styles.hintBox, { backgroundColor: C.tintLight }]}>
            <Feather name="info" size={13} color={C.tint} />
            <Text style={[styles.hintTxt, { color: C.tint }]}>
              이름·주소로 검색하거나 아래 목록에서 선택하세요
            </Text>
          </View>
        )}

        {/* 결과 */}
        {pools.length === 0 && query.trim() ? (
          <View style={styles.emptyState}>
            <Feather name="search" size={36} color={C.textMuted} />
            <Text style={[styles.emptyText, { color: C.textSecondary }]}>
              검색 결과가 없습니다.{"\n"}다른 키워드로 검색해보세요.
            </Text>
          </View>
        ) : (
          <FlatList
            data={pools}
            keyExtractor={item => item.id}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ gap: 10, paddingBottom: 40 }}
            renderItem={({ item }) => (
              <Pressable
                style={({ pressed }) => [styles.poolCard, { backgroundColor: C.card, opacity: pressed ? 0.85 : 1 }]}
                onPress={() => selectPool(item.id, item.name)}
              >
                <View style={[styles.poolIcon, { backgroundColor: C.tintLight }]}>
                  <Feather name="droplet" size={18} color={C.tint} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.poolName, { color: C.text }]}>{item.name}</Text>
                  {!!item.address && (
                    <Text style={[styles.poolAddr, { color: C.textMuted }]} numberOfLines={1}>
                      {item.address}
                    </Text>
                  )}
                  {!!item.phone && (
                    <Text style={[styles.poolPhone, { color: C.textMuted }]}>{item.phone}</Text>
                  )}
                </View>
                <Feather name="chevron-right" size={18} color={C.textMuted} />
              </Pressable>
            )}
          />
        )}
      </View>
    </View>
  );
}

function StepBar({ current }: { current: number }) {
  const steps = [1, 2, 3];
  return (
    <View style={sb.row}>
      {steps.map((s, i) => (
        <React.Fragment key={s}>
          {i > 0 && <View style={[sb.line, { backgroundColor: s <= current ? C.tint : C.border }]} />}
          <View style={[sb.dot, { backgroundColor: s < current ? "#2E9B6F" : s === current ? C.tint : C.border }]}>
            {s < current
              ? <Feather name="check" size={12} color="#fff" />
              : <Text style={[sb.dotTxt, { color: s === current ? "#fff" : C.textMuted }]}>{s}</Text>
            }
          </View>
        </React.Fragment>
      ))}
    </View>
  );
}

const sb = StyleSheet.create({
  row:    { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center" },
  dot:    { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  dotTxt: { fontSize: 13, fontFamily: "Inter_700Bold" },
  line:   { flex: 1, height: 2, maxWidth: 40 },
});

const styles = StyleSheet.create({
  root:       { flex: 1 },
  header:     { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingBottom: 8, gap: 16 },
  content:    { flex: 1, paddingHorizontal: 20, paddingTop: 20, gap: 14 },
  title:      { fontSize: 22, fontFamily: "Inter_700Bold" },
  sub:        { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 21 },
  searchRow:  { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1.5, borderRadius: 16, paddingHorizontal: 14, height: 52 },
  searchInput:{ flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  hintBox:    { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 12 },
  hintTxt:    { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1 },
  emptyState: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingTop: 60 },
  emptyText:  { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 22 },
  poolCard:   { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 16, padding: 14, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 1 },
  poolIcon:   { width: 44, height: 44, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  poolName:   { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  poolAddr:   { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  poolPhone:  { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },
});
