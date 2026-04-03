import { Home, Layers, Send, Settings, Users } from "lucide-react";

const TABS = [
  { icon: Home, label: "홈" },
  { icon: Layers, label: "수업" },
  { icon: Send, label: "알림" },
  { icon: Users, label: "회원" },
  { icon: Settings, label: "설정" },
];

const THEME = "#2EC4B6";

function TabBar({
  height,
  paddingBottom,
  paddingTop = 8,
  activeIndex = 0,
}: {
  height: number;
  paddingBottom: number;
  paddingTop?: number;
  activeIndex?: number;
}) {
  return (
    <div
      style={{
        height,
        paddingBottom,
        paddingTop,
        backgroundColor: "#ffffff",
        borderTop: "1px solid #E2E8F0",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-around",
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        boxSizing: "border-box",
      }}
    >
      {TABS.map((tab, i) => {
        const Icon = tab.icon;
        const active = i === activeIndex;
        return (
          <div
            key={i}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 3,
              flex: 1,
            }}
          >
            <Icon
              size={22}
              color={active ? THEME : "#94A3B8"}
              strokeWidth={active ? 2.5 : 1.8}
              fill={active ? THEME + "22" : "none"}
            />
            <span
              style={{
                fontSize: 10,
                color: active ? THEME : "#94A3B8",
                fontFamily: "sans-serif",
                fontWeight: active ? 600 : 400,
                lineHeight: 1,
              }}
            >
              {tab.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function PhoneFrame({
  label,
  platform,
  variant,
  tabHeight,
  tabPaddingBottom,
  insetsBottom,
  notch,
  children,
}: {
  label: string;
  platform: string;
  variant: string;
  tabHeight: number;
  tabPaddingBottom: number;
  insetsBottom: number;
  notch: "dynamic-island" | "notch" | "none";
  children?: React.ReactNode;
}) {
  const PHONE_W = 260;
  const PHONE_H = 520;
  const BORDER_R = 36;
  const SCREEN_H = PHONE_H - 24;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
      <div
        style={{
          background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
          borderRadius: BORDER_R,
          width: PHONE_W,
          height: PHONE_H,
          padding: 10,
          boxShadow: "0 20px 60px rgba(0,0,0,0.35), 0 0 0 1.5px #333",
          position: "relative",
          boxSizing: "border-box",
        }}
      >
        {/* Screen */}
        <div
          style={{
            width: "100%",
            height: SCREEN_H,
            borderRadius: BORDER_R - 10,
            overflow: "hidden",
            backgroundColor: "#F8FAFC",
            position: "relative",
          }}
        >
          {/* Notch / Dynamic Island */}
          {notch === "dynamic-island" && (
            <div
              style={{
                position: "absolute",
                top: 10,
                left: "50%",
                transform: "translateX(-50%)",
                width: 90,
                height: 26,
                borderRadius: 14,
                backgroundColor: "#000",
                zIndex: 10,
              }}
            />
          )}
          {notch === "notch" && (
            <div
              style={{
                position: "absolute",
                top: 0,
                left: "50%",
                transform: "translateX(-50%)",
                width: 100,
                height: 26,
                borderRadius: "0 0 18px 18px",
                backgroundColor: "#000",
                zIndex: 10,
              }}
            />
          )}
          {/* Camera (Android) */}
          {notch === "none" && (
            <div
              style={{
                position: "absolute",
                top: 10,
                left: "50%",
                transform: "translateX(-50%)",
                width: 10,
                height: 10,
                borderRadius: "50%",
                backgroundColor: "#222",
                zIndex: 10,
              }}
            />
          )}

          {/* Screen content placeholder */}
          <div
            style={{
              position: "absolute",
              top: 40,
              left: 12,
              right: 12,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div style={{ height: 16, background: "#E2E8F0", borderRadius: 4, width: "60%" }} />
            <div style={{ height: 80, background: "#EEF2FF", borderRadius: 8, border: "1px solid #C7D2FE" }} />
            <div style={{ height: 10, background: "#E2E8F0", borderRadius: 4, width: "80%" }} />
            <div style={{ height: 10, background: "#E2E8F0", borderRadius: 4, width: "65%" }} />
            <div style={{ height: 60, background: "#F0FDF4", borderRadius: 8, border: "1px solid #BBF7D0" }} />
          </div>

          {/* Safe area indicator (insets.bottom zone) */}
          {insetsBottom > 0 && (
            <div
              style={{
                position: "absolute",
                bottom: 0,
                left: 0,
                right: 0,
                height: insetsBottom * 1.2,
                background: "rgba(239,68,68,0.08)",
                borderTop: "1px dashed rgba(239,68,68,0.35)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <span style={{ fontSize: 7, color: "#ef4444", fontFamily: "monospace" }}>
                insets.bottom = {insetsBottom}px
              </span>
            </div>
          )}

          {/* Tab bar */}
          <TabBar
            height={tabHeight * 1.2}
            paddingBottom={tabPaddingBottom * 1.2}
            activeIndex={0}
          />
        </div>

        {/* Home indicator or buttons */}
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: 14 }}>
          {notch !== "none" ? (
            <div style={{ width: 80, height: 4, borderRadius: 2, backgroundColor: "#555" }} />
          ) : (
            <div style={{ display: "flex", gap: 10 }}>
              {["◁", "○", "□"].map((b, i) => (
                <span key={i} style={{ fontSize: 9, color: "#666" }}>{b}</span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Info card */}
      <div
        style={{
          width: PHONE_W,
          backgroundColor: "#fff",
          border: "1px solid #E2E8F0",
          borderRadius: 12,
          padding: "12px 14px",
          boxSizing: "border-box",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#1E293B", fontFamily: "sans-serif" }}>
            {label}
          </span>
          <span
            style={{
              fontSize: 9,
              fontWeight: 600,
              color: "#fff",
              backgroundColor: platform === "iOS" ? "#2563EB" : "#16A34A",
              borderRadius: 4,
              padding: "2px 6px",
              fontFamily: "sans-serif",
            }}
          >
            {platform}
          </span>
          <span
            style={{
              fontSize: 9,
              color: "#64748B",
              border: "1px solid #E2E8F0",
              borderRadius: 4,
              padding: "2px 6px",
              fontFamily: "sans-serif",
            }}
          >
            {variant}
          </span>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "monospace", fontSize: 10 }}>
          <tbody>
            {[
              ["height", `${tabHeight}px`],
              ["paddingBottom", `${tabPaddingBottom}px`],
              ["insets.bottom", `${insetsBottom}px`],
            ].map(([k, v]) => (
              <tr key={k}>
                <td style={{ color: "#64748B", padding: "2px 0", paddingRight: 8 }}>{k}</td>
                <td style={{ color: "#2EC4B6", fontWeight: 700 }}>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function TabBarCompare() {
  const cases = [
    {
      label: "iPhone 15 Pro",
      platform: "iOS",
      variant: "Dynamic Island",
      tabHeight: 72,
      tabPaddingBottom: 12,
      insetsBottom: 0,
      notch: "dynamic-island" as const,
    },
    {
      label: "Galaxy S24",
      platform: "Android",
      variant: "제스처 내비게이션",
      tabHeight: 76,
      tabPaddingBottom: 16,
      insetsBottom: 16,
      notch: "none" as const,
    },
    {
      label: "Galaxy A55",
      platform: "Android",
      variant: "3버튼 내비게이션",
      tabHeight: 108,
      tabPaddingBottom: 48,
      insetsBottom: 48,
      notch: "none" as const,
    },
  ];

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "32px 24px",
        gap: 24,
        boxSizing: "border-box",
      }}
    >
      <div style={{ textAlign: "center", marginBottom: 8 }}>
        <h2 style={{ fontSize: 18, fontWeight: 800, color: "#1E293B", fontFamily: "sans-serif", margin: 0 }}>
          플랫폼별 탭바 비교
        </h2>
        <p style={{ fontSize: 12, color: "#64748B", fontFamily: "sans-serif", marginTop: 4 }}>
          iOS 고정 / Android insets 동적 적용
        </p>
      </div>

      <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap", justifyContent: "center" }}>
        {cases.map((c) => (
          <PhoneFrame key={c.label} {...c} />
        ))}
      </div>

      {/* Legend */}
      <div
        style={{
          display: "flex",
          gap: 16,
          padding: "10px 16px",
          backgroundColor: "#fff",
          borderRadius: 10,
          border: "1px solid #E2E8F0",
          fontFamily: "sans-serif",
          fontSize: 11,
          color: "#64748B",
          alignItems: "center",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <div style={{ width: 14, height: 14, background: "rgba(239,68,68,0.1)", border: "1px dashed #ef4444", borderRadius: 2 }} />
          <span>시스템 내비게이션 영역 (insets.bottom)</span>
        </div>
        <div style={{ width: 1, height: 16, backgroundColor: "#E2E8F0" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <div style={{ width: 14, height: 3, background: THEME, borderRadius: 2 }} />
          <span>탭바 컨텐츠 영역</span>
        </div>
      </div>
    </div>
  );
}
