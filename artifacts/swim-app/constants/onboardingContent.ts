/**
 * onboardingContent.ts — 온보딩 copy single source of truth
 *
 * 규칙:
 * - 실제 코드/API가 보장하지 않는 표현 금지 ("자동", "즉시", "더 정확한", "품질 향상" 등)
 * - 기존 legacy copy 재사용 금지
 * - 기능 설명과 실제 동작 100% 일치
 */

// ── Core onboarding required versions ────────────────────────────────────────
// 이 값을 올리면 해당 role의 모든 사용자가 1회 재노출.
export const ONBOARDING_REQUIRED_VERSIONS = {
  admin_core: 1,
  teacher_core: 1,
  parent_core: 1,
  x_core: 1,
} as const;

export type CoreOnboardingKey = keyof typeof ONBOARDING_REQUIRED_VERSIONS;

// ── Feature guide versions (AsyncStorage) ───────────────────────────────────
// 올리면 해당 기기의 해당 guide 재노출.
export const GUIDE_VERSIONS = {
  admin_members: 1,
  admin_ai_diary: 1,
  admin_x_curriculum: 1,
  admin_growth_report: 1,
  teacher_today: 1,
  teacher_ai_diary: 1,
  teacher_x_ai_diary: 1,
  parent_add_child: 1,
  parent_additional_guardian: 1,
  parent_ai_curriculum_search: 1,
  parent_growth_report: 1,
  parent_insight_report: 1,
  x_entry: 1,
  x_curriculum: 1,
  x_ready: 1,
  x_ai_diary: 1,
  x_growth_event: 1,
  x_growth_report: 1,
} as const;

export type GuideKey = keyof typeof GUIDE_VERSIONS;

// ── Admin Core (TYPE B — 1~3장) ──────────────────────────────────────────────
export const ADMIN_CORE_SLIDES = [
  {
    icon: "users" as const,
    title: "SWIMNOTE에 오신 것을 환영합니다",
    body: "회원 등록, 반 배정, 출결 관리부터\n선생님 초대, 학부모 연결까지\n수영장 운영에 필요한 기능이 모두 담겨 있습니다.",
  },
  {
    icon: "calendar-days" as const,
    title: "수업·출결·일지",
    body: "오늘 수업 일정과 출결을 한눈에 관리하고,\nAI가 수업 메모를 바탕으로\n공통 일지와 학생별 일지를 작성해줍니다.",
  },
  {
    icon: "chart-bar" as const,
    title: "성장 리포트 · SWIMNOTE X",
    body: "AI가 학생별 성장 리포트를 만들면\n내용을 검토한 뒤 학부모에게 발급할 수 있습니다.\n\nSWIMNOTE X는 풀 커리큘럼 기반 심화 기능을\n추가로 제공합니다.",
  },
];

// ── Teacher Core (TYPE B — 1~3장) ────────────────────────────────────────────
export const TEACHER_CORE_SLIDES = [
  {
    icon: "clipboard-list" as const,
    title: "오늘 수업 한눈에",
    body: "홈 화면에서 오늘 수업 일정과\n담당 학생 출결을 바로 확인하고 처리할 수 있습니다.",
  },
  {
    icon: "mic" as const,
    title: "AI 일지 · 사진",
    body: "수업 메모를 입력하면 AI가\n공통 일지와 학생별 일지를 구분해 작성합니다.\n\n사진·영상은 학생별 앨범에 저장됩니다.",
  },
  {
    icon: "message-circle" as const,
    title: "학부모 소통",
    body: "결석·보강 요청과\n학부모 메시지를 앱에서 처리할 수 있습니다.",
  },
];

// ── Parent Core (TYPE B — 1~3장) ─────────────────────────────────────────────
export const PARENT_CORE_SLIDES = [
  {
    icon: "house" as const,
    title: "SWIMNOTE에 오신 것을 환영합니다",
    body: "자녀의 수업 일정, 출결, 일지, 사진을\n앱에서 바로 확인할 수 있습니다.\n\n여러 자녀가 있다면 화면 상단에서 전환해 보세요.",
  },
  {
    icon: "book-open" as const,
    title: "일지 · 공지 · 요청",
    body: "선생님이 작성한 수업 일지와 수영장 공지를 확인하고,\n결석·보강 요청을 앱에서 직접 할 수 있습니다.",
  },
  {
    icon: "bar-chart-2" as const,
    title: "AI 리포트 · 성장 기록",
    body: "수영장에서 발급한 성장 리포트를 확인하고,\nPDF로 저장할 수 있습니다.\n\nAI 커리큘럼 검색으로 우리 아이 수준에 맞는\n내용을 찾아볼 수 있습니다.",
  },
];

// ── Feature guide copy ───────────────────────────────────────────────────────

