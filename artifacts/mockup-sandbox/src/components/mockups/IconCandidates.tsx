import {
  Bell, Inbox, MessageCircleMore, ClipboardList, Mail, ListChecks,
  MessageSquareDot, Send, BellDot, MailOpen, Megaphone, HandHelping,
  MessageCircleQuestion, FileQuestion, CircleHelp
} from "lucide-react";

const candidates = [
  { name: "bell", label: "bell\n(현재)", Icon: Bell },
  { name: "inbox", label: "inbox", Icon: Inbox },
  { name: "message-circle-more", label: "message-\ncircle-more", Icon: MessageCircleMore },
  { name: "mail-open", label: "mail-open", Icon: MailOpen },
  { name: "message-square-dot", label: "message-\nsquare-dot", Icon: MessageSquareDot },
  { name: "list-checks", label: "list-checks", Icon: ListChecks },
  { name: "clipboard-list", label: "clipboard-\nlist", Icon: ClipboardList },
  { name: "send", label: "send", Icon: Send },
  { name: "megaphone", label: "megaphone", Icon: Megaphone },
  { name: "hand-helping", label: "hand-\nhelping", Icon: HandHelping },
  { name: "message-circle-question", label: "message-\ncircle-?", Icon: MessageCircleQuestion },
  { name: "circle-help", label: "circle-help", Icon: CircleHelp },
];

export default function IconCandidates() {
  return (
    <div style={{ fontFamily: "sans-serif", backgroundColor: "#f5f5f5", minHeight: "100vh", padding: 24 }}>
      {/* 헤더 맥락 미리보기 */}
      <div style={{ marginBottom: 24 }}>
        <p style={{ fontSize: 11, color: "#999", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>
          헤더 맥락 미리보기
        </p>
        <div style={{
          background: "#fff",
          borderRadius: 16,
          padding: "12px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
          maxWidth: 360,
        }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: "#1a1a1a" }}>서울 수영장</span>
          <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
            {/* 후보 아이콘 (inbox 예시) */}
            <div style={{ position: "relative" }}>
              <Inbox size={20} color="#555" />
              <div style={{
                position: "absolute", top: -2, right: -2,
                width: 8, height: 8, borderRadius: 4,
                backgroundColor: "#E53E3E", border: "1.5px solid #fff"
              }} />
            </div>
            <MessageCircleMore size={20} color="#aaa" />
            <div style={{ width: 26, height: 26, borderRadius: 8, background: "#eee", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ fontSize: 10, color: "#888" }}>로고</span>
            </div>
          </div>
        </div>
      </div>

      {/* 전체 후보 그리드 */}
      <p style={{ fontSize: 11, color: "#999", marginBottom: 12, textTransform: "uppercase", letterSpacing: 1 }}>
        전체 후보 ({candidates.length}개)
      </p>
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: 12,
        maxWidth: 480,
      }}>
        {candidates.map(({ name, label, Icon }) => (
          <div
            key={name}
            style={{
              background: name === "bell" ? "#fff8e6" : "#fff",
              border: name === "bell" ? "1.5px solid #f0c040" : "1.5px solid #e8e8e8",
              borderRadius: 14,
              padding: "14px 8px 10px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 8,
              boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
            }}
          >
            <div style={{ position: "relative" }}>
              <Icon size={26} color={name === "bell" ? "#c8972a" : "#333"} strokeWidth={1.8} />
              {(name === "bell" || name === "inbox" || name === "bell-dot") && (
                <div style={{
                  position: "absolute", top: -2, right: -2,
                  width: 7, height: 7, borderRadius: 4,
                  backgroundColor: "#E53E3E", border: "1.5px solid #fff"
                }} />
              )}
            </div>
            <span style={{
              fontSize: 9.5,
              color: "#666",
              textAlign: "center",
              whiteSpace: "pre-line",
              lineHeight: 1.4,
            }}>{label}</span>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 20, padding: "12px 16px", background: "#e8f4ff", borderRadius: 12, maxWidth: 480 }}>
        <p style={{ fontSize: 11, color: "#2563eb", margin: 0 }}>
          💡 <strong>inbox</strong> — 알림·요청 모두 포함하는 가장 범용적 표현<br/>
          💡 <strong>message-circle-more</strong> — 소통·요청 진행 중인 느낌<br/>
          💡 <strong>send</strong> — 요청 전송 느낌 (단방향)
        </p>
      </div>
    </div>
  );
}
