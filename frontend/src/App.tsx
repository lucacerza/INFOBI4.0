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

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore();
  
  if (user?.role !== 'admin') {
    return <Navigate to="/reports" replace />;
  }
  
  return <>{children}</>;
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
          <Route index element={<Navigate to="/reports" replace />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="reports/:id" element={<ReportViewerPage />} />
          <Route path="reports/:id/pivot" element={<ReportPivotPage />} />
          <Route path="reports/:id/edit" element={<ReportEditorPage />} />
          <Route path="reports/new" element={<ReportEditorPage />} />
          <Route path="connections" element={<ConnectionsPage />} />
          <Route path="dashboards" element={<DashboardsPage />} />
          <Route path="dashboards/:id" element={<DashboardViewerPage />} />
          <Route path="users" element={<AdminRoute><UsersPage /></AdminRoute>} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
