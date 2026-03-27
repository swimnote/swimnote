import {
  House, Users, CalendarDots, Bell, CheckCircle,
  XCircle, Gear, MagnifyingGlass, ArrowLeft, Plus,
  Lock, UserCircle, Phone, Warning, Clock, ChartBar,
  SwimmingPool, CaretRight, Pencil, Trash, SignOut
} from "@phosphor-icons/react";

const TINT = "#2EC4B6";
const TEXT = "#0F172A";
const SECONDARY = "#64748B";
const BG = "#F5F5F5";
const CARD = "#FFFFFF";
const MINT = "#E6FAF8";

const rows = [
  { Icon: House,           label: "홈"        },
  { Icon: Users,           label: "회원관리"   },
  { Icon: CalendarDots,    label: "일정"       },
  { Icon: CheckCircle,     label: "출석"       },
  { Icon: XCircle,         label: "결석"       },
  { Icon: Clock,           label: "지각"       },
  { Icon: ChartBar,        label: "매출통계"   },
  { Icon: Bell,            label: "알림"       },
  { Icon: Warning,         label: "경고"       },
  { Icon: MagnifyingGlass, label: "검색"       },
  { Icon: Lock,            label: "비밀번호"   },
  { Icon: UserCircle,      label: "프로필"     },
  { Icon: Phone,           label: "전화"       },
  { Icon: Pencil,          label: "수정"       },
  { Icon: Trash,           label: "삭제"       },
  { Icon: SignOut,         label: "로그아웃"   },
  { Icon: Gear,            label: "설정"       },
  { Icon: Plus,            label: "추가"       },
];

export function Phosphor() {
  return (
    <div style={{ background: BG, minHeight: "100vh", fontFamily: "system-ui, sans-serif", maxWidth: 390, margin: "0 auto" }}>
      <div style={{ background: TINT, padding: "48px 20px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <SwimmingPool size={22} color="#fff" weight="fill" />
          <span style={{ color: "#fff", fontSize: 18, fontWeight: 800 }}>Phosphor Icons</span>
        </div>
        <p style={{ color: "rgba(255,255,255,0.8)", fontSize: 12, margin: "4px 0 0" }}>Duotone · Fill · Bold · Regular · Thin</p>
      </div>

      {/* 탭바 미리보기 */}
      <div style={{ background: CARD, borderBottom: "1px solid #F1F5F9", display: "flex", padding: "10px 0 14px" }}>
        {[House, Users, CalendarDots, Bell, Gear].map((Icon, i) => (
          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            <Icon size={22} color={i === 0 ? TINT : SECONDARY} weight={i === 0 ? "fill" : "regular"} />
            <span style={{ fontSize: 9, color: i === 0 ? TINT : SECONDARY, fontWeight: i === 0 ? 700 : 400 }}>
              {["홈","회원","일정","알림","설정"][i]}
            </span>
          </div>
        ))}
      </div>

      {/* 아이콘 그리드 */}
      <div style={{ padding: 14 }}>
        <div style={{ background: CARD, borderRadius: 18, padding: "4px 0", boxShadow: "0 2px 10px #0000000a" }}>
          {rows.map(({ Icon, label }, i) => (
            <div key={label} style={{
              display: "flex", alignItems: "center", gap: 14, padding: "11px 16px",
              borderBottom: i < rows.length - 1 ? "1px solid #F8FAFC" : "none"
            }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: MINT, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Icon size={18} color={TINT} weight="fill" />
              </div>
              <span style={{ fontSize: 14, color: TEXT, flex: 1 }}>{label}</span>
              <Icon size={16} color={SECONDARY} weight="regular" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
