import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import MobileGuard from "@/components/site/MobileGuard";

export default function AdminGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (loading) return;
    if (!user) { navigate("/login"); return; }
    if (user.role !== "pool_admin" && user.role !== "super_admin") { navigate("/"); }
  }, [user, loading, navigate]);

  // WP9: Block mobile/tablet from /admin/* (UX guard, not a security control)
  return (
    <MobileGuard>
      {loading ? (
        <div className="min-h-screen flex items-center justify-center bg-[#F5F6FA]">
          <div className="w-8 h-8 border-2 border-[#0369A1] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : !user ? null : <>{children}</>}
    </MobileGuard>
  );
}
