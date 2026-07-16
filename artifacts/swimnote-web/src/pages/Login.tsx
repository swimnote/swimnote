import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";

const PRIMARY = "#002F5F";
const SECONDARY = "#01B2F1";

export default function Login() {
  const [, navigate] = useLocation();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const user = await login(email, password);
      if (user.role === "super_admin") {
        navigate("/super-admin");
      } else if (user.role === "pool_admin" && user.swimming_pool_id) {
        navigate(`/pool/${user.swimming_pool_id}/admin`);
      } else {
        navigate("/");
      }
    } catch (err: any) {
      setError(err?.data?.error || err?.data?.message || "이메일 또는 비밀번호가 올바르지 않습니다.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-[#f8f9fb]">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div
            className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4"
            style={{ background: PRIMARY }}
          >
            <span className="text-white text-[22px] font-black tracking-tighter" translate="no">S</span>
          </div>
          <h1 className="text-[22px] font-bold text-[#0a0a0a]" translate="no">SWIMNOTE</h1>
          <p className="text-[13px] text-[#888] mt-1">관리자 로그인</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-[#ebebeb] p-8">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[12px] font-semibold text-[#555] mb-1.5">이메일</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="이메일 주소 입력"
                required
                className="w-full px-4 py-3 rounded-xl border border-[#e5e5e5] text-[14px] text-[#0a0a0a] placeholder:text-[#ccc] focus:outline-none focus:border-[#01B2F1] transition-colors"
              />
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-[#555] mb-1.5">비밀번호</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="비밀번호 입력"
                required
                className="w-full px-4 py-3 rounded-xl border border-[#e5e5e5] text-[14px] text-[#0a0a0a] placeholder:text-[#ccc] focus:outline-none focus:border-[#01B2F1] transition-colors"
              />
            </div>

            {error && (
              <div className="px-4 py-3 rounded-xl bg-red-50 border border-red-100">
                <p className="text-[13px] text-red-600">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 rounded-xl text-white text-[14px] font-semibold transition-opacity hover:opacity-85 disabled:opacity-50 mt-2"
              style={{ background: PRIMARY }}
            >
              {loading ? "로그인 중..." : "로그인"}
            </button>
          </form>
        </div>

        <div className="mt-6 text-center">
          <button
            onClick={() => navigate("/")}
            className="text-[12px] text-[#bbb] hover:text-[#888] transition-colors"
          >
            ← 홈으로 돌아가기
          </button>
        </div>
      </div>
    </div>
  );
}
