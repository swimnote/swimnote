import {
  Home, Layers, Send, DollarSign, Menu,
  CheckCircle2, BookOpen, Clock, Bell,
  Users, RefreshCw, ChevronRight, Waves,
  PenLine, ClipboardList, MessageCircle,
  Calendar, Award, Camera, UserCheck,
} from "lucide-react";

const TEXT      = "#0F172A";
const SECONDARY = "#64748B";
const BG        = "#F5F5F5";
const CARD      = "#FFFFFF";

// ── 당근마켓식 — 기능마다 고유 색상 ──────────────────────────────
const COLORS = {
  schedule:   { icon: "#FF6F0F", bg: "#FFF2E8" }, // 오늘 수업  — 주황
  attendance: { icon: "#10B981", bg: "#ECFDF5" }, // 출석 체크  — 에메랄드
  diary:      { icon: "#3B82F6", bg: "#EFF6FF" }, // 수업 일지  — 파랑
  messenger:  { icon: "#8B5CF6", bg: "#F5F3FF" }, // 메신저     — 보라
  revenue:    { icon: "#F59E0B", bg: "#FFFBEB" }, // 정산       — 골드
  makeup:     { icon: "#0D9488", bg: "#F0FDFA" }, // 보강       — 틸
  students:   { icon: "#EC4899", bg: "#FDF2F8" }, // 학생 명단  — 핑크
  notice:     { icon: "#EF4444", bg: "#FEF2F2" }, // 공지사항   — 레드
};

const TABS = [
  { Icon: Home,       label: "홈",    color: COLORS.schedule.icon,  active: true  },
  { Icon: Layers,     label: "수업",  color: COLORS.diary.icon,     active: false },
  { Icon: Send,       label: "메신저",color: COLORS.messenger.icon, active: false },
  { Icon: DollarSign, label: "정산",  color: COLORS.revenue.icon,   active: false },
  { Icon: Menu,       label: "더보기",color: SECONDARY,             active: false },
];

const HUB = [
  { Icon: CheckCircle2,  label: "출석 체크",   sub: "오늘 3반",   ...COLORS.attendance, badge: null },
  { Icon: PenLine,       label: "수업 일지",   sub: "미작성 2건", ...COLORS.diary,      badge: 2    },
  { Icon: MessageCircle, label: "메신저",      sub: "안읽음 5건", ...COLORS.messenger,  badge: 5    },
  { Icon: RefreshCw,     label: "보강 요청",   sub: "1건",        ...COLORS.makeup,     badge: 1    },
];

const SCHEDULE = [
  { time: "10:00", name: "기초반 A",    level: "입문", students: 6, present: 6, diary: true,  c: COLORS.schedule  },
  { time: "11:30", name: "성인 중급반", level: "중급", students: 8, present: 7, diary: false, c: COLORS.schedule  },
  { time: "14:00", name: "어린이반 B",  level: "초급", students: 5, present: 3, diary: false, c: COLORS.schedule  },
];

const QUICK = [
  { Icon: ClipboardList, label: "출석 체크",   sub: "진행 중",  ...COLORS.attendance },
  { Icon: PenLine,       label: "일지 작성",   sub: "2건 미작성",...COLORS.diary      },
  { Icon: Users,         label: "학생 명단",   sub: "전체 18명",...COLORS.students   },
  { Icon: Camera,        label: "사진 앨범",   sub: "최근 추가", ...COLORS.makeup     },
  { Icon: Bell,          label: "공지사항",    sub: "새글 1건",  ...COLORS.notice    },
  { Icon: Award,         label: "피드백 템플릿",sub: "12개",     ...COLORS.messenger  },
];

