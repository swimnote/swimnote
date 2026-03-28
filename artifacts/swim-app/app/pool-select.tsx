import { ChevronRight, CircleAlert, Droplet, Layers, LogOut } from "lucide-react-native";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, Pressable, ScrollView,
  StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { useAuth, type OwnedPool } from "@/context/AuthContext";

const C = Colors.light;
const TINT = "#2EC4B6";

export default function PoolSelectScreen() {
  const insets = useSafeAreaInsets();
  const { loadOwnedPools, ownedPools, switchPool, logout, setLastUsedTenant, pool: currentPool } = useAuth();

  const [loading, setLoading] = useState(true);
  const [selecting, setSelecting] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      await loadOwnedPools();
      setLoading(false);
    })();
  }, []);

  async function handleSelect(p: OwnedPool) {
    setSelecting(p.id); setError("");
    try {
      if (p.id !== currentPool?.id) {
        await switchPool(p.id);
      }
      await setLastUsedTenant(p.id);
      router.replace("/(admin)/dashboard" as any);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "수영장 전환 중 오류가 발생했습니다.");
      setSelecting(null);
    }
  }

  const statusLabel = (s: string) => {
    const MAP: Record<string, string> = { trial: "체험", active: "구독중", expired: "만료", suspended: "정지", cancelled: "해지" };
    return MAP[s] ?? s;
  };
  const statusColor = (s: string) => {
    if (s === "active") return "#15803D";
    if (s === "trial") return TINT;
    return "#94928F";
  };

  return (
    <View style={[styles.root, { backgroundColor: C.background }]}>
      {/* 헤더 */}
      <View style={[styles.header, { paddingTop: insets.top + 20 }]}>
        <View style={[styles.logoBox, { backgroundColor: "#E8F7F6" }]}>
          <Layers size={28} color={TINT} />
        </View>
        <Text style={[styles.title, { color: C.text }]}>수영장 선택</Text>
        <Text style={[styles.subtitle, { color: C.textSecondary }]}>
          관리할 수영장을 선택해 주세요
        </Text>
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={TINT} size="large" />
          <Text style={[styles.loadingTxt, { color: C.textMuted }]}>수영장 목록을 불러오는 중...</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
        >
          {error ? (
            <View style={[styles.errorBox, { backgroundColor: "#FEF2F2", borderColor: "#FECACA" }]}>
              <CircleAlert size={16} color="#DC2626" />
              <Text style={[styles.errorTxt, { color: "#DC2626" }]}>{error}</Text>
            </View>
          ) : null}

          {ownedPools.map((p) => {
            const isSelecting = selecting === p.id;
            const isCurrent = p.id === currentPool?.id;
            return (
              <Pressable
                key={p.id}
                onPress={() => handleSelect(p)}
                disabled={!!selecting}
                style={({ pressed }) => [
                  styles.poolCard,
                  {
                    backgroundColor: C.card,
                    borderColor: isCurrent ? TINT : C.border,
                    borderWidth: isCurrent ? 2 : 1,
                    opacity: pressed ? 0.88 : 1,
                  },
                ]}
              >
                <View style={[styles.poolIcon, { backgroundColor: isCurrent ? "#E8F7F6" : "#F3F0EE" }]}>
                  {p.logo_emoji ? (
                    <Text style={styles.emoji}>{p.logo_emoji}</Text>
                  ) : (
                    <Droplet size={24} color={isCurrent ? TINT : C.textMuted} />
                  )}
                </View>

                <View style={styles.poolInfo}>
                  <View style={styles.nameLine}>
                    <Text style={[styles.poolName, { color: C.text }]} numberOfLines={1}>{p.name}</Text>
                    {isCurrent && (
                      <View style={[styles.currentBadge, { backgroundColor: TINT }]}>
                        <Text style={styles.currentBadgeTxt}>현재</Text>
                      </View>
                    )}
                    {p.is_primary && (
                      <View style={[styles.primaryBadge, { borderColor: TINT }]}>
                        <Text style={[styles.primaryBadgeTxt, { color: TINT }]}>기본</Text>
                      </View>
                    )}
                  </View>
                  <View style={styles.meta}>
                    <View style={[styles.statusPill, { backgroundColor: statusColor(p.subscription_status) + "22" }]}>
                      <Text style={[styles.statusTxt, { color: statusColor(p.subscription_status) }]}>
                        {statusLabel(p.subscription_status)}
                      </Text>
                    </View>
                    {p.address ? (
                      <Text style={[styles.address, { color: C.textMuted }]} numberOfLines={1}>
                        {p.address}
                      </Text>
                    ) : null}
                  </View>
                </View>

                <View style={styles.arrow}>
                  {isSelecting ? (
                    <ActivityIndicator size="small" color={TINT} />
                  ) : (
                    <ChevronRight size={22} color={isCurrent ? TINT : C.textMuted} />
                  )}
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      {/* 로그아웃 */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <Pressable
          onPress={() => { logout(); router.replace("/"); }}
          style={styles.logoutBtn}
        >
          <LogOut size={15} color={C.textMuted} />
          <Text style={[styles.logoutTxt, { color: C.textMuted }]}>다른 계정으로 로그인</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { alignItems: "center", paddingHorizontal: 32, paddingBottom: 28, gap: 10 },
  logoBox: { width: 70, height: 70, borderRadius: 22, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  title: { fontSize: 26, fontFamily: "Pretendard-Regular", textAlign: "center" },
  subtitle: { fontSize: 15, fontFamily: "Pretendard-Regular", textAlign: "center", lineHeight: 22 },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14 },
  loadingTxt: { fontSize: 14, fontFamily: "Pretendard-Regular" },
  list: { paddingHorizontal: 20, gap: 14, paddingTop: 4 },
  errorBox: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 12, borderWidth: 1 },
  errorTxt: { flex: 1, fontSize: 13, fontFamily: "Pretendard-Regular" },
  poolCard: {
    flexDirection: "row", alignItems: "center", gap: 14,
    borderRadius: 18, padding: 16,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 6, elevation: 2,
  },
  poolIcon: { width: 52, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  emoji: { fontSize: 26 },
  poolInfo: { flex: 1, gap: 6 },
  nameLine: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  poolName: { fontSize: 17, fontFamily: "Pretendard-Regular", flexShrink: 1 },
  currentBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  currentBadgeTxt: { color: "#fff", fontSize: 11, fontFamily: "Pretendard-Regular" },
  primaryBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, borderWidth: 1 },
  primaryBadgeTxt: { fontSize: 11, fontFamily: "Pretendard-Regular" },
  meta: { flexDirection: "row", alignItems: "center", gap: 8 },
  statusPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  statusTxt: { fontSize: 11, fontFamily: "Pretendard-Regular" },
  address: { fontSize: 12, fontFamily: "Pretendard-Regular", flex: 1 },
  arrow: { width: 30, alignItems: "center" },
  footer: { alignItems: "center", paddingTop: 10 },
  logoutBtn: { flexDirection: "row", alignItems: "center", gap: 6, padding: 10 },
  logoutTxt: { fontSize: 14, fontFamily: "Pretendard-Regular" },
});
