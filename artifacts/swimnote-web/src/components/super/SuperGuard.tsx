import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";

/**
 * SuperGuard — super_admin 전용 접근 제어
 * UI 숨기기만으로 끝내지 않음. 서버 권한은 각 API에서 별도 보호.
 */
export default function SuperGuard({ children }: { children: React.ReactNode }) {
  const [, navigate] = useLocation();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && (!user || user.role !== "super_admin")) {
      navigate("/login", { replace: true });
    }
  }, [user, loading, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f5f5f7]">
        <span className="text-[13px] text-[#999]">인증 확인 중...</span>
      </div>
    );
  }

  if (!user || user.role !== "super_admin") return null;

  return <>{children}</>;
}
