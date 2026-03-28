import {
  Home, Users, ChartBar, DollarSign, Menu,
  Bell, BookOpen, CheckCircle2, Calendar,
  ClipboardList, Settings, Database, Shield,
  UserPlus, Waves, ChevronRight, MessageSquare,
  BarChart2, CreditCard, Award, FileText,
  RefreshCw, Camera, ToggleLeft, Globe,
} from "lucide-react";

const TEXT      = "#0F172A";
const SECONDARY = "#64748B";
const BG        = "#F5F5F5";
const CARD      = "#FFFFFF";

// ── 기능마다 고유 색상 ────────────────────────────────────────────
const C = {
  member:     { icon: "#3B82F6", bg: "#EFF6FF" }, // 회원      — 파랑
  class:      { icon: "#10B981", bg: "#ECFDF5" }, // 수업      — 에메랄드
  attendance: { icon: "#FF6F0F", bg: "#FFF2E8" }, // 출결      — 주황
  revenue:    { icon: "#F59E0B", bg: "#FFFBEB" }, // 정산/매출 — 골드
  notice:     { icon: "#8B5CF6", bg: "#F5F3FF" }, // 공지      — 보라
  teacher:    { icon: "#0D9488", bg: "#F0FDFA" }, // 선생님    — 틸
  diary:      { icon: "#EC4899", bg: "#FDF2F8" }, // 일지      — 핑크
  alert:      { icon: "#EF4444", bg: "#FEF2F2" }, // 경고/대기 — 레드
  data:       { icon: "#6366F1", bg: "#EEF2FF" }, // 데이터    — 인디고
  backup:     { icon: "#14B8A6", bg: "#F0FDFA" }, // 백업      — 시안
  branding:   { icon: "#F97316", bg: "#FFF7ED" }, // 브랜딩    — 오렌지
  security:   { icon: "#DC2626", bg: "#FEF2F2" }, // 보안      — 다크레드
};

const STATS = [
  { label: "전체 회원",    value: "218명", color: C.member.icon,     bg: C.member.bg     },
  { label: "오늘 출석",    value: "47명",  color: C.attendance.icon, bg: C.attendance.bg },
  { label: "이달 매출",    value: "3.2M",  color: C.revenue.icon,    bg: C.revenue.bg    },
  { label: "승인 대기",    value: "8건",   color: C.alert.icon,      bg: C.alert.bg      },
];

const SERVICES = [
  { Icon: Users,        label: "회원 관리",   ...C.member     },
  { Icon: Calendar,     label: "수업 관리",   ...C.class      },
  { Icon: ClipboardList,label: "출결 현황",   ...C.attendance },
  { Icon: DollarSign,   label: "정산/매출",   ...C.revenue    },
  { Icon: MessageSquare,label: "공지사항",    ...C.notice     },
  { Icon: Users,        label: "선생님",      ...C.teacher    },
  { Icon: BookOpen,     label: "수업 일지",   ...C.diary      },
  { Icon: UserPlus,     label: "가입 승인",   ...C.alert      },
  { Icon: Database,     label: "데이터 관리", ...C.data       },
  { Icon: RefreshCw,    label: "백업/복원",   ...C.backup     },
  { Icon: Globe,        label: "브랜딩",      ...C.branding   },
  { Icon: Shield,       label: "보안 설정",   ...C.security   },
];

const RECENT = [
  { text: "김서준 회원 등록 완료",    time: "방금",    color: C.member.icon,     bg: C.member.bg,     Icon: UserPlus    },
  { text: "이지수 보강 요청 승인",    time: "10분 전", color: C.class.icon,      bg: C.class.bg,      Icon: CheckCircle2 },
  { text: "3월 정산 완료 — 3.2M원",  time: "1시간",   color: C.revenue.icon,    bg: C.revenue.bg,    Icon: DollarSign   },
  { text: "신규 선생님 승인 대기",    time: "2시간",   color: C.alert.icon,      bg: C.alert.bg,      Icon: Bell         },
];

