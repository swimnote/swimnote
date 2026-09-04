import { lazy, Suspense } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import AdminGuard from "@/components/admin/AdminGuard";
import AdminLayout from "@/components/admin/AdminLayout";
import SuperGuard from "@/components/super/SuperGuard";
import SuperLayout from "@/components/super/SuperLayout";

// ── 공개 페이지 (Public) ─────────────────────────────────────────────────────
const Intro        = lazy(() => import("@/pages/Intro"));
const Education    = lazy(() => import("@/pages/Education"));
const AppPage      = lazy(() => import("@/pages/AppPage"));
const Support      = lazy(() => import("@/pages/Support"));
const Login        = lazy(() => import("@/pages/Login"));
const DeleteAccount = lazy(() => import("@/pages/DeleteAccount"));
const PoolPage     = lazy(() => import("@/pages/PoolPage"));
const PoolHomepage = lazy(() => import("@/pages/PoolHomepage"));
const NotFound     = lazy(() => import("@/pages/not-found"));

// ── 레거시 ──────────────────────────────────────────────────────────────────
const SuperAdmin   = lazy(() => import("@/pages/SuperAdmin"));
const PoolAdmin    = lazy(() => import("@/pages/PoolAdmin"));

// ── 웹 관리자 (Admin) ────────────────────────────────────────────────────────
const Dashboard      = lazy(() => import("@/pages/admin/Dashboard"));
const Classes        = lazy(() => import("@/pages/admin/Classes"));
const Attendance     = lazy(() => import("@/pages/admin/Attendance"));
const Diary          = lazy(() => import("@/pages/admin/Diary"));
const Notices        = lazy(() => import("@/pages/admin/Notices"));
const Makeups        = lazy(() => import("@/pages/admin/Makeups"));
const Holidays       = lazy(() => import("@/pages/admin/Holidays"));
const Members        = lazy(() => import("@/pages/admin/Members"));
const Teachers       = lazy(() => import("@/pages/admin/Teachers"));
const Approvals      = lazy(() => import("@/pages/admin/Approvals"));
const Revenue        = lazy(() => import("@/pages/admin/Revenue"));
const Settlement     = lazy(() => import("@/pages/admin/Settlement"));
const PeoplePending  = lazy(() => import("@/pages/admin/PeoplePending"));
const Parents        = lazy(() => import("@/pages/admin/Parents"));
const Withdrawn      = lazy(() => import("@/pages/admin/Withdrawn"));
const PoolSettings   = lazy(() => import("@/pages/admin/settings/PoolSettings"));
const LevelSettings  = lazy(() => import("@/pages/admin/settings/LevelSettings"));
const DiaryTemplates = lazy(() => import("@/pages/admin/settings/DiaryTemplates"));
const ClassCapacity  = lazy(() => import("@/pages/admin/settings/ClassCapacity"));
const UnitPricing    = lazy(() => import("@/pages/admin/settings/UnitPricing"));
const Permissions    = lazy(() => import("@/pages/admin/settings/Permissions"));
const Branding       = lazy(() => import("@/pages/admin/settings/Branding"));

// ── Super Admin ──────────────────────────────────────────────────────────────
const SuperOverview           = lazy(() => import("@/pages/super/SuperOverview"));
const SuperPools              = lazy(() => import("@/pages/super/SuperPools"));
const SuperPoolControlCenter  = lazy(() => import("@/pages/super/SuperPoolControlCenter"));
const SuperBilling            = lazy(() => import("@/pages/super/SuperBilling"));
const SuperXMode              = lazy(() => import("@/pages/super/SuperXMode"));
const SuperAI                 = lazy(() => import("@/pages/super/SuperAI"));
const SuperSupport            = lazy(() => import("@/pages/super/SuperSupport"));
const SuperServers            = lazy(() => import("@/pages/super/SuperServers"));
const SuperIncidents          = lazy(() => import("@/pages/super/SuperIncidents"));
const SuperPartner            = lazy(() => import("@/pages/super/SuperPartner"));
const SuperAudit              = lazy(() => import("@/pages/super/SuperAudit"));
const SuperSettings           = lazy(() => import("@/pages/super/SuperSettings"));
const SuperKnowledgeReview    = lazy(() => import("@/pages/super/SuperKnowledgeReview"));
const SuperKnowledgeCandidates = lazy(() => import("@/pages/super/SuperKnowledgeCandidates"));

// ── QueryClient ──────────────────────────────────────────────────────────────
const queryClient = new QueryClient();

// ── 페이지 전환 fallback ──────────────────────────────────────────────────────
function PageFallback() {
  return (
    <div className="min-h-[40vh] flex items-center justify-center">
      <div className="w-6 h-6 rounded-full border-2 border-gray-200 border-t-blue-500 animate-spin" />
    </div>
  );
}

// ── 레이아웃 래퍼 ─────────────────────────────────────────────────────────────
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

/** Super Admin 페이지 공통 wrapper — SuperGuard + SuperLayout */
function SuperPage({ children }: { children: React.ReactNode }) {
  return (
    <SuperGuard>
      <SuperLayout>{children}</SuperLayout>
    </SuperGuard>
  );
}

function Router() {
  return (
    <Suspense fallback={<PageFallback />}>
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

        {/* ─── Super Admin (구 레거시 → redirect) ─── */}
        <Route path="/super-admin" component={SuperAdmin} />

        {/* ─── Super Admin 새 URL-based 구조 ─── */}
        {/* 주의: /super/pools/:poolId 가 /super/pools 보다 먼저 와야 함 */}
        <Route path="/super/pools/:poolId">
          <SuperPage><SuperPoolControlCenter /></SuperPage>
        </Route>
        <Route path="/super/pools">
          <SuperPage><SuperPools /></SuperPage>
        </Route>
        <Route path="/super/billing">
          <SuperPage><SuperBilling /></SuperPage>
        </Route>
        <Route path="/super/x-mode">
          <SuperPage><SuperXMode /></SuperPage>
        </Route>
        <Route path="/super/ai">
          <SuperPage><SuperAI /></SuperPage>
        </Route>
        <Route path="/super/support">
          <SuperPage><SuperSupport /></SuperPage>
        </Route>
        <Route path="/super/knowledge-review">
          <SuperPage><SuperKnowledgeReview /></SuperPage>
        </Route>
        <Route path="/super/knowledge-candidates">
          <SuperPage><SuperKnowledgeCandidates /></SuperPage>
        </Route>
        <Route path="/super/servers">
          <SuperPage><SuperServers /></SuperPage>
        </Route>
        <Route path="/super/incidents">
          <SuperPage><SuperIncidents /></SuperPage>
        </Route>
        <Route path="/super/partner">
          <SuperPage><SuperPartner /></SuperPage>
        </Route>
        <Route path="/super/audit">
          <SuperPage><SuperAudit /></SuperPage>
        </Route>
        <Route path="/super/settings">
          <SuperPage><SuperSettings /></SuperPage>
        </Route>
        <Route path="/super/overview">
          <SuperPage><SuperOverview /></SuperPage>
        </Route>
        {/* /super → /super/overview */}
        <Route path="/super">
          <SuperPage><SuperOverview /></SuperPage>
        </Route>

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
    </Suspense>
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
