import { useState } from 'react';
import { Outlet, NavLink } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { 
  LayoutDashboard, 
  FileText, 
  Database, 
  LogOut,
  Menu,
  X,
  Users
} from 'lucide-react';

/**
 * Menu di navigazione con controllo accessi per ruolo:
 * - superuser: Vede tutto (Connessioni, Report, Dashboard, Utenti)
 * - admin: Vede Report (sola lettura), Dashboard, Utenti
 * - user: Vede solo Dashboard (assegnate)
 */
const navItems = [
  { path: '/connections', label: 'Connessioni', icon: Database, roles: ['superuser'] },
  { path: '/reports', label: 'Report', icon: FileText, roles: ['superuser', 'admin'] },
  { path: '/dashboards', label: 'Dashboard', icon: LayoutDashboard, roles: ['superuser', 'admin', 'user'] },
  { path: '/users', label: 'Utenti', icon: Users, roles: ['superuser', 'admin'] },
];

export default function Layout() {
  const { user, logout } = useAuthStore();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  
  const userRole = user?.role || 'user';
  const filteredNav = navItems.filter(item => item.roles.includes(userRole));
  
  const toggleSidebar = () => {
    setSidebarOpen(!sidebarOpen);
  };
  
  const closeSidebar = () => {
    setSidebarOpen(false);
  };
  
  return (
    <div className="h-screen flex bg-gray-50">
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={closeSidebar}
        />
      )}
      
      {/* Sidebar */}
      <aside className={`
        fixed lg:static inset-y-0 left-0 z-50
        w-64 bg-slate-900 text-white
        transform transition-transform duration-200
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        {/* Logo */}
        <div className="h-16 flex items-center justify-between px-4 border-b border-slate-700">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-blue-500 flex items-center justify-center font-bold">
              I
            </div>
            <span className="font-semibold text-lg">INFOBI</span>
            <span className="text-xs text-slate-400">4.0</span>
          </div>
          <button 
            className="lg:hidden p-1 hover:bg-slate-800 rounded"
            onClick={closeSidebar}
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        
        {/* Navigation */}
        <nav className="p-4 space-y-1">
          {filteredNav.map(item => (
            <NavLink
              key={item.path}
              to={item.path}
              onClick={closeSidebar}
              className={({ isActive }) => `
                flex items-center gap-3 px-3 py-2.5 rounded-lg transition
                ${isActive 
                  ? 'bg-blue-500/20 text-blue-400' 
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }
              `}
            >
              <item.icon className="w-5 h-5" />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        
        {/* User section */}
        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-slate-700">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-full bg-slate-700 flex items-center justify-center text-sm font-medium">
              {user?.username?.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user?.username}</p>
              <p className="text-xs text-slate-400 capitalize">{user?.role}</p>
            </div>
          </div>
          <button
            onClick={logout}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 rounded-lg transition"
          >
            <LogOut className="w-4 h-4" />
            <span>Esci</span>
          </button>
        </div>
      </aside>
      
      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="h-14 bg-white border-b flex items-center px-4 gap-4 lg:hidden">
          <button
            className="p-2 hover:bg-gray-100 rounded-lg"
            onClick={toggleSidebar}
          >
            <Menu className="w-5 h-5" />
          </button>
          <span className="font-semibold text-slate-800">INFOBI</span>
        </header>
        
        {/* Page content */}
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
