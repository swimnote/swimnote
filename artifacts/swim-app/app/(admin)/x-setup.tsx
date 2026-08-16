/**
 * (admin)/x-setup.tsx — SWIMNOTE X 커리큘럼 설정 요청 화면 (WP3)
 *
 * 상태별 동작:
 *   NOT_CONFIGURED    → "커리큘럼 설정 요청하기" 버튼 → POST /pools/x-request
 *   CURRICULUM_PENDING → 요청 상태 표시 (pending/reviewing/rejected)
 *   READY             → dashboard로 redirect (이 화면에서 설정 기능 없음)
 *
 * 진입 조건: entitlement=true + (NOT_CONFIGURED | CURRICULUM_PENDING)
 * poolId는 서버가 userId→DB로 결정. 앱에서 body에 포함하지 않음.
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LucideIcon } from "@/components/common/LucideIcon";
import { useMode } from "@/context/ModeContext";
import { useAuth, API_BASE } from "@/context/AuthContext";
import Colors from "@/constants/colors";

const C = Colors.light;
// X 전용 토큰 — A1 Theme Polish (Steel Blue)
const MINT       = "#355C7D";   // xAccent
const MINT_LIGHT = "#E9EEF3";   // xAccentLight
const NAVY       = "#23415C";   // xAccentStrong
const SLATE      = C.textSecondary;
const SLATE_LIGHT = C.backgroundSoft;
const BORDER     = C.border;

interface CurriculumRequest {
  id: string;
  request_status: "pending" | "reviewing" | "approved" | "rejected" | "cancelled";
  title: string;
  review_note: string | null;
  result_version_id: string | null;
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
}

export default function AdminXSetupScreen() {
  const insets = useSafeAreaInsets();
  const { mode, xmode_config_status, refreshMode } = useMode();
  const { token } = useAuth();

  const [requestData, setRequestData] = useState<CurriculumRequest | null>(null);
  const [loadingRequest, setLoadingRequest] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // P0: x-setup은 "X모드 세팅하기" 화면으로 재정의 — mode=x 상태에서도 진입 허용
  // (구 로직: mode=x || config=READY → dashboard redirect 제거)

  // GET /pools/x-request — 현재 요청 상태 조회
  const fetchRequest = useCallback(async () => {
    if (!token) return;
    setLoadingRequest(true);
    try {
      const res = await fetch(`${API_BASE}/pools/x-request`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setRequestData(data.request ?? null);
      }
    } catch {
      // 조회 실패는 UI에서 조용히 처리
    } finally {
      setLoadingRequest(false);
    }
  }, [token, API_BASE]);

  useEffect(() => {
    if (xmode_config_status === "CURRICULUM_PENDING") {
      fetchRequest();
    }
  }, [xmode_config_status, fetchRequest]);

  // POST /pools/x-request — 커리큘럼 설정 요청 제출
  const handleSubmitRequest = useCallback(async () => {
    if (!token || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch(`${API_BASE}/pools/x-request`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });
      const data = await res.json();
      if (!res.ok) {
        setSubmitError(data.error ?? "요청에 실패했습니다. 다시 시도해 주세요.");
        return;
      }
      // 성공: ModeContext 갱신 + 요청 데이터 설정
      await refreshMode();
      if (data.request) {
        setRequestData(data.request);
      } else {
        await fetchRequest();
      }
    } catch {
      setSubmitError("네트워크 오류가 발생했습니다. 다시 시도해 주세요.");
    } finally {
      setSubmitting(false);
    }
  }, [token, API_BASE, submitting, refreshMode, fetchRequest]);

  // request_status 라벨
  const statusLabel = (status: CurriculumRequest["request_status"] | undefined) => {
    switch (status) {
      case "pending":   return "요청 접수됨";
      case "reviewing": return "커리큘럼 준비 중";
      case "approved":  return "준비 완료";
      case "rejected":  return "요청 반려됨";
      case "cancelled": return "요청 취소됨";
      default:          return "확인 중";
    }
  };

  // ── READY (X모드 활성) 화면 ─────────────────────────────────────────────
  const renderReady = () => (
    <View style={s.card}>
      <View style={[s.iconCircle, { backgroundColor: MINT_LIGHT }]}>
        <LucideIcon name="check-circle" size={28} color={MINT} />
      </View>
      <Text style={s.cardTitle}>X모드 설정 완료</Text>
      <Text style={s.cardDesc}>
        수영장 커리큘럼이 연결되어{"\n"}
        SWIMNOTE X 기능을 모두 사용할 수 있습니다.
      </Text>

      {/* 커리큘럼 상태 */}
      <View style={[s.statusRow, { marginTop: 4 }]}>
        <View style={[s.statusDot, { backgroundColor: MINT }]} />
        <Text style={[s.statusText, { color: NAVY }]}>커리큘럼 연결 완료</Text>
      </View>

      {/* 향후 확장 안내 */}
      <View style={[s.noteBox, { backgroundColor: MINT_LIGHT }]}>
        <Text style={[s.noteLabel, { color: NAVY }]}>추가 설정</Text>
        <Text style={[s.noteText, { color: SLATE }]}>
          AI 기능 설정 및 학부모 리포트 옵션은{"\n"}
          향후 업데이트에서 추가될 예정입니다.
        </Text>
      </View>
    </View>
  );

  // ── NOT_CONFIGURED 화면 ───────────────────────────────────────────────────
  const renderNotConfigured = () => (
    <View style={s.card}>
      <View style={s.iconCircle}>
        <LucideIcon name="settings" size={28} color={MINT} />
      </View>
      <Text style={s.cardTitle}>SWIMNOTE X 설정</Text>
      <Text style={s.cardDesc}>
        X 모드를 사용하려면 수영장의 교육과정(커리큘럼)을{"\n"}
        설정해야 합니다.{"\n\n"}
        요청을 제출하면 운영팀이 수영장에 맞는{"\n"}
        커리큘럼을 준비합니다.
      </Text>

      {submitError && (
        <View style={s.errorBox}>
          <LucideIcon name="alert-circle" size={14} color="#EF4444" />
          <Text style={s.errorText}>{submitError}</Text>
        </View>
      )}

      <Pressable
        style={({ pressed }) => [s.primaryBtn, pressed && { opacity: 0.75 }, submitting && { opacity: 0.5 }]}
        onPress={handleSubmitRequest}
        disabled={submitting}
      >
        {submitting ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text style={s.primaryBtnText}>커리큘럼 설정 요청하기</Text>
        )}
      </Pressable>
    </View>
  );

  // ── CURRICULUM_PENDING 화면 ───────────────────────────────────────────────
  const renderCurriculumPending = () => {
    const status = requestData?.request_status;
    const isRejected = status === "rejected";

    return (
      <View style={s.card}>
        <View style={[s.iconCircle, { backgroundColor: "#FEF3C7" }]}>
          <LucideIcon name="clock" size={28} color="#F59E0B" />
        </View>
        <Text style={s.cardTitle}>SWIMNOTE X 준비 중</Text>

        {loadingRequest ? (
          <ActivityIndicator size="small" color={MINT} style={{ marginVertical: 16 }} />
        ) : (
          <>
            <View style={s.statusRow}>
              <View style={[s.statusDot, isRejected && { backgroundColor: "#EF4444" }]} />
              <Text style={[s.statusText, isRejected && { color: "#EF4444" }]}>
                {statusLabel(status)}
              </Text>
            </View>

            <Text style={s.cardDesc}>
              {isRejected
                ? "커리큘럼 설정 요청이 반려되었습니다.\n아래 사유를 확인한 뒤 문의해 주세요."
                : "커리큘럼 설정 요청이 접수되었습니다.\n운영팀이 준비 완료 후 알림을 드립니다."}
            </Text>

            {isRejected && requestData?.review_note && (
              <View style={s.noteBox}>
                <Text style={s.noteLabel}>반려 사유</Text>
                <Text style={s.noteText}>{requestData.review_note}</Text>
              </View>
            )}

            {/* 불일치 감지: CURRICULUM_PENDING이지만 active request 없는 경우 */}
            {!loadingRequest && !requestData && (
              <View style={s.errorBox}>
                <LucideIcon name="alert-circle" size={14} color="#F59E0B" />
                <Text style={[s.errorText, { color: "#92400E" }]}>
                  요청 정보를 불러올 수 없습니다. 문의해 주세요.
                </Text>
              </View>
            )}
          </>
        )}
      </View>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      {/* 헤더 */}
      <View style={[s.header, { paddingTop: insets.top + 14 }]}>
        <Pressable hitSlop={12} onPress={() => router.back()} style={s.backBtn}>
          <LucideIcon name="arrow-left" size={20} color={NAVY} />
        </Pressable>
        <Text style={s.headerTitle}>X모드 세팅하기</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView
        contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* X 배지 */}
        <View style={s.badgeRow}>
          <View style={s.xBadge}>
            <LucideIcon name="trending-up" size={13} color={MINT} />
            <Text style={s.xBadgeText}>SWIMNOTE X</Text>
          </View>
        </View>

        {/* 상태별 본문 */}
        {xmode_config_status === "READY" && renderReady()}
        {xmode_config_status === "NOT_CONFIGURED" && renderNotConfigured()}
        {xmode_config_status === "CURRICULUM_PENDING" && renderCurriculumPending()}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 12,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  backBtn: { width: 32, alignItems: "flex-start" },
  headerTitle: { fontSize: 16, fontFamily: "Pretendard-SemiBold", color: NAVY },
  scroll: { padding: 20, gap: 16 },

  badgeRow: { flexDirection: "row", marginBottom: 8 },
  xBadge: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: MINT_LIGHT, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: MINT,
  },
  xBadgeText: { fontSize: 11, fontFamily: "Pretendard-SemiBold", color: NAVY },

  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    gap: 12,
  },
  iconCircle: {
    width: 60, height: 60, borderRadius: 18,
    backgroundColor: MINT_LIGHT,
    alignItems: "center", justifyContent: "center",
    marginBottom: 4,
  },
  cardTitle: {
    fontSize: 18, fontFamily: "Pretendard-SemiBold", color: NAVY,
    textAlign: "center",
  },
  cardDesc: {
    fontSize: 13, fontFamily: "Pretendard-Regular", color: SLATE,
    textAlign: "center", lineHeight: 20,
  },

  primaryBtn: {
    backgroundColor: MINT, borderRadius: 12,
    paddingVertical: 14, paddingHorizontal: 32,
    alignItems: "center", marginTop: 8,
    minWidth: 220,
  },
  primaryBtnText: {
    fontSize: 15, fontFamily: "Pretendard-SemiBold", color: "#fff",
  },

  errorBox: {
    flexDirection: "row", alignItems: "flex-start", gap: 6,
    backgroundColor: "#FEF2F2", borderRadius: 10,
    padding: 12, alignSelf: "stretch",
  },
  errorText: {
    fontSize: 12, fontFamily: "Pretendard-Regular", color: "#991B1B",
    flex: 1, lineHeight: 18,
  },

  statusRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginVertical: 4,
  },
  statusDot: {
    width: 8, height: 8, borderRadius: 4, backgroundColor: "#F59E0B",
  },
  statusText: {
    fontSize: 14, fontFamily: "Pretendard-SemiBold", color: "#92400E",
  },

  noteBox: {
    backgroundColor: "#FFF7ED", borderRadius: 10,
    padding: 14, alignSelf: "stretch", gap: 4,
  },
  noteLabel: {
    fontSize: 11, fontFamily: "Pretendard-SemiBold", color: "#92400E",
  },
  noteText: {
    fontSize: 13, fontFamily: "Pretendard-Regular", color: "#78350F",
    lineHeight: 20,
  },
});
