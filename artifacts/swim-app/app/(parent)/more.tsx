/**
 * 학부모 설정 — UI 정리 버전
 *
 * 구조:
 *   1. 상단 계정 요약 row (compact, tap → my-info)
 *   2. 자주 쓰는 설정 (알림 설정 / 자녀 관리 / 수업 요청)
 *   3. 큰 분류 4개 (탭 시 inline expand)
 *      A. 계정 및 가족
 *      B. 알림 및 소식
 *      C. 수업 및 수영장
 *      D. 도움말 및 문의
 *   4. 하단 버전 정보
 *
 * 기존 route/logic 전부 보존. UI 구조만 변경.
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LucideIcon } from "@/components/common/LucideIcon";
import { ConfirmModal } from "@/components/common/ConfirmModal";
import { WithdrawalModal } from "@/components/common/WithdrawalModal";
import { ParentScreenHeader } from "@/components/parent/ParentScreenHeader";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useParent } from "@/context/ParentContext";
import Colors from "@/constants/colors";

const C    = Colors.light;
const NAVY = "#0C1A2E";
const DIV  = "#E5E7EB";
const MUTED = "#9CA3AF";
const APP_VERSION = "1.6.3";

// ─────────────────────────────────────────────────────────────
// Row atom — 쿠팡식 list row
// ─────────────────────────────────────────────────────────────
function Row({
  icon,
  label,
  sub,
  danger = false,
  badge,
  onPress,
  last = false,
}: {
  icon: any;
  label: string;
  sub?: string;
  danger?: boolean;
  badge?: number;
  onPress?: () => void;
  last?: boolean;
}) {
  const labelColor = danger ? "#D96C6C" : NAVY;
  const iconColor  = danger ? "#D96C6C" : NAVY;
  return (
    <>
      <Pressable
        style={({ pressed }) => [s.row, { opacity: pressed ? 0.65 : 1 }]}
        onPress={onPress}
      >
        <LucideIcon name={icon} size={17} color={iconColor} />
        <View style={{ flex: 1 }}>
          <Text style={[s.rowLabel, { color: labelColor }]}>{label}</Text>
          {sub ? <Text style={s.rowSub}>{sub}</Text> : null}
        </View>
        {badge ? (
          <View style={s.badge}>
            <Text style={s.badgeTxt}>{badge}</Text>
          </View>
        ) : null}
        {!danger && <LucideIcon name="chevron-right" size={15} color={MUTED} />}
      </Pressable>
      {!last && <View style={s.div} />}
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// Section container
// ─────────────────────────────────────────────────────────────
function SectionTitle({ label }: { label: string }) {
  return <Text style={s.sectionTitle}>{label}</Text>;
}

function SectionBox({ children }: { children: React.ReactNode }) {
  return <View style={s.sectionBox}>{children}</View>;
}

// ─────────────────────────────────────────────────────────────
// Category row — 탭 시 inline expand
// ─────────────────────────────────────────────────────────────
function CategoryRow({
  icon,
  label,
  sub,
  expanded,
  onToggle,
  children,
  last = false,
}: {
  icon: any;
  label: string;
  sub: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <>
      <Pressable
        style={({ pressed }) => [s.row, { opacity: pressed ? 0.65 : 1 }]}
        onPress={onToggle}
      >
        <LucideIcon name={icon} size={17} color={NAVY} />
        <View style={{ flex: 1 }}>
          <Text style={[s.rowLabel, { color: NAVY }]}>{label}</Text>
          <Text style={s.rowSub}>{sub}</Text>
        </View>
        <LucideIcon
          name={expanded ? "chevron-up" : "chevron-down"}
          size={15}
          color={MUTED}
        />
      </Pressable>

      {expanded && (
        <View style={s.expandBody}>
          {children}
        </View>
      )}

      {!last && <View style={s.div} />}
    </>
  );
}

function SubRow({
  icon,
  label,
  sub,
  danger = false,
  badge,
  onPress,
  last = false,
}: {
  icon: any;
  label: string;
  sub?: string;
  danger?: boolean;
  badge?: number;
  onPress?: () => void;
  last?: boolean;
}) {
  return (
    <>
      <Pressable
        style={({ pressed }) => [s.subRow, { opacity: pressed ? 0.65 : 1 }]}
        onPress={onPress}
      >
        <LucideIcon name={icon} size={15} color={danger ? "#D96C6C" : MUTED} />
        <View style={{ flex: 1 }}>
          <Text style={[s.subRowLabel, { color: danger ? "#D96C6C" : C.text }]}>{label}</Text>
          {sub ? <Text style={s.subRowSub}>{sub}</Text> : null}
        </View>
        {badge ? (
          <View style={s.badge}>
            <Text style={s.badgeTxt}>{badge}</Text>
          </View>
        ) : null}
        {!danger && <LucideIcon name="chevron-right" size={14} color={MUTED} />}
      </Pressable>
      {!last && <View style={[s.div, { marginLeft: 34 }]} />}
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// Screen
// ─────────────────────────────────────────────────────────────
export default function ParentMoreScreen() {
  const insets = useSafeAreaInsets();
  const { parentAccount, logout, token, pool, parentPoolName } = useAuth();
  const { students } = useParent();

  const [logoutConfirm, setLogoutConfirm]   = useState(false);
  const [deleteConfirm, setDeleteConfirm]   = useState(false);
  const [deleteLoading, setDeleteLoading]   = useState(false);
  const [inquiryBadge,  setInquiryBadge]   = useState(0);

  // 큰 분류 expand state
  const [expandA, setExpandA] = useState(false);
  const [expandB, setExpandB] = useState(false);
  const [expandC, setExpandC] = useState(false);
  const [expandD, setExpandD] = useState(false);

  const fetchBadge = useCallback(async () => {
    if (!token) return;
    try {
      const res = await apiRequest(token, "/inquiries/unread-count");
      if (res.ok) { const d = await res.json(); setInquiryBadge(d.count ?? 0); }
    } catch { /* ignore */ }
  }, [token]);

  useEffect(() => { fetchBadge(); }, [fetchBadge]);
  useFocusEffect(useCallback(() => { fetchBadge(); }, [fetchBadge]));

  async function handleDeleteAccount(immediate: boolean) {
    setDeleteLoading(true);
    try {
      const res = await apiRequest(token, "/auth/account", {
        method: "DELETE",
        body: JSON.stringify({ immediate }),
      });
      if (res.ok) { setDeleteConfirm(false); await logout(); }
    } catch { } finally { setDeleteLoading(false); }
  }

  const poolName   = parentPoolName || (parentAccount as any)?.pool_name || pool?.name || "수영장";
  const childCount = students.length;

  return (
    <View style={[s.root, { backgroundColor: "#F4F5F7" }]}>
      <ParentScreenHeader title="설정" showHome={false} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 40, paddingTop: 12 }}
      >
        {/* ── 상단 계정 요약 ── */}
        {parentAccount && (
          <Pressable
            style={({ pressed }) => [s.accountRow, { opacity: pressed ? 0.7 : 1 }]}
            onPress={() => router.push("/(parent)/my-info?backTo=more" as any)}
          >
            <View style={s.accountAvatar}>
              <LucideIcon name="user-round" size={20} color={NAVY} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.accountName}>{parentAccount.name}님</Text>
              <Text style={s.accountSub}>{poolName} · 자녀 {childCount}명</Text>
            </View>
            <LucideIcon name="chevron-right" size={15} color={MUTED} />
          </Pressable>
        )}

        {/* ── 자주 쓰는 설정 ── */}
        <SectionTitle label="자주 쓰는 설정" />
        <SectionBox>
          <Row
            icon="bell"
            label="알림 설정"
            sub="공지 · 수업피드 · 사진 · 좋아요 · 댓글"
            onPress={() => router.push("/(parent)/push-settings?backTo=more" as any)}
          />
          <Row
            icon="users"
            label="자녀 관리"
            sub={childCount > 0 ? `연결된 자녀 ${childCount}명` : "자녀를 연결해주세요"}
            onPress={() => router.push("/(parent)/children?backTo=more" as any)}
          />
          <Row
            icon="clipboard-list"
            label="수업 요청"
            sub="결석 · 연기 · 퇴원 · 상담 신청"
            onPress={() => router.push("/(parent)/requests?backTo=more" as any)}
            last
          />
        </SectionBox>

        {/* ── 큰 분류 4개 ── */}
        <SectionTitle label="설정" />
        <SectionBox>
          {/* A. 계정 및 가족 */}
          <CategoryRow
            icon="user"
            label="계정 및 가족"
            sub="내 정보 · 보호자 · 로그인/보안"
            expanded={expandA}
            onToggle={() => setExpandA(v => !v)}
          >
            <SubRow icon="user-round" label="내 정보" sub="프로필 확인" onPress={() => router.push("/(parent)/my-info?backTo=more" as any)} />
            <SubRow icon="pencil" label="부모 정보 수정" sub="이름·전화번호·비밀번호" onPress={() => router.push("/(parent)/parent-profile?backTo=more" as any)} />
            {childCount > 0 && (
              <SubRow icon="user-plus" label="추가 보호자 관리" sub="두 번째·세 번째 보호자 번호 등록" onPress={() => router.push("/(parent)/additional-guardians" as any)} />
            )}
            <SubRow icon="log-out" label="로그아웃" danger onPress={() => setLogoutConfirm(true)} />
            <SubRow icon="user-x" label="회원 탈퇴" sub="계정 및 데이터 영구 삭제" danger onPress={() => setDeleteConfirm(true)} last />
          </CategoryRow>

          {/* B. 알림 및 소식 */}
          <CategoryRow
            icon="bell"
            label="알림 및 소식"
            sub="푸시 알림 · 공지 · 알림함"
            expanded={expandB}
            onToggle={() => setExpandB(v => !v)}
          >
            <SubRow icon="settings" label="푸시 알림 설정" sub="공지·수업·일지·사진 알림 on/off" onPress={() => router.push("/(parent)/push-settings?backTo=more" as any)} />
            <SubRow icon="megaphone" label="공지함" sub="수영장 공지 전체 보기" onPress={() => router.push("/(parent)/notices?backTo=more" as any)} last />
          </CategoryRow>

          {/* C. 수업 및 수영장 */}
          <CategoryRow
            icon="waves"
            label="수업 및 수영장"
            sub="수업 요청 · 등록 수영장"
            expanded={expandC}
            onToggle={() => setExpandC(v => !v)}
          >
            <SubRow icon="clipboard-list" label="수업 요청" sub="결석·연기·퇴원·상담 신청" onPress={() => router.push("/(parent)/requests?backTo=more" as any)} last />
          </CategoryRow>

          {/* D. 도움말 및 문의 */}
          <CategoryRow
            icon="help-circle"
            label="도움말 및 문의"
            sub="AI 문의 · 고객센터 · 약관"
            expanded={expandD}
            onToggle={() => setExpandD(v => !v)}
            last
          >
            <SubRow icon="message-circle" label="AI 문의" sub="스윔노트 운영팀에 AI로 문의" onPress={() => router.push("/(parent)/support-chat" as any)} />
            <SubRow
              icon="help-circle"
              label="문의하기 (기존)"
              sub="스윔노트 · 원장님에게 문의"
              badge={inquiryBadge > 0 ? inquiryBadge : undefined}
              onPress={() => router.push("/(parent)/inquiries" as any)}
            />
            <SubRow icon="file-text" label="이용약관" onPress={() => router.push("/terms" as any)} />
            <SubRow icon="lock" label="개인정보처리방침" onPress={() => router.push("/privacy" as any)} last />
          </CategoryRow>
        </SectionBox>

        {/* ── 하단 버전 정보 ── */}
        <View style={s.versionBlock}>
          <Text style={s.versionApp}>SWIMNOTE</Text>
          <Text style={s.versionNum}>앱 버전 {APP_VERSION}</Text>
        </View>
      </ScrollView>

      <ConfirmModal
        visible={logoutConfirm}
        title="로그아웃"
        message="정말 로그아웃하시겠습니까?"
        confirmText="로그아웃"
        destructive
        onConfirm={async () => { setLogoutConfirm(false); await logout(); }}
        onCancel={() => setLogoutConfirm(false)}
      />
      <WithdrawalModal
        visible={deleteConfirm}
        onClose={() => setDeleteConfirm(false)}
        onConfirm={handleDeleteAccount}
        loading={deleteLoading}
        isPaidPlan={false}
      />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1 },

  // Account row
  accountRow:   { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#fff", marginHorizontal: 16, marginBottom: 4, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: DIV },
  accountAvatar:{ width: 36, height: 36, borderRadius: 18, backgroundColor: "#EEF0F4", alignItems: "center", justifyContent: "center" },
  accountName:  { fontSize: 15, fontFamily: "Pretendard-Regular", fontWeight: "600", color: NAVY },
  accountSub:   { fontSize: 12, fontFamily: "Pretendard-Regular", color: MUTED, marginTop: 1 },

  // Section
  sectionTitle: { fontSize: 11, fontFamily: "Pretendard-Regular", color: MUTED, letterSpacing: 0.5, textTransform: "uppercase", marginHorizontal: 20, marginTop: 20, marginBottom: 6 },
  sectionBox:   { backgroundColor: "#fff", marginHorizontal: 16, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: DIV, overflow: "hidden" },

  // Row
  row:      { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  rowLabel: { fontSize: 14, fontFamily: "Pretendard-Regular", fontWeight: "500" },
  rowSub:   { fontSize: 12, fontFamily: "Pretendard-Regular", color: MUTED, marginTop: 1 },
  div:      { height: StyleSheet.hairlineWidth, backgroundColor: DIV, marginHorizontal: 16 },

  // Expanded sub-rows
  expandBody:   { backgroundColor: "#F8F9FB", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: DIV },
  subRow:       { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 20, paddingVertical: 12 },
  subRowLabel:  { fontSize: 13, fontFamily: "Pretendard-Regular", fontWeight: "500" },
  subRowSub:    { fontSize: 11, fontFamily: "Pretendard-Regular", color: MUTED, marginTop: 1 },

  // Badge
  badge:    { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: "#D96C6C", alignItems: "center", justifyContent: "center", paddingHorizontal: 5, marginRight: 4 },
  badgeTxt: { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#fff", fontWeight: "600" },

  // Version
  versionBlock: { alignItems: "center", marginTop: 32, gap: 3 },
  versionApp:   { fontSize: 12, fontFamily: "Pretendard-Regular", fontWeight: "600", color: MUTED },
  versionNum:   { fontSize: 11, fontFamily: "Pretendard-Regular", color: MUTED },
});
