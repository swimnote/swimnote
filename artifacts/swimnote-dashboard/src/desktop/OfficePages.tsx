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
import { OfficeAppPage } from "./OfficeAppPages";

const webPages = [
  ["/admin/members/new", NewMemberPage], ["/admin/members/bulk", BulkMembersPage],
  ["/admin/members/withdrawn", WithdrawnMembersPage],
  ["/admin/members/archive", () => <ArchiveMembersPage userRole="pool_admin" readOnly />],
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
export const officePageRoutes = () => [
  ...webPages.map(([path, Component]) => <Route key={path} path={path}>
    <div role="note" style={{ padding: "8px 24px", borderBottom: "1px solid #d1d5db", fontSize: 12 }}>
      기존 Web 화면·API 재사용 · 발송/초대·유료 AI 생성·금융 확정·권한 변경·삭제는 별도 승인 또는 추가 연결 대기입니다.
      {path === "/admin/curriculum/new" && " 파일 업로드·구조화 처리는 아직 PC에 연결되지 않았습니다."}
      {path === "/admin/members/archive" && " 퇴원 기록 조회 연결 · 재원생 연결/해제는 추가 연결 대기입니다."}
    </div>
    <Component />
  </Route>),
  ...appPages.map(([path, kind]) => <Route key={path} path={`/admin/${path}`}><OfficeAppPage kind={kind} /></Route>),
  ...["legacy", "tuition"].map(path => <Route key={path} path={`/admin/${path}`}>
    <section style={{ padding: 24 }}><h1>{path === "legacy" ? "상담·체험·등록전환" : "재등록·청구·수납"}</h1>
      <p>V1 후속 완성 범위입니다. 현재 원장·저장·AI 실행은 연결되지 않았습니다.</p>
      <p>기존 회원·수강 기록을 공유해 연결하며, 앱 구독 결제를 수강료 장부로 대체하지 않습니다.</p>
    </section></Route>),
];
