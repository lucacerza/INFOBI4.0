import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import ReportsPage from './pages/ReportsPage';
import ReportViewerPage from './pages/ReportViewerPage';
import ReportPivotPage from './pages/ReportPivotPage';
import ReportEditorPage from './pages/ReportEditorPage';
import ConnectionsPage from './pages/ConnectionsPage';
import DashboardsPage from './pages/DashboardsPage';
import DashboardViewerPage from './pages/DashboardViewerPage';
import UsersPage from './pages/UsersPage';
import { Loader2 } from 'lucide-react';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuthStore();
  
  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }
  
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  
  return <>{children}</>;
}

/**
 * Route protetta per ruoli specifici
 * @param roles - Array di ruoli ammessi (es. ['superuser', 'admin'])
 * @param fallback - Route di fallback se non autorizzato (default: /dashboards)
 */
function RoleRoute({
  children,
  roles,
  fallback = '/dashboards'
}: {
  children: React.ReactNode;
  roles: string[];
  fallback?: string;
}) {
  const { user } = useAuthStore();

  if (!user?.role || !roles.includes(user.role)) {
    return <Navigate to={fallback} replace />;
  }

  return <>{children}</>;
}

// Alias per retrocompatibilità
function SuperuserRoute({ children }: { children: React.ReactNode }) {
  return <RoleRoute roles={['superuser']}>{children}</RoleRoute>;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  return <RoleRoute roles={['superuser', 'admin']}>{children}</RoleRoute>;
}

function App() {
  const { checkAuth, isLoading } = useAuthStore();
  
  useEffect(() => {
    checkAuth();
  }, []);
  
  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-blue-500 mx-auto mb-4" />
          <p className="text-gray-500">Caricamento...</p>
        </div>
      </div>
    );
  }
  
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        
        <Route path="/" element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }>
          {/* Default: redirect to dashboards (accessible by all) */}
          <Route index element={<Navigate to="/dashboards" replace />} />

          {/* SUPERUSER ONLY: Connections */}
          <Route path="connections" element={<SuperuserRoute><ConnectionsPage /></SuperuserRoute>} />

          {/* Reports: lista visibile a superuser e admin, modifica solo superuser */}
          <Route path="reports" element={<AdminRoute><ReportsPage /></AdminRoute>} />
          <Route path="reports/new" element={<SuperuserRoute><ReportEditorPage /></SuperuserRoute>} />
          <Route path="reports/:id/edit" element={<SuperuserRoute><ReportEditorPage /></SuperuserRoute>} />

          {/* Report viewing - accessible if user has access (checked by backend) */}
          <Route path="reports/:id" element={<ReportViewerPage />} />
          <Route path="reports/:id/pivot" element={<ReportPivotPage />} />

          {/* Dashboards - accessible by all roles */}
          <Route path="dashboards" element={<DashboardsPage />} />
          <Route path="dashboards/:id" element={<DashboardViewerPage />} />

          {/* Users management - admin and superuser */}
          <Route path="users" element={<AdminRoute><UsersPage /></AdminRoute>} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
