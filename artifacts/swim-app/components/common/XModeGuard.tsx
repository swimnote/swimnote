/**
 * XModeGuard — X 전용 Route 접근 제어 컴포넌트 (WP5)
 *
 * 보호 우선순위 (순서 중요):
 *
 *  1. Auth 인증 완료 전      → 스피너 대기 (isLoading)
 *  2. kind 불일치            → 즉시 역할 홈 redirect (mode 로딩 기다리지 않음)
 *  3. role 불일치            → 즉시 역할 홈 redirect (mode 로딩 기다리지 않음)
 *  4. mode 로딩 중           → 스피너 대기 (auth 통과 후)
 *  5. mode === "x"           → children 렌더 (접근 허용)
 *  6. status === "error"     → fail-safe Lock UI (재시도 버튼)
 *  7. mode === "x_pending"   → 상태별 Lock UI (NOT_CONFIGURED / CURRICULUM_PENDING)
 *  8. mode === "normal"      → 구독 안내 Lock UI
 *
 * WP5 핵심:
 *   mode !== "x"인 경우 역할 홈 redirect 대신 상태별 Lock UI를 표시.
 *   kind/role 불일치(비 X 역할의 deep-link)만 redirect 처리 유지.
 *   X 상태 API 실패 시 fail-safe LOCK (X 기능 허용 방향 fallback 금지).
 *   일반 SWIMNOTE 기능(스케줄러/회원/일지 등)에는 영향 없음.
 *
 * 허용 역할 기준 (ModeProvider와 동일):
 *   - admin x-growth: allowedKind="admin" allowedRole="pool_admin"
 *   - teacher x-growth: allowedKind="admin" allowedRole="teacher"
 *   - parent x-growth: allowedKind="parent"
 */

import React, { useEffect, type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router } from "expo-router";
import { useMode } from "@/context/ModeContext";
import { useAuth } from "@/context/AuthContext";
import { LucideIcon } from "@/components/common/LucideIcon";
import Colors from "@/constants/colors";

const C = Colors.light;
// X 전용 토큰 — A1 Theme Polish (Steel Blue / Muted Gold)
const X_ACCENT        = "#355C7D";
const X_ACCENT_LIGHT  = "#E9EEF3";
const X_ACCENT_STRONG = "#23415C";
const X_PENDING       = "#B7791F";
const X_PENDING_LIGHT = "#F8EED8";
// 레거시 alias (non-X 용도 — ActivityIndicator 등)
const NAVY = "#14283D";

// ── 역할별 홈 경로 ─────────────────────────────────────────────────────────
function _getRoleHome(kind: string | null, role?: string): string {
  if (kind === "parent") return "/(parent)/home";
  if (kind === "admin") {
    if (role === "teacher") return "/(teacher)/today-schedule";
    return "/(admin)/dashboard";
  }
  return "/";
}

// ── Lock UI 타입 ────────────────────────────────────────────────────────────
type LockReason =
  | "no_entitlement"     // xmode_entitlement=false
  | "not_configured"     // entitlement 있음, xmode_config_status=NOT_CONFIGURED
  | "curriculum_pending" // entitlement 있음, xmode_config_status=CURRICULUM_PENDING
  | "api_error";         // status="error" — fail-safe

// ── Lock UI 컴포넌트 ────────────────────────────────────────────────────────
interface XModeLockUIProps {
  reason: LockReason;
  isPoolAdmin: boolean;
  errorCode: string | null;
  onRetry: () => void;
  onBack: () => void;
}

