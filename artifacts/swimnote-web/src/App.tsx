import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import Intro from "@/pages/Intro";
import Education from "@/pages/Education";
import AppPage from "@/pages/AppPage";
import Support from "@/pages/Support";
import Login from "@/pages/Login";
import SuperAdmin from "@/pages/SuperAdmin";
import PoolPage from "@/pages/PoolPage";
import PoolAdmin from "@/pages/PoolAdmin";
import PoolHomepage from "@/pages/PoolHomepage";
import DeleteAccount from "@/pages/DeleteAccount";
import NotFound from "@/pages/not-found";

import AdminGuard from "@/components/admin/AdminGuard";
import AdminLayout from "@/components/admin/AdminLayout";

import Dashboard from "@/pages/admin/Dashboard";
import Classes from "@/pages/admin/Classes";
import Attendance from "@/pages/admin/Attendance";
import Diary from "@/pages/admin/Diary";
import Notices from "@/pages/admin/Notices";
import Makeups from "@/pages/admin/Makeups";
import Holidays from "@/pages/admin/Holidays";
import Members from "@/pages/admin/Members";
import Teachers from "@/pages/admin/Teachers";
import Approvals from "@/pages/admin/Approvals";
import Revenue from "@/pages/admin/Revenue";
import Settlement from "@/pages/admin/Settlement";
import PeoplePending from "@/pages/admin/PeoplePending";
import Parents from "@/pages/admin/Parents";
import Withdrawn from "@/pages/admin/Withdrawn";
import PoolSettings from "@/pages/admin/settings/PoolSettings";
import LevelSettings from "@/pages/admin/settings/LevelSettings";
import DiaryTemplates from "@/pages/admin/settings/DiaryTemplates";
import ClassCapacity from "@/pages/admin/settings/ClassCapacity";
import UnitPricing from "@/pages/admin/settings/UnitPricing";
import Permissions from "@/pages/admin/settings/Permissions";
import Branding from "@/pages/admin/settings/Branding";

const queryClient = new QueryClient();

function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-white flex flex-col">
      <Nav />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}

function AdminPage({ children }: { children: React.ReactNode }) {
  return (
    <AdminGuard>
      <AdminLayout>{children}</AdminLayout>
    </AdminGuard>
  );
}

function Router() {
  return (
    <Switch>
      {/* 공개 홈페이지 */}
      <Route path="/">
        <PublicLayout><Intro /></PublicLayout>
      </Route>
      <Route path="/education">
        <PublicLayout><Education /></PublicLayout>
      </Route>
      <Route path="/app">
        <PublicLayout><AppPage /></PublicLayout>
      </Route>
      <Route path="/support">
        <PublicLayout><Support /></PublicLayout>
      </Route>
      <Route path="/delete-account">
        <PublicLayout><DeleteAccount /></PublicLayout>
      </Route>

      {/* 인증 */}
      <Route path="/login" component={Login} />

      {/* 슈퍼관리자 */}
      <Route path="/super-admin" component={SuperAdmin} />

      {/* ─── 웹 관리자 대시보드 ─── */}
      <Route path="/admin">
        <AdminPage><Dashboard /></AdminPage>
      </Route>
      <Route path="/admin/classes">
        <AdminPage><Classes /></AdminPage>
      </Route>
      <Route path="/admin/attendance">
        <AdminPage><Attendance /></AdminPage>
      </Route>
      <Route path="/admin/diary">
        <AdminPage><Diary /></AdminPage>
      </Route>
      <Route path="/admin/notices">
        <AdminPage><Notices /></AdminPage>
      </Route>
      <Route path="/admin/makeups">
        <AdminPage><Makeups /></AdminPage>
      </Route>
      <Route path="/admin/holidays">
        <AdminPage><Holidays /></AdminPage>
      </Route>
      <Route path="/admin/members">
        <AdminPage><Members /></AdminPage>
      </Route>
      <Route path="/admin/teachers">
        <AdminPage><Teachers /></AdminPage>
      </Route>
      <Route path="/admin/approvals">
        <AdminPage><Approvals /></AdminPage>
      </Route>
      <Route path="/admin/revenue">
        <AdminPage><Revenue /></AdminPage>
      </Route>
      <Route path="/admin/settlement">
        <AdminPage><Settlement /></AdminPage>
      </Route>
      <Route path="/admin/people-pending">
        <AdminPage><PeoplePending /></AdminPage>
      </Route>
      <Route path="/admin/parents">
        <AdminPage><Parents /></AdminPage>
      </Route>
      <Route path="/admin/withdrawn">
        <AdminPage><Withdrawn /></AdminPage>
      </Route>
      <Route path="/admin/settings/pool">
        <AdminPage><PoolSettings /></AdminPage>
      </Route>
      <Route path="/admin/settings/levels">
        <AdminPage><LevelSettings /></AdminPage>
      </Route>
      <Route path="/admin/settings/diary-templates">
        <AdminPage><DiaryTemplates /></AdminPage>
      </Route>
      <Route path="/admin/settings/capacity">
        <AdminPage><ClassCapacity /></AdminPage>
      </Route>
      <Route path="/admin/settings/pricing">
        <AdminPage><UnitPricing /></AdminPage>
      </Route>
      <Route path="/admin/settings/permissions">
        <AdminPage><Permissions /></AdminPage>
      </Route>
      <Route path="/admin/settings/branding">
        <AdminPage><Branding /></AdminPage>
      </Route>

      {/* 수영장 관리자 (레거시) */}
      <Route path="/pool/:id/admin" component={PoolAdmin} />

      {/* 수영장 공개 페이지 */}
      <Route path="/pool/:id" component={PoolPage} />

      {/* 수영장 개별 홈페이지 (슬러그) */}
      <Route path="/:slug" component={PoolHomepage} />

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
