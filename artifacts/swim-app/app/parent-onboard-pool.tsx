import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState, useEffect } from "react";
import {
  ActivityIndicator, FlatList, Platform, Pressable, StyleSheet,
  Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";

const C = Colors.light;

interface PoolResult { id: string; name: string; address: string; phone: string; }

export default function ParentOnboardPoolScreen() {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PoolResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [debounce, setDebounce] = useState<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounce) clearTimeout(debounce);
    if (!query.trim()) { setResults([]); return; }
    const t = setTimeout(() => { search(query.trim()); }, 350);
    setDebounce(t);
    return () => clearTimeout(t);
  }, [query]);

  async function search(q: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/pools/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setResults(Array.isArray(data) ? data : []);
    } catch { setResults([]); } finally { setLoading(false); }
  }

  function selectPool(pool: PoolResult) {
    router.push({ pathname: "/parent-onboard-child", params: { pool_id: pool.id, pool_name: pool.name } } as any);
  }

  return (
    <View style={[styles.root, { backgroundColor: C.background }]}>
      {/* 헤더 */}
      <View style={[styles.header, { paddingTop: insets.top + (Platform.OS === "web" ? 68 : 20) }]}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Feather name="arrow-left" size={22} color={C.text} />
        </Pressable>
        <View style={styles.stepRow}>
          <View style={[styles.step, { backgroundColor: C.tint }]}>
            <Text style={styles.stepText}>1</Text>
          </View>
          <View style={[styles.stepLine, { backgroundColor: C.border }]} />
          <View style={[styles.step, { backgroundColor: C.border }]}>
            <Text style={[styles.stepText, { color: C.textMuted }]}>2</Text>
          </View>
          <View style={[styles.stepLine, { backgroundColor: C.border }]} />
          <View style={[styles.step, { backgroundColor: C.border }]}>
            <Text style={[styles.stepText, { color: C.textMuted }]}>3</Text>
          </View>
        </View>
      </View>

      <View style={styles.content}>
        <Text style={[styles.title, { color: C.text }]}>수영장 검색</Text>
        <Text style={[styles.sub, { color: C.textSecondary }]}>
          자녀가 다니는 수영장을 검색해서 선택해주세요.
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
          {loading && <ActivityIndicator size="small" color={C.tint} />}
          {!!query && !loading && (
            <Pressable onPress={() => setQuery("")} hitSlop={8}>
              <Feather name="x" size={16} color={C.textMuted} />
            </Pressable>
          )}
        </View>

        {/* 결과 */}
        {query.trim() && results.length === 0 && !loading ? (
          <View style={styles.emptyState}>
            <Feather name="search" size={36} color={C.textMuted} />
            <Text style={[styles.emptyText, { color: C.textSecondary }]}>
              검색 결과가 없습니다.{"\n"}수영장 이름을 정확히 입력해주세요.
            </Text>
          </View>
        ) : (
          <FlatList
            data={results}
            keyExtractor={item => item.id}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ gap: 10, paddingBottom: 40 }}
            renderItem={({ item }) => (
              <Pressable
                style={({ pressed }) => [styles.poolCard, { backgroundColor: C.card, opacity: pressed ? 0.85 : 1 }]}
                onPress={() => selectPool(item)}
              >
                <View style={[styles.poolIcon, { backgroundColor: C.tintLight }]}>
                  <Feather name="droplet" size={18} color={C.tint} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.poolName, { color: C.text }]}>{item.name}</Text>
                  {!!item.address && (
                    <Text style={[styles.poolAddr, { color: C.textMuted }]} numberOfLines={1}>{item.address}</Text>
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

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingBottom: 8, gap: 16 },
  stepRow: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 0 },
  step: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  stepText: { fontSize: 13, fontFamily: "Inter_700Bold", color: "#fff" },
  stepLine: { flex: 1, height: 2, maxWidth: 40 },
  content: { flex: 1, paddingHorizontal: 20, paddingTop: 20, gap: 12 },
  title: { fontSize: 22, fontFamily: "Inter_700Bold" },
  sub: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 21 },
  searchRow: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1.5, borderRadius: 16, paddingHorizontal: 14, height: 52 },
  searchInput: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  emptyState: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 22 },
  poolCard: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 16, padding: 14, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 1 },
  poolIcon: { width: 44, height: 44, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  poolName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  poolAddr: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
});
