import {
  CheckCircle, XCircle, Clock, UserCircle, SwimmingPool,
  CalendarDots, CaretLeft, CaretRight, MegaphoneSimple,
  Pencil, ChartBar, Timer, Waves
} from "@phosphor-icons/react";

const TINT = "#2EC4B6";
const TEXT = "#0F172A";
const SECONDARY = "#64748B";
const BG = "#F5F5F5";
const CARD = "#FFFFFF";
const MINT_BOX = "#E6FAF8";

const students = [
  { name: "김민준", status: "present" },
  { name: "이서연", status: "present" },
  { name: "박지호", status: "absent" },
  { name: "최하은", status: "present" },
  { name: "정도윤", status: "late" },
  { name: "한소율", status: "present" },
  { name: "오채원", status: null },
  { name: "윤현우", status: null },
];

const statusMap: Record<string, { label: string; color: string; bg: string; icon: any }> = {
  present: { label: "출석", color: TINT,      bg: "#DFF6F4", icon: CheckCircle },
  absent:  { label: "결석", color: "#E87070", bg: "#FFF0F0", icon: XCircle    },
  late:    { label: "지각", color: "#E4A93A", bg: "#FFF8E6", icon: Clock      },
};

export function Attendance() {
  const presentCount = students.filter(s => s.status === "present").length;
  const absentCount  = students.filter(s => s.status === "absent").length;
  const lateCount    = students.filter(s => s.status === "late").length;
  const total        = students.length;

  return (
    <div style={{ backgroundColor: BG, minHeight: "100vh", fontFamily: "'Pretendard', 'Apple SD Gothic Neo', sans-serif", maxWidth: 390, margin: "0 auto" }}>
      {/* 헤더 */}
      <div style={{ backgroundColor: TINT, paddingTop: 52, paddingBottom: 20, paddingLeft: 20, paddingRight: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <CaretLeft size={22} color="#fff" weight="bold" />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.75)" }}>2026년 3월 27일</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#fff" }}>초급반 A · 출석체크</div>
          </div>
          <div style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Timer size={18} color="#fff" weight="fill" />
          </div>
        </div>

        {/* 수업 정보 */}
        <div style={{ display: "flex", gap: 14, padding: "12px 14px", backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Waves size={15} color="#fff" weight="fill" />
            <span style={{ fontSize: 12, color: "#fff" }}>김수영 선생님</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Clock size={15} color="#fff" weight="fill" />
            <span style={{ fontSize: 12, color: "#fff" }}>09:00 - 09:50</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <SwimmingPool size={15} color="#fff" weight="fill" />
            <span style={{ fontSize: 12, color: "#fff" }}>1레인</span>
          </div>
        </div>
      </div>

      {/* 통계 */}
      <div style={{ margin: "14px 14px 0", backgroundColor: CARD, borderRadius: 18, padding: "14px 16px", boxShadow: "0 2px 10px #0000000a" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <ChartBar size={16} color={TINT} weight="fill" />
          <span style={{ fontSize: 14, fontWeight: 700, color: TEXT }}>오늘 출결 현황</span>
          <span style={{ marginLeft: "auto", fontSize: 12, color: SECONDARY }}>총 {total}명</span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {[
            { label: "출석", count: presentCount, color: TINT, bg: "#DFF6F4" },
            { label: "결석", count: absentCount,  color: "#E87070", bg: "#FFF0F0" },
            { label: "지각", count: lateCount,    color: "#E4A93A", bg: "#FFF8E6" },
            { label: "미체크", count: students.filter(s => !s.status).length, color: SECONDARY, bg: "#F1F5F9" },
          ].map(r => (
            <div key={r.label} style={{ flex: 1, textAlign: "center", padding: "8px 0", borderRadius: 10, backgroundColor: r.bg }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: r.color }}>{r.count}</div>
              <div style={{ fontSize: 10, color: r.color, fontWeight: 600, marginTop: 2 }}>{r.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 학생 목록 */}
      <div style={{ padding: "12px 14px 40px", display: "flex", flexDirection: "column", gap: 8 }}>
        {students.map((student, i) => {
          const s = student.status ? statusMap[student.status] : null;
          const Icon = s?.icon;
          return (
            <div key={student.name} style={{
              backgroundColor: CARD, borderRadius: 16, padding: "12px 14px",
              boxShadow: "0 1px 6px #0000000a",
              display: "flex", alignItems: "center", gap: 12
            }}>
              <div style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: MINT_BOX, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <UserCircle size={26} color={TINT} weight="fill" />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: TEXT }}>{student.name}</div>
                {!s && <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 1 }}>터치하여 출결 체크</div>}
              </div>
              {s && Icon ? (
                <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 10, backgroundColor: s.bg }}>
                  <Icon size={15} color={s.color} weight="fill" />
                  <span style={{ fontSize: 13, fontWeight: 700, color: s.color }}>{s.label}</span>
                </div>
              ) : (
                <div style={{ display: "flex", gap: 6 }}>
                  {["출석", "지각", "결석"].map((label, li) => {
                    const colors = [TINT, "#E4A93A", "#E87070"];
                    return (
                      <div key={label} style={{
                        width: 36, height: 36, borderRadius: 10, border: `1.5px solid ${colors[li]}20`,
                        backgroundColor: `${colors[li]}12`, display: "flex", alignItems: "center",
                        justifyContent: "center", fontSize: 11, fontWeight: 600, color: colors[li]
                      }}>{label}</div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {/* 완료 버튼 */}
        <div style={{ marginTop: 4, padding: "16px 0", backgroundColor: TINT, borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <CheckCircle size={20} color="#fff" weight="fill" />
          <span style={{ fontSize: 16, fontWeight: 700, color: "#fff" }}>출결 저장하기</span>
        </div>
      </div>
    </div>
  );
}
