/**
 * XModeGuard — X 전용 Route 접근 제어 컴포넌트 (WP4 + WP6)
 *
 * 보호 우선순위 (순서 중요):
 *
 *  1. Auth 인증 완료 전         → 스피너 대기 (isLoading)
 *  2. kind 불일치               → 즉시 역할 홈 redirect (mode 로딩 기다리지 않음)
 *  3. role 불일치               → 즉시 역할 홈 redirect (mode 로딩 기다리지 않음)
 *  4. mode 로딩 중              → 스피너 대기 (auth 통과 후)
 *  5. mode !== "x"              → 역할 홈 redirect
 *  6. requiredCapability 있고
 *     capabilities가 아직 null → 스피너 대기
 *  7. requiredCapability가
 *     false                     → 역할 홈 redirect
 *  8. 모두 통과                  → children 렌더
 *
 * 핵심: kind/role 검사는 ModeProvider 상태(idle 포함)에 무관하게 즉시 평가.
 * ModeProvider가 영구 idle을 유지하는 역할(sub_admin 등)이 deep-link해도 redirect됨.
 *
 * 허용 역할 기준 (ModeProvider와 동일):
 *   - admin x-growth:   allowedKind="admin" allowedRole="pool_admin"
 *   - teacher x-growth: allowedKind="admin" allowedRole="teacher"
 *   - parent x-growth:  allowedKind="parent"
 */

import React, { useEffect, type ReactNode } from "react";
import { ActivityIndicator, View } from "react-native";
import { router } from "expo-router";
import { useMode, type XCapabilityKey } from "@/context/ModeContext";
import { useAuth } from "@/context/AuthContext";

// ── 역할별 홈 경로 ─────────────────────────────────────────────────────────
function _getRoleHome(kind: string | null, role?: string): string {
  if (kind === "parent") return "/(parent)/home";
  if (kind === "admin") {
    if (role === "teacher") return "/(teacher)/today-schedule";
    return "/(admin)/dashboard";
  }
  return "/";
}

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
  /**
   * WP6: 필요한 X Capability 키.
   * 미지정 시 Capability 검사 생략 (mode==="x"만으로 통과).
   * 지정 시 해당 Capability가 true여야 children 렌더.
   * false이면 역할 홈 redirect.
   */
  requiredCapability?: XCapabilityKey;
}

export function XModeGuard({
  children,
  allowedKind,
  allowedRole,
  requiredCapability,
}: XModeGuardProps) {
  const { mode, status, capabilities, hasCapability } = useMode();
  const { kind, adminUser, isLoading } = useAuth();

  const currentRole = adminUser?.role ?? "";
  const roles: string[] = allowedRole === undefined
    ? []
    : Array.isArray(allowedRole) ? allowedRole : [allowedRole];

  // ─── Step 1: Auth 완료 여부 ─────────────────────────────────────────────
  // isLoading 중엔 kind/role 미확정 → 판단 보류
  const authReady = !isLoading;

  // ─── Step 2 & 3: kind/role 검사 (mode status 무관하게 즉시 평가) ──────────
  const wrongKind = authReady && allowedKind !== undefined && kind !== allowedKind;
  const wrongRole = authReady && roles.length > 0 && !roles.includes(currentRole);
  const authBlocked = wrongKind || wrongRole;

  // ─── Step 4: mode 로딩 여부 (auth 통과 후 대기) ──────────────────────────
  const modeReady = authReady && !authBlocked && (status === "ready" || status === "error");

  // ─── Step 5: mode 검사 ───────────────────────────────────────────────────
  const wrongMode = modeReady && mode !== "x";

  // ─── Step 6: Capability 로딩 여부 ────────────────────────────────────────
  // capabilities는 mode와 동일한 API 호출로 로드되므로
  // modeReady=true 시 capabilities는 non-null.
  // 단, parse_error 시 EMPTY_X_CAPABILITIES(전부 false)로 fail-closed 처리됨.
  const capabilityReady = !requiredCapability || capabilities !== null;

  // ─── Step 7: Capability 검사 ─────────────────────────────────────────────
  const wrongCapability =
    modeReady &&
    !wrongMode &&
    !!requiredCapability &&
    !hasCapability(requiredCapability);

  const shouldRedirect = authBlocked || wrongMode || wrongCapability;

  useEffect(() => {
    if (shouldRedirect) {
      const home = _getRoleHome(kind, adminUser?.role);
      router.replace(home as any);
    }
  }, [shouldRedirect, kind, adminUser?.role]);

  // ── 렌더 결정 ─────────────────────────────────────────────────────────────

  // Auth 로딩 중
  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: "#fff", justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" color="#2EC4B6" />
      </View>
    );
  }

  // auth 실패 → useEffect redirect 대기
  if (authBlocked) return null;

  // mode 로딩 중 (auth 통과, mode 미확정)
  if (!modeReady) {
    return (
      <View style={{ flex: 1, backgroundColor: "#fff", justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" color="#2EC4B6" />
      </View>
    );
  }

  // mode 실패 → useEffect redirect 대기
  if (wrongMode) return null;

  // Step 6: Capability 로딩 중 (통상 modeReady 시 즉시 해소)
  if (!capabilityReady) {
    return (
      <View style={{ flex: 1, backgroundColor: "#fff", justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" color="#2EC4B6" />
      </View>
    );
  }

  // Step 7: Capability 실패 → useEffect redirect 대기
  if (wrongCapability) return null;

  return <>{children}</>;
}
