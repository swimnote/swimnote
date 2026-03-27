import {
  Home, Layers, Send, DollarSign, Menu,
  Bell, Database, Image, HardDrive,
  ChevronRight, LogOut, Settings, User,
  BookOpen, Lock, ShieldCheck, Smartphone,
  ToggleRight, Volume2, SlidersHorizontal,
  Waves, MessageSquare, Camera,
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
  { Icon: Home,       label: "홈",    active: false },
  { Icon: Layers,     label: "수업",  active: false },
  { Icon: Send,       label: "메신저",active: false },
  { Icon: DollarSign, label: "정산",  active: false },
  { Icon: Menu,       label: "더보기",active: true  },
];

const SECTIONS = [
  {
    title: "내 정보",
    items: [
      { Icon: User,        label: "프로필 수정",    sub: "이름·연락처",         color: BLUE,   bg: BLUE_BG   },
      { Icon: Lock,        label: "비밀번호 변경",  sub: "마지막 변경 30일 전", color: BLUE,   bg: BLUE_BG   },
      { Icon: ShieldCheck, label: "보안 설정",      sub: "2단계 인증",          color: BLUE,   bg: BLUE_BG   },
    ],
  },
  {
    title: "알림",
    items: [
      { Icon: MessageSquare, label: "메신저 알림",   sub: "켜짐", color: GREEN,  bg: GREEN_BG, toggle: true, on: true  },
      { Icon: BookOpen,      label: "일지 리마인더", sub: "켜짐", color: GREEN,  bg: GREEN_BG, toggle: true, on: true  },
      { Icon: Bell,          label: "보강 요청 알림",sub: "켜짐", color: ORANGE, bg: ORANGE_BG,toggle: true, on: true  },
    ],
  },
  {
    title: "저장공간",
    items: [
      { Icon: Camera,    label: "사진·영상 앨범",  sub: "342 MB",  color: GREEN,  bg: GREEN_BG  },
      { Icon: HardDrive, label: "데이터 사용량",   sub: "1.2 GB / 5 GB", color: ORANGE, bg: ORANGE_BG },
      { Icon: Database,  label: "캐시 초기화",     sub: "48 MB",   color: ORANGE, bg: ORANGE_BG },
    ],
  },
  {
    title: "앱 설정",
    items: [
      { Icon: SlidersHorizontal, label: "피드백 기본 설정", sub: "템플릿 관리", color: BLUE, bg: BLUE_BG   },
      { Icon: Smartphone,        label: "디스플레이 설정",  sub: "글자 크기",   color: BLUE, bg: BLUE_BG   },
    ],
  },
];

export function TeacherSettings() {
  return (
    <div style={{ background: BG, minHeight: "100vh", fontFamily: "'Inter', system-ui, sans-serif", maxWidth: 390, margin: "0 auto", display: "flex", flexDirection: "column" }}>

      {/* 헤더 */}
      <div style={{ background: CARD, padding: "52px 20px 20px", borderBottom: "1px solid #F1F5F9" }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: TEXT }}>더보기</div>

        {/* 프로필 카드 */}
        <div style={{ marginTop: 16, background: BLUE_BG, borderRadius: 18, padding: "16px 18px", display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 52, height: 52, borderRadius: 16, background: BLUE, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Waves size={26} color="#fff" strokeWidth={2.5} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: TEXT }}>김민준 선생님</div>
            <div style={{ fontSize: 12, color: SECONDARY, marginTop: 2 }}>스윔아카데미 · 선생님</div>
            <div style={{ fontSize: 11, color: BLUE, marginTop: 4, fontWeight: 600 }}>010-1234-5678</div>
          </div>
          <ChevronRight size={16} color={BLUE} strokeWidth={2} />
        </div>
      </div>

      {/* 저장공간 게이지 */}
      <div style={{ margin: "14px 14px 0", background: CARD, borderRadius: 18, padding: "16px 18px", boxShadow: "0 2px 10px #0000000a" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: ORANGE_BG, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <HardDrive size={16} color={ORANGE} strokeWidth={2} />
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>저장공간</div>
          </div>
          <div style={{ fontSize: 12, color: SECONDARY }}>1.2 GB / 5 GB</div>
        </div>
        <div style={{ height: 8, background: "#F1F5F9", borderRadius: 99, overflow: "hidden" }}>
          <div style={{ width: "24%", height: "100%", background: ORANGE, borderRadius: 99 }} />
        </div>
        <div style={{ fontSize: 10, color: SECONDARY, marginTop: 6 }}>24% 사용 중</div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px 100px" }}>

        {SECTIONS.map(section => (
          <div key={section.title} style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: SECONDARY, padding: "4px 4px 8px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              {section.title}
            </div>
            <div style={{ background: CARD, borderRadius: 20, overflow: "hidden", boxShadow: "0 2px 10px #0000000a" }}>
              {section.items.map(({ Icon, label, sub, color, bg, toggle, on }, i) => (
                <div key={label} style={{
                  display: "flex", alignItems: "center", gap: 14, padding: "12px 16px",
                  borderBottom: i < section.items.length - 1 ? "1px solid #F8FAFC" : "none",
                }}>
                  <div style={{ width: 40, height: 40, borderRadius: 12, background: bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <Icon size={19} color={color} strokeWidth={2} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: TEXT }}>{label}</div>
                    {sub && <div style={{ fontSize: 11, color: SECONDARY, marginTop: 1 }}>{sub}</div>}
                  </div>
                  {toggle ? (
                    <div style={{ width: 44, height: 26, borderRadius: 13, background: on ? GREEN : "#CBD5E1", position: "relative" }}>
                      <div style={{ position: "absolute", top: 3, right: on ? 3 : "auto", left: on ? "auto" : 3, width: 20, height: 20, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px #0002" }} />
                    </div>
                  ) : (
                    <ChevronRight size={15} color={SECONDARY} strokeWidth={1.5} />
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* 로그아웃 */}
        <div style={{ background: CARD, borderRadius: 20, overflow: "hidden", boxShadow: "0 2px 10px #0000000a" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 16px" }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: "#FFF2F2", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <LogOut size={19} color="#E85555" strokeWidth={2} />
            </div>
            <span style={{ fontSize: 14, fontWeight: 600, color: "#E85555" }}>로그아웃</span>
          </div>
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
            <div style={{ width: 40, height: 32, borderRadius: 10, background: active ? ORANGE_BG : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Icon size={21} color={active ? ORANGE : SECONDARY} strokeWidth={active ? 2.5 : 1.5} />
            </div>
            <span style={{ fontSize: 10, color: active ? ORANGE : SECONDARY, fontWeight: active ? 700 : 400 }}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