export const GUIDE_CONTENT = {
  // Admin: 학부모 전화번호 inline help
  admin_parent_phone_inline: {
    text: "학부모 전화번호를 정확히 입력하면,\n학부모 가입 시 자녀 이름과 전화번호가 일치할 때\n자동으로 연결됩니다.",
  },

  // Admin: 회원 목록
  admin_members: {
    title: "회원 관리",
    body: "회원 등록, 반 배정, 학부모 연결을\n이 화면에서 할 수 있습니다.\n\n학부모가 가입할 때 전화번호가 일치하면\n자동으로 연결됩니다.",
  },

  // Admin: AI 일지
  admin_ai_diary: {
    title: "AI 일지",
    body: "수업 메모를 입력하면\nAI가 공통 일지와 학생별 일지를 작성합니다.\n\n저장 전 내용을 수정할 수 있습니다.",
  },

  // Admin: Growth Report
  admin_growth_report: {
    title: "성장 리포트",
    body: "매달 AI가 학생별 성장 리포트를 생성합니다.\n\n내용을 검토한 뒤 발급 버튼을 누르면\n학부모 앱에 공개되고 알림이 발송됩니다.",
  },

  // Admin: X Curriculum
  admin_x_curriculum: {
    title: "X 커리큘럼",
    body: "수영장의 커리큘럼 파일을 업로드하면\nSWIMNOTE가 내용을 구조화해 검토 준비를 합니다.\n\n업로드된 내용은 운영 검수 후 승인되며,\n승인된 커리큘럼만 X 기능에 적용됩니다.\n\n수정이 필요한 경우 파일을 다시 업로드할 수 있습니다.",
  },

  // Teacher: AI Diary
  teacher_ai_diary: {
    title: "AI 일지",
    body: "음성이나 텍스트로 수업 메모를 입력하면\nAI가 공통 일지와 학생별 일지를 작성합니다.\n\n학생 이름을 말하면 해당 학생 일지로 구분하고,\n\"전체\"라고 하면 공통 일지로 전환됩니다.\n\n저장 전에 내용을 수정할 수 있습니다.",
  },

  // Teacher: X AI Diary (X mode)
  teacher_x_ai_diary: {
    title: "X AI 일지",
    body: "강사 메모를 입력하면\nAI가 공통 일지와 학생별 일지를\n자동으로 구분해 작성합니다.\n\nX에서는 생성된 일지에\n수영장의 커리큘럼 항목과 연결된\n태그를 함께 제공합니다.",
  },

  // Parent: 자녀 연결 안내 (add-child inline)
  parent_add_child_inline: {
    text: "수영장에 등록된 자녀 이름과\n지금 가입하는 전화번호가 일치하면\n자동으로 연결됩니다.\n\n정보가 일치하지 않으면\n수영장 확인 후 연결됩니다.",
  },

  // Parent: Additional Guardians
  parent_additional_guardian: {
    title: "추가 보호자 등록",
    body: "배우자, 조부모 등 다른 보호자도\n함께 사용할 수 있습니다.\n\n추가 보호자 전화번호를 등록하면\n그 번호로 가입한 보호자가\n자동으로 자녀와 연결됩니다.\n\n최대 3명까지 등록할 수 있습니다.",
  },

  // Parent: Growth Report
  parent_growth_report: {
    title: "AI 성장 리포트",
    body: "선생님의 수업 기록을 바탕으로\nAI가 성장 리포트를 만듭니다.\n\n수영장에서 내용을 확인한 뒤 발행하면\n앱에서 확인할 수 있습니다.\n\n발행된 리포트는 PDF로 저장할 수 있습니다.",
  },

  // Parent: Insight Report (HOLD)
  parent_insight_report: {
    title: "AI 인사이트 리포트",
    body: "일지 기반으로 내 아이의\n수영 성장 과정을 심층 분석한 리포트입니다.\n\n수업 기록이 쌓이면 이용할 수 있게 됩니다.",
  },

  // Parent: AI Curriculum Search
  parent_ai_curriculum_search: {
    title: "AI 커리큘럼 검색",
    body: "우리 아이 수준에 맞는\n커리큘럼 항목을 검색하고\n현재 학습 목표를 확인할 수 있습니다.",
  },

  // X: Entry
  x_entry: {
    title: "SWIMNOTE X",
    body: "SWIMNOTE X는 수영장 커리큘럼을 기반으로\nAI 일지 태그, 성장 이벤트 추적,\nAI 성장 리포트 등 심화 기능을 제공합니다.\n\n구독 및 커리큘럼 승인 후 사용할 수 있습니다.",
  },

  // X: READY
  x_ready: {
    title: "X 기능이 활성화되었습니다",
    body: "이제 다음 기능을 사용할 수 있습니다:\n\n• AI 일지 커리큘럼 태그\n• 성장 이벤트 기록\n• AI 성장 리포트\n• 학부모 커리큘럼 검색\n\n회원 관리, 출결, 일지 등 기본 기능은\nX와 무관하게 사용 가능합니다.",
  },

  // X: Curriculum (human review)
  x_curriculum: {
    title: "X 커리큘럼 검수",
    body: "수영장의 커리큘럼 파일을 업로드하면\nSWIMNOTE가 내용을 구조화해 검토 준비를 합니다.\n\n업로드된 내용은 운영 검수 후 승인되며,\n승인된 커리큘럼만 X 기능에 적용됩니다.\n\n수정이 필요한 경우\n파일을 다시 업로드할 수 있습니다.",
  },

  // X: AI Diary (accurate description)
  x_ai_diary: {
    title: "X AI 일지",
    body: "강사 메모를 입력하면\nAI가 공통 일지와 학생별 일지를\n자동으로 구분해 작성합니다.\n\nX에서는 생성된 일지에\n수영장의 커리큘럼 항목과 연결된\n태그를 함께 제공합니다.",
  },

  // X: Growth Event
  x_growth_event: {
    title: "성장 이벤트",
    body: "학생의 중요한 성장 순간을\n기록하고 추적할 수 있습니다.\n\n기록된 이벤트는 성장 리포트에 반영됩니다.",
  },

  // X: Growth Report
  x_growth_report: {
    title: "성장 리포트",
    body: "선생님의 수업 기록과 성장 이벤트를 바탕으로\nAI가 학생별 성장 리포트를 만듭니다.\n\n검토 후 발급하면 학부모 앱에 공개됩니다.\n발행된 리포트는 PDF로 저장할 수 있습니다.",
  },
} as const;
