import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { AuthPage } from "./pages/AuthPage";
import { DashboardPage } from "./pages/DashboardPage";
import { AnalyzerPage } from "./pages/AnalyzerPage";
import { ModelPerformancePage } from "./pages/ModelPerformancePage";
import { SystemPage } from "./pages/SystemPage";
import { WebsitesPage } from "./pages/WebsitesPage";
import { SectionPage } from "./pages/SectionPage";
import { sections } from "./sections";
import { SessionProvider } from "./context/SessionContext";
import { AuthProvider } from "./context/AuthContext";
import { AuthGuard } from "./components/AuthGuard";
import {
  AlertsPage,
  BatchPage,
  EndpointRiskPage,
  ExplainabilityPage,
  FeedbackPage,
  HistoryPage,
  IncidentsPage,
  LiveMonitoringPage,
  ReportsPage,
  TrafficPage,
} from "./pages/SessionPages";

function renderSection(path: string, section: (typeof sections)[number]) {
  switch (path) {
    case "/analyzer": return <AnalyzerPage />;
    case "/system": return <SystemPage />;
    case "/websites": return <WebsitesPage />;
    case "/model-performance": return <ModelPerformancePage />;
    case "/history": return <HistoryPage />;
    case "/alerts": return <AlertsPage />;
    case "/traffic": return <TrafficPage />;
    case "/endpoint-risk": return <EndpointRiskPage />;
    case "/incidents": return <IncidentsPage />;
    case "/feedback": return <FeedbackPage />;
    case "/reports": return <ReportsPage />;
    case "/explainable-ai": return <ExplainabilityPage />;
    case "/live-monitoring": return <LiveMonitoringPage />;
    case "/batch": return <BatchPage />;
    default: return <SectionPage section={section} />;
  }
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="/register" element={<AuthPage mode="register" />} />
        <Route path="/forgot-password" element={<AuthPage mode="forgot" />} />
        <Route path="/reset-password" element={<AuthPage mode="reset" />} />
        <Route element={<AuthGuard />}>
          <Route element={<SessionProvider><AppShell /></SessionProvider>}>
            <Route index element={<DashboardPage />} />
            {sections.slice(1).map((section) => (
              <Route
                key={section.path}
                path={section.path}
                element={renderSection(section.path, section)}
              />
            ))}
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
