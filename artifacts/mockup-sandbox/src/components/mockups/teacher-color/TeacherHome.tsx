import {
  Home, Layers, Send, DollarSign, Menu,
  CheckCircle2, BookOpen, Clock, AlertTriangle,
  MessageCircle, RefreshCw, Users, ChevronRight,
  Waves, Bell, UserCheck, Calendar, Pencil,
  PenLine, ClipboardList, Star, Award, Zap,
} from "lucide-react";

const BLUE   = "#007AFF";
const GREEN  = "#00704A";
const ORANGE = "#FF6F0F";

const BLUE_BG   = "#EAF4FF";
const GREEN_BG  = "#E6F5EF";
const ORANGE_BG = "#FFF2E8";

const TEXT      = "#0F172A";
const SECONDARY = "#64748B";
const BG        = "#F5F5F5";
const CARD      = "#FFFFFF";

const TABS = [
  { Icon: Home,        label: "홈",    active: true  },
  { Icon: Layers,      label: "수업",  active: false },
  { Icon: Send,        label: "메신저",active: false },
  { Icon: DollarSign,  label: "정산",  active: false },
  { Icon: Menu,        label: "더보기",active: false },
];

const HUB_ICONS = [
  { Icon: CheckCircle2,  label: "출석 완료", sub: "오늘 3반", color: GREEN,  bg: GREEN_BG  },
  { Icon: BookOpen,      label: "일지 미작성",sub: "2건",      color: ORANGE, bg: ORANGE_BG, badge: 2 },
  { Icon: MessageCircle, label: "안읽은 메시지",sub: "5건",    color: ORANGE, bg: ORANGE_BG, badge: 5 },
  { Icon: RefreshCw,     label: "보강 요청", sub: "1건",      color: ORANGE, bg: ORANGE_BG, badge: 1 },
];

const SCHEDULE = [
  {
    time: "10:00", name: "기초반 A", level: "입문",
    students: 6, present: 6, diary: true,
  },
  {
    time: "11:30", name: "성인 중급반", level: "중급",
    students: 8, present: 7, diary: false,
  },
  {
    time: "14:00", name: "어린이반 B", level: "초급",
    students: 5, present: 3, diary: false,
  },
];

