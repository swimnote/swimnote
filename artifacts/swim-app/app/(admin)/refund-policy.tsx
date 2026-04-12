/**
 * (admin)/refund-policy.tsx — 환불 정책 확인 및 동의 화면
 *
 * 수영장 관리자가 플랫폼 환불 정책을 읽고 동의 처리하는 화면.
 * 동의 완료 시 슈퍼관리자 대시보드의 "정책 미확인" 항목에서 제거됨.
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet,
  Text, View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CheckCircle, FileText, ChevronLeft } from "lucide-react-native";
import { apiRequest, useAuth } from "@/context/AuthContext";
import Colors from "@/constants/colors";

const C = Colors.light;
const PURPLE = "#7C3AED";

export default function RefundPolicyScreen() {
  const { token } = useAuth() as any;
  const insets = useSafeAreaInsets();
  const { backTo } = useLocalSearchParams<{ backTo?: string }>();

  const [loading,   setLoading]   = useState(true);
  const [agreeing,  setAgreeing]  = useState(false);
  const [content,   setContent]   = useState("");
  const [version,   setVersion]   = useState("v1.0");
  const [agreedAt,  setAgreedAt]  = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await apiRequest(token, "/admin/refund-policy");
      const data = await res.json();
      setContent(data.content ?? "");
      setVersion(data.version ?? "v1.0");
      setAgreedAt(data.agreed_at ?? null);
    } catch {
      // 네트워크 오류 시 무시
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function handleAgree() {
    Alert.alert(
      "환불 정책 동의",
      "위 내용을 모두 읽고 동의합니다.\n계속 진행하시겠습니까?",
      [
        { text: "취소", style: "cancel" },
        {
          text: "동의",
          onPress: async () => {
            setAgreeing(true);
            try {
              const res  = await apiRequest(token, "/admin/refund-policy/agree", { method: "POST" });
              const data = await res.json();
              if (data.success) {
                setAgreedAt(data.agreed_at);
                Alert.alert("동의 완료", "환불 정책에 동의했습니다.");
              } else {
                Alert.alert("오류", data.error ?? "처리에 실패했습니다.");
              }
            } catch {
              Alert.alert("오류", "서버 연결에 실패했습니다.");
            } finally {
              setAgreeing(false);
            }
          },
        },
      ]
    );
  }

  function handleBack() {
    if (backTo) router.push((`/(admin)/${backTo}`) as any);
    else router.back();
  }

  const agreedDate = agreedAt
    ? new Date(agreedAt).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" })
    : null;

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      {/* 헤더 */}
      <View style={s.header}>
        <Pressable style={s.backBtn} onPress={handleBack}>
          <ChevronLeft size={22} color={C.text} />
        </Pressable>
        <Text style={s.headerTitle}>환불 정책</Text>
        {agreedAt ? (
          <View style={s.agreedBadge}>
            <CheckCircle size={13} color="#16A34A" />
            <Text style={s.agreedBadgeTxt}>동의 완료</Text>
          </View>
        ) : (
          <View style={s.unreadBadge}>
            <Text style={s.unreadBadgeTxt}>미확인</Text>
          </View>
        )}
      </View>

      {loading ? (
        <ActivityIndicator color={PURPLE} style={{ marginTop: 60 }} />
      ) : (
        <>
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={s.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* 정책 안내 */}
            <View style={s.infoCard}>
              <View style={s.infoRow}>
                <FileText size={15} color={PURPLE} />
                <Text style={s.infoTitle}>SwimNote 환불 정책</Text>
              </View>
              <Text style={s.infoVersion}>버전 {version}</Text>
              {agreedDate && (
                <Text style={s.infoAgreed}>동의일: {agreedDate}</Text>
              )}
            </View>

            {/* 정책 내용 */}
            <View style={s.policyBox}>
              {content.split("\n").filter(Boolean).map((line, i) => (
                <View key={i} style={s.policyLine}>
                  <View style={s.bullet} />
                  <Text style={s.policyText}>{line}</Text>
                </View>
              ))}
            </View>

            {/* 이미 동의한 경우 안내 */}
            {agreedAt && (
              <View style={s.alreadyAgreed}>
                <CheckCircle size={20} color="#16A34A" />
                <Text style={s.alreadyAgreedTxt}>
                  이미 동의 완료된 정책입니다{"\n"}({agreedDate})
                </Text>
              </View>
            )}

            <View style={{ height: 120 }} />
          </ScrollView>

          {/* 동의 버튼 (미동의 상태에서만 표시) */}
          {!agreedAt && (
            <View style={[s.footer, { paddingBottom: insets.bottom + 16 }]}>
              <Text style={s.footerHint}>위 내용을 모두 읽은 후 동의 버튼을 눌러주세요</Text>
              <Pressable
                style={[s.agreeBtn, agreeing && { opacity: 0.6 }]}
                onPress={handleAgree}
                disabled={agreeing}
              >
                {agreeing
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={s.agreeBtnTxt}>환불 정책에 동의합니다</Text>
                }
              </Pressable>
            </View>
          )}
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root:         { flex: 1, backgroundColor: C.background },
  header:       { flexDirection: "row", alignItems: "center", gap: 8,
                  paddingHorizontal: 16, paddingVertical: 12,
                  borderBottomWidth: 1, borderBottomColor: "#E5E7EB",
                  backgroundColor: C.card },
  backBtn:      { padding: 4 },
  headerTitle:  { flex: 1, fontSize: 17, fontFamily: "Pretendard-Regular", color: C.text },
  agreedBadge:  { flexDirection: "row", alignItems: "center", gap: 4,
                  backgroundColor: "#F0FDF4", borderRadius: 10,
                  paddingHorizontal: 8, paddingVertical: 4 },
  agreedBadgeTxt:{ fontSize: 11, fontFamily: "Pretendard-Regular", color: "#16A34A" },
  unreadBadge:  { backgroundColor: "#FEF2F2", borderRadius: 10,
                  paddingHorizontal: 8, paddingVertical: 4 },
  unreadBadgeTxt:{ fontSize: 11, fontFamily: "Pretendard-Regular", color: "#D96C6C" },

  scrollContent:{ padding: 16, gap: 12 },

  infoCard:     { backgroundColor: "#F5F3FF", borderRadius: 12, padding: 14,
                  borderWidth: 1, borderColor: "#DDD6FE" },
  infoRow:      { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  infoTitle:    { fontSize: 15, fontFamily: "Pretendard-Regular", color: PURPLE },
  infoVersion:  { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B" },
  infoAgreed:   { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#16A34A", marginTop: 2 },

  policyBox:    { backgroundColor: C.card, borderRadius: 12, padding: 16,
                  borderWidth: 1, borderColor: "#E5E7EB", gap: 10 },
  policyLine:   { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  bullet:       { width: 5, height: 5, borderRadius: 3, backgroundColor: PURPLE, marginTop: 7 },
  policyText:   { flex: 1, fontSize: 13, fontFamily: "Pretendard-Regular",
                  color: C.text, lineHeight: 20 },

  alreadyAgreed:{ flexDirection: "row", alignItems: "center", gap: 10,
                  backgroundColor: "#F0FDF4", borderRadius: 12, padding: 14,
                  borderWidth: 1, borderColor: "#BBF7D0" },
  alreadyAgreedTxt:{ fontSize: 13, fontFamily: "Pretendard-Regular", color: "#16A34A", lineHeight: 20 },

  footer:       { paddingHorizontal: 16, paddingTop: 12, gap: 8,
                  backgroundColor: C.card,
                  borderTopWidth: 1, borderTopColor: "#E5E7EB" },
  footerHint:   { fontSize: 11, fontFamily: "Pretendard-Regular",
                  color: "#64748B", textAlign: "center" },
  agreeBtn:     { backgroundColor: PURPLE, borderRadius: 12, paddingVertical: 14,
                  alignItems: "center" },
  agreeBtnTxt:  { fontSize: 15, fontFamily: "Pretendard-Regular", color: "#fff" },
});
