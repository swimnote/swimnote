import {
  Users, BookOpen, CalendarDots, Bell,
  ChartBar, CaretRight, SwimmingPool,
  Clock, CheckCircle, House, ChalkboardTeacher,
  Student, Gear
} from "@phosphor-icons/react";

const TINT = "#2EC4B6";
const TEXT = "#0F172A";
const SECONDARY = "#64748B";
const BG = "#F5F5F5";
const CARD = "#FFFFFF";
const MINT_BOX = "#E6FAF8";

const stats = [
  { icon: Users, label: "전체 회원", value: "148", sub: "+3 이번주", color: TINT },
  { icon: ChalkboardTeacher, label: "선생님", value: "8", sub: "활동중", color: "#4F6EF7" },
  { icon: BookOpen, label: "오늘 수업", value: "12", sub: "진행중 3", color: "#2E9B6F" },
  { icon: Bell, label: "미확인 알림", value: "5", sub: "새 알림", color: "#E4A93A" },
];

const schedule = [
  { time: "09:00", name: "초급반 A", teacher: "김수영", status: "진행중" },
  { time: "10:30", name: "중급반 B", teacher: "이파도", status: "예정" },
  { time: "13:00", name: "자유수영", teacher: "박물결", status: "예정" },
];

export function Dashboard() {
  return (
    <div style={{ backgroundColor: BG, minHeight: "100vh", fontFamily: "'Pretendard', 'Apple SD Gothic Neo', sans-serif", maxWidth: 390, margin: "0 auto" }}>
      {/* 헤더 */}
      <div style={{ backgroundColor: CARD, paddingTop: 52, paddingBottom: 16, paddingLeft: 20, paddingRight: 20, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: MINT_BOX, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <SwimmingPool size={20} color={TINT} weight="fill" />
          </div>
          <div>
            <div style={{ fontSize: 13, color: SECONDARY }}>스윔노트</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: TEXT }}>오늘의 현황</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: BG, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Bell size={18} color={SECONDARY} />
          </div>
        </div>
      </div>

      <div style={{ padding: "16px 16px 80px" }}>
        {/* 통계 그리드 */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
          {stats.map(({ icon: Icon, label, value, sub, color }) => (
            <div key={label} style={{ backgroundColor: CARD, borderRadius: 18, padding: "16px 14px", boxShadow: "0 2px 10px #0000000a" }}>
              <div style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: MINT_BOX, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 10 }}>
                <Icon size={20} color={color} weight="fill" />
              </div>
              <div style={{ fontSize: 22, fontWeight: 800, color: TEXT, letterSpacing: -0.5 }}>{value}</div>
              <div style={{ fontSize: 12, color: SECONDARY, marginTop: 2 }}>{label}</div>
              <div style={{ fontSize: 11, color: TINT, marginTop: 4 }}>{sub}</div>
            </div>
          ))}
        </div>

        {/* 오늘 수업 */}
        <div style={{ backgroundColor: CARD, borderRadius: 18, padding: "16px 16px", boxShadow: "0 2px 10px #0000000a", marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <CalendarDots size={18} color={TINT} weight="fill" />
              <span style={{ fontSize: 15, fontWeight: 700, color: TEXT }}>오늘 수업 일정</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 3, color: TINT, fontSize: 12, fontWeight: 600 }}>
              전체보기 <CaretRight size={13} color={TINT} weight="bold" />
            </div>
          </div>
          {schedule.map((s, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "center", gap: 12, paddingTop: i > 0 ? 12 : 0,
              borderTop: i > 0 ? "1px solid #F1F5F9" : "none"
            }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: SECONDARY, minWidth: 42 }}>{s.time}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: TEXT }}>{s.name}</div>
                <div style={{ fontSize: 12, color: SECONDARY, marginTop: 1 }}>{s.teacher} 선생님</div>
              </div>
              <div style={{
                fontSize: 11, fontWeight: 600, padding: "3px 9px", borderRadius: 8,
                backgroundColor: s.status === "진행중" ? "#DFF6F4" : "#F1F5F9",
                color: s.status === "진행중" ? TINT : SECONDARY
              }}>
                {s.status === "진행중" ? <span style={{ display: "flex", alignItems: "center", gap: 3 }}><Clock size={10} weight="fill" />{s.status}</span> : s.status}
              </div>
            </div>
          ))}
        </div>

        {/* 빠른 통계 */}
        <div style={{ backgroundColor: CARD, borderRadius: 18, padding: "16px", boxShadow: "0 2px 10px #0000000a" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <ChartBar size={18} color={TINT} weight="fill" />
            <span style={{ fontSize: 15, fontWeight: 700, color: TEXT }}>출석률</span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {[{ label: "이번주", val: "94%", good: true }, { label: "이번달", val: "89%", good: true }, { label: "지난달", val: "85%", good: false }].map(r => (
              <div key={r.label} style={{ flex: 1, textAlign: "center", padding: "10px 0", borderRadius: 10, backgroundColor: BG }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: r.good ? TINT : TEXT }}>{r.val}</div>
                <div style={{ fontSize: 11, color: SECONDARY, marginTop: 2 }}>{r.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 하단 탭 */}
      <div style={{
        position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: 390,
        backgroundColor: CARD, borderTop: "1px solid #F1F5F9",
        display: "flex", paddingBottom: 20, paddingTop: 10
      }}>
        {[
          { icon: House, label: "홈", active: true },
          { icon: Users, label: "회원", active: false },
          { icon: CalendarDots, label: "일정", active: false },
          { icon: ChalkboardTeacher, label: "선생님", active: false },
          { icon: Gear, label: "설정", active: false },
        ].map(({ icon: Icon, label, active }) => (
          <div key={label} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            <Icon size={22} color={active ? TINT : SECONDARY} weight={active ? "fill" : "regular"} />
            <span style={{ fontSize: 10, color: active ? TINT : SECONDARY, fontWeight: active ? 700 : 400 }}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
