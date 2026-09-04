import { LucideIcon } from "@/components/common/LucideIcon";
import { router } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, FlatList, Platform, Pressable,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { API_BASE, useAuth } from "@/context/AuthContext";

const C = Colors.light;

interface Pool { id: string; name: string; address?: string; }
type PoolSearchState = "idle" | "loading" | "loaded" | "empty" | "error";

export default function ParentLoginScreen() {
  const { parentLogin } = useAuth();
  const insets = useSafeAreaInsets();

  // ── Pool selection ──────────────────────────────────
  const [poolSearch, setPoolSearch] = useState("");
  const [pools, setPools] = useState<Pool[]>([]);
  const [selectedPool, setSelectedPool] = useState<Pool | null>(null);
  const [poolSearchState, setPoolSearchState] = useState<PoolSearchState>("idle");
  const poolSearchAbortRef = useRef<AbortController | null>(null);
  const poolSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Credentials ─────────────────────────────────────
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Pool search debounce
  useEffect(() => {
    const q = poolSearch.trim();
    if (!q) {
      if (poolSearchAbortRef.current) { poolSearchAbortRef.current.abort(); poolSearchAbortRef.current = null; }
      if (poolSearchTimerRef.current) clearTimeout(poolSearchTimerRef.current);
      setPools([]);
      setPoolSearchState("idle");
      return;
    }
    setPoolSearchState("loading");
    if (poolSearchTimerRef.current) clearTimeout(poolSearchTimerRef.current);
    poolSearchTimerRef.current = setTimeout(async () => {
      if (poolSearchAbortRef.current) poolSearchAbortRef.current.abort();
      const ctrl = new AbortController();
      poolSearchAbortRef.current = ctrl;
      try {
        const res = await fetch(`${API_BASE}/pools/public-search?name=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        if (ctrl.signal.aborted) return;
        const d = await res.json();
        if (ctrl.signal.aborted) return;
        if (d.success && Array.isArray(d.data)) {
          setPools(d.data);
          setPoolSearchState(d.data.length > 0 ? "loaded" : "empty");
        } else {
          setPools([]); setPoolSearchState("empty");
        }
      } catch (e: any) {
        if (e?.name === "AbortError") return;
        setPools([]); setPoolSearchState("error");
      }
    }, 350);
  }, [poolSearch]);

  function selectPool(pool: Pool) {
    setSelectedPool(pool);
    setPoolSearch(pool.name);
    setPools([]);
    setPoolSearchState("idle");
    setError("");
  }

  function clearPool() {
    setSelectedPool(null);
    setPoolSearch("");
    setPools([]);
    setPoolSearchState("idle");
    setIdentifier("");
    setPassword("");
    setError("");
  }

  async function handleLogin() {
    if (!selectedPool) { setError("수영장을 먼저 선택해주세요."); return; }
    if (!identifier.trim()) { setError("아이디 또는 전화번호를 입력해주세요."); return; }
    if (password.length < 4) { setError("비밀번호는 4자리 이상이어야 합니다."); return; }
    setLoading(true); setError("");
    try {
      await parentLogin(identifier.trim(), password, selectedPool.id);
    } catch (err: unknown) {
      const e = err as Error & { error_code?: string };
      if (e.error_code === "pending_pool_request") {
        setError("가입 요청이 승인 대기 중입니다.\n수영장 관리자 승인 후 로그인 가능합니다.");
      } else {
        setError(e.message || "로그인에 실패했습니다.");
      }
    } finally { setLoading(false); }
  }

  return (
    <View style={[styles.root, { backgroundColor: C.background }]}>
      <KeyboardAwareScrollView
        contentContainerStyle={[styles.container, {
          paddingTop: insets.top + (Platform.OS === "web" ? 67 : 24),
          paddingBottom: insets.bottom + 40,
        }]}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable onPress={() => router.back()} style={styles.back}>
          <LucideIcon name="arrow-left" size={22} color={C.text} />
        </Pressable>

        <View style={styles.header}>
          <View style={[styles.iconBox, { backgroundColor: C.brandSoft }]}>
            <LucideIcon name="user" size={30} color={C.success} />
          </View>
          <Text style={[styles.title, { color: C.text }]}>학부모 로그인</Text>
          <Text style={[styles.sub, { color: C.textSecondary }]}>
            먼저 수영장을 선택하고{"\n"}아이디(또는 전화번호)와 비밀번호로 로그인하세요
          </Text>
        </View>

        <View style={[styles.card, { backgroundColor: C.card }]}>
          {!!error && (
            <View style={[styles.errBox, { backgroundColor: "#F9DEDA" }]}>
              <LucideIcon name="alert-circle" size={14} color={C.error} />
              <Text style={[styles.errText, { color: C.error }]}>{error}</Text>
            </View>
          )}

          {/* ── 수영장 선택 ── */}
          <View style={styles.field}>
            <Text style={[styles.label, { color: C.textSecondary }]}>수영장 선택</Text>

            {selectedPool ? (
              <Pressable
                style={[styles.selectedPool, { borderColor: C.brandStrong, backgroundColor: "#EFF4FF" }]}
                onPress={clearPool}
              >
                <LucideIcon name="building-2" size={16} color={C.brandStrong} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.poolName, { color: C.brandStrong }]}>{selectedPool.name}</Text>
                  {selectedPool.address
                    ? <Text style={[styles.poolAddr, { color: C.textMuted }]}>{selectedPool.address}</Text>
                    : null}
                </View>
                <LucideIcon name="x" size={16} color={C.textMuted} />
              </Pressable>
            ) : (
              <View>
                <View style={[styles.inputRow, { borderColor: poolSearch ? C.brandStrong : C.border, backgroundColor: C.background }]}>
                  <LucideIcon name="search" size={16} color={poolSearch ? C.brandStrong : C.textMuted} />
                  <TextInput
                    style={[styles.input, { color: C.text }]}
                    value={poolSearch}
                    onChangeText={v => { setPoolSearch(v); setSelectedPool(null); }}
                    placeholder="수영장 이름으로 검색"
                    placeholderTextColor={C.textMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="search"
                  />
                  {poolSearchState === "loading" && <ActivityIndicator size="small" color={C.textMuted} />}
                </View>

                {poolSearchState === "loaded" && pools.length > 0 && (
                  <View style={[styles.poolDropdown, { borderColor: C.border, backgroundColor: C.card }]}>
                    <FlatList
                      data={pools}
                      keyExtractor={p => p.id}
                      scrollEnabled={false}
                      ItemSeparatorComponent={() => <View style={[styles.separator, { backgroundColor: C.border }]} />}
                      renderItem={({ item }) => (
                        <Pressable
                          style={({ pressed }) => [styles.poolItem, { opacity: pressed ? 0.7 : 1 }]}
                          onPress={() => selectPool(item)}
                        >
                          <LucideIcon name="building-2" size={14} color={C.textMuted} />
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.poolItemName, { color: C.text }]}>{item.name}</Text>
                            {item.address
                              ? <Text style={[styles.poolItemAddr, { color: C.textMuted }]}>{item.address}</Text>
                              : null}
                          </View>
                        </Pressable>
                      )}
                    />
                  </View>
                )}
                {poolSearchState === "empty" && (
                  <Text style={[styles.poolHint, { color: C.textMuted }]}>검색 결과가 없습니다.</Text>
                )}
              </View>
            )}
          </View>

          {/* ── 아이디 / 비밀번호 (수영장 선택 후 표시) ── */}
          {selectedPool && (
            <>
              <View style={styles.field}>
                <Text style={[styles.label, { color: C.textSecondary }]}>아이디 또는 전화번호</Text>
                <View style={[styles.inputRow, { borderColor: C.border, backgroundColor: C.background }]}>
                  <LucideIcon name="user" size={16} color={C.textMuted} />
                  <TextInput
                    style={[styles.input, { color: C.text }]}
                    value={identifier}
                    onChangeText={v => { setIdentifier(v); setError(""); }}
                    placeholder="아이디 또는 010-0000-0000"
                    placeholderTextColor={C.textMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="next"
                    autoFocus
                  />
                </View>
              </View>

              <View style={styles.field}>
                <Text style={[styles.label, { color: C.textSecondary }]}>비밀번호</Text>
                <View style={[styles.inputRow, { borderColor: C.border, backgroundColor: C.background }]}>
                  <LucideIcon name="lock" size={16} color={C.textMuted} />
                  <TextInput
                    style={[styles.input, { color: C.text }]}
                    value={password}
                    onChangeText={v => { setPassword(v); setError(""); }}
                    placeholder="비밀번호 입력"
                    placeholderTextColor={C.textMuted}
                    secureTextEntry={!showPw}
                    returnKeyType="done"
                    onSubmitEditing={handleLogin}
                  />
                  <Pressable onPress={() => setShowPw(v => !v)} hitSlop={10}>
                    <LucideIcon name={showPw ? "eye-off" : "eye"} size={16} color={C.textMuted} />
                  </Pressable>
                </View>
              </View>

              <Pressable
                style={({ pressed }) => [styles.btn, { backgroundColor: pressed ? C.textStrong : C.primaryAction }]}
                onPress={handleLogin}
                disabled={loading}
              >
                {loading ? <ActivityIndicator color="#fff" size="small" /> : (
                  <View style={styles.btnContent}>
                    <LucideIcon name="log-in" size={18} color="#fff" />
                    <Text style={styles.btnText}>로그인</Text>
                  </View>
                )}
              </Pressable>
            </>
          )}
        </View>

        <Pressable
          style={({ pressed }) => [styles.joinRequestBtn, { backgroundColor: C.card, borderColor: C.border, opacity: pressed ? 0.8 : 1 }]}
          onPress={() => router.push("/pool-join-request" as any)}
        >
          <View style={[styles.joinIconBox, { backgroundColor: C.brandSoft }]}>
            <LucideIcon name="user-plus" size={18} color={C.brandStrong} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.joinBtnTitle, { color: C.text }]}>수영장 가입 요청</Text>
            <Text style={[styles.joinBtnSub, { color: C.textSecondary }]}>수영장을 검색하고 가입 요청을 보내세요</Text>
          </View>
          <LucideIcon name="chevron-right" size={18} color={C.textMuted} />
        </Pressable>
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  container: { flexGrow: 1, paddingHorizontal: 24, gap: 24 },
  back: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  header: { alignItems: "center", gap: 12 },
  iconBox: { width: 72, height: 72, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 24, fontFamily: "Pretendard-Regular" },
  sub: { fontSize: 14, fontFamily: "Pretendard-Regular", textAlign: "center", lineHeight: 22 },
  card: {
    borderRadius: 18, padding: 22, gap: 16,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 12, elevation: 3,
  },
  errBox: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 10 },
  errText: { fontSize: 13, fontFamily: "Pretendard-Regular", flex: 1 },
  field: { gap: 6 },
  label: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  inputRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 12, height: 50,
  },
  input: { flex: 1, fontSize: 16, fontFamily: "Pretendard-Regular" },
  selectedPool: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderWidth: 1.5, borderRadius: 12, padding: 12,
  },
  poolName: { fontSize: 14, fontFamily: "Pretendard-Regular" },
  poolAddr: { fontSize: 11, fontFamily: "Pretendard-Regular", marginTop: 1 },
  poolDropdown: {
    borderWidth: 1, borderRadius: 12, marginTop: 4,
    overflow: "hidden",
  },
  poolItem: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 12, paddingVertical: 10,
  },
  poolItemName: { fontSize: 14, fontFamily: "Pretendard-Regular" },
  poolItemAddr: { fontSize: 11, fontFamily: "Pretendard-Regular", marginTop: 1 },
  separator: { height: 1 },
  poolHint: { fontSize: 12, fontFamily: "Pretendard-Regular", textAlign: "center", marginTop: 4 },
  btn: { height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  btnContent: { flexDirection: "row", alignItems: "center", gap: 8 },
  btnText: { color: "#fff", fontSize: 16, fontFamily: "Pretendard-Regular" },
  joinRequestBtn: {
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: 16, borderRadius: 16, borderWidth: 1.5,
  },
  joinIconBox: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  joinBtnTitle: { fontSize: 14, fontFamily: "Pretendard-Regular" },
  joinBtnSub: { fontSize: 12, fontFamily: "Pretendard-Regular", marginTop: 2 },
});
