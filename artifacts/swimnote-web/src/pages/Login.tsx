// /login — Pool PC Dashboard 전용 로그인
// super_admin은 이 페이지에서 차단. /super-login 사용.
// poolId는 서버가 계정으로 자동 식별 (URL 파라미터 불필요).

import { useState } from "react";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import type { LoginResult, WebPinRequired } from "@/contexts/AuthContext";
import MobileGuard from "@/components/site/MobileGuard";

const PRIMARY = "#002F5F";

export default function Login() {
  const [, navigate] = useLocation();
  const { login, completeWebPinLogin } = useAuth();

  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [pin, setPin]           = useState("");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!pin.trim()) { setError("PIN 번호를 입력해주세요."); return; }
    setLoading(true);
    try {
      const result = await login(email, password);

      // super_admin 차단 — TOTP 요구는 super_admin 계정의 특징
      if ((result as LoginResult).totp_required) {
        setError("수영장 관리자 계정만 PC 대시보드에 로그인할 수 있습니다.");
        setLoading(false);
        return;
      }

      if ((result as WebPinRequired).web_pin_required) {
        const webSess = (result as WebPinRequired).web_session;
        const user = await completeWebPinLogin(webSess, pin);
        if (user.role !== "pool_admin") {
          setError("수영장 관리자 계정만 PC 대시보드에 로그인할 수 있습니다.");
          setLoading(false);
          return;
        }
        navigate("/admin");
        return;
      }

      // web_pin 없이 바로 성공한 경우 — role 확인
      const u = result as any;
      if (u.role !== "pool_admin") {
        setError("수영장 관리자 계정만 PC 대시보드에 로그인할 수 있습니다.");
        setLoading(false);
        return;
      }
      navigate("/admin");
    } catch (err: any) {
      setError(err?.data?.error || err?.data?.message || "입력 정보를 다시 확인해주세요.");
      setLoading(false);
    }
  };

  // /login은 항상 Pool PC Dashboard — Desktop-only (MobileGuard skip 없음)
  return (
    <MobileGuard>
      <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-[#f8f9fb]">
        <div className="w-full max-w-sm">

          {/* Logo */}
          <div className="mb-8 text-center">
            <img
              src={`${import.meta.env.BASE_URL}swimnote-logo-vertical.png`}
              alt="SWIMNOTE"
              style={{ width: 80, height: 80, objectFit: "contain", borderRadius: 16, display: "inline-block", marginBottom: 16 }}
            />
            <h1 className="text-[16px] font-semibold text-[#0a0a0a]" translate="no">PC 대시보드</h1>
          </div>

          {/* Form */}
          <div className="bg-white rounded-2xl shadow-sm border border-[#ebebeb] p-8">
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-[12px] font-semibold text-[#555] mb-1.5">
                  아이디(이메일)
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setError(""); }}
                  placeholder="이메일 주소 입력"
                  required
                  autoComplete="username"
                  className="w-full px-4 py-3 rounded-xl border border-[#e5e5e5] text-[14px] focus:outline-none focus:border-[#002F5F] transition-colors"
                />
              </div>

              <div>
                <label className="block text-[12px] font-semibold text-[#555] mb-1.5">
                  비밀번호
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(""); }}
                  placeholder="비밀번호 입력"
                  required
                  autoComplete="current-password"
                  className="w-full px-4 py-3 rounded-xl border border-[#e5e5e5] text-[14px] focus:outline-none focus:border-[#002F5F] transition-colors"
                />
              </div>

              <div>
                <label className="block text-[12px] font-semibold text-[#555] mb-1.5">
                  PIN 번호
                </label>
                <input
                  type="password"
                  value={pin}
                  onChange={(e) => { setPin(e.target.value); setError(""); }}
                  placeholder="앱에서 설정한 PIN 번호"
                  required
                  autoComplete="off"
                  inputMode="numeric"
                  className="w-full px-4 py-3 rounded-xl border border-[#e5e5e5] text-[14px] focus:outline-none focus:border-[#002F5F] transition-colors"
                />
                <p className="text-[11px] text-[#999] mt-1.5">
                  PIN 번호는 SWIMNOTE 앱에서 설정할 수 있습니다.
                </p>
              </div>

              {error && (
                <p className="text-[12px] text-red-500 text-center leading-snug">{error}</p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3.5 rounded-xl text-white font-semibold text-[14px] transition-opacity disabled:opacity-60"
                style={{ background: PRIMARY }}
              >
                {loading ? "로그인 중..." : "로그인"}
              </button>
            </form>
          </div>

          <p className="text-center mt-6 text-[12px] text-[#bbb]">
            <Link href="/" style={{ color: "inherit", textDecoration: "none" }} className="hover:text-[#888] transition-colors">← 홈으로 돌아가기</Link>
          </p>
        </div>
      </div>
    </MobileGuard>
  );
}
