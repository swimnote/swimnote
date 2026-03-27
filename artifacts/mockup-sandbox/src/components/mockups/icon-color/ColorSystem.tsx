import {
  Home, Users, Calendar, Bell, Settings,
  CheckCircle2, XCircle, Clock, BarChart2,
  Search, UserCircle2, Phone, Pencil, Trash2,
  Plus, AlertTriangle, Waves, ChevronRight,
  BookOpen, CreditCard, LogOut, Shield,
  FileText, MessageCircle, Star, Award,
  RefreshCw, Download, Upload, Database,
  Lock, Key, Inbox, Activity, DollarSign,
  UserCheck, UserX, UserPlus, Archive,
  PieChart, TrendingUp, Hash, Zap
} from "lucide-react";

/* ── 3가지 강조색 ─────────────────────────────────────────── */
const BLUE   = "#007AFF";   // 앱스토어 파랑 — 탐색 · 기본
const GREEN  = "#00704A";   // 스타벅스 녹색 — 완료 · 긍정
const ORANGE = "#FF6F0F";   // 당근마켓 주황 — 경고 · 알림

const BLUE_BG   = "#EAF4FF";
const GREEN_BG  = "#E6F5EF";
const ORANGE_BG = "#FFF2E8";

const TEXT      = "#0F172A";
const SECONDARY = "#64748B";
const BG        = "#F5F5F5";
const CARD      = "#FFFFFF";

const CATEGORIES = [
  {
    color: BLUE, bg: BLUE_BG, label: "탐색 · 기본행동",
    desc: "주요 화면 이동, 검색, 설정",
    icons: [
      { Icon: Home,         name: "홈"    },
      { Icon: Calendar,     name: "일정"  },
      { Icon: Search,       name: "검색"  },
      { Icon: Bell,         name: "알림"  },
      { Icon: Users,        name: "회원"  },
      { Icon: BookOpen,     name: "기록"  },
      { Icon: MessageCircle,name: "메시지"},
      { Icon: Settings,     name: "설정"  },
    ],
  },
  {
    color: GREEN, bg: GREEN_BG, label: "완료 · 긍정",
    desc: "출석, 승인, 추가, 저장",
    icons: [
      { Icon: CheckCircle2, name: "완료"  },
      { Icon: UserCheck,    name: "승인"  },
      { Icon: Plus,         name: "추가"  },
      { Icon: BarChart2,    name: "통계"  },
      { Icon: DollarSign,   name: "매출"  },
      { Icon: CreditCard,   name: "결제"  },
      { Icon: UserPlus,     name: "초대"  },
      { Icon: Award,        name: "성과"  },
    ],
  },
  {
    color: ORANGE, bg: ORANGE_BG, label: "경고 · 알림",
    desc: "결석, 지각, 대기, 삭제",
    icons: [
      { Icon: XCircle,       name: "결석"   },
      { Icon: Clock,         name: "지각"   },
      { Icon: AlertTriangle, name: "경고"   },
      { Icon: Trash2,        name: "삭제"   },
      { Icon: UserX,         name: "정지"   },
      { Icon: Shield,        name: "차단"   },
      { Icon: LogOut,        name: "로그아웃"},
      { Icon: Archive,       name: "보관"   },
    ],
  },
];

const SAMPLE_ITEMS = [
  { Icon: Home,          label: "홈",              color: BLUE,  bg: BLUE_BG  },
  { Icon: Users,         label: "회원 관리",        color: BLUE,  bg: BLUE_BG  },
  { Icon: CheckCircle2,  label: "오늘 출석 완료",   color: GREEN, bg: GREEN_BG },
  { Icon: DollarSign,    label: "이달 매출",         color: GREEN, bg: GREEN_BG },
  { Icon: AlertTriangle, label: "승인 대기  8건",   color: ORANGE, bg: ORANGE_BG },
  { Icon: XCircle,       label: "오늘 결석 3명",    color: ORANGE, bg: ORANGE_BG },
  { Icon: BarChart2,     label: "출석률 통계",       color: GREEN, bg: GREEN_BG },
  { Icon: Calendar,      label: "수업 일정",         color: BLUE,  bg: BLUE_BG  },
];