function XModeLockUI({ reason, isPoolAdmin, errorCode, onRetry, onBack }: XModeLockUIProps) {
  const config = _getLockConfig(reason, isPoolAdmin, errorCode);

  return (
    <View style={s.lockRoot}>
      {/* 헤더 뒤로가기 */}
      <View style={s.lockHeader}>
        <Pressable hitSlop={12} onPress={onBack} style={s.backBtn}>
          <LucideIcon name="arrow-left" size={20} color={NAVY} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={s.lockScroll}
        showsVerticalScrollIndicator={false}
      >
        {/* 아이콘 */}
        <View style={[s.lockIconWrap, { backgroundColor: config.iconBg }]}>
          <LucideIcon name={config.icon as any} size={32} color={config.iconColor} />
        </View>

        {/* X 배지 */}
        <View style={s.xBadge}>
          <Text style={s.xBadgeTxt}>SWIMNOTE X</Text>
        </View>

        {/* 제목 / 설명 */}
        <Text style={s.lockTitle}>{config.title}</Text>
        <Text style={s.lockDesc}>{config.desc}</Text>

        {/* 행동 버튼 */}
        {config.primaryBtn && (
          <Pressable
            style={s.primaryBtn}
            onPress={config.primaryBtn.onPress}
          >
            <Text style={s.primaryBtnTxt}>{config.primaryBtn.label}</Text>
          </Pressable>
        )}

        {/* 보조 텍스트 */}
        {config.note && (
          <Text style={s.lockNote}>{config.note}</Text>
        )}
      </ScrollView>
    </View>
  );

  function _getLockConfig(
    r: LockReason,
    poolAdmin: boolean,
    errCode: string | null,
  ) {
    switch (r) {
      case "no_entitlement":
        return {
          icon: "lock",
          iconColor: C.textMuted,
          iconBg: C.backgroundSoft,
          title: "SWIMNOTE X 전용 기능이에요",
          desc: "이 기능은 SWIMNOTE X 구독이 필요해요.\nX Mode를 구독하면 AI 기반 커리큘럼 성장 관리를 사용할 수 있어요.",
          primaryBtn: null,
          note: null,
        };

      case "not_configured":
        return {
          icon: "settings",
          iconColor: X_ACCENT,
          iconBg: X_ACCENT_LIGHT,
          title: "X Mode 설정이 필요해요",
          desc: "X Mode를 시작하려면 먼저 설정을 완료해 주세요.\n커리큘럼 설정 후 이 기능을 사용할 수 있어요.",
          primaryBtn: poolAdmin
            ? {
                label: "X 설정 시작하기",
                onPress: () => router.push("/(admin)/x-setup" as any),
              }
            : null,
          note: poolAdmin ? null : "수영장 관리자에게 X Mode 설정을 요청해 주세요.",
        };

      case "curriculum_pending":
        return {
          icon: "clock",
          iconColor: X_PENDING,
          iconBg: X_PENDING_LIGHT,
          title: "커리큘럼 검토 중이에요",
          desc: "X Mode 커리큘럼이 검토 중입니다.\n검토 완료 후 자동으로 활성화되니 조금만 기다려 주세요.",
          primaryBtn: null,
          note: null,
        };

      case "api_error":
        return {
          icon: "alert-circle",
          iconColor: "#EF4444",
          iconBg: "#FEE2E2",
          title: "X Mode 상태를 확인할 수 없어요",
          desc: errCode === "network_error" || errCode === "timeout"
            ? "네트워크 연결을 확인하고 다시 시도해 주세요."
            : "일시적인 오류가 발생했어요. 잠시 후 다시 시도해 주세요.",
          primaryBtn: {
            label: "다시 시도",
            onPress: onRetry,
          },
          note: null,
        };
    }
  }
}

// ── Props ───────────────────────────────────────────────────────────────────
interface XModeGuardProps {
  children: ReactNode;
  /**
   * 허용할 Auth kind ("admin" | "parent").
   * 미지정 시 kind 검사 생략.
   */
  allowedKind?: string;
  /**
   * 허용할 adminUser.role (단일 또는 배열).
   * 미지정 시 role 검사 생략.
   */
  allowedRole?: string | string[];
}