const TABS = [
  { Icon: Home,       label: "홈",    color: C.member.icon,     active: true  },
  { Icon: Users,      label: "회원",  color: C.member.icon,     active: false },
  { Icon: Calendar,   label: "수업",  color: C.class.icon,      active: false },
  { Icon: DollarSign, label: "정산",  color: C.revenue.icon,    active: false },
  { Icon: Menu,       label: "더보기",color: SECONDARY,         active: false },
];

export function AdminDanggeun() {
  return (
    <div style={{ background: BG, minHeight: "100vh", fontFamily: "'Inter', system-ui, sans-serif", maxWidth: 390, margin: "0 auto", display: "flex", flexDirection: "column" }}>

      {/* 헤더 */}
      <div style={{ background: CARD, padding: "52px 20px 16px", borderBottom: "1px solid #F1F5F9" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 38, height: 38, borderRadius: 12, background: C.attendance.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Waves size={20} color={C.attendance.icon} strokeWidth={2.5} />
            </div>
            <div>
              <div style={{ fontSize: 12, color: SECONDARY }}>스윔아카데미</div>
              <div style={{ fontSize: 17, fontWeight: 800, color: TEXT }}>관리자 대시보드</div>
            </div>
          </div>
          <div style={{ position: "relative" }}>
            <div style={{ width: 42, height: 42, borderRadius: 13, background: C.alert.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Bell size={20} color={C.alert.icon} strokeWidth={2} />
            </div>
            <div style={{ position: "absolute", top: -3, right: -3, width: 17, height: 17, borderRadius: "50%", background: C.alert.icon, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ fontSize: 9, color: "#fff", fontWeight: 800 }}>8</span>
            </div>
          </div>
        </div>

        {/* 통계 4칸 */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginTop: 16 }}>
          {STATS.map(s => (
            <div key={s.label} style={{ background: s.bg, borderRadius: 14, padding: "10px 8px", textAlign: "center" }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 9, color: SECONDARY, marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "14px 14px 110px" }}>

        {/* 서비스 그리드 — 당근마켓 스타일 */}
        <div style={{ background: CARD, borderRadius: 20, padding: "16px 10px 10px", boxShadow: "0 2px 10px #0000000a", marginBottom: 14 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: TEXT, padding: "0 6px 12px" }}>관리 서비스</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)" }}>
            {SERVICES.map(({ Icon, label, icon, bg }) => (
              <div key={label} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 7, padding: "10px 4px" }}>
                <div style={{ width: 54, height: 54, borderRadius: 17, background: bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon size={26} color={icon} strokeWidth={1.8} />
                </div>
                <span style={{ fontSize: 11, color: TEXT, fontWeight: 600, textAlign: "center", lineHeight: 1.3 }}>{label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 최근 활동 */}
        <div style={{ background: CARD, borderRadius: 20, overflow: "hidden", boxShadow: "0 2px 10px #0000000a" }}>
          <div style={{ padding: "14px 16px", borderBottom: "1px solid #F8FAFC", display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 11, background: C.data.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <BarChart2 size={18} color={C.data.icon} strokeWidth={2} />
            </div>
            <div style={{ fontSize: 14, fontWeight: 800, color: TEXT }}>최근 활동</div>
          </div>
          {RECENT.map(({ text, time, color, bg, Icon }, i) => (
            <div key={text} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: i < RECENT.length - 1 ? "1px solid #F8FAFC" : "none" }}>
              <div style={{ width: 38, height: 38, borderRadius: 12, background: bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Icon size={18} color={color} strokeWidth={2} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: TEXT }}>{text}</div>
                <div style={{ fontSize: 11, color: SECONDARY, marginTop: 2 }}>{time}</div>
              </div>
              <ChevronRight size={14} color={SECONDARY} strokeWidth={1.5} />
            </div>
          ))}
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