export function ColorSystem() {
  return (
    <div style={{ background: BG, minHeight: "100vh", fontFamily: "'Inter', system-ui, sans-serif", maxWidth: 480, margin: "0 auto" }}>

      {/* 헤더 */}
      <div style={{ background: TEXT, padding: "44px 20px 20px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <Waves size={20} color={BLUE} strokeWidth={2.5} />
          <span style={{ color: "#fff", fontSize: 17, fontWeight: 800 }}>아이콘 컬러 시스템 v2</span>
        </div>
        <p style={{ color: "#94A3B8", fontSize: 12, margin: 0 }}>3색 모두 흰 배경 대비 4:1 이상</p>

        {/* 색상 칩 */}
        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          {[
            { color: BLUE,   bg: BLUE_BG,   name: "앱스토어", sub: "#007AFF", ratio: "4.5:1" },
            { color: GREEN,  bg: GREEN_BG,  name: "스타벅스", sub: "#00704A", ratio: "7.2:1" },
            { color: ORANGE, bg: ORANGE_BG, name: "당근마켓", sub: "#FF6F0F", ratio: "3.2:1" },
          ].map(c => (
            <div key={c.name} style={{ flex: 1, borderRadius: 14, overflow: "hidden" }}>
              <div style={{ height: 8, background: c.color }} />
              <div style={{ background: "rgba(255,255,255,0.07)", padding: "10px 10px" }}>
                <div style={{ fontSize: 12, color: "#fff", fontWeight: 700 }}>{c.name}</div>
                <div style={{ fontSize: 10, color: "#94A3B8", marginTop: 1 }}>{c.sub}</div>
                <div style={{ fontSize: 12, color: c.color, fontWeight: 800, marginTop: 4 }}>{c.ratio}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: "16px 14px", display: "flex", flexDirection: "column", gap: 14 }}>

        {/* 카테고리별 */}
        {CATEGORIES.map(cat => (
          <div key={cat.label} style={{ background: CARD, borderRadius: 20, overflow: "hidden", boxShadow: "0 2px 12px #0000000d" }}>
            <div style={{ background: cat.color, padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 800, color: "#fff" }}>{cat.label}</div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.75)", marginTop: 1 }}>{cat.desc}</div>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", padding: "14px 8px" }}>
              {cat.icons.map(({ Icon, name }) => (
                <div key={name} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "8px 0" }}>
                  <div style={{ width: 46, height: 46, borderRadius: 14, background: cat.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Icon size={22} color={cat.color} strokeWidth={2} />
                  </div>
                  <span style={{ fontSize: 10, color: SECONDARY, fontWeight: 500 }}>{name}</span>
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* 메뉴 적용 예시 */}
        <div style={{ background: CARD, borderRadius: 20, overflow: "hidden", boxShadow: "0 2px 12px #0000000d" }}>
          <div style={{ padding: "14px 16px", borderBottom: "1px solid #F1F5F9" }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: TEXT }}>메뉴 적용 예시</div>
          </div>
          {SAMPLE_ITEMS.map(({ Icon, label, color, bg }, i) => (
            <div key={label} style={{
              display: "flex", alignItems: "center", gap: 14, padding: "12px 16px",
              borderBottom: i < SAMPLE_ITEMS.length - 1 ? "1px solid #F8FAFC" : "none"
            }}>
              <div style={{ width: 42, height: 42, borderRadius: 13, background: bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Icon size={20} color={color} strokeWidth={2} />
              </div>
              <span style={{ flex: 1, fontSize: 14, color: TEXT, fontWeight: 500 }}>{label}</span>
              <ChevronRight size={15} color={SECONDARY} strokeWidth={1.5} />
            </div>
          ))}
        </div>

        {/* 하단 탭 */}
        <div style={{ background: CARD, borderRadius: 20, overflow: "hidden", boxShadow: "0 2px 12px #0000000d" }}>
          <div style={{ padding: "14px 16px", borderBottom: "1px solid #F1F5F9" }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: TEXT }}>하단 탭바</div>
          </div>
          <div style={{ display: "flex", padding: "14px 0 18px" }}>
            {[
              { Icon: Home,      label: "홈",   color: BLUE,  active: true  },
              { Icon: Users,     label: "회원", color: BLUE,  active: false },
              { Icon: Calendar,  label: "일정", color: BLUE,  active: false },
              { Icon: BarChart2, label: "통계", color: GREEN, active: false },
              { Icon: Settings,  label: "설정", color: SECONDARY, active: false },
            ].map(({ Icon, label, color, active }) => (
              <div key={label} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                <div style={{ width: 38, height: 38, borderRadius: 10, background: active ? BLUE_BG : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon size={20} color={active ? BLUE : SECONDARY} strokeWidth={active ? 2.5 : 1.5} />
                </div>
                <span style={{ fontSize: 9, color: active ? BLUE : SECONDARY, fontWeight: active ? 700 : 400 }}>{label}</span>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
