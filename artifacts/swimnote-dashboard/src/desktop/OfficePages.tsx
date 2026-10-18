import { Route } from "wouter";
import NewMemberPage from "../pages/members/NewMemberPage";
import BulkMembersPage from "../pages/members/BulkMembersPage";
import WithdrawnMembersPage from "../pages/members/WithdrawnMembersPage";
import ArchiveMembersPage from "../pages/members/ArchiveMembersPage";
import SchedulePage from "../pages/schedule/SchedulePage";
import ClassesPage from "../pages/schedule/ClassesPage";
import MakeupsPage from "../pages/makeups/MakeupsPage";
import CurriculumPage from "../pages/curriculum/CurriculumPage";
import CurriculumNewPage from "../pages/curriculum/CurriculumNewPage";
import LevelsPage from "../pages/curriculum/LevelsPage";
import TemplatesPage from "../pages/curriculum/TemplatesPage";
import PendingPage from "../pages/growth-reports/PendingPage";
import PublishPage from "../pages/growth-reports/PublishPage";
import PublishedPage from "../pages/growth-reports/PublishedPage";
import DiaryPage from "../pages/diary/DiaryPage";
import TeachersPage from "../pages/teachers/TeachersPage";
import RevenuePage from "../pages/revenue/RevenuePage";
import SettingsPage from "../pages/settings/SettingsPage";
import { OfficeAppPage, OfficeTeacherHome, OfficeCurriculumReview, OfficeTeacherDiaryFeed, OfficeDiaryComposer } from "./OfficeAppPages";
import { officePageAllowed } from "../../desktop/office-access.cts";
import { OfficeOperationsPanel } from "./OfficeOperationsPanel";
import { OfficeFinancePanel } from "./OfficeFinancePanel";
import { OfficeTeacherGrowthReports } from "./OfficeTeacherGrowthReports";

const webPages = [
  ["/admin/members/new", NewMemberPage], ["/admin/members/bulk", BulkMembersPage],
  ["/admin/members/withdrawn", WithdrawnMembersPage],
  ["/admin/members/archive", () => <ArchiveMembersPage userRole="pool_admin" />],
  ["/admin/schedule", SchedulePage], ["/admin/schedule/classes", ClassesPage],
  ["/admin/makeups", MakeupsPage],
  ["/admin/curriculum", CurriculumPage], ["/admin/curriculum/new", CurriculumNewPage],
  ["/admin/curriculum/levels", LevelsPage], ["/admin/curriculum/templates", TemplatesPage],
  ["/admin/growth-reports/pending", PendingPage], ["/admin/growth-reports/publish", PublishPage],
  ["/admin/growth-reports/published", PublishedPage], ["/admin/diary", DiaryPage],
  ["/admin/teachers", TeachersPage], ["/admin/revenue", RevenuePage], ["/admin/settings", SettingsPage],
] as const;
const appPages = [
  ["attendance", "attendance"], ["album", "album"], ["communication", "communication"],
  ["notices", "notices"], ["staff", "staff"], ["guardians", "guardians"], ["desktop-settings", "desktop-settings"],
  ["makeups/assign", "makeup-assignment"],
] as const;
export const officePageRoutes = (role: "pool_admin" | "teacher" = "pool_admin", navigate?: (path: string) => void) => [
  <Route key="diary-new" path="/admin/diary/new"><OfficeDiaryComposer onSaved={() => navigate?.("/admin/diary")} /></Route>,
  ...(role === "pool_admin" ? [<Route key="curriculum-review" path="/admin/curriculum/review"><OfficeCurriculumReview /></Route>] : []),
  ...(role === "teacher" ? [
    <Route key="teacher-diary" path="/admin/diary"><OfficeTeacherDiaryFeed /></Route>,
    ...["pending", "published"].map(kind => <Route key={`teacher-growth-${kind}`} path={`/admin/growth-reports/${kind}`}><OfficeTeacherGrowthReports publishedOnly={kind === "published"} /></Route>),
    <Route key="teacher-schedule" path="/admin/schedule"><OfficeTeacherHome onNavigate={navigate ? kind => navigate(kind === "makeup-assignment" ? "/admin/makeups/assign" : `/admin/${kind}`) : undefined} /></Route>,
    <Route key="teacher-makeups" path="/admin/makeups"><OfficeAppPage kind="makeup-assignment" role={role} /></Route>,
  ] : []),
  ...webPages.filter(([path]) => officePageAllowed(path, role)).map(([path, Component]) => <Route key={path} path={path}>
    <div role="note" style={{ padding: "8px 24px", borderBottom: "1px solid #d1d5db", fontSize: 12 }}>
      기존 Web 화면·API 재사용 · 현재 역할의 서버 권한 유지 · 발송·초대·금액 확정·권한 변경·삭제는 실제 처리 전 확인을 받습니다.
    </div>
    <Component />
  </Route>),
  ...appPages.filter(([path]) => officePageAllowed(`/admin/${path}`, role)).map(([path, kind]) => <Route key={path} path={`/admin/${path}`}><OfficeAppPage kind={kind} role={role} /></Route>),
  ...(role === "pool_admin" ? ["contacts", "courses", "sessions", "imports", "marketing", "cards", "applications", "support", "policies"].map(r => <Route key={`ops-${r}`} path={`/admin/office/${r}`}><OfficeOperationsPanel view={r as never} /></Route>) : []),
  ...(role === "pool_admin" ? [<Route key="ops-finance" path="/admin/office/finance"><OfficeFinancePanel /></Route>] : []),
  ...(role === "pool_admin" ? ["legacy", "tuition"] : []).map(path => <Route key={path} path={`/admin/${path}`}>
    <section style={{ padding: 24 }}><h1>{path === "legacy" ? "상담·체험·등록전환" : "재등록·청구·수납"}</h1>
      <p>V1 후속 완성 범위입니다. 현재 원장·저장·AI 실행은 연결되지 않았습니다.</p>
      <p>기존 회원·수강 기록을 공유해 연결하며, 앱 구독 결제를 수강료 장부로 대체하지 않습니다.</p>
    </section></Route>),
];
