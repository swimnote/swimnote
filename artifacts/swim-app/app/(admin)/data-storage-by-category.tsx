/**
 * 카테고리별 사용량 — 사진 · 영상 · 메신저 · 기록 분류
 */
import { LucideIcon } from "@/components/common/LucideIcon";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";

const C = Colors.light;

function fmtBytes(b: number) {
  if (b === 0) return "0 B";
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}

interface AdminStorage {
  total_bytes: number; quota_bytes: number;
  photo_bytes: number; video_bytes: number;
  messenger_bytes: number; diary_bytes: number;
  notice_bytes: number; system_bytes: number;
}

const CATEGORIES = [
  { key: "photo_bytes",     icon: "image"          as const, bg: "#E6FAF8", color: "#0F172A", label: "사진"    },
  { key: "video_bytes",     icon: "video"          as const, bg: "#E6FAF8", color: "#0F172A", label: "영상"    },
  { key: "messenger_bytes", icon: "message-square" as const, bg: "#E6FAF8", color: "#0F172A", label: "메신저"  },
  { key: "diary_bytes",     icon: "book-open"      as const, bg: "#E6FAF8", color: "#0F172A", label: "수업기록" },
  { key: "notice_bytes",    icon: "bell"           as const, bg: "#E6FAF8", color: "#0F172A", label: "공지"    },
  { key: "system_bytes",    icon: "cpu"            as const, bg: "#E6FAF8", color: "#0F172A", label: "시스템"  },
];

export default function DataStorageByCategoryScreen() {
  const { token } = useAuth();
  const { themeColor } = useBrand();
  const insets = useSafeAreaInsets();
  const [storage, setStorage] = useState<AdminStorage | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest(token, "/admin/storage");
      if (res.ok) setStorage(await res.json());
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const total = storage?.total_bytes ?? 0;

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <SubScreenHeader title="카테고리별 사용량" />

      {loading ? (
        <ActivityIndicator color={themeColor} style={{ marginTop: 60 }} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: insets.bottom + 32 }}
          showsVerticalScrollIndicator={false}
        >
          {CATEGORIES.map(cat => {
            const bytes = (storage as any)?.[cat.key] ?? 0;
            const pct = total > 0 ? Math.min(100, (bytes / total) * 100) : 0;
            return (
              <View key={cat.label} style={[s.card, { backgroundColor: C.card }]}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
                  <View style={[s.iconWrap, { backgroundColor: cat.bg }]}>
                    <LucideIcon name={cat.icon} size={20} color={cat.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <Text style={s.label}>{cat.label}</Text>
                      <Text style={[s.bytes, { color: cat.color }]}>{fmtBytes(bytes)}</Text>
                    </View>
                    <View style={s.gaugeWrap}>
                      <View style={[s.gaugeBar, { width: `${pct}%` as any, backgroundColor: cat.color }]} />
                    </View>
                    <Text style={s.pct}>{pct.toFixed(1)}% of 전체</Text>
                  </View>
                </View>
              </View>
            );
          })}

          {/* 합계 */}
          <View style={[s.totalCard, { borderColor: themeColor + "30", backgroundColor: themeColor + "08" }]}>
            <Text style={{ fontSize: 14, fontFamily: "Pretendard-Regular", color: themeColor }}>전체 합계</Text>
            <Text style={{ fontSize: 22, fontFamily: "Pretendard-Regular", color: themeColor }}>{fmtBytes(total)}</Text>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  card:      { borderRadius: 16, padding: 16, shadowColor: "#00000010", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 6, elevation: 2 },
  iconWrap:  { width: 44, height: 44, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  label:     { fontSize: 15, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  bytes:     { fontSize: 15, fontFamily: "Pretendard-Regular" },
  gaugeWrap: { height: 8, backgroundColor: "#E5E7EB", borderRadius: 4, overflow: "hidden" },
  gaugeBar:  { height: 8, borderRadius: 4 },
  pct:       { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B", marginTop: 4 },
  totalCard: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, borderRadius: 16, borderWidth: 1 },
});
