import {
  Home, Users, Calendar, Bell, Settings,
  CheckCircle2, XCircle, Clock, BarChart2,
  Search, Lock, UserCircle2, Phone,
  Pencil, Trash2, LogOut, Plus,
  AlertTriangle, Waves, ChevronRight
} from "lucide-react";

const TINT = "#2EC4B6";
const TEXT = "#0F172A";
const SECONDARY = "#64748B";
const BG = "#F5F5F5";
const CARD = "#FFFFFF";
const MINT = "#E6FAF8";
const ACCENT = "#7C3AED";

const rows = [
  { Icon: Home,          label: "홈"        },
  { Icon: Users,         label: "회원관리"   },
  { Icon: Calendar,      label: "일정"       },
  { Icon: CheckCircle2,  label: "출석"       },
  { Icon: XCircle,       label: "결석"       },
  { Icon: Clock,         label: "지각"       },
  { Icon: BarChart2,     label: "매출통계"   },
  { Icon: Bell,          label: "알림"       },
  { Icon: AlertTriangle, label: "경고"       },
  { Icon: Search,        label: "검색"       },
  { Icon: Lock,          label: "비밀번호"   },
  { Icon: UserCircle2,   label: "프로필"     },
  { Icon: Phone,         label: "전화"       },
  { Icon: Pencil,        label: "수정"       },
  { Icon: Trash2,        label: "삭제"       },
  { Icon: LogOut,        label: "로그아웃"   },
  { Icon: Settings,      label: "설정"       },
  { Icon: Plus,          label: "추가"       },
];

const tabs = [
  { Icon: Home,     label: "홈"   },
  { Icon: Users,    label: "회원" },
  { Icon: Calendar, label: "일정" },
  { Icon: Bell,     label: "알림" },
  { Icon: Settings, label: "설정" },
];

export function Lucide() {
  return (
    <div style={{ background: BG, minHeight: "100vh", fontFamily: "system-ui, sans-serif", maxWidth: 390, margin: "0 auto" }}>
      <div style={{ background: ACCENT, padding: "48px 20px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Waves size={22} color="#fff" strokeWidth={2.5} />
          <span style={{ color: "#fff", fontSize: 18, fontWeight: 800 }}>Lucide Icons</span>
        </div>
        <p style={{ color: "rgba(255,255,255,0.8)", fontSize: 12, margin: "4px 0 0" }}>Feather 후속작 · strokeWidth 1~3 · 1300개+</p>
      </div>

      <div style={{ background: CARD, borderBottom: "1px solid #F1F5F9", display: "flex", padding: "10px 0 14px" }}>
        {tabs.map(({ Icon, label }, i) => (
          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            <Icon size={22} color={i === 0 ? ACCENT : SECONDARY} strokeWidth={i === 0 ? 2.5 : 1.5} />
            <span style={{ fontSize: 9, color: i === 0 ? ACCENT : SECONDARY, fontWeight: i === 0 ? 700 : 400 }}>{label}</span>
          </div>
        ))}
      </div>

      <div style={{ padding: 14 }}>
        <div style={{ background: CARD, borderRadius: 18, padding: "4px 0", boxShadow: "0 2px 10px #0000000a" }}>
          {rows.map(({ Icon, label }, i) => (
            <div key={label} style={{
              display: "flex", alignItems: "center", gap: 14, padding: "11px 16px",
              borderBottom: i < rows.length - 1 ? "1px solid #F8FAFC" : "none"
            }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: "#F5F3FF", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Icon size={18} color={ACCENT} strokeWidth={2} />
              </div>
              <span style={{ fontSize: 14, color: TEXT, flex: 1 }}>{label}</span>
              <Icon size={16} color={SECONDARY} strokeWidth={1.5} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