export function TeacherDanggeun() {
  return (
    <div style={{ background: BG, minHeight: "100vh", fontFamily: "'Inter', system-ui, sans-serif", maxWidth: 390, margin: "0 auto", display: "flex", flexDirection: "column" }}>

      {/* 헤더 */}
      <div style={{ background: CARD, padding: "52px 20px 16px", borderBottom: "1px solid #F1F5F9" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 12, color: SECONDARY }}>스윔노트 선생님</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: TEXT, marginTop: 2 }}>김민준 선생님 👋</div>
            <div style={{ fontSize: 12, color: SECONDARY, marginTop: 3 }}>오늘 수업 3반 · 3월 27일 목요일</div>
          </div>
          <div style={{ position: "relative" }}>
            <div style={{ width: 44, height: 44, borderRadius: 14, background: COLORS.notice.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Bell size={21} color={COLORS.notice.icon} strokeWidth={2} />
            </div>
            <div style={{ position: "absolute", top: -3, right: -3, width: 17, height: 17, borderRadius: "50%", background: COLORS.notice.icon, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ fontSize: 9, color: "#fff", fontWeight: 800 }}>8</span>
            </div>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "14px 14px 110px" }}>

        {/* 퀵 허브 2×2 */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
          {HUB.map(({ Icon, label, sub, icon, bg, badge }) => (
            <div key={label} style={{ background: CARD, borderRadius: 20, padding: "16px", boxShadow: "0 2px 10px #0000000a", position: "relative" }}>
              {badge && (
                <div style={{ position: "absolute", top: 12, right: 12, background: icon, borderRadius: 10, minWidth: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 5px" }}>
                  <span style={{ fontSize: 10, color: "#fff", fontWeight: 800 }}>{badge}</span>
                </div>
              )}
              <div style={{ width: 48, height: 48, borderRadius: 15, background: bg, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 10 }}>
                <Icon size={24} color={icon} strokeWidth={2} />
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>{label}</div>
              <div style={{ fontSize: 11, color: SECONDARY, marginTop: 2 }}>{sub}</div>
            </div>
          ))}
        </div>

        {/* 빠른 기능 — 당근마켓 서비스 그리드 스타일 */}
        <div style={{ background: CARD, borderRadius: 20, padding: "16px 12px 10px", boxShadow: "0 2px 10px #0000000a", marginBottom: 14 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: TEXT, padding: "0 6px 12px" }}>빠른 기능</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "4px 0" }}>
            {QUICK.map(({ Icon, label, sub, icon, bg }) => (
              <div key={label} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 7, padding: "10px 6px" }}>
                <div style={{ width: 54, height: 54, borderRadius: 17, background: bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon size={26} color={icon} strokeWidth={1.8} />
                </div>
                <span style={{ fontSize: 11, color: TEXT, fontWeight: 600, textAlign: "center" }}>{label}</span>
                <span style={{ fontSize: 10, color: SECONDARY, marginTop: -4 }}>{sub}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 오늘 수업 목록 */}
        <div style={{ background: CARD, borderRadius: 20, overflow: "hidden", boxShadow: "0 2px 10px #0000000a" }}>
          <div style={{ padding: "14px 16px", borderBottom: "1px solid #F8FAFC", display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 11, background: COLORS.schedule.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Calendar size={18} color={COLORS.schedule.icon} strokeWidth={2} />
            </div>
            <div style={{ fontSize: 14, fontWeight: 800, color: TEXT }}>오늘 수업</div>
          </div>
          {SCHEDULE.map((s, i) => {
            const allPresent = s.present === s.students;
            const attC = allPresent ? COLORS.attendance : COLORS.notice;
            return (
              <div key={s.name} style={{ padding: "13px 16px", borderBottom: i < SCHEDULE.length - 1 ? "1px solid #F8FAFC" : "none", display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 44, height: 44, borderRadius: 13, background: s.c.bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 800, color: s.c.icon }}>{s.time}</span>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: TEXT }}>{s.name}</div>
                  <div style={{ display: "flex", gap: 5, marginTop: 5 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 3, background: attC.bg, borderRadius: 7, padding: "3px 7px" }}>
                      <Users size={10} color={attC.icon} strokeWidth={2.5} />
                      <span style={{ fontSize: 10, color: attC.icon, fontWeight: 700 }}>{s.present}/{s.students}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 3, background: s.diary ? COLORS.attendance.bg : COLORS.diary.bg, borderRadius: 7, padding: "3px 7px" }}>
                      {s.diary
                        ? <CheckCircle2 size={10} color={COLORS.attendance.icon} strokeWidth={2.5} />
                        : <PenLine size={10} color={COLORS.diary.icon} strokeWidth={2.5} />}
                      <span style={{ fontSize: 10, color: s.diary ? COLORS.attendance.icon : COLORS.diary.icon, fontWeight: 700 }}>
                        {s.diary ? "일지 완료" : "미작성"}
                      </span>
                    </div>
                  </div>
                </div>
                <ChevronRight size={15} color={SECONDARY} strokeWidth={1.5} />
              </div>
            );
          })}
        </div>
      </div>

      {/* 탭바 */}
      <div style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: 390, background: CARD, borderTop: "1px solid #F1F5F9", display: "flex", padding: "10px 0 28px", zIndex: 100, boxShadow: "0 -4px 20px #00000010" }}>
        {TABS.map(({ Icon, label, color, active }) => (
          <div key={label} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            <div style={{ width: 40, height: 32, borderRadius: 10, background: active ? `${color}18` : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Icon size={21} color={active ? color : SECONDARY} strokeWidth={active ? 2.5 : 1.5} />
            </div>
            <span style={{ fontSize: 10, color: active ? color : SECONDARY, fontWeight: active ? 700 : 400 }}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
