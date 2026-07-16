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
import NotFound from "@/pages/not-found";

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

      {/* 인증 */}
      <Route path="/login" component={Login} />

      {/* 슈퍼관리자 */}
      <Route path="/super-admin" component={SuperAdmin} />

      {/* 수영장 관리자 대시보드 */}
      <Route path="/pool/:id/admin" component={PoolAdmin} />

      {/* 수영장 공개 페이지 */}
      <Route path="/pool/:id" component={PoolPage} />

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
