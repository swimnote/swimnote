/**
 * 학부모 교육 프로그램
 * - 수영장 교육 프로그램 (관리자 작성, 학부모 읽기 전용)
 * - 미작성 시 "준비 중" 안내
 * - ParentScreenHeader (홈 버튼 → 학부모 홈)
 */
import { Award } from "lucide-react-native";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { ParentScreenHeader } from "@/components/parent/ParentScreenHeader";
import { apiRequest, useAuth } from "@/context/AuthContext";

const C = Colors.light;

interface Program {
  id: string; title: string; content: string;
  author_name: string; updated_at: string;
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });
}

export default function ParentProgramScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const [program, setProgram] = useState<Program | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const r = await apiRequest(token, "/parent/program");
        if (r.ok) { const data = await r.json(); setProgram(data); }
      } catch {}
      finally { setLoading(false); }
    })();
  }, []);

  return (
    <View style={[s.root, { backgroundColor: C.background }]}>
      <ParentScreenHeader title="교육 프로그램" />

      {loading ? (
        <ActivityIndicator color={C.tint} style={{ marginTop: 40 }} />
      ) : program ? (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40, gap: 16 }}
        >
          <View style={[s.card, { backgroundColor: C.card }]}>
            <View style={s.cardTop}>
              <View style={[s.iconBox, { backgroundColor: "#F0F9FF" }]}>
                <Award size={24} color="#0EA5E9" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.cardTitle, { color: C.text }]}>{program.title}</Text>
                <Text style={[s.cardMeta, { color: C.textMuted }]}>
                  {program.author_name} · {fmtDate(program.updated_at)}
                </Text>
              </View>
            </View>
            <View style={[s.divider, { backgroundColor: C.border }]} />
            <Text style={[s.content, { color: C.text }]}>{program.content}</Text>
          </View>
        </ScrollView>
      ) : (
        <View style={s.emptyWrap}>
          <View style={[s.emptyIcon, { backgroundColor: "#F0F9FF" }]}>
            <Award size={44} color="#BAE6FD" />
          </View>
          <Text style={[s.emptyTitle, { color: C.text }]}>교육 프로그램 준비 중</Text>
          <Text style={[s.emptyBody, { color: C.textSecondary }]}>
            수영장에서 교육 프로그램을 등록하면{"\n"}이 화면에서 확인할 수 있어요
          </Text>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  card: {
    borderRadius: 20, padding: 20, gap: 16,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 14 },
  iconBox: { width: 52, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  cardTitle: { fontSize: 17, fontFamily: "Pretendard-Regular" },
  cardMeta: { fontSize: 12, fontFamily: "Pretendard-Regular", marginTop: 3 },
  divider: { height: 1 },
  content: { fontSize: 14, fontFamily: "Pretendard-Regular", lineHeight: 24 },
  emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40, gap: 16 },
  emptyIcon: { width: 88, height: 88, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  emptyTitle: { fontSize: 18, fontFamily: "Pretendard-Regular" },
  emptyBody: { fontSize: 14, fontFamily: "Pretendard-Regular", textAlign: "center", lineHeight: 22 },
});
