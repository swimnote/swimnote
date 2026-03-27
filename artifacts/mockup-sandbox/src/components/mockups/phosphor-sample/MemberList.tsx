import {
  MagnifyingGlass, Funnel, UserCircle, Phone, CalendarDots,
  CheckCircle, Clock, XCircle, Plus, CaretRight, SwimmingPool,
  DotsThreeVertical, Star, Warning
} from "@phosphor-icons/react";

const TINT = "#2EC4B6";
const TEXT = "#0F172A";
const SECONDARY = "#64748B";
const BG = "#F5F5F5";
const CARD = "#FFFFFF";
const MINT_BOX = "#E6FAF8";

const members = [
  { name: "김민준", age: 9, class: "초급반 A", status: "active", phone: "010-1234-5678", days: "월·수·금", attendance: 92 },
  { name: "이서연", age: 11, class: "중급반 B", status: "active", phone: "010-2345-6789", days: "화·목", attendance: 88 },
  { name: "박지호", age: 8, class: "초급반 A", status: "pending", phone: "010-3456-7890", days: "월·수·금", attendance: 0 },
  { name: "최하은", age: 13, class: "상급반 C", status: "active", phone: "010-4567-8901", days: "월·화·목", attendance: 96 },
  { name: "정도윤", age: 10, class: "중급반 B", status: "inactive", phone: "010-5678-9012", days: "화·목", attendance: 45 },
];

const statusConfig: Record<string, { label: string; color: string; bg: string; icon: any; weight: any }> = {
  active:   { label: "수강중",   color: TINT,      bg: "#DFF6F4", icon: CheckCircle, weight: "fill" },
  pending:  { label: "승인대기", color: "#E4A93A", bg: "#FFF8E6", icon: Clock,        weight: "fill" },
  inactive: { label: "정지",     color: "#94A3B8", bg: "#F1F5F9", icon: XCircle,      weight: "fill" },
};

export function MemberList() {
  return (
    <div style={{ backgroundColor: BG, minHeight: "100vh", fontFamily: "'Pretendard', 'Apple SD Gothic Neo', sans-serif", maxWidth: 390, margin: "0 auto" }}>
      {/* 헤더 */}
      <div style={{ backgroundColor: CARD, paddingTop: 52, paddingBottom: 14, paddingLeft: 20, paddingRight: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 13, color: SECONDARY }}>스윔노트</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: TEXT }}>회원 관리</div>
          </div>
          <div style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: TINT, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Plus size={20} color="#fff" weight="bold" />
          </div>
        </div>

        {/* 검색 */}
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          backgroundColor: BG, borderRadius: 12, padding: "10px 14px"
        }}>
          <MagnifyingGlass size={16} color={SECONDARY} />
          <span style={{ fontSize: 14, color: "#94A3B8" }}>회원 이름, 전화번호 검색</span>
        </div>

        {/* 필터 칩 */}
        <div style={{ display: "flex", gap: 8, marginTop: 12, overflowX: "auto", paddingBottom: 2 }}>
          {["전체 148", "수강중 132", "승인대기 8", "정지 8"].map((f, i) => (
            <div key={f} style={{
              whiteSpace: "nowrap", padding: "5px 13px", borderRadius: 20, fontSize: 12, fontWeight: 600,
              backgroundColor: i === 0 ? TINT : CARD,
              color: i === 0 ? "#fff" : SECONDARY,
              border: i === 0 ? "none" : "1.5px solid #E2E8F0"
            }}>{f}</div>
          ))}
        </div>
      </div>

      {/* 회원 목록 */}
      <div style={{ padding: "12px 14px 40px", display: "flex", flexDirection: "column", gap: 8 }}>
        {members.map((m) => {
          const s = statusConfig[m.status];
          const StatusIcon = s.icon;
          return (
            <div key={m.name} style={{
              backgroundColor: CARD, borderRadius: 18, padding: "14px 14px",
              boxShadow: "0 2px 10px #0000000a",
              display: "flex", gap: 12, alignItems: "flex-start"
            }}>
              {/* 아바타 */}
              <div style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: MINT_BOX, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <UserCircle size={28} color={TINT} weight="fill" />
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 15, fontWeight: 700, color: TEXT }}>{m.name}</span>
                    <span style={{ fontSize: 12, color: SECONDARY }}>{m.age}세</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: 8, backgroundColor: s.bg }}>
                    <StatusIcon size={11} color={s.color} weight={s.weight} />
                    <span style={{ fontSize: 11, fontWeight: 600, color: s.color }}>{s.label}</span>
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 5 }}>
                  <SwimmingPool size={13} color={SECONDARY} />
                  <span style={{ fontSize: 12, color: SECONDARY }}>{m.class}</span>
                  <span style={{ color: "#CBD5E1", fontSize: 10 }}>•</span>
                  <CalendarDots size={13} color={SECONDARY} />
                  <span style={{ fontSize: 12, color: SECONDARY }}>{m.days}</span>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                  <Phone size={13} color={SECONDARY} />
                  <span style={{ fontSize: 12, color: SECONDARY }}>{m.phone}</span>
                  {m.status === "active" && (
                    <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 3 }}>
                      <div style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: "#F1F5F9", overflow: "hidden" }}>
                        <div style={{ width: `${m.attendance}%`, height: "100%", backgroundColor: m.attendance >= 90 ? TINT : "#E4A93A", borderRadius: 3 }} />
                      </div>
                      <span style={{ fontSize: 11, color: m.attendance >= 90 ? TINT : "#E4A93A", fontWeight: 600 }}>{m.attendance}%</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
