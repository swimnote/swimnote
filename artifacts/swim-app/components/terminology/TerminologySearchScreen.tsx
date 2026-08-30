/**
 * TerminologySearchScreen — 공통 수영·훈련용어 검색 화면
 *
 * Parent / Teacher 모두 이 컴포넌트를 사용.
 * 역할별 route 파일에서 role prop을 넘겨 네비게이션 경로를 결정.
 */

import React, { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { LucideIcon } from "@/components/common/LucideIcon";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { apiRequest, useAuth } from "@/context/AuthContext";
import Colors from "@/constants/colors";
import { TerminologyResultCard, type TermSearchResult } from "./TerminologyResultCard";

const C    = Colors.light;
const NAVY = "#0C1A2E";

type Role = "parent" | "teacher";

interface Props {
  role: Role;
}

function detailPath(role: Role): string {
  return role === "parent"
    ? "/(parent)/terminology-detail"
    : "/(teacher)/terminology-detail";
}

// ─── main component ───────────────────────────────────────────────────────────

export function TerminologySearchScreen({ role }: Props) {
  const insets      = useSafeAreaInsets();
  const { token }   = useAuth();

  const [query, setQuery]       = useState("");
  const [results, setResults]   = useState<TermSearchResult[]>([]);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef    = useRef<AbortController | null>(null);

  const doSearch = useCallback(async (q: string) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setLoading(true);
    setError(null);

    try {
      const res = await apiRequest(token, `/terminology/search?q=${encodeURIComponent(q)}&limit=30`);
      if (ac.signal.aborted) return;
      if (res.ok) {
        const data = await res.json();
        setResults(data.results ?? []);
        setSearched(true);
      } else {
        setError("검색 중 오류가 발생했습니다. 다시 시도해 주세요.");
        setResults([]);
      }
    } catch {
      if (!ac.signal.aborted) {
        setError("검색 중 오류가 발생했습니다. 다시 시도해 주세요.");
        setResults([]);
      }
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, [token]);

  const onChangeText = useCallback(
    (text: string) => {
      setQuery(text);

      if (debounceRef.current) clearTimeout(debounceRef.current);

      if (!text.trim()) {
        abortRef.current?.abort();
        setResults([]);
        setLoading(false);
        setError(null);
        setSearched(false);
        return;
      }

      debounceRef.current = setTimeout(() => {
        doSearch(text.trim());
      }, 300);
    },
    [doSearch],
  );

  const onClear = useCallback(() => {
    setQuery("");
    setResults([]);
    setLoading(false);
    setError(null);
    setSearched(false);
    abortRef.current?.abort();
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  const onCardPress = useCallback(
    (termId: string) => {
      Keyboard.dismiss();
      router.push({
        pathname: detailPath(role) as any,
        params: { termId },
      });
    },
    [role],
  );

  // ── Render body ─────────────────────────────────────────────────────────────

  function renderBody() {
    if (loading) {
      return (
        <View style={styles.center}>
          <ActivityIndicator size="small" color={NAVY} />
        </View>
      );
    }

    if (error) {
      return (
        <View style={styles.center}>
          <LucideIcon name="alert-circle" size={36} color={C.textMuted} />
          <Text style={styles.emptyText}>{error}</Text>
          <Pressable
            style={styles.retryBtn}
            onPress={() => { if (query.trim()) doSearch(query.trim()); }}
          >
            <Text style={styles.retryText}>다시 시도</Text>
          </Pressable>
        </View>
      );
    }

    if (!query.trim() || !searched) {
      return (
        <View style={styles.center}>
          <LucideIcon name="search" size={40} color={C.border} />
          <Text style={styles.hintText}>수영·훈련용어를 검색해보세요</Text>
        </View>
      );
    }

    if (results.length === 0) {
      return (
        <View style={styles.center}>
          <LucideIcon name="file-x" size={36} color={C.textMuted} />
          <Text style={styles.emptyText}>검색 결과가 없습니다.</Text>
        </View>
      );
    }

    return (
      <FlatList
        data={results}
        keyExtractor={(item) => item.term_id}
        renderItem={({ item }) => (
          <TerminologyResultCard item={item} onPress={onCardPress} />
        )}
        contentContainerStyle={[
          styles.list,
          { paddingBottom: insets.bottom + 24 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      />
    );
  }

  // ── Layout ──────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <SubScreenHeader title="수영·훈련용어 검색" showHome={false} />

      {/* 검색창 */}
      <View style={styles.searchBar}>
        <LucideIcon name="search" size={18} color={C.textMuted} />
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={onChangeText}
          placeholder="수영·훈련용어를 검색해보세요"
          placeholderTextColor={C.textMuted}
          autoFocus
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          onSubmitEditing={() => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
            if (query.trim()) doSearch(query.trim());
          }}
        />
        {query.length > 0 && (
          <Pressable onPress={onClear} hitSlop={8}>
            <LucideIcon name="x-circle" size={18} color={C.textMuted} />
          </Pressable>
        )}
      </View>

      {renderBody()}
    </SafeAreaView>
  );
}

// ─── styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: C.background,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === "ios" ? 11 : 8,
    gap: 8,
  },
  input: {
    flex: 1,
    fontSize: 15,
    fontFamily: "Pretendard-Regular",
    color: NAVY,
    padding: 0,
  },
  list: {
    paddingHorizontal: 16,
    paddingTop: 4,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 12,
  },
  hintText: {
    fontSize: 14,
    fontFamily: "Pretendard-Regular",
    color: C.textMuted,
    textAlign: "center",
  },
  emptyText: {
    fontSize: 14,
    fontFamily: "Pretendard-Regular",
    color: C.textMuted,
    textAlign: "center",
  },
  retryBtn: {
    marginTop: 4,
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: NAVY,
  },
  retryText: {
    fontSize: 14,
    fontFamily: "Pretendard-Medium",
    color: "#FFFFFF",
  },
});
