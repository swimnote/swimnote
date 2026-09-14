import { useAuth } from "@/contexts/AuthContext";
import { LogOut, Lock } from "lucide-react";

export default function XGatePage() {
  const { state, logout } = useAuth();
  const poolName =
    state.status === "authenticated" ? state.user.poolName : undefined;
  const xMode =
    state.status === "authenticated" ? state.user.xMode : undefined;

  const modeLabel: Record<string, string> = {
    x_pending:            "X 설정 진행 중",
    normal:               "일반 플랜",
    subscription_required: "구독 갱신 필요",
    unknown:              "상태 확인 중",
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg-page, #F8F9FA)",
        fontFamily: "'Pretendard', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif",
      }}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: "16px",
          border: "1px solid var(--border-default, #E5E7EB)",
          padding: "48px 40px",
          maxWidth: "420px",
          width: "100%",
          textAlign: "center",
          boxShadow: "0 4px 24px rgba(0,0,0,0.06)",
        }}
      >
        <div
          style={{
            width: "56px",
            height: "56px",
            borderRadius: "14px",
            background: "#F1F5F9",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 24px",
          }}
        >
          <Lock size={26} color="#64748B" />
        </div>

        <h1
          style={{
            fontSize: "18px",
            fontWeight: 700,
            color: "#111827",
            margin: "0 0 8px",
          }}
        >
          SWIMNOTE X 전용 기능
        </h1>
        <p
          style={{
            fontSize: "14px",
            color: "#6B7280",
            margin: "0 0 20px",
            lineHeight: 1.6,
          }}
        >
          PC 관리 대시보드는{" "}
          <strong style={{ color: "#111827" }}>SWIMNOTE X 이용 수영장 전용</strong>
          입니다.
          <br />현재 수영장의 X 이용 권한을 확인해 주세요.
        </p>

        {poolName && (
          <div
            style={{
              background: "#F8F9FA",
              borderRadius: "8px",
              padding: "12px 16px",
              marginBottom: "20px",
              fontSize: "13px",
              color: "#374151",
            }}
          >
            <span style={{ color: "#9CA3AF" }}>수영장</span>{" "}
            <strong>{poolName}</strong>
            {xMode && modeLabel[xMode] && (
              <>
                {" "}·{" "}
                <span style={{ color: "#EF4444" }}>{modeLabel[xMode]}</span>
              </>
            )}
          </div>
        )}

        <p
          style={{
            fontSize: "13px",
            color: "#9CA3AF",
            margin: "0 0 28px",
          }}
        >
          X 가입 문의는 SWIMNOTE 운영팀에 연락해 주세요.
        </p>

        <button
          onClick={logout}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            padding: "10px 20px",
            borderRadius: "8px",
            border: "1px solid #E5E7EB",
            background: "#fff",
            fontSize: "13px",
            color: "#374151",
            cursor: "pointer",
          }}
        >
          <LogOut size={14} />
          로그아웃
        </button>
      </div>
    </div>
  );
}
