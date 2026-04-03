/**
 * 내 정보 화면
 * - 이름, 휴대폰번호, 자녀 목록, 수영장 정보, 가입일
 */
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { LucideIcon } from "@/components/common/LucideIcon";
import { ParentScreenHeader } from "@/components/parent/ParentScreenHeader";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useParent } from "@/context/ParentContext";

const C = Colors.light;
const TEAL = "#2EC4B6";
const TEAL_BG = "#E6FAF8";
const NAVY = "#0F172A";
const NAVY_BG = "#EFF2F7";

interface MeData {
  id: string;
  name: string;
  phone: string | null;
  swimming_pool_id: string | null;
  pool_name: string | null;
  pool_address: string | null;
  pool_phone: string | null;
  created_at: string | null;
}

function InfoRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <View style={s.row}>
      <View style={s.rowIcon}>
        <LucideIcon name={icon} size={16} color={TEAL} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[s.rowLabel, { color: C.textMuted }]}>{label}</Text>
        <Text style={[s.rowValue, { color: C.text }]}>{value}</Text>
      </View>
    </View>
  );
}

function SectionCard({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <View style={[s.card, { backgroundColor: C.card }]}>
      <View style={s.cardHeader}>
        <View style={[s.cardIconWrap, { backgroundColor: TEAL_BG }]}>
          <LucideIcon name={icon} size={15} color={TEAL} />
        </View>
        <Text style={[s.cardTitle, { color: C.text }]}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

function formatPhone(phone: string | null) {
  if (!phone) return "—";
  const n = phone.replace(/[^0-9]/g, "");
  if (n.length === 11) return `${n.slice(0, 3)}-${n.slice(3, 7)}-${n.slice(7)}`;
  if (n.length === 10) return `${n.slice(0, 3)}-${n.slice(3, 6)}-${n.slice(6)}`;
  return phone;
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return "—";
  try {
    const d = new Date(dateStr);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}년 ${m}월 ${day}일`;
  } catch { return "—"; }
}

export default function MyInfoScreen() {
  const insets = useSafeAreaInsets();
  const { token, parentPoolName } = useAuth();
  const { students } = useParent();
  const [me, setMe] = useState<MeData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const r = await apiRequest(token, "/parent/me");
        if (r.ok) setMe(await r.json());
      } catch {} finally { setLoading(false); }
    })();
  }, []);

  const poolName = me?.pool_name || parentPoolName || "—";
  const poolAddress = me?.pool_address || "—";
  const poolPhone = me?.pool_phone ? formatPhone(me.pool_phone) : "—";

  return (
    <View style={[s.root, { backgroundColor: C.background }]}>
      <ParentScreenHeader title="내 정보" onBack={() => router.back()} />

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={TEAL} />
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: insets.bottom + 40, gap: 12 }}
        >
          {/* 아바타 헤더 */}
          <View style={[s.avatarCard, { backgroundColor: TEAL }]}>
            <View style={s.avatar}>
              <Text style={s.avatarTxt}>{me?.name?.[0] ?? "?"}</Text>
            </View>
            <Text style={s.avatarName}>{me?.name ?? ""}님</Text>
            <Text style={s.avatarSub}>{poolName}</Text>
          </View>

          {/* 계정 정보 */}
          <SectionCard title="계정 정보" icon="user">
            <InfoRow icon="user" label="이름" value={me?.name ?? "—"} />
            <View style={s.divider} />
            <InfoRow icon="phone" label="휴대폰 번호" value={formatPhone(me?.phone ?? null)} />
            <View style={s.divider} />
            <InfoRow icon="calendar" label="가입일" value={formatDate(me?.created_at ?? null)} />
          </SectionCard>

          {/* 자녀 정보 */}
          <SectionCard title="등록된 자녀" icon="users">
            {students.length === 0 ? (
              <Text style={[s.emptyTxt, { color: C.textMuted }]}>연결된 자녀가 없습니다.</Text>
            ) : (
              students.map((st, i) => (
                <React.Fragment key={st.id}>
                  {i > 0 && <View style={s.divider} />}
                  <View style={s.childRow}>
                    <View style={[s.childBadge, { backgroundColor: TEAL_BG }]}>
                      <Text style={[s.childBadgeTxt, { color: TEAL }]}>{st.name?.[0] ?? "?"}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[s.childName, { color: C.text }]}>{st.name}</Text>
                      {(st as any).class_name ? (
                        <Text style={[s.childSub, { color: C.textMuted }]}>{(st as any).class_name}</Text>
                      ) : null}
                    </View>
                  </View>
                </React.Fragment>
              ))
            )}
          </SectionCard>

          {/* 수영장 정보 */}
          <SectionCard title="등록된 수영장" icon="building-2">
            <InfoRow icon="building-2" label="수영장 이름" value={poolName} />
            <View style={s.divider} />
            <InfoRow icon="map-pin" label="주소" value={poolAddress} />
            <View style={s.divider} />
            <InfoRow icon="phone" label="전화번호" value={poolPhone} />
          </SectionCard>

          {/* 내 정보 수정 버튼 */}
          <Pressable
            style={({ pressed }) => [s.editBtn, { backgroundColor: TEAL, opacity: pressed ? 0.8 : 1 }]}
            onPress={() => router.push("/(parent)/parent-profile?backTo=my-info" as any)}
          >
            <LucideIcon name="pencil" size={16} color="#fff" />
            <Text style={s.editBtnTxt}>내 정보 수정</Text>
          </Pressable>
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },

  avatarCard: {
    borderRadius: 20, padding: 28, alignItems: "center", gap: 6,
    marginBottom: 4,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08, shadowRadius: 8, elevation: 3,
  },
  avatar: {
    width: 64, height: 64, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.25)",
    alignItems: "center", justifyContent: "center", marginBottom: 4,
  },
  avatarTxt: { fontSize: 28, color: "#fff", fontFamily: "Pretendard-Regular" },
  avatarName: { fontSize: 20, color: "#fff", fontFamily: "Pretendard-Regular" },
  avatarSub: { fontSize: 13, color: "rgba(255,255,255,0.75)", fontFamily: "Pretendard-Regular" },

  card: {
    borderRadius: 16, padding: 16,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 3, elevation: 1,
  },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  cardIconWrap: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  cardTitle: { fontSize: 13, fontFamily: "Pretendard-Regular", letterSpacing: 0.2 },

  row: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 4 },
  rowIcon: { width: 28, height: 28, alignItems: "center", justifyContent: "center" },
  rowLabel: { fontSize: 11, fontFamily: "Pretendard-Regular", marginBottom: 2 },
  rowValue: { fontSize: 14, fontFamily: "Pretendard-Regular" },

  divider: { height: 1, backgroundColor: "rgba(0,0,0,0.04)", marginVertical: 6 },

  emptyTxt: { fontSize: 13, fontFamily: "Pretendard-Regular", textAlign: "center", paddingVertical: 8 },

  childRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 },
  childBadge: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  childBadgeTxt: { fontSize: 15, fontFamily: "Pretendard-Regular" },
  childName: { fontSize: 14, fontFamily: "Pretendard-Regular" },
  childSub: { fontSize: 12, fontFamily: "Pretendard-Regular", marginTop: 1 },

  editBtn: {
    borderRadius: 14, paddingVertical: 14, flexDirection: "row",
    alignItems: "center", justifyContent: "center", gap: 8, marginTop: 4,
  },
  editBtnTxt: { fontSize: 15, color: "#fff", fontFamily: "Pretendard-Regular" },
});
