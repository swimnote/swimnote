/**
 * (auth)/policy-agreement.tsx — 환불 정책 동의 온보딩 화면
 *
 * pool_admin 가입 직후 OR 새 정책 버전 등장 시 강제 진입.
 * 정책을 읽고 동의해야 홈 화면으로 진행 가능.
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Pressable, ScrollView,
  StyleSheet, Text, View,
} from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { FileCheck, ShieldCheck, ChevronRight } from "lucide-react-native";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { ConfirmModal } from "@/components/common/ConfirmModal";

const PURPLE = "#7C3AED";
const NAVY   = "#0F172A";

export default function PolicyAgreementScreen() {
  const { token } = useAuth() as any;

  const [loading,      setLoading]      = useState(true);
  const [agreeing,     setAgreeing]     = useState(false);
  const [version,      setVersion]      = useState("v1.0");
  const [content,      setContent]      = useState("");
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [errorMsg,     setErrorMsg]     = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await apiRequest(token, "/admin/refund-policy");
      const data = await res.json();
      if (data.success) {
        setVersion(data.version ?? "v1.0");
        setContent(data.content ?? "");
      }
    } catch {}
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function doAgree() {
    setAgreeing(true);
    setConfirmVisible(false);
    try {
      const res  = await apiRequest(token, "/admin/refund-policy/agree", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        router.replace("/(admin)/(tabs)/dashboard" as any);
      } else {
        setErrorMsg(data.error ?? "처리에 실패했습니다.");
      }
    } catch {
      setErrorMsg("서버 연결에 실패했습니다.");
    } finally {
      setAgreeing(false);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={s.center}>
        <ActivityIndicator color={PURPLE} size="large" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.root} edges={["top", "bottom"]}>
      {/* 헤더 */}
      <View style={s.hero}>
        <View style={s.heroIcon}>
          <FileCheck size={36} color={PURPLE} />
        </View>
        <Text style={s.heroTitle}>환불 정책 확인</Text>
        <Text style={s.heroSub}>
          서비스 이용 전 환불 정책을 확인해 주세요.{"\n"}
          동의 후 대시보드로 이동합니다.
        </Text>
        <View style={s.versionBadge}>
          <Text style={s.versionTxt}>현재 버전: {version}</Text>
        </View>
      </View>

      {/* 오류 메시지 */}
      {errorMsg && (
        <View style={s.errorBox}>
          <Text style={s.errorTxt}>{errorMsg}</Text>
        </View>
      )}

      {/* 정책 내용 */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
      >
        <View style={s.policyBox}>
          <Text style={s.policyHeader}>환불 정책 전문</Text>
          {content.split("\n").filter(Boolean).map((line, i) => (
            <View key={i} style={s.line}>
              <ChevronRight size={13} color={PURPLE} style={{ marginTop: 2 }} />
              <Text style={s.lineText}>{line}</Text>
            </View>
          ))}
        </View>

        <View style={s.noticeBox}>
          <ShieldCheck size={16} color="#0369A1" />
          <Text style={s.noticeTxt}>
            정책 변경 시 재동의가 필요합니다.{"\n"}
            과거 버전 동의는 새 버전에 자동 적용되지 않습니다.
          </Text>
        </View>

        <View style={{ height: 32 }} />
      </ScrollView>

      {/* 동의 버튼 */}
      <View style={s.footer}>
        <Text style={s.footerHint}>위 내용을 모두 읽었다면 동의 버튼을 눌러주세요</Text>
        <Pressable
          style={[s.agreeBtn, agreeing && { opacity: 0.6 }]}
          onPress={() => setConfirmVisible(true)}
          disabled={agreeing}
        >
          {agreeing
            ? <ActivityIndicator color="#fff" />
            : <Text style={s.agreeTxt}>환불 정책에 동의하고 계속하기</Text>
          }
        </Pressable>
      </View>

      {/* 동의 확인 모달 */}
      <ConfirmModal
        visible={confirmVisible}
        title="환불 정책 동의"
        message={`위 내용을 모두 읽었으며 동의합니다.\n\n현재 버전: ${version}`}
        confirmText="동의하고 계속하기"
        onConfirm={doAgree}
        onCancel={() => setConfirmVisible(false)}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root:         { flex: 1, backgroundColor: "#FAFAFA" },
  center:       { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#FAFAFA" },

  hero:         { alignItems: "center", paddingHorizontal: 24, paddingTop: 28, paddingBottom: 20,
                  backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  heroIcon:     { width: 72, height: 72, borderRadius: 20, backgroundColor: "#F5F3FF",
                  alignItems: "center", justifyContent: "center", marginBottom: 12 },
  heroTitle:    { fontSize: 22, fontFamily: "Pretendard-Regular", color: NAVY, marginBottom: 6 },
  heroSub:      { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#64748B",
                  textAlign: "center", lineHeight: 20, marginBottom: 10 },
  versionBadge: { backgroundColor: "#EDE9FE", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  versionTxt:   { fontSize: 12, fontFamily: "Pretendard-Regular", color: PURPLE },

  errorBox:     { backgroundColor: "#FEF2F2", paddingHorizontal: 16, paddingVertical: 10,
                  borderBottomWidth: 1, borderBottomColor: "#FECACA" },
  errorTxt:     { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#DC2626", textAlign: "center" },

  scroll:       { padding: 16, gap: 12 },

  policyBox:    { backgroundColor: "#fff", borderRadius: 14, padding: 16,
                  borderWidth: 1, borderColor: "#E5E7EB", gap: 10 },
  policyHeader: { fontSize: 14, fontFamily: "Pretendard-Regular", color: NAVY, marginBottom: 4 },
  line:         { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  lineText:     { flex: 1, fontSize: 13, fontFamily: "Pretendard-Regular",
                  color: "#374151", lineHeight: 20 },

  noticeBox:    { flexDirection: "row", gap: 10, alignItems: "flex-start",
                  backgroundColor: "#EFF6FF", borderRadius: 12, padding: 14,
                  borderWidth: 1, borderColor: "#BFDBFE" },
  noticeTxt:    { flex: 1, fontSize: 12, fontFamily: "Pretendard-Regular",
                  color: "#0369A1", lineHeight: 20 },

  footer:       { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 24, gap: 8,
                  backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: "#E5E7EB" },
  footerHint:   { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B", textAlign: "center" },
  agreeBtn:     { backgroundColor: PURPLE, borderRadius: 14, paddingVertical: 15,
                  alignItems: "center" },
  agreeTxt:     { fontSize: 15, fontFamily: "Pretendard-Regular", color: "#fff" },
});
