/**
 * 계정별 사용량 — 선생님 리스트 + 사용량
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Modal, Pressable,
  ScrollView, StyleSheet, Text, View,
} from "react-native";
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

interface StaffStorage {
  id: string; name: string; role: string;
  photo_bytes: number; video_bytes: number;
  messenger_bytes: number; diary_bytes: number;
  notice_bytes: number; system_bytes: number; total_bytes: number;
}
interface AdminStorage { quota_bytes: number; staff: StaffStorage[]; [k: string]: any; }

const CAT_ITEMS = [
  { key: "photo_bytes",     icon: "image"          as const, bg: "#E6FAF8", color: "#0F172A", label: "사진"    },
  { key: "video_bytes",     icon: "video"          as const, bg: "#E6FAF8", color: "#0F172A", label: "영상"    },
  { key: "messenger_bytes", icon: "message-square" as const, bg: "#E6FAF8", color: "#0F172A", label: "메신저"  },
  { key: "diary_bytes",     icon: "book-open"      as const, bg: "#E6FAF8", color: "#0F172A", label: "수업기록" },
  { key: "notice_bytes",    icon: "bell"           as const, bg: "#E6FAF8", color: "#0F172A", label: "공지"    },
  { key: "system_bytes",    icon: "cpu"            as const, bg: "#E6FAF8", color: "#0F172A", label: "시스템"  },
];

export default function DataStorageByAccountScreen() {
  const { token } = useAuth();
  const { themeColor } = useBrand();
  const insets = useSafeAreaInsets();
  const [storage, setStorage] = useState<AdminStorage | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<StaffStorage | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest(token, "/admin/storage");
      if (res.ok) setStorage(await res.json());
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const quota = storage?.quota_bytes ?? 5 * 1024 ** 3;
  const staff = storage?.staff ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <SubScreenHeader title="계정별 사용량" />

      {loading ? (
        <ActivityIndicator color={themeColor} style={{ marginTop: 60 }} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}
          showsVerticalScrollIndicator={false}
        >
          {staff.length === 0 ? (
            <View style={{ alignItems: "center", paddingTop: 60, gap: 12 }}>
              <Feather name="users" size={40} color={C.textMuted} />
              <Text style={{ fontSize: 15, fontFamily: "Pretendard-Regular", color: C.textMuted }}>계정 정보가 없습니다</Text>
            </View>
          ) : (
            <View style={[s.card, { backgroundColor: C.card }]}>
              {staff.map((sf, idx) => {
                const pct = quota > 0 ? Math.min(100, (sf.total_bytes / quota) * 100) : 0;
                return (
                  <Pressable
                    key={sf.id}
                    style={({ pressed }) => [
                      s.row,
                      idx < staff.length - 1 && s.rowBorder,
                      { opacity: pressed ? 0.7 : 1 },
                    ]}
                    onPress={() => setSelected(sf)}
                  >
                    <View style={[s.avatar, { backgroundColor: themeColor + "20" }]}>
                      <Text style={[s.avatarText, { color: themeColor }]}>{sf.name[0]}</Text>
                    </View>
                    <View style={{ flex: 1, gap: 4 }}>
                      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                        <Text style={s.name}>{sf.name}</Text>
                        <Text style={s.bytes}>{fmtBytes(sf.total_bytes)}</Text>
                      </View>
                      <View style={s.miniGaugeWrap}>
                        <View style={[s.miniGaugeBar, { width: `${pct}%` as any, backgroundColor: themeColor + "99" }]} />
                      </View>
                      <Text style={s.pctText}>전체 대비 {pct.toFixed(1)}%</Text>
                    </View>
                    <Feather name="chevron-right" size={14} color={C.textMuted} style={{ marginLeft: 8 }} />
                  </Pressable>
                );
              })}
            </View>
          )}
        </ScrollView>
      )}

      {/* 상세 모달 */}
      <Modal visible={!!selected} transparent animationType="slide" onRequestClose={() => setSelected(null)}>
        <Pressable style={sm.overlay} onPress={() => setSelected(null)}>
          <Pressable style={sm.sheet} onPress={e => e.stopPropagation()}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <View>
                <Text style={sm.title}>{selected?.name}</Text>
                <Text style={sm.sub}>{selected?.role === "pool_admin" ? "관리자" : "선생님"} · 저장공간 상세</Text>
              </View>
              <Pressable onPress={() => setSelected(null)} hitSlop={8}>
                <Feather name="x" size={22} color={C.text} />
              </Pressable>
            </View>
            <View style={{ gap: 10 }}>
              {CAT_ITEMS.map(cat => (
                <View key={cat.label} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <View style={[sm.catIcon, { backgroundColor: cat.bg }]}>
                    <Feather name={cat.icon} size={14} color={cat.color} />
                  </View>
                  <Text style={{ flex: 1, fontSize: 14, fontFamily: "Pretendard-Medium", color: C.text }}>{cat.label}</Text>
                  <Text style={{ fontSize: 14, fontFamily: "Pretendard-Bold", color: cat.color }}>{fmtBytes((selected as any)?.[cat.key] ?? 0)}</Text>
                </View>
              ))}
              <View style={[sm.total, { borderColor: themeColor + "30", backgroundColor: themeColor + "08" }]}>
                <Text style={{ fontSize: 14, fontFamily: "Pretendard-SemiBold", color: themeColor }}>합계</Text>
                <Text style={{ fontSize: 18, fontFamily: "Pretendard-Bold", color: themeColor }}>{fmtBytes(selected?.total_bytes ?? 0)}</Text>
              </View>
            </View>
            <Pressable style={sm.closeBtn} onPress={() => setSelected(null)}>
              <Text style={sm.closeBtnText}>닫기</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const sm = StyleSheet.create({
  overlay:     { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", alignItems: "center", padding: 24 },
  sheet:       { backgroundColor: "#fff", borderRadius: 24, padding: 24, width: "100%", gap: 12 },
  title:       { fontSize: 18, fontFamily: "Pretendard-Bold", color: "#111827" },
  sub:         { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#6B7280", marginBottom: 4 },
  catIcon:     { width: 32, height: 32, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  total:       { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 14, borderRadius: 14, borderWidth: 1, marginTop: 4 },
  closeBtn:    { marginTop: 4, height: 46, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "#F8FAFC" },
  closeBtnText:{ fontSize: 15, fontFamily: "Pretendard-SemiBold", color: "#6B7280" },
});

const s = StyleSheet.create({
  card:         { borderRadius: 18, overflow: "hidden", shadowColor: "#00000010", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 6, elevation: 2 },
  row:          { flexDirection: "row", alignItems: "center", gap: 12, padding: 16 },
  rowBorder:    { borderBottomWidth: 1, borderBottomColor: "#F8FAFC" },
  avatar:       { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  avatarText:   { fontSize: 16, fontFamily: "Pretendard-Bold" },
  name:         { fontSize: 14, fontFamily: "Pretendard-SemiBold", color: "#111827" },
  bytes:        { fontSize: 14, fontFamily: "Pretendard-Bold", color: "#111827" },
  miniGaugeWrap:{ height: 5, backgroundColor: "#E5E7EB", borderRadius: 3, overflow: "hidden" },
  miniGaugeBar: { height: 5, borderRadius: 3 },
  pctText:      { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#9CA3AF" },
});