// ── Guard 본체 ───────────────────────────────────────────────────────────────
export function XModeGuard({ children, allowedKind, allowedRole }: XModeGuardProps) {
  const { mode, xmode_entitlement, xmode_config_status, status, error, refreshMode } = useMode();
  const { kind, adminUser, isLoading } = useAuth();

  const currentRole = adminUser?.role ?? "";
  const roles: string[] = allowedRole === undefined
    ? []
    : Array.isArray(allowedRole) ? allowedRole : [allowedRole];
  const isPoolAdmin = currentRole === "pool_admin";

  // ─── Step 1: Auth 완료 여부 ─────────────────────────────────────────────
  const authReady = !isLoading;

  // ─── Step 2 & 3: kind/role 검사 (mode status 무관하게 즉시 평가) ──────────
  // kind/role 불일치 → 역할 홈 redirect (Lock UI 아님)
  const wrongKind = authReady && allowedKind !== undefined && kind !== allowedKind;
  const wrongRole = authReady && roles.length > 0 && !roles.includes(currentRole);
  const authBlocked = wrongKind || wrongRole;

  useEffect(() => {
    if (authBlocked) {
      const home = _getRoleHome(kind, adminUser?.role);
      router.replace(home as any);
    }
  }, [authBlocked, kind, adminUser?.role]);

  // ─── Step 4: mode 로딩 여부 (auth 통과 후 대기) ──────────────────────────
  const modeSettled = authReady && !authBlocked && (status === "ready" || status === "error");

  // ── 렌더 결정 ──────────────────────────────────────────────────────────────

  // Auth 로딩 중
  if (isLoading) {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color={X_ACCENT} />
      </View>
    );
  }

  // auth 실패 → useEffect redirect 대기
  if (authBlocked) return null;

  // mode 로딩 중 (auth 통과, mode 미확정)
  if (!modeSettled) {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color={X_ACCENT} />
      </View>
    );
  }

  // ─── Step 6: status="error" → fail-safe Lock UI ─────────────────────────
  if (status === "error") {
    return (
      <XModeLockUI
        reason="api_error"
        isPoolAdmin={isPoolAdmin}
        errorCode={error}
        onRetry={refreshMode}
        onBack={() => router.back()}
      />
    );
  }

  // ─── Step 5: mode === "x" → children ────────────────────────────────────
  if (mode === "x") {
    return <>{children}</>;
  }

  // ─── Step 7 & 8: mode !== "x" → 상태별 Lock UI ──────────────────────────
  const lockReason = _resolveLockReason(xmode_entitlement, xmode_config_status);
  return (
    <XModeLockUI
      reason={lockReason}
      isPoolAdmin={isPoolAdmin}
      errorCode={null}
      onRetry={refreshMode}
      onBack={() => router.back()}
    />
  );
}

// ── Lock 이유 결정 (Source of Truth: ModeContext 값 기반) ───────────────────
function _resolveLockReason(
  entitlement: boolean,
  configStatus: import("@/context/ModeContext").XModeStatus | null,
): LockReason {
  if (!entitlement) return "no_entitlement";
  if (configStatus === "CURRICULUM_PENDING") return "curriculum_pending";
  // NOT_CONFIGURED 또는 null (x_pending의 기본)
  return "not_configured";
}

// ── StyleSheet ──────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  center: {
    flex: 1,
    backgroundColor: "#fff",
    justifyContent: "center",
    alignItems: "center",
  },
  // Lock UI
  lockRoot: {
    flex: 1,
    backgroundColor: C.background,
  },
  lockHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 12,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: C.backgroundSoft,
    alignItems: "center", justifyContent: "center",
  },
  lockScroll: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 16,
  },
  lockIconWrap: {
    width: 80, height: 80, borderRadius: 24,
    alignItems: "center", justifyContent: "center",
    marginBottom: 4,
  },
  xBadge: {
    backgroundColor: X_ACCENT_LIGHT,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: X_ACCENT,
  },
  xBadgeTxt: {
    fontSize: 11,
    fontFamily: "Pretendard-SemiBold",
    color: X_ACCENT_STRONG,
  },
  lockTitle: {
    fontSize: 18,
    fontFamily: "Pretendard-SemiBold",
    color: NAVY,
    textAlign: "center",
    marginTop: 4,
  },
  lockDesc: {
    fontSize: 14,
    fontFamily: "Pretendard-Regular",
    color: C.textSecondary,
    textAlign: "center",
    lineHeight: 22,
  },
  primaryBtn: {
    backgroundColor: X_ACCENT,
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 28,
    marginTop: 8,
  },
  primaryBtnTxt: {
    fontSize: 15,
    fontFamily: "Pretendard-SemiBold",
    color: "#fff",
  },
  lockNote: {
    fontSize: 13,
    fontFamily: "Pretendard-Regular",
    color: C.textMuted,
    textAlign: "center",
    lineHeight: 20,
    marginTop: 4,
  },
});
