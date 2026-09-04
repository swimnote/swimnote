/**
 * SuperAdmin.tsx — legacy redirect shim
 * /super-admin → /super/overview 로 리다이렉트.
 * 기존 기능은 모두 /super/* 하위 페이지로 이동됨 (WP-SA0-A).
 */
import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";

export default function SuperAdmin() {
  const [, navigate] = useLocation();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (!user || user.role !== "super_admin") {
      navigate("/login", { replace: true });
    } else {
      navigate("/super/overview", { replace: true });
    }
  }, [user, loading, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f5f5f7]">
      <span className="text-[13px] text-[#999]">이동 중...</span>
    </div>
  );
}
