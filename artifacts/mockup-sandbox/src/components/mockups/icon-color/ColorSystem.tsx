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

const MINT   = "#2EC4B6";
const INDIGO = "#4F6EF7";
const AMBER  = "#E4A93A";

const MINT_BG   = "#E6FAF8";
const INDIGO_BG = "#EEF2FF";
const AMBER_BG  = "#FFF8E6";

const TEXT      = "#0F172A";
const SECONDARY = "#64748B";
const BG        = "#F5F5F5";
const CARD      = "#FFFFFF";

const CATEGORIES = [
  {
    color: MINT, bg: MINT_BG, label: "탐색 · 기본행동",
    desc: "주요 화면 이동, 확인, 완료",
    icons: [
      { Icon: Home,        name: "홈"    },
      { Icon: Calendar,    name: "일정"  },
      { Icon: Search,      name: "검색"  },
      { Icon: Bell,        name: "알림"  },
      { Icon: CheckCircle2,name: "완료"  },
      { Icon: Plus,        name: "추가"  },
      { Icon: BookOpen,    name: "기록"  },
      { Icon: MessageCircle,name: "메시지"},
    ],
  },
  {
    color: INDIGO, bg: INDIGO_BG, label: "관리 · 데이터",
    desc: "회원·수업·매출 관리 기능",
    icons: [
      { Icon: Users,      name: "회원"   },
      { Icon: UserPlus,   name: "초대"   },
      { Icon: UserCheck,  name: "승인"   },
      { Icon: BarChart2,  name: "통계"   },
      { Icon: DollarSign, name: "매출"   },
      { Icon: CreditCard, name: "결제"   },
      { Icon: FileText,   name: "보고서" },
      { Icon: Database,   name: "데이터" },
    ],
  },
  {
    color: AMBER, bg: AMBER_BG, label: "상태 · 알림",
    desc: "출결 상태, 경고, 대기 처리",
    icons: [
      { Icon: Clock,         name: "지각"   },
      { Icon: AlertTriangle, name: "경고"   },
      { Icon: XCircle,       name: "결석"   },
      { Icon: UserX,         name: "정지"   },
      { Icon: Shield,        name: "보안"   },
      { Icon: Inbox,         name: "대기"   },
      { Icon: RefreshCw,     name: "갱신"   },
      { Icon: Archive,       name: "보관"   },
    ],
  },
];

const SAMPLE_ITEMS = [
  { Icon: Home,          label: "홈",          color: MINT,   bg: MINT_BG   },
  { Icon: Users,         label: "회원 관리",    color: INDIGO, bg: INDIGO_BG },
  { Icon: Calendar,      label: "수업 일정",    color: MINT,   bg: MINT_BG   },
  { Icon: BarChart2,     label: "매출 통계",    color: INDIGO, bg: INDIGO_BG },
  { Icon: AlertTriangle, label: "승인 대기 8건",color: AMBER,  bg: AMBER_BG  },
  { Icon: CheckCircle2,  label: "오늘 출석 완료",color: MINT,  bg: MINT_BG   },
  { Icon: DollarSign,    label: "이달 수입",    color: INDIGO, bg: INDIGO_BG },
  { Icon: Clock,         label: "지각 알림",    color: AMBER,  bg: AMBER_BG  },
];

const CONTRAST = [
  { color: MINT,   bg: MINT_BG,   label: "#2EC4B6", name: "민트",   ratio: "3.8:1" },
  { color: INDIGO, bg: INDIGO_BG, label: "#4F6EF7", name: "인디고", ratio: "4.6:1" },
  { color: AMBER,  bg: AMBER_BG,  label: "#E4A93A", name: "앰버",   ratio: "3.2:1" },
];

