export interface RoleConfig {
  key: string;
  title: string;
  subtitle: string;
  icon: string;
  color: string;
  bgColor: string;
  route: string;
}

export const ROLE_CONFIGS: Record<string, RoleConfig> = {
  pool_admin: {
    key: "pool_admin",
    title: "관리자",
    subtitle: "수영장 운영 및 전체 관리",
    icon: "settings",
    color: "#1A5CFF",
    bgColor: "#EEF3FF",
    route: "/(admin)/dashboard",
  },
  teacher: {
    key: "teacher",
    title: "선생님",
    subtitle: "수업·출결·일지 관리",
    icon: "user-check",
    color: "#0891B2",
    bgColor: "#E0F5FA",
    route: "/(teacher)/my-schedule",
  },
  parent: {
    key: "parent",
    title: "학부모",
    subtitle: "자녀 수업 일정 확인",
    icon: "heart",
    color: "#059669",
    bgColor: "#D1FAE5",
    route: "/(parent)",
  },
  super_admin: {
    key: "super_admin",
    title: "플랫폼 관리자",
    subtitle: "전체 수영장 플랫폼 관리",
    icon: "shield",
    color: "#7C3AED",
    bgColor: "#EDE9FE",
    route: "/(super)/pools",
  },
};

export const LOGIN_LABELS = {
  appName: "스윔노트",
  appSub: "수영장 통합 관리 플랫폼",

  idInput: {
    label: "아이디",
    placeholder: "이메일 또는 전화번호",
    helper: "등록된 이메일 또는 전화번호를 입력하세요",
  },

  nextBtn: "다음",
  checkingId: "확인 중...",

  existsMsg: "가입된 계정입니다. 비밀번호를 입력해주세요.",
  newIdMsg: "등록되지 않은 아이디입니다. 가입 화면으로 이동합니다.",

  poolSearch: {
    title: "수영장 찾기",
    sub: "수영장 이름이나 지역으로 검색해보세요",
    btn: "수영장 검색하기",
  },

  passwordInput: {
    label: "비밀번호",
    placeholder: "비밀번호를 입력하세요",
  },

  loginBtn: "로그인",
  forgotPw: "비밀번호를 잊으셨나요?",
  backToId: "아이디 변경",

  inviteCode: {
    sectionTitle: "초대 코드 또는 수영장 코드",
    placeholder: "초대링크 또는 수영장 코드 입력",
    btn: "확인",
    helper: "수영장에서 받은 초대코드 또는 링크를 입력하세요",
  },
};

export const ROLE_SELECT_LABELS = {
  title: "모드 선택",
  orgSelectorLabel: "수영장 선택",
  orgSelectorIcon: "chevron-down",
  switchModeTitle: "모드 변경",
  switchOrgTitle: "수영장 변경",
  enterModeBtn: (title: string) => `${title} 모드 입장`,
  logoutBtn: "로그아웃",
  noRolesMsg: "사용 가능한 역할이 없습니다.",
};

export const DEMO_ACCOUNTS = [
  { id: "1", pw: "1", label: "플랫폼 관리자", roleKey: "super_admin", color: "#7C3AED" },
  { id: "2", pw: "2", label: "토이키즈 관리자", roleKey: "pool_admin", color: "#1A5CFF" },
  { id: "3", pw: "3", label: "토이키즈 선생님", roleKey: "teacher", color: "#0891B2" },
  { id: "4", pw: "4", label: "서태웅 학부모", roleKey: "parent", color: "#059669" },
  { id: "5", pw: "5", label: "아쿠아스타 관리자", roleKey: "pool_admin", color: "#1A5CFF" },
  { id: "6", pw: "6", label: "아쿠아스타 선생님", roleKey: "teacher", color: "#0891B2" },
] as const;
