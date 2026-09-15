import { useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import { publicPost } from "@/lib/api-client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/Button";

type LoginResponse = {
  success: boolean;
  token?: string;
  totp_required?: boolean;
  totp_session?: string;
  message?: string;
};

type TotpResponse = {
  success: boolean;
  token?: string;
  message?: string;
};

const inputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  height: "40px",
  padding: "0 12px",
  fontSize: "14px",
  color: "var(--text-body)",
  background: "var(--surface-white)",
  border: "1px solid var(--border-default)",
  borderRadius: "6px",
  outline: "none",
  boxSizing: "border-box",
};

type Step =
  | { kind: "credentials" }
  | { kind: "totp"; totpSession: string };

export default function SuperLoginPage() {
  const { login } = useAuth();
  const [, navigate] = useLocation();

  const [step, setStep] = useState<Step>({ kind: "credentials" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (step.kind === "credentials") {
        const res = await publicPost<LoginResponse>("/auth/login", {
          email: email.trim(),
          password,
          web_login: true,
        });
        if (res.totp_required && res.totp_session) {
          setStep({ kind: "totp", totpSession: res.totp_session });
        } else if (res.token) {
          await login(res.token);
          navigate("/admin");
        } else {
          setError(res.message ?? "로그인에 실패했습니다.");
        }
      } else {
        const res = await publicPost<TotpResponse>("/auth/totp/verify-login", {
          totp_session: step.totpSession,
          otp_code: otpCode.replace(/\D/g, ""),
        });
        if (res.token) {
          await login(res.token);
          navigate("/admin");
        } else {
          setError(res.message ?? "OTP 인증에 실패했습니다.");
        }
      }
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string };
      if (e.status === 401 || e.status === 403) {
        setError(
          step.kind === "totp"
            ? "OTP 코드가 올바르지 않습니다."
            : "아이디 또는 비밀번호가 올바르지 않습니다."
        );
      } else if (e.status === 0 || !e.status) {
        setError("서버에 연결할 수 없습니다. 네트워크를 확인해주세요.");
      } else {
        setError(e.message ?? "로그인 중 오류가 발생했습니다.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#F0F2F5",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "380px",
          background: "#fff",
          border: "1px solid #E2E8F0",
          borderRadius: "12px",
          padding: "40px 36px",
          boxShadow: "0 1px 3px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.04)",
        }}
      >
        {/* Logo */}
        <div style={{ marginBottom: "32px", textAlign: "center" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", marginBottom: "8px" }}>
            <span style={{ fontSize: "20px", fontWeight: 800, color: "#1D4E8F", letterSpacing: "-0.5px" }}>
              SWIMNOTE
            </span>
            <span style={{ fontSize: "11px", fontWeight: 700, color: "#fff", background: "#1E293B", borderRadius: "4px", padding: "1px 6px" }}>
              SUPER
            </span>
          </div>
          <div style={{ fontSize: "13px", color: "#64748B", fontWeight: 500 }}>
            {step.kind === "credentials" ? "슈퍼관리자 로그인" : "OTP 인증"}
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} noValidate style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {step.kind === "credentials" ? (
            <>
              <div>
                <label style={{ display: "block", fontSize: "13px", fontWeight: 500, color: "#374151", marginBottom: "6px" }}>
                  아이디
                </label>
                <input
                  type="text"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="슈퍼관리자 아이디"
                  autoComplete="username"
                  autoFocus
                  style={inputStyle}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "13px", fontWeight: 500, color: "#374151", marginBottom: "6px" }}>
                  비밀번호
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="비밀번호"
                  autoComplete="current-password"
                  required
                  style={inputStyle}
                />
              </div>
            </>
          ) : (
            <>
              <div
                style={{
                  background: "#F8FAFC",
                  borderRadius: "8px",
                  padding: "12px 14px",
                  fontSize: "13px",
                  color: "#64748B",
                }}
              >
                <strong style={{ color: "#374151" }}>OTP 인증 코드를 입력해주세요.</strong>
                <br />
                SWIMNOTE 앱에 등록된 인증 앱(Google Authenticator 등)에서 코드를 확인하세요.
              </div>

              <div>
                <label style={{ display: "block", fontSize: "13px", fontWeight: 500, color: "#374151", marginBottom: "6px" }}>
                  OTP 코드
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value)}
                  placeholder="6자리 코드"
                  autoComplete="one-time-code"
                  autoFocus
                  maxLength={6}
                  required
                  style={{ ...inputStyle, letterSpacing: "0.2em", textAlign: "center", fontSize: "18px" }}
                />
              </div>
            </>
          )}

          {error && (
            <div style={{ padding: "10px 12px", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: "6px", fontSize: "13px", color: "#DC2626" }}>
              {error}
            </div>
          )}

          <Button
            type="submit"
            loading={loading}
            style={{ width: "100%", marginTop: "8px", height: "44px", fontSize: "15px" }}
          >
            {step.kind === "credentials" ? "다음" : "인증 완료"}
          </Button>
        </form>

        {/* Back buttons */}
        <div style={{ marginTop: "24px", textAlign: "center", display: "flex", flexDirection: "column", gap: "8px" }}>
          {step.kind === "totp" && (
            <button
              type="button"
              onClick={() => { setStep({ kind: "credentials" }); setOtpCode(""); setError(null); }}
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: "12px", color: "#94A3B8" }}
            >
              ← 처음으로 돌아가기
            </button>
          )}
          <button
            type="button"
            onClick={() => navigate("/admin/login")}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: "12px", color: "#94A3B8" }}
          >
            ← 수영장 관리자 로그인
          </button>
        </div>
      </div>
    </div>
  );
}
