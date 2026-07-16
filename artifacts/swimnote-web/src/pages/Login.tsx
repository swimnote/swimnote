import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import type { LoginResult } from "@/contexts/AuthContext";
import { Shield, Smartphone } from "lucide-react";

const PRIMARY = "#002F5F";
const PURPLE = "#7C3AED";

export default function Login() {
  const [, navigate] = useLocation();
  const { login, completeTotpLogin } = useAuth();

  const [step, setStep] = useState<"credentials" | "otp">("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpSession, setTotpSession] = useState("");
  const [digits, setDigits] = useState(["", "", "", "", "", ""]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const digitRefs = useRef<(HTMLInputElement | null)[]>(Array(6).fill(null));

  useEffect(() => {
    if (step === "otp") {
      setTimeout(() => digitRefs.current[0]?.focus(), 100);
    }
  }, [step]);

  const otpCode = digits.join("");

  const handleCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const result = await login(email, password);
      if ((result as LoginResult).totp_required) {
        setTotpSession((result as LoginResult).totp_session);
        setStep("otp");
      } else {
        const user = result as any;
        if (user.role === "super_admin") navigate("/super-admin");
        else if (user.role === "pool_admin" && user.swimming_pool_id)
          navigate(`/pool/${user.swimming_pool_id}/admin`);
        else navigate("/");
      }
    } catch (err: any) {
      setError(err?.data?.error || err?.data?.message || "이메일 또는 비밀번호가 올바르지 않습니다.");
    } finally {
      setLoading(false);
    }
  };

  const handleOtp = async () => {
    if (otpCode.length !== 6) { setError("6자리 코드를 입력해주세요."); return; }
    setError("");
    setLoading(true);
    try {
      const user = await completeTotpLogin(totpSession, otpCode);
      if (user.role === "super_admin") navigate("/super-admin");
      else if (user.role === "pool_admin" && user.swimming_pool_id)
        navigate(`/pool/${user.swimming_pool_id}/admin`);
      else navigate("/");
    } catch (err: any) {
      setError(err?.data?.error || err?.data?.message || "OTP 코드가 올바르지 않거나 만료되었습니다.");
      setDigits(["", "", "", "", "", ""]);
      setTimeout(() => digitRefs.current[0]?.focus(), 100);
    } finally {
      setLoading(false);
    }
  };

  const handleDigitChange = (index: number, value: string) => {
    const digit = value.replace(/\D/g, "").slice(-1);
    const next = [...digits];
    next[index] = digit;
    setDigits(next);
    setError("");
    if (digit && index < 5) digitRefs.current[index + 1]?.focus();
    if (digit && index === 5) {
      const full = next.join("");
      if (full.length === 6) setTimeout(handleOtp, 80);
    }
  };

  const handleDigitKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      const next = [...digits];
      next[index - 1] = "";
      setDigits(next);
      digitRefs.current[index - 1]?.focus();
    }
  };

  const handleDigitPaste = (e: React.ClipboardEvent) => {
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (pasted.length === 6) {
      setDigits(pasted.split(""));
      digitRefs.current[5]?.focus();
      setTimeout(handleOtp, 80);
    }
    e.preventDefault();
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-[#f8f9fb]">
      <div className="w-full max-w-sm">

        {step === "credentials" ? (
          <>
            <div className="mb-8 text-center">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4" style={{ background: PRIMARY }}>
                <span className="text-white text-[22px] font-black tracking-tighter" translate="no">S</span>
              </div>
              <h1 className="text-[22px] font-bold text-[#0a0a0a]" translate="no">SWIMNOTE</h1>
              <p className="text-[13px] text-[#888] mt-1">관리자 로그인</p>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-[#ebebeb] p-8">
              <form onSubmit={handleCredentials} className="space-y-4">
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
          </>
        ) : (
          <>
            <div className="mb-6 text-center">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4" style={{ background: "#EDE9FE" }}>
                <Smartphone size={26} color={PURPLE} />
              </div>
              <h1 className="text-[20px] font-bold text-[#0a0a0a]">Google OTP 인증</h1>
              <p className="text-[13px] text-[#888] mt-1">Google Authenticator 앱에서<br />6자리 코드를 입력해주세요.</p>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-[#ebebeb] p-8">
              <div className="flex items-center gap-2 mb-5 px-3 py-2 rounded-xl" style={{ background: "#F5F3FF" }}>
                <Shield size={13} color={PURPLE} />
                <span className="text-[12px] font-semibold" style={{ color: PURPLE }}>2단계 인증</span>
              </div>

              {error && (
                <div className="px-4 py-3 rounded-xl bg-red-50 border border-red-100 mb-4">
                  <p className="text-[13px] text-red-600">{error}</p>
                </div>
              )}

              <div className="flex justify-center gap-2 mb-6">
                {digits.map((d, i) => (
                  <input
                    key={i}
                    ref={(el) => { digitRefs.current[i] = el; }}
                    type="text"
                    inputMode="numeric"
                    maxLength={2}
                    value={d}
                    onChange={(e) => handleDigitChange(i, e.target.value)}
                    onKeyDown={(e) => handleDigitKeyDown(i, e)}
                    onPaste={i === 0 ? handleDigitPaste : undefined}
                    className="w-11 h-14 text-center text-[22px] font-bold rounded-xl border-2 focus:outline-none transition-all"
                    style={{
                      borderColor: d ? PURPLE : "#e5e5e5",
                      background: d ? "#EDE9FE" : "#fafafa",
                      color: PURPLE,
                    }}
                  />
                ))}
              </div>

              <button
                onClick={handleOtp}
                disabled={loading || otpCode.length !== 6}
                className="w-full py-3.5 rounded-xl text-white text-[14px] font-semibold transition-all hover:opacity-85 disabled:opacity-40"
                style={{ background: otpCode.length === 6 ? PURPLE : "#d1d5db" }}
              >
                {loading ? "인증 중..." : "인증 완료"}
              </button>

              <button
                onClick={() => { setStep("credentials"); setDigits(["","","","","",""]); setError(""); }}
                className="w-full mt-3 py-2.5 text-[13px] text-[#aaa] hover:text-[#666] transition-colors"
              >
                ← 비밀번호 입력으로 돌아가기
              </button>
            </div>

            <div className="mt-4 flex items-start gap-2 px-4 py-3 rounded-xl border" style={{ background: "#F5F3FF", borderColor: "#EDE9FE" }}>
              <Shield size={13} color={PURPLE} className="mt-0.5 shrink-0" />
              <p className="text-[12px] leading-relaxed" style={{ color: "#5B21B6" }}>
                Google Authenticator 앱을 열고 계정 이름 옆의 6자리 숫자를 입력하세요. 코드는 30초마다 갱신됩니다.
              </p>
            </div>
          </>
        )}

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
