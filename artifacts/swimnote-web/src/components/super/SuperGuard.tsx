import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";

/**
 * SuperGuard — super_admin 전용 접근 제어
 * UI 숨기기만으로 끝내지 않음. 서버 권한은 각 API에서 별도 보호.
 */
export default function SuperGuard({ children, allowPlatformAdmin = false }: {
  children: React.ReactNode; allowPlatformAdmin?: boolean;
}) {
  const [, navigate] = useLocation();
  const { user, loading } = useAuth();
  // The login API also returns platform_admin; the legacy web User union is narrower.
  const role = String(user?.role ?? "");
  const allowed = role === "super_admin" ||
    (allowPlatformAdmin && role === "platform_admin");

  useEffect(() => {
    if (!loading && !allowed) {
      navigate("/login", { replace: true });
    }
  }, [allowed, loading, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f5f5f7]">
        <span className="text-[13px] text-[#999]">인증 확인 중...</span>
      </div>
    );
  }

  if (!allowed) return null;

  return <>{children}</>;
}
