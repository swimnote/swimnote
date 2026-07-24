import { Route, Switch } from "wouter";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import KnowledgeFactory from "./pages/KnowledgeFactory";
import Documents from "./pages/Documents";
import KnowledgeDB from "./pages/KnowledgeDB";
import AIQuestionTest from "./pages/AIQuestionTest";
import SystemLogs from "./pages/SystemLogs";
import Settings from "./pages/Settings";

// Misconception Hunter pages
import Overview from "./pages/misconception/Overview";
import ClaimInbox from "./pages/misconception/ClaimInbox";
import ClaimDetail from "./pages/misconception/ClaimDetail";
import VerificationWorkbench from "./pages/misconception/VerificationWorkbench";
import SourceIntelligence from "./pages/misconception/SourceIntelligence";
import DTALab from "./pages/misconception/DTALab";
import HunterAutomation from "./pages/misconception/HunterAutomation";
import DiagnosticMapping from "./pages/misconception/DiagnosticMapping";
import VideoAnalysisBridge from "./pages/misconception/VideoAnalysisBridge";
import ApprovedDecisions from "./pages/misconception/ApprovedDecisions";
import SystemBlueprint from "./pages/misconception/SystemBlueprint";

export default function App() {
  return (
    <Layout>
      <Switch>
        <Route path="/ai-admin" component={Dashboard} />
        <Route path="/ai-admin/dashboard" component={Dashboard} />
        <Route path="/ai-admin/knowledge-factory" component={KnowledgeFactory} />
        <Route path="/ai-admin/documents" component={Documents} />
        <Route path="/ai-admin/knowledge-db" component={KnowledgeDB} />
        <Route path="/ai-admin/ai-question-test" component={AIQuestionTest} />
        {/* Misconception Hunter */}
        <Route path="/ai-admin/misconception" component={Overview} />
        <Route path="/ai-admin/misconception/overview" component={Overview} />
        <Route path="/ai-admin/misconception/claim-inbox" component={ClaimInbox} />
        <Route path="/ai-admin/misconception/claim-inbox/:id" component={ClaimDetail} />
        <Route path="/ai-admin/misconception/verification-workbench" component={VerificationWorkbench} />
        <Route path="/ai-admin/misconception/source-intelligence" component={SourceIntelligence} />
        <Route path="/ai-admin/misconception/dta-lab" component={DTALab} />
        <Route path="/ai-admin/misconception/hunter-automation" component={HunterAutomation} />
        <Route path="/ai-admin/misconception/diagnostic-mapping" component={DiagnosticMapping} />
        <Route path="/ai-admin/misconception/video-analysis-bridge" component={VideoAnalysisBridge} />
        <Route path="/ai-admin/misconception/approved-decisions" component={ApprovedDecisions} />
        <Route path="/ai-admin/misconception/system-blueprint" component={SystemBlueprint} />
        {/* System */}
        <Route path="/ai-admin/system-logs" component={SystemLogs} />
        <Route path="/ai-admin/settings" component={Settings} />
        {/* Default */}
        <Route component={Dashboard} />
      </Switch>
    </Layout>
  );
}
