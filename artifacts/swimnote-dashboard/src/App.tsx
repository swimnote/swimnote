import { Switch, Route, Redirect, useLocation } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { queryClient } from "@/lib/query-client";
import { RealtimeProvider } from "@/context/RealtimeContext";
import { getToken } from "@/lib/token";
import { DashboardLayout } from "@/layouts/DashboardLayout";
import LoginPage from "@/pages/LoginPage";
import SuperLoginPage from "@/pages/SuperLoginPage";
import HomePage from "@/pages/HomePage";
import XGatePage from "@/pages/XGatePage";
import PlaceholderPage from "@/pages/PlaceholderPage";
import MembersPage from "@/pages/members/MembersPage";
import NewMemberPage from "@/pages/members/NewMemberPage";
import WithdrawnMembersPage from "@/pages/members/WithdrawnMembersPage";
import SchedulePage from "@/pages/schedule/SchedulePage";
import ClassesPage from "@/pages/schedule/ClassesPage";
import MakeupsPage from "@/pages/makeups/MakeupsPage";
import PendingPage from "@/pages/growth-reports/PendingPage";
import PublishPage from "@/pages/growth-reports/PublishPage";
import PublishedPage from "@/pages/growth-reports/PublishedPage";
import CurriculumPage from "@/pages/curriculum/CurriculumPage";
import CurriculumNewPage from "@/pages/curriculum/CurriculumNewPage";
import LevelsPage from "@/pages/curriculum/LevelsPage";
import TemplatesPage from "@/pages/curriculum/TemplatesPage";
import DiaryPage from "@/pages/diary/DiaryPage";
import TeachersPage from "@/pages/teachers/TeachersPage";
import RevenuePage from "@/pages/revenue/RevenuePage";
import BulkMembersPage from "@/pages/members/BulkMembersPage";
import SettingsPage from "@/pages/settings/SettingsPage";

function AppRoutes() {
  const { state } = useAuth();
  const [location] = useLocation();

  // Loading
  if (state.status === "loading") {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "'Pretendard', sans-serif",
          fontSize: "14px",
          color: "#9CA3AF",
        }}
      >
        로딩 중…
      </div>
    );
  }

  // Super admin login route (/admin/super) — always accessible when unauthenticated
  if (location === "/admin/super") {
    if (state.status === "authenticated") return <Redirect to="/admin" />;
    return <SuperLoginPage />;
  }

  // Redirect authenticated users away from login
  if (location === "/admin/login" && state.status === "authenticated") {
    return <Redirect to="/admin" />;
  }

  // Login page — no layout, no auth required
  if (location === "/admin/login" || state.status === "unauthenticated") {
    return <LoginPage />;
  }

  // Authenticated: check X entitlement
  // X gate: pool_admin without active X → show gate (no DashboardLayout)
  if (!state.user.hasX) {
    return <XGatePage />;
  }

  // Full dashboard for X members
  return (
    <DashboardLayout>
      <Switch>
        <Route path="/admin" component={HomePage} />

        {/* Members */}
        <Route path="/admin/members" component={MembersPage} />
        <Route path="/admin/members/new" component={NewMemberPage} />
        <Route path="/admin/members/withdrawn" component={WithdrawnMembersPage} />
        <Route path="/admin/members/bulk" component={BulkMembersPage} />

        {/* Schedule */}
        <Route path="/admin/schedule" component={SchedulePage} />
        <Route path="/admin/schedule/classes" component={ClassesPage} />

        {/* Makeups */}
        <Route path="/admin/makeups" component={MakeupsPage} />
        <Route path="/admin/makeups/assign" component={MakeupsPage} />

        {/* Growth Reports */}
        <Route path="/admin/growth-reports/pending" component={PendingPage} />
        <Route path="/admin/growth-reports/publish" component={PublishPage} />
        <Route path="/admin/growth-reports/published" component={PublishedPage} />

        {/* Curriculum */}
        <Route path="/admin/curriculum" component={CurriculumPage} />
        <Route path="/admin/curriculum/new" component={CurriculumNewPage} />
        <Route path="/admin/curriculum/levels" component={LevelsPage} />
        <Route path="/admin/curriculum/templates" component={TemplatesPage} />

        {/* Diary */}
        <Route path="/admin/diary" component={DiaryPage} />

        {/* Teachers */}
        <Route path="/admin/teachers" component={TeachersPage} />

        {/* Revenue */}
        <Route path="/admin/revenue" component={RevenuePage} />

        {/* Settings */}
        <Route path="/admin/settings" component={SettingsPage} />

        {/* Fallback */}
        <Route>
          <Redirect to="/admin" />
        </Route>
      </Switch>
    </DashboardLayout>
  );
}

function RealtimeWrapper({ children }: { children: React.ReactNode }) {
  // Read token directly from localStorage so RealtimeContext gets updated
  // when auth state changes — avoids threading token through context layers.
  const token = getToken();
  return <RealtimeProvider token={token}>{children}</RealtimeProvider>;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RealtimeWrapper>
          <AppRoutes />
        </RealtimeWrapper>
      </AuthProvider>
    </QueryClientProvider>
  );
}
