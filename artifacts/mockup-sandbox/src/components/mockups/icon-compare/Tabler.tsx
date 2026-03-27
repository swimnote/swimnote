import {
  IconHome2, IconUsers, IconCalendar, IconBell, IconSettings,
  IconCircleCheck, IconCircleX, IconClock, IconChartBar,
  IconSearch, IconLock, IconUserCircle, IconPhone,
  IconPencil, IconTrash, IconLogout, IconPlus,
  IconAlertTriangle, IconSwimming
} from "@tabler/icons-react";

const TINT = "#2EC4B6";
const TEXT = "#0F172A";
const SECONDARY = "#64748B";
const BG = "#F5F5F5";
const CARD = "#FFFFFF";
const MINT = "#E6FAF8";

const rows = [
  { Icon: IconHome2,        label: "홈"        },
  { Icon: IconUsers,        label: "회원관리"   },
  { Icon: IconCalendar,     label: "일정"       },
  { Icon: IconCircleCheck,  label: "출석"       },
  { Icon: IconCircleX,      label: "결석"       },
  { Icon: IconClock,        label: "지각"       },
  { Icon: IconChartBar,     label: "매출통계"   },
  { Icon: IconBell,         label: "알림"       },
  { Icon: IconAlertTriangle,label: "경고"       },
  { Icon: IconSearch,       label: "검색"       },
  { Icon: IconLock,         label: "비밀번호"   },
  { Icon: IconUserCircle,   label: "프로필"     },
  { Icon: IconPhone,        label: "전화"       },
  { Icon: IconPencil,       label: "수정"       },
  { Icon: IconTrash,        label: "삭제"       },
  { Icon: IconLogout,       label: "로그아웃"   },
  { Icon: IconSettings,     label: "설정"       },
  { Icon: IconPlus,         label: "추가"       },
];

const tabs = [
  { Icon: IconHome2,    label: "홈"   },
  { Icon: IconUsers,    label: "회원" },
  { Icon: IconCalendar, label: "일정" },
  { Icon: IconBell,     label: "알림" },
  { Icon: IconSettings, label: "설정" },
];

export function Tabler() {
  return (
    <div style={{ background: BG, minHeight: "100vh", fontFamily: "system-ui, sans-serif", maxWidth: 390, margin: "0 auto" }}>
      <div style={{ background: "#2563EB", padding: "48px 20px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <IconSwimming size={22} color="#fff" stroke={2} />
          <span style={{ color: "#fff", fontSize: 18, fontWeight: 800 }}>Tabler Icons</span>
        </div>
        <p style={{ color: "rgba(255,255,255,0.8)", fontSize: 12, margin: "4px 0 0" }}>Stroke 1 · Stroke 1.5 · Stroke 2 · Filled</p>
      </div>

      <div style={{ background: CARD, borderBottom: "1px solid #F1F5F9", display: "flex", padding: "10px 0 14px" }}>
        {tabs.map(({ Icon, label }, i) => (
          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            <Icon size={22} color={i === 0 ? "#2563EB" : SECONDARY} stroke={i === 0 ? 2.5 : 1.5} />
            <span style={{ fontSize: 9, color: i === 0 ? "#2563EB" : SECONDARY, fontWeight: i === 0 ? 700 : 400 }}>{label}</span>
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
              <div style={{ width: 36, height: 36, borderRadius: 10, background: "#EFF6FF", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Icon size={18} color="#2563EB" stroke={2} />
              </div>
              <span style={{ fontSize: 14, color: TEXT, flex: 1 }}>{label}</span>
              <Icon size={16} color={SECONDARY} stroke={1.5} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
