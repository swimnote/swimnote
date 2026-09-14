import { Switch, Route, Redirect, useLocation } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { queryClient } from "@/lib/query-client";
import { DashboardLayout } from "@/layouts/DashboardLayout";
import LoginPage from "@/pages/LoginPage";
import HomePage from "@/pages/HomePage";
import XGatePage from "@/pages/XGatePage";
import PlaceholderPage from "@/pages/PlaceholderPage";
import MembersPage from "@/pages/members/MembersPage";
import NewMemberPage from "@/pages/members/NewMemberPage";
import WithdrawnMembersPage from "@/pages/members/WithdrawnMembersPage";
import SchedulePage from "@/pages/schedule/SchedulePage";
import ClassesPage from "@/pages/schedule/ClassesPage";
import MakeupsPage from "@/pages/makeups/MakeupsPage";

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
        <Route path="/admin/members/bulk">
          <PlaceholderPage title="대량 등록 (PHASE 2-F)" />
        </Route>

        {/* Schedule */}
        <Route path="/admin/schedule" component={SchedulePage} />
        <Route path="/admin/schedule/classes" component={ClassesPage} />

        {/* Makeups */}
        <Route path="/admin/makeups" component={MakeupsPage} />
        <Route path="/admin/makeups/assign" component={MakeupsPage} />

        {/* Growth Reports */}
        <Route path="/admin/growth-reports/pending">
          <PlaceholderPage title="검수 대기" />
        </Route>
        <Route path="/admin/growth-reports/publish">
          <PlaceholderPage title="발행 관리" />
        </Route>
        <Route path="/admin/growth-reports/published">
          <PlaceholderPage title="발행 완료" />
        </Route>

        {/* Curriculum */}
        <Route path="/admin/curriculum">
          <PlaceholderPage title="커리큘럼 관리" />
        </Route>
        <Route path="/admin/curriculum/new">
          <PlaceholderPage title="커리큘럼 등록" />
        </Route>
        <Route path="/admin/curriculum/levels">
          <PlaceholderPage title="레벨 / 교육과정" />
        </Route>
        <Route path="/admin/curriculum/templates">
          <PlaceholderPage title="일지 템플릿" />
        </Route>

        {/* Diary */}
        <Route path="/admin/diary">
          <PlaceholderPage title="일지 · 피드" />
        </Route>

        {/* Teachers */}
        <Route path="/admin/teachers">
          <PlaceholderPage title="선생님" />
        </Route>

        {/* Revenue */}
        <Route path="/admin/revenue">
          <PlaceholderPage title="매출 · 정산" />
        </Route>

        {/* Settings */}
        <Route path="/admin/settings">
          <PlaceholderPage title="설정" />
        </Route>

        {/* Fallback */}
        <Route>
          <Redirect to="/admin" />
        </Route>
      </Switch>
    </DashboardLayout>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </QueryClientProvider>
  );
}
