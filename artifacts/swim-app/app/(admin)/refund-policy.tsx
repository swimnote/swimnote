/**
 * (admin)/refund-policy.tsx — 환불 정책 확인 및 동의 화면
 *
 * - 현재 활성 버전 표시
 * - 동의 완료 시 동의 버전과 날짜 표시
 * - 새 버전 등장 시 "재동의 필요" 배지 표시
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet,
  Text, View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CheckCircle, FileText, ChevronLeft, AlertCircle } from "lucide-react-native";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { ConfirmModal } from "@/components/common/ConfirmModal";
import Colors from "@/constants/colors";

const C = Colors.light;
const PURPLE = "#7C3AED";

interface PolicyData {
  version:        string;
  content:        string;
  agreed:         boolean;
  agreed_at:      string | null;
  agreed_version: string | null;
  needs_reagree:  boolean;
}

export default function RefundPolicyScreen() {
  const { token } = useAuth() as any;
  const insets = useSafeAreaInsets();
  const { backTo } = useLocalSearchParams<{ backTo?: string }>();

  const [loading,        setLoading]        = useState(true);
  const [agreeing,       setAgreeing]       = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [data,           setData]           = useState<PolicyData>({
    version: "v1.0", content: "", agreed: false,
    agreed_at: null, agreed_version: null, needs_reagree: true,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await apiRequest(token, "/admin/refund-policy");
      const json = await res.json();
      if (json.success) {
        setData({
          version:        json.version        ?? "v1.0",
          content:        json.content        ?? "",
          agreed:         json.agreed         ?? false,
          agreed_at:      json.agreed_at      ?? null,
          agreed_version: json.agreed_version ?? null,
          needs_reagree:  json.needs_reagree  ?? true,
        });
      }
    } catch {}
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function doAgree() {
    setConfirmVisible(false);
    setAgreeing(true);
    try {
      const res  = await apiRequest(token, "/admin/refund-policy/agree", { method: "POST" });
      const json = await res.json();
      if (json.success) {
        setData(prev => ({
          ...prev,
          agreed: true,
          agreed_at: json.agreed_at,
          agreed_version: json.agreed_version ?? prev.version,
          needs_reagree: false,
        }));
      }
    } catch {}
    finally { setAgreeing(false); }
  }

  function handleBack() {
    if (backTo) router.push((`/(admin)/${backTo}`) as any);
    else router.back();
  }

  const agreedDate = data.agreed_at
    ? new Date(data.agreed_at).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" })
    : null;

  // 헤더 배지 상태
  const headerBadge = data.agreed && !data.needs_reagree
    ? "done"
    : data.agreed && data.needs_reagree
    ? "reagree"
    : "unread";

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      {/* 헤더 */}
      <View style={s.header}>
        <Pressable style={s.backBtn} onPress={handleBack}>
          <ChevronLeft size={22} color={C.text} />
        </Pressable>
        <Text style={s.headerTitle}>환불 정책</Text>
        {headerBadge === "done" && (
          <View style={s.agreedBadge}>
            <CheckCircle size={13} color="#16A34A" />
            <Text style={s.agreedBadgeTxt}>동의 완료</Text>
          </View>
        )}
        {headerBadge === "reagree" && (
          <View style={s.reagreeBadge}>
            <AlertCircle size={13} color="#D97706" />
            <Text style={s.reagreeBadgeTxt}>재동의 필요</Text>
          </View>
        )}
        {headerBadge === "unread" && (
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
            {/* 정책 안내 카드 */}
            <View style={s.infoCard}>
              <View style={s.infoRow}>
                <FileText size={15} color={PURPLE} />
                <Text style={s.infoTitle}>SwimNote 환불 정책</Text>
              </View>
              <Text style={s.infoVersion}>현재 버전: {data.version}</Text>
              {data.agreed_version && data.agreed_version !== data.version && (
                <Text style={s.infoReagreeTxt}>
                  이전 동의 버전: {data.agreed_version} — 새 버전에 재동의가 필요합니다
                </Text>
              )}
              {agreedDate && !data.needs_reagree && (
                <Text style={s.infoAgreed}>동의일: {agreedDate}</Text>
              )}
            </View>

            {/* 재동의 필요 알림 */}
            {data.needs_reagree && data.agreed && (
              <View style={s.reagreeBox}>
                <AlertCircle size={18} color="#D97706" />
                <View style={{ flex: 1 }}>
                  <Text style={s.reagreeTitle}>환불 정책이 변경되어 재동의가 필요합니다.</Text>
                  <Text style={s.reagreeDesc}>현재 버전: {data.version}</Text>
                </View>
              </View>
            )}

            {/* 정책 내용 */}
            <View style={s.policyBox}>
              {data.content.split("\n").filter(Boolean).map((line, i) => (
                <View key={i} style={s.policyLine}>
                  <View style={s.bullet} />
                  <Text style={s.policyText}>{line}</Text>
                </View>
              ))}
            </View>

            {/* 동의 완료 상태 */}
            {data.agreed && !data.needs_reagree && (
              <View style={s.alreadyAgreed}>
                <CheckCircle size={20} color="#16A34A" />
                <Text style={s.alreadyAgreedTxt}>
                  동의 완료된 정책입니다 (버전 {data.agreed_version}){"\n"}
                  {agreedDate && `동의일: ${agreedDate}`}
                </Text>
              </View>
            )}

            <View style={{ height: 120 }} />
          </ScrollView>

          {/* 동의 버튼 (미동의 또는 재동의 필요 시 표시) */}
          {data.needs_reagree && (
            <View style={[s.footer, { paddingBottom: insets.bottom + 16 }]}>
              <Text style={s.footerHint}>
                {data.agreed
                  ? "정책이 변경되었습니다. 재동의 후 결제 기능을 이용할 수 있습니다."
                  : "위 내용을 모두 읽은 후 동의 버튼을 눌러주세요"}
              </Text>
              <Pressable
                style={[s.agreeBtn, agreeing && { opacity: 0.6 }]}
                onPress={() => setConfirmVisible(true)}
                disabled={agreeing}
              >
                {agreeing
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={s.agreeBtnTxt}>
                      {data.agreed ? "재동의합니다" : "환불 정책에 동의합니다"}
                    </Text>
                }
              </Pressable>
            </View>
          )}
        </>
      )}

      <ConfirmModal
        visible={confirmVisible}
        title="환불 정책 동의"
        message={`위 내용을 모두 읽었으며 동의합니다.\n\n현재 버전: ${data.version}`}
        confirmText={data.agreed ? "재동의합니다" : "동의합니다"}
        onConfirm={doAgree}
        onCancel={() => setConfirmVisible(false)}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root:           { flex: 1, backgroundColor: C.background },
  header:         { flexDirection: "row", alignItems: "center", gap: 8,
                    paddingHorizontal: 16, paddingVertical: 12,
                    borderBottomWidth: 1, borderBottomColor: "#E5E7EB",
                    backgroundColor: C.card },
  backBtn:        { padding: 4 },
  headerTitle:    { flex: 1, fontSize: 17, fontFamily: "Pretendard-Regular", color: C.text },
  agreedBadge:    { flexDirection: "row", alignItems: "center", gap: 4,
                    backgroundColor: "#F0FDF4", borderRadius: 10,
                    paddingHorizontal: 8, paddingVertical: 4 },
  agreedBadgeTxt: { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#16A34A" },
  reagreeBadge:   { flexDirection: "row", alignItems: "center", gap: 4,
                    backgroundColor: "#FFFBEB", borderRadius: 10,
                    paddingHorizontal: 8, paddingVertical: 4 },
  reagreeBadgeTxt:{ fontSize: 11, fontFamily: "Pretendard-Regular", color: "#D97706" },
  unreadBadge:    { backgroundColor: "#FEF2F2", borderRadius: 10,
                    paddingHorizontal: 8, paddingVertical: 4 },
  unreadBadgeTxt: { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#D96C6C" },

  scrollContent:  { padding: 16, gap: 12 },

  infoCard:       { backgroundColor: "#F5F3FF", borderRadius: 12, padding: 14,
                    borderWidth: 1, borderColor: "#DDD6FE" },
  infoRow:        { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  infoTitle:      { fontSize: 15, fontFamily: "Pretendard-Regular", color: PURPLE },
  infoVersion:    { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B" },
  infoAgreed:     { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#16A34A", marginTop: 2 },
  infoReagreeTxt: { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#D97706", marginTop: 2 },

  reagreeBox:     { flexDirection: "row", alignItems: "flex-start", gap: 10,
                    backgroundColor: "#FFFBEB", borderRadius: 12, padding: 14,
                    borderWidth: 1, borderColor: "#FDE68A" },
  reagreeTitle:   { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#92400E" },
  reagreeDesc:    { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#D97706", marginTop: 2 },

  policyBox:      { backgroundColor: C.card, borderRadius: 12, padding: 16,
                    borderWidth: 1, borderColor: "#E5E7EB", gap: 10 },
  policyLine:     { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  bullet:         { width: 5, height: 5, borderRadius: 3, backgroundColor: PURPLE, marginTop: 7 },
  policyText:     { flex: 1, fontSize: 13, fontFamily: "Pretendard-Regular",
                    color: C.text, lineHeight: 20 },

  alreadyAgreed:  { flexDirection: "row", alignItems: "center", gap: 10,
                    backgroundColor: "#F0FDF4", borderRadius: 12, padding: 14,
                    borderWidth: 1, borderColor: "#BBF7D0" },
  alreadyAgreedTxt:{ fontSize: 13, fontFamily: "Pretendard-Regular", color: "#16A34A", lineHeight: 20 },

  footer:         { paddingHorizontal: 16, paddingTop: 12, gap: 8,
                    backgroundColor: C.card,
                    borderTopWidth: 1, borderTopColor: "#E5E7EB" },
  footerHint:     { fontSize: 11, fontFamily: "Pretendard-Regular",
                    color: "#64748B", textAlign: "center" },
  agreeBtn:       { backgroundColor: PURPLE, borderRadius: 12, paddingVertical: 14,
                    alignItems: "center" },
  agreeBtnTxt:    { fontSize: 15, fontFamily: "Pretendard-Regular", color: "#fff" },
});
