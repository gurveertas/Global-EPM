import { ActivityPage, MastersPage, RolesPage } from "./pages/Admin";
import { Navigate, Route, Routes } from "react-router-dom";
import { OrgChart } from "./pages/OrgChart";
import { SessionProvider, useSession } from "./lib/session";
import { Layout } from "./components/Layout";
import { Spinner } from "./components/ui";
import { AcceptInvite, Forgot, Login, Reset } from "./pages/Auth";
import { Dashboard } from "./pages/Dashboard";
import { MySheet } from "./pages/Sheet";
import { Approvals } from "./pages/Approvals";
import { Leave } from "./pages/Leave";
import { LeadDetail, Leads } from "./pages/Leads";
import { ClientDetail, Clients } from "./pages/Clients";
import { ProjectDetail, Projects } from "./pages/Projects";
import { NewProject } from "./pages/NewProject";
import { InvoiceDetail, Invoices, NewInvoice, PendingPayments } from "./pages/Invoices";
import { Performance, Rates, Reports } from "./pages/Insights";
import { People } from "./pages/People";
import { EmployeeDetail } from "./pages/EmployeeDetail";
import { Assignments } from "./pages/Assignments";
import { Handover } from "./pages/Handover";
import { NotesPage } from "./pages/Notes";
import { SettingsPage } from "./pages/Settings";
import { Profile, TwoFactorCard } from "./pages/Profile";
import { ConsoleApp } from "./console/Console";
import { AccessoriesPage, CalendarPage, StandupPage } from "./pages/Workspace";
import { Site } from "./site/Site";

/**
 * One React app serves every host:
 *   eszy.com, www.eszy.com, localhost -> marketing site
 *   admin.<domain>                    -> platform console
 *   anything else                     -> that company's panel
 */
const host = window.location.hostname;
const baseDomain = (import.meta.env.VITE_BASE_DOMAIN as string | undefined) ?? "eszy.com";
const isConsole = host.startsWith("admin.");
const isSite = host === "localhost" || host === "127.0.0.1" || host === baseDomain || host === `www.${baseDomain}`;

export function App() {
  if (isConsole) return <ConsoleApp />;
  if (isSite) return <Site />;
  return (
    <SessionProvider>
      <CompanyRoutes />
    </SessionProvider>
  );
}

function CompanyRoutes() {
  const { me, ready } = useSession();
  if (!ready) return <Spinner />;
  if (!me) {
    return (
      <Routes>
        <Route path="/forgot" element={<Forgot />} />
        <Route path="/reset" element={<Reset />} />
        <Route path="/invite" element={<AcceptInvite />} />
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }
  if ((me.user as any).mustSetUpTwoFactor) {
    return <div className="mx-auto max-w-2xl p-6"><TwoFactorCard forced /></div>;
  }
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="sheet" element={<MySheet />} />
        <Route path="approvals" element={<Approvals />} />
        <Route path="leave" element={<Leave />} />
        <Route path="leads" element={<Leads />} />
        <Route path="leads/:id" element={<LeadDetail />} />
        <Route path="clients" element={<Clients />} />
        <Route path="clients/:id" element={<ClientDetail />} />
        <Route path="projects" element={<Projects />} />
        <Route path="projects/new" element={<NewProject />} />
        <Route path="projects/:id" element={<ProjectDetail />} />
        <Route path="invoices" element={<Invoices />} />
        <Route path="invoices/new" element={<NewInvoice />} />
        <Route path="invoices/:id" element={<InvoiceDetail />} />
        <Route path="payments" element={<PendingPayments />} />
        <Route path="performance" element={<Performance />} />
        <Route path="rates" element={<Rates />} />
        <Route path="reports" element={<Reports />} />
        <Route path="people" element={<People />} />
        <Route path="people/:id" element={<EmployeeDetail />} />
        <Route path="assignments" element={<Assignments />} />
        <Route path="handover" element={<Handover />} />
        <Route path="notes" element={<NotesPage />} />
        <Route path="settings/:tab?" element={<SettingsPage />} />
        <Route path="masters/:list?" element={<MastersPage />} />
        <Route path="roles" element={<RolesPage />} />
        <Route path="activity" element={<ActivityPage />} />
        <Route path="org" element={<OrgChart />} />
        <Route path="profile" element={<Profile />} />
        <Route path="calendar" element={<CalendarPage />} />
        <Route path="standup" element={<StandupPage />} />
        <Route path="accessories" element={<AccessoriesPage />} />
        <Route path="invite" element={<Navigate to="/" />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Route>
    </Routes>
  );
}