export function TeacherHome() {
  return (
    <div style={{ background: BG, minHeight: "100vh", fontFamily: "'Inter', system-ui, sans-serif", maxWidth: 390, margin: "0 auto", display: "flex", flexDirection: "column" }}>

      {/* 상단 헤더 */}
      <div style={{ background: CARD, padding: "52px 20px 16px", borderBottom: "1px solid #F1F5F9" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 12, color: SECONDARY }}>스윔노트 선생님</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: TEXT, marginTop: 2 }}>
              김민준 선생님, 안녕하세요 👋
            </div>
            <div style={{ fontSize: 12, color: SECONDARY, marginTop: 4 }}>
              오늘 수업 3반 · 3월 27일 목요일
            </div>
          </div>
          <div style={{ position: "relative" }}>
            <div style={{ width: 42, height: 42, borderRadius: 13, background: ORANGE_BG, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Bell size={20} color={ORANGE} strokeWidth={2} />
            </div>
            <div style={{ position: "absolute", top: -3, right: -3, width: 16, height: 16, borderRadius: "50%", background: ORANGE, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ fontSize: 9, color: "#fff", fontWeight: 800 }}>8</span>
            </div>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "14px 14px 100px" }}>

        {/* 퀵 허브 */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
          {HUB_ICONS.map(({ Icon, label, sub, color, bg, badge }) => (
            <div key={label} style={{ background: CARD, borderRadius: 18, padding: "16px 16px", boxShadow: "0 2px 10px #0000000a", position: "relative" }}>
              {badge && (
                <div style={{ position: "absolute", top: 12, right: 12, background: color, borderRadius: 10, minWidth: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 5px" }}>
                  <span style={{ fontSize: 10, color: "#fff", fontWeight: 800 }}>{badge}</span>
                </div>
              )}
              <div style={{ width: 44, height: 44, borderRadius: 13, background: bg, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 10 }}>
                <Icon size={22} color={color} strokeWidth={2} />
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>{label}</div>
              <div style={{ fontSize: 11, color: SECONDARY, marginTop: 2 }}>{sub}</div>
            </div>
          ))}
        </div>

        {/* 오늘 수업 목록 */}
        <div style={{ background: CARD, borderRadius: 20, overflow: "hidden", boxShadow: "0 2px 10px #0000000a", marginBottom: 14 }}>
          <div style={{ padding: "14px 16px", borderBottom: "1px solid #F8FAFC", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: BLUE_BG, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Calendar size={18} color={BLUE} strokeWidth={2} />
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 800, color: TEXT }}>오늘 수업</div>
                <div style={{ fontSize: 11, color: SECONDARY }}>총 3반</div>
              </div>
            </div>
          </div>

          {SCHEDULE.map((s, i) => {
            const allPresent = s.present === s.students;
            const someAbsent = s.present < s.students;
            const attColor = allPresent ? GREEN : someAbsent ? ORANGE : SECONDARY;
            const attBg    = allPresent ? GREEN_BG : someAbsent ? ORANGE_BG : BG;

            return (
              <div key={s.name} style={{
                padding: "14px 16px",
                borderBottom: i < SCHEDULE.length - 1 ? "1px solid #F8FAFC" : "none",
                display: "flex", alignItems: "center", gap: 12,
              }}>
                {/* 시간 */}
                <div style={{ width: 44, textAlign: "center" }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: BLUE }}>{s.time}</div>
                  <div style={{ fontSize: 10, color: SECONDARY, marginTop: 1 }}>{s.level}</div>
                </div>

                {/* 반 정보 */}
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: TEXT }}>{s.name}</div>
                  <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                    {/* 출석 뱃지 */}
                    <div style={{ display: "flex", alignItems: "center", gap: 4, background: attBg, borderRadius: 8, padding: "3px 8px" }}>
                      <Users size={11} color={attColor} strokeWidth={2.5} />
                      <span style={{ fontSize: 11, color: attColor, fontWeight: 700 }}>{s.present}/{s.students}</span>
                    </div>
                    {/* 일지 뱃지 */}
                    <div style={{ display: "flex", alignItems: "center", gap: 4, background: s.diary ? GREEN_BG : ORANGE_BG, borderRadius: 8, padding: "3px 8px" }}>
                      {s.diary
                        ? <CheckCircle2 size={11} color={GREEN} strokeWidth={2.5} />
                        : <Pencil size={11} color={ORANGE} strokeWidth={2.5} />
                      }
                      <span style={{ fontSize: 11, color: s.diary ? GREEN : ORANGE, fontWeight: 700 }}>
                        {s.diary ? "일지 완료" : "일지 미작성"}
                      </span>
                    </div>
                  </div>
                </div>

                <ChevronRight size={15} color={SECONDARY} strokeWidth={1.5} />
              </div>
            );
          })}
        </div>

        {/* 빠른 액션 */}
        <div style={{ background: CARD, borderRadius: 20, overflow: "hidden", boxShadow: "0 2px 10px #0000000a" }}>
          <div style={{ padding: "14px 16px", borderBottom: "1px solid #F8FAFC" }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: TEXT }}>빠른 액션</div>
          </div>
          {[
            { Icon: ClipboardList, label: "출석 체크하기",  sub: "진행 중 수업", color: GREEN,  bg: GREEN_BG  },
            { Icon: PenLine,       label: "수업 일지 작성", sub: "미작성 2건",   color: ORANGE, bg: ORANGE_BG },
            { Icon: Users,         label: "학생 명단 보기", sub: "전체 18명",    color: BLUE,   bg: BLUE_BG   },
          ].map(({ Icon, label, sub, color, bg }) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 16px", borderBottom: "1px solid #F8FAFC" }}>
              <div style={{ width: 40, height: 40, borderRadius: 12, background: bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Icon size={19} color={color} strokeWidth={2} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: TEXT }}>{label}</div>
                <div style={{ fontSize: 11, color: SECONDARY }}>{sub}</div>
              </div>
              <ChevronRight size={15} color={SECONDARY} strokeWidth={1.5} />
            </div>
          ))}
        </div>
      </div>

      {/* 하단 탭바 */}
      <div style={{
        position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)",
        width: 390, background: CARD, borderTop: "1px solid #F1F5F9",
        display: "flex", padding: "10px 0 28px", zIndex: 100,
        boxShadow: "0 -4px 20px #00000010",
      }}>
        {TABS.map(({ Icon, label, active }) => (
          <div key={label} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            <div style={{ width: 40, height: 32, borderRadius: 10, background: active ? BLUE_BG : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Icon size={21} color={active ? BLUE : SECONDARY} strokeWidth={active ? 2.5 : 1.5} />
            </div>
            <span style={{ fontSize: 10, color: active ? BLUE : SECONDARY, fontWeight: active ? 700 : 400 }}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
