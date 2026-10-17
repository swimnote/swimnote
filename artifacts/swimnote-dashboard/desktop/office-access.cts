/** Shared, explicit OFFICE surface. No arbitrary URL, financial execution or messaging transport. */
export const OFFICE_PAGES = [
  ["/admin/members/new", "회원 등록", "회원"],
  ["/admin/members/bulk", "엑셀 일괄등록", "회원"],
  ["/admin/members/withdrawn", "지난 회원", "회원"],
  ["/admin/members/archive", "퇴원 Archive", "회원"],
  ["/admin/guardians", "보호자·연락처", "회원"],
  ["/admin/schedule", "전체 시간표", "수업"],
  ["/admin/schedule/classes", "반·정원 관리", "수업"],
  ["/admin/attendance", "출결", "출결·보강"],
  ["/admin/makeups", "보강 현황", "출결·보강"],
  ["/admin/makeups/assign", "보강 배정", "출결·보강"],
  ["/admin/diary", "일지·피드", "교육"],
  ["/admin/album", "앨범", "교육"],
  ["/admin/curriculum", "커리큘럼", "교육"],
  ["/admin/curriculum/new", "커리큘럼 등록", "교육"],
  ["/admin/curriculum/levels", "레벨·교육과정", "교육"],
  ["/admin/curriculum/templates", "일지 템플릿", "교육"],
  ["/admin/growth-reports/pending", "성장리포트 검수", "교육"],
  ["/admin/growth-reports/publish", "성장리포트 발행", "교육"],
  ["/admin/growth-reports/published", "성장리포트 발행 이력", "교육"],
  ["/admin/communication", "학부모 요청·답장", "소통·직원"],
  ["/admin/notices", "공지", "소통·직원"],
  ["/admin/teachers", "선생님", "소통·직원"],
  ["/admin/staff", "직원·권한", "소통·직원"],
  ["/admin/revenue", "기존 통계·강사 정산", "통계·설정"],
  ["/admin/settings", "Pool·운영 설정", "통계·설정"],
  ["/admin/desktop-settings", "Desktop 설정", "통계·설정"],
  ["/admin/legacy", "상담·체험·등록전환", "후속 완성"],
  ["/admin/tuition", "재등록·청구·수납", "후속 완성"],
] as const;

export function officePage(raw: string) {
  if (!raw.startsWith("/admin/") || raw.startsWith("//") || /[#\\\u0000-\u001f]/.test(raw) ||
    /%2e|%2f|(?:^|\/)\.{1,2}(?:\/|$)/i.test(raw.split("?")[0])) return undefined;
  try {
    const u = new URL(raw, "https://office.invalid");
    if (u.origin !== "https://office.invalid" || u.search.length > 800) return undefined;
    if ([...u.searchParams.keys()].some(k => !["highlight", "student_id", "class_id", "month", "year", "tab"].includes(k))) return undefined;
    return OFFICE_PAGES.find(p => p[0] === u.pathname);
  } catch { return undefined; }
}

const id = "[A-Za-z0-9_-]{1,160}";
const reads = [
  "/students", `/students/${id}(?:/parents|/attendance)?`, "/class-groups", "/teachers",
  `/admin/(?:students/${id}/detail|class-groups/${id}/detail|withdrawn-members|members/export|makeups)`,
  `/admin/teacher-invites(?:/${id}/detail)?`,
  `/admin/growth-reports/(?:monthly-list|${id}|students/${id})`,
  "/diary-template-levels", "/diary-templates",
  "/curriculum/diary/(?:levels|facets|nodes)",
  `/diaries/(?:admin/all-entries|${id})`,
  "/settlement/(?:admin-overview|admin-teacher-detail)",
  "/homepage/settings", "/x-setup/status",
  `/archive(?:/members)?(?:/${id}(?:/diaries|/links)?)?`,
  `/admin/archives(?:/${id}(?:/diaries)?)?`,
  "/admin/makeups/(?:pending|eligible-classes)",
  "/attendance", `/notices(?:/${id}/read-stats)?`, "/parent-requests",
  `/parent-requests/${id}/messages`, "/photos/teacher-all",
];
const saves: [string, string][] = [
  ["POST", "/students"], ["POST", "/admin/members/bulk/(?:validate|commit)"],
  ["POST", `/admin/students/${id}/restore`],
  ["POST", "/class-groups"], ["PATCH", `/class-groups/${id}`],
  ["PATCH", `/admin/makeups/${id}/status-override`],
  ["POST", "/diary-template-levels(?:/reorder)?"],
  ["PATCH", `/diary-template-levels/${id}`],
  ["POST", "/diary-templates(?:/reorder)?"], ["PATCH", `/diary-templates/${id}`],
  ["PUT", `/diaries/${id}`],
  ["POST", "/attendance"], ["PATCH", "/homepage/settings"],
];
export function isOfficeApiRequest(raw: string, method: string): boolean {
  if (!raw.startsWith("/") || raw.startsWith("//") || /[\\#\u0000-\u001f]/.test(raw) ||
    /%2e|%2f|(?:^|\/)\.{1,2}(?:\/|$)/i.test(raw.split("?")[0])) return false;
  try {
    const u = new URL(raw, "https://office.invalid");
    if (u.origin !== "https://office.invalid" || u.search.length > 1800 || /%2f|%5c|%2e/i.test(u.pathname)) return false;
    if ([...u.searchParams.keys()].some(k => ![
      "pool_all", "status", "class_id", "class_group_id", "student_id", "teacher_id",
      "date", "from", "to", "start_date", "end_date", "month", "year", "limit", "offset", "page",
      "search", "level_order", "level_id", "category", "stroke", "skill", "q", "include_archived",
      "domain", "include_inactive", "scope",
    ].includes(k))) return false;
    if (method === "OPTIONS")
      return reads.some(p => new RegExp(`^${p}$`).test(u.pathname)) ||
        !u.search && saves.some(([, p]) => new RegExp(`^${p}$`).test(u.pathname));
    if (method === "GET")
      return reads.some(p => new RegExp(`^${p}$`).test(u.pathname));
    return !u.search && saves.some(([m, p]) => m === method && new RegExp(`^${p}$`).test(u.pathname));
  } catch { return false; }
}

/** Presigned image URLs only; never attach an API Authorization header to these hosts. */
export function isAllowedOfficeImage(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && !u.username && !u.password && !u.hash &&
      (u.hostname === "swimnote-api.onrender.com" ||
        /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.r2\.cloudflarestorage\.com$/.test(u.hostname) ||
        /^[a-z0-9-]+\.r2\.dev$/.test(u.hostname));
  } catch { return false; }
}