export function ColorSystem() {
  return (
    <div style={{ background: BG, minHeight: "100vh", fontFamily: "'Inter', system-ui, sans-serif", maxWidth: 480, margin: "0 auto" }}>

      {/* 헤더 */}
      <div style={{ background: TEXT, padding: "44px 20px 20px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <Waves size={20} color={MINT} strokeWidth={2.5} />
          <span style={{ color: "#fff", fontSize: 17, fontWeight: 800 }}>아이콘 컬러 시스템</span>
        </div>
        <p style={{ color: "#94A3B8", fontSize: 12, margin: 0 }}>기존 앱 색상 중 대비 상위 3가지</p>

        {/* 대비 수치 */}
        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          {CONTRAST.map(c => (
            <div key={c.name} style={{ flex: 1, background: "rgba(255,255,255,0.08)", borderRadius: 12, padding: "10px 10px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                <div style={{ width: 12, height: 12, borderRadius: 3, background: c.color }} />
                <span style={{ color: "#fff", fontSize: 12, fontWeight: 700 }}>{c.name}</span>
              </div>
              <div style={{ fontSize: 10, color: "#94A3B8", marginBottom: 2 }}>{c.label}</div>
              <div style={{ fontSize: 13, color: c.color, fontWeight: 800 }}>대비 {c.ratio}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: "16px 14px", display: "flex", flexDirection: "column", gap: 14 }}>

        {/* 카테고리별 아이콘 */}
        {CATEGORIES.map(cat => (
          <div key={cat.label} style={{ background: CARD, borderRadius: 20, overflow: "hidden", boxShadow: "0 2px 10px #0000000a" }}>
            <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid #F8FAFC", display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: cat.color }} />
              <div>
                <div style={{ fontSize: 14, fontWeight: 800, color: TEXT }}>{cat.label}</div>
                <div style={{ fontSize: 11, color: SECONDARY }}>{cat.desc}</div>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", padding: "12px 8px" }}>
              {cat.icons.map(({ Icon, name }) => (
                <div key={name} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "8px 0" }}>
                  <div style={{ width: 44, height: 44, borderRadius: 13, background: cat.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Icon size={20} color={cat.color} strokeWidth={2} />
                  </div>
                  <span style={{ fontSize: 10, color: SECONDARY, fontWeight: 500 }}>{name}</span>
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* 실제 적용 예시 */}
        <div style={{ background: CARD, borderRadius: 20, overflow: "hidden", boxShadow: "0 2px 10px #0000000a" }}>
          <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid #F8FAFC" }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: TEXT }}>실제 메뉴 적용 예시</div>
            <div style={{ fontSize: 11, color: SECONDARY }}>3가지 색상으로 기능 구분</div>
          </div>
          {SAMPLE_ITEMS.map(({ Icon, label, color, bg }, i) => (
            <div key={label} style={{
              display: "flex", alignItems: "center", gap: 14, padding: "12px 16px",
              borderBottom: i < SAMPLE_ITEMS.length - 1 ? "1px solid #F8FAFC" : "none"
            }}>
              <div style={{ width: 40, height: 40, borderRadius: 12, background: bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Icon size={18} color={color} strokeWidth={2} />
              </div>
              <span style={{ flex: 1, fontSize: 14, color: TEXT, fontWeight: 500 }}>{label}</span>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: color, opacity: 0.6 }} />
              <ChevronRight size={15} color={SECONDARY} strokeWidth={1.5} />
            </div>
          ))}
        </div>

        {/* 탭바 예시 */}
        <div style={{ background: CARD, borderRadius: 20, boxShadow: "0 2px 10px #0000000a" }}>
          <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid #F8FAFC" }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: TEXT }}>하단 탭바</div>
          </div>
          <div style={{ display: "flex", padding: "14px 0 18px" }}>
            {[
              { Icon: Home,      label: "홈",   color: MINT,   active: true  },
              { Icon: Users,     label: "회원", color: INDIGO, active: false },
              { Icon: Calendar,  label: "일정", color: MINT,   active: false },
              { Icon: BarChart2, label: "통계", color: INDIGO, active: false },
              { Icon: Settings,  label: "설정", color: SECONDARY, active: false },
            ].map(({ Icon, label, color, active }) => (
              <div key={label} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: active ? MINT_BG : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon size={20} color={active ? MINT : SECONDARY} strokeWidth={active ? 2.5 : 1.5} />
                </div>
                <span style={{ fontSize: 9, color: active ? MINT : SECONDARY, fontWeight: active ? 700 : 400 }}>{label}</span>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
