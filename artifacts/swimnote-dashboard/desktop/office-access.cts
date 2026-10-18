/** Explicit, shared OFFICE surface. No arbitrary URL/API; consequential existing operations require runtime confirmation. */
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
  ["/admin/diary/new", "일지 작성", "교육"],
  ["/admin/album", "앨범", "교육"],
  ["/admin/curriculum", "커리큘럼", "교육"],
  ["/admin/curriculum/new", "커리큘럼 등록", "교육"],
  ["/admin/curriculum/review", "커리큘럼 접수·검토 상태", "교육"],
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
  ["/admin/office/contacts", "상담·체험·등록전환", "운영"],
  ["/admin/office/courses", "상품·계약·수강", "운영"],
  ["/admin/office/sessions", "수업 세션", "운영"],
  ["/admin/office/imports", "엑셀 가져오기", "운영"],
  ["/admin/office/marketing", "마케팅 수동 관리", "운영"],
  ["/admin/office/cards", "출입 카드", "운영"],
  ["/admin/office/applications", "태블릿 가입 신청", "운영"],
  ["/admin/office/finance", "재등록·청구·수납 원장", "운영"],
  ["/admin/office/support", "시설·물품·대회·업체·본사", "운영"],
  ["/admin/office/transport", "무료 배차 준비·검수", "운영"],
  ["/admin/office/policies", "센터 운영 기준", "운영"],
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
const OPS = "(?:contacts|products|contracts|sessions|enrollments|marketing|cards|imports|templates|support|policies)";
const reads = [
  "/transport/admin", "/transport/planning", "/transport/planning/ai-capability", "/transport/operations", "/transport/reconciliation", "/transport/notifications", `/transport/runs/${id}/document`, "/transport/students", "/transport/candidates",
  `/transport/requests/${id}`, `/transport/runs/${id}/review`, `/transport/admin/runs/${id}`,
  "/office/operations/finance/snapshot", "/office/operations/applications", "/office/operations/activity-report",
  "/office/operations/workspace/catalog",
  `/office/operations/applications/${id}/document`,
  "/office/operations/capabilities", `/office/operations/${OPS}`, `/office/operations/imports/${id}/results`,
  `/office/operations/receipts/${id}`, `/office/operations/${OPS}/${id}/history`,
  "/students", `/students/${id}(?:/parents|/attendance)?`, "/class-groups", "/teachers",
  `/admin/(?:students/${id}/detail|class-groups/${id}/detail|withdrawn-members|members/export|makeups)`,
  `/admin/teacher-invites(?:/${id}/detail)?`,
  `/admin/growth-reports/(?:monthly-list|${id}|students/${id})`,
  "/diary-template-levels", "/diary-templates",
  "/curriculum/diary/(?:levels|facets|nodes)",
  "/diaries", `/diaries/(?:admin/all-entries|${id})`,
  "/settlement/(?:admin-overview|admin-teacher-detail)",
  "/homepage/settings", "/x-setup/status",
  `/archive(?:/members)?(?:/${id}(?:/diaries|/links)?)?`,
  `/admin/archives(?:/${id}(?:/diaries)?)?`,
  "/admin/makeups/(?:pending|eligible-classes)",
  "/admin/archive-link-candidates",
  `/admin/parent-v2-pending(?:/${id}/approval-info)?`,
  `/teacher/growth-reports(?:/${id}/review)?`,
  "/attendance", `/notices(?:/${id}/read-stats)?`, "/parent-requests",
  "/office/operations/transport", `/office/operations/transport/snapshots/${id}`, `/office/operations/transport/plans/${id}/preview`,
  `/parent-requests/${id}/messages`, "/photos/teacher-all", `/photos/private/${id}`,
  `/videos/(?:group|private|diary)/${id}`,
];
const saves: [string, string][] = [
  ["POST","/transport/memberships/invite"], ["POST",`/transport/memberships/${id}/revoke`],
  ["POST","/transport/runs/save"], ["POST","/transport/planning/(?:settings|calculate|interpret|ai-propose)"], ["POST","/transport/operations"], ["POST","/transport/onboarding/invites"], ["POST",`/transport/reconciliation/${id}/resolve`], ["POST",`/transport/runs/${id}/certify`], ["POST",`/transport/runs/${id}/(?:approve|publish|recalculate)`],
  ["POST",`/transport/preferences/${id}`], ["POST",`/transport/vehicles/${id}/availability`],
  ["POST","/office/operations/transport/records"],
  ["PATCH",`/office/operations/transport/records/${id}`],
  ["POST",`/office/operations/transport/plans/${id}/approve`],
  ["POST", "/office/operations/finance/(?:preview|execute)"],
  ["POST", "/office/operations/finance/batch/(?:preview|execute)"],
  ["POST", "/office/operations/workspace/interpret"],
  ["POST", "/office/operations/nfc/(?:resolve|scan)"],
  ["POST", "/office/operations/applications/invite"],
  ["POST", `/office/operations/applications/${id}/confirm`],
  ["POST", `/office/operations/imports/${id}/finance-(?:preview|apply)`],
  ["POST", `/office/operations/${OPS}`], ["PATCH", `/office/operations/${OPS}/${id}`],
  ["POST", `/office/operations/imports/${id}/(?:prepare|apply|interpret)`],
  ["PUT", `/admin/growth-reports/${id}/discard`], ["POST", `/admin/growth-reports/${id}/mark-reviewed`],
  ["POST", "/videos/(?:group|private|diary-attach|note-attach)"],
  ["DELETE", "/videos/video_[A-Za-z0-9_-]{1,154}"],
  ["POST", "/students"], ["POST", "/admin/members/bulk/(?:validate|commit)"],
  ["POST", `/admin/students/${id}/restore`],
  ["POST", "/class-groups"], ["PATCH", `/class-groups/${id}`],
  ["PATCH", `/admin/makeups/${id}/status-override`],
  ["POST", "/diary-template-levels(?:/reorder)?"],
  ["PATCH", `/diary-template-levels/${id}`],
  ["POST", "/diary-templates(?:/reorder)?"], ["PATCH", `/diary-templates/${id}`],
  ["PUT", `/diaries/${id}`],
  ["POST", "/attendance"], ["PATCH", "/homepage/settings"],
  ["PATCH", `/admin/students/${id}/info`], ["PATCH", `/students/${id}/assign`],
  ["POST", `/admin/students/${id}/withdraw`], ["POST", `/students/${id}/change-status`],
  ["POST", `/students/${id}/move-class`], ["POST", `/students/${id}/remove-from-class`],
  ["POST", `/teacher/growth-reports/${id}/review`],
  ["PATCH", `/admin/growth-reports/${id}/discard`],
  ["POST", `/admin/growth-reports/(?:${id}/send|bulk-send)`],
  ["POST", "/admin/teacher-invites"], ["PATCH", `/admin/teacher-invites/${id}`],
  ["POST", `/admin/teacher-invites/${id}/transfer`],
  ["POST", "/admin/archive-links"], ["DELETE", `/admin/archive-links/${id}`],
  ["POST", "/x-setup/upload/curriculum"], ["POST", "/settlement/finalize"],
  ["DELETE", `/class-groups/${id}`], ["DELETE", `/diaries/${id}`],
  ["DELETE", `/diary-templates/${id}`], ["DELETE", `/diary-template-levels/${id}`],
  ["PATCH", `/teacher/makeups/${id}/(?:assign|complete-direct|revert|complete)`],
  ["POST", `/teacher/makeups/${id}/extinguish`],
  ["PATCH", `/admin/makeups/${id}/status-override`],
  ["POST", `/parent-requests/${id}/messages`], ["PATCH", `/parent-requests/${id}`],
  ["POST", "/notices"], ["PATCH", `/notices/${id}`], ["DELETE", `/notices/${id}`],
  ["POST", "/photos/(?:group|private)"], ["DELETE", `/photos/${id}`],
  ["PATCH", `/students/${id}`], ["PATCH", `/teachers/${id}`], ["DELETE", `/teachers/${id}`],
  ["POST", "/diaries"], ["POST", "/teachers"], ["POST", "/v1/teacher-diary/generate"],
  ["POST", `/admin/parent-v2-pending/${id}/confirm`], ["PATCH", `/admin/parent-v2-pending/${id}`],
  ["POST", "/photos/diary-attach"], ["POST", "/photos/note-attach"],
  ["PUT", `/diaries/student-notes/${id}`],
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
      "domain", "include_inactive", "scope", "product_status",
      "vehicleId", "archive_id", "lesson_date", "cursor", "studentId", "history",
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

const teacherPages = new Set([
  "/admin/guardians", "/admin/schedule", "/admin/attendance", "/admin/makeups", "/admin/makeups/assign",
  "/admin/diary", "/admin/diary/new", "/admin/album", "/admin/curriculum", "/admin/curriculum/templates",
  "/admin/growth-reports/pending", "/admin/growth-reports/published", "/admin/communication",
  "/admin/notices", "/admin/desktop-settings",
]);
export function officePageAllowed(path: string, role: string) {
  const page = officePage(path);
  return !!page && (role === "pool_admin" || role === "teacher" && teacherPages.has(page[0]));
}
export function officeRoleRequest(path: string, method: string, role: string) {
  if (!isOfficeApiRequest(path, method)) return false;
  if (role === "pool_admin") return true;
  if (role !== "teacher") return false;
  if(path.startsWith("/office/operations/")||path.startsWith("/admin/growth-reports/")) return false;
  return method === "GET" || new RegExp(`^/(?:attendance|teacher/|diaries(?:/|$)|photos(?:/|$)|videos(?:/|$)|parent-requests(?:/|$)|v1/teacher-diary/generate$|students/${id}/(?:change-status|move-class|remove-from-class))`).test(path);
}
export function officeConfirmation(path: string, method: string, body?: string | FormData): string | null {
  let action = "";
  if (typeof body === "string") { try { action = JSON.parse(body)?.action ?? ""; } catch { /* Server validates JSON. */ } }
  if (method === "DELETE") return "삭제하면 기존 앱과 동일하게 운영 데이터에 반영됩니다. 대상과 영향을 확인하고 삭제하시겠습니까?";
  if (path === "/v1/teacher-diary/generate") return "기존 앱과 동일한 유료 AI 초안을 생성합니다. 이용량·비용이 발생할 수 있습니다. 현재 초안 변경과 실제 호출을 승인하시겠습니까?";
  if (path === "/teachers") return "실제 선생님 로그인 계정을 생성합니다. 계정·소속·자기 강사 여부를 확인하고 생성하시겠습니까?";
  if (path === "/x-setup/upload/curriculum") return "DOCX 파일을 실제 업로드하고 기존 서버의 접수·구조화·검토 처리를 요청합니다. 파일과 대상 수영장을 확인하고 진행하시겠습니까?";
  if (/\/send$|bulk-send|teacher-invites|parent-requests.*messages|\/notices|parent-v2-pending/.test(path))
    return "기존 앱과 같은 발송·초대 또는 권한 처리를 요청합니다. 대상과 내용을 확인했으며 실제 처리를 승인하시겠습니까?";
  if (/^\/office\/operations\/imports\/[^/]+\/apply$/.test(path)) return "준비된 행을 실제 회원 등록에 반영합니다. 미리보기 건수와 보류 행을 확인했으며 적용하시겠습니까?";
  if (path === "/settlement/finalize") return "이 정산 확정은 실제 운영 금액에 반영됩니다. 월·대상·금액을 확인했으며 확정하시겠습니까?";
  if (action === "REQUEST_REANALYSIS") return "기존 재분석 요청을 실행합니다. 유료 AI 처리로 이어질 수 있습니다. 대상·사유를 확인하고 요청하시겠습니까?";
  if (path.includes("archive-links")) return "퇴원 기록과 재원생의 연결 관계를 변경합니다. 비교 정보·전화 일치 여부·대상을 확인했으며 처리하시겠습니까?";
  return null;
}
