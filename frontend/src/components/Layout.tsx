import { useState, useEffect } from 'react';
import { Outlet, NavLink } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { useThemeStore } from '../stores/themeStore';
import {
  LayoutDashboard,
  FileText,
  Database,
  LogOut,
  Menu,
  X,
  Users,
  Sun,
  Moon,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';

/**
 * Shell INFOBI Pulse: rail laterale comprimibile + nav con controllo ruoli.
 * - superuser: Dashboard, Report, Sorgenti, Team
 * - admin: Dashboard, Report, Team
 * - user: solo Dashboard
 */
const navItems = [
  { path: '/dashboards', label: 'Dashboard', icon: LayoutDashboard, roles: ['superuser', 'admin', 'user'] },
  { path: '/reports', label: 'Report', icon: FileText, roles: ['superuser', 'admin'] },
  { path: '/connections', label: 'Sorgenti', icon: Database, roles: ['superuser'] },
  { path: '/users', label: 'Team', icon: Users, roles: ['superuser', 'admin'] },
];

const COLLAPSE_KEY = 'infobi_pulse_collapsed';

function Logo({ showText }: { showText: boolean }) {
  return (
    <div className="flex items-center gap-3 min-h-[40px]">
      <div
        className="w-9 h-9 flex-none rounded-xl flex items-center justify-center shadow-lg"
        style={{ background: 'linear-gradient(140deg,#7B6CF5,#4FE3C1)', boxShadow: '0 8px 20px -8px rgba(123,108,245,.7)' }}
      >
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3.2" /><path d="M12 3v2.5M12 18.5V21M4.5 12H7M17 12h2.5" />
        </svg>
      </div>
      {showText && (
        <div className="font-disp font-extrabold tracking-tight whitespace-nowrap leading-none">
          INFOBI <span style={{ background: 'linear-gradient(90deg,#A99BFF,#4FE3C1)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>Pulse</span>
        </div>
      )}
    </div>
  );
}

export default function Layout() {
  const { user, logout } = useAuthStore();
  const { theme, toggle: toggleTheme } = useThemeStore();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      const c = localStorage.getItem(COLLAPSE_KEY);
      if (c !== null) setCollapsed(c === '1');
    } catch { /* ignore */ }
  }, []);

  const toggleCollapse = () => {
    setCollapsed(prev => {
      const next = !prev;
      try { localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  };

  const userRole = user?.role || 'user';
  const filteredNav = navItems.filter(item => item.roles.includes(userRole));
  const railW = collapsed ? 72 : 236;

  return (
    <div className="h-screen flex bg-ground text-ink">
      {/* Backdrop mobile */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/60 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Rail */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-50 flex flex-col bg-surface border-r border-line
          transform transition-all duration-200 overflow-hidden
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}
        style={{ width: railW, minWidth: railW }}
      >
        <div className={`px-3.5 pt-4 pb-5 flex ${collapsed ? 'flex-col items-center gap-3' : 'items-center justify-between'}`}>
          <Logo showText={!collapsed} />
          {/* Toggle navigazione accanto al nome (desktop) */}
          <button
            onClick={toggleCollapse}
            title={collapsed ? 'Espandi menu' : 'Comprimi menu'}
            className="hidden lg:flex w-8 h-8 flex-none items-center justify-center rounded-lg text-muted hover:bg-ground hover:text-ink transition-colors"
          >
            {collapsed ? <ChevronRight className="w-[18px] h-[18px]" /> : <ChevronLeft className="w-[18px] h-[18px]" />}
          </button>
          {/* Chiudi (mobile) */}
          <button className="lg:hidden p-1 hover:bg-ground rounded text-muted" onClick={() => setSidebarOpen(false)} title="Chiudi">
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex flex-col gap-1 px-2.5">
          {filteredNav.map(item => (
            <NavLink
              key={item.path}
              to={item.path}
              onClick={() => setSidebarOpen(false)}
              title={item.label}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl py-2.5 text-sm font-medium transition-colors
                 ${collapsed ? 'px-0 justify-center' : 'px-3'}
                 ${isActive ? 'bg-accent-soft text-accent-strong font-semibold' : 'text-muted hover:bg-ground hover:text-ink'}`
              }
            >
              <item.icon className="w-[18px] h-[18px] flex-none" />
              {!collapsed && <span className="flex-1 whitespace-nowrap">{item.label}</span>}
            </NavLink>
          ))}
        </nav>

        {/* Bottom */}
        <div className="mt-auto flex flex-col gap-3 px-2.5 pb-4">
          {/* Tema (solo icona) */}
          <div className={`flex ${collapsed ? 'justify-center' : ''}`}>
            <button
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Tema chiaro' : 'Tema scuro'}
              className="w-9 h-9 flex-none flex items-center justify-center rounded-lg text-muted hover:bg-ground hover:text-ink transition-colors"
            >
              {theme === 'dark' ? <Sun className="w-[18px] h-[18px]" /> : <Moon className="w-[18px] h-[18px]" />}
            </button>
          </div>

          <div className={`flex items-center gap-2.5 pt-3 border-t border-line ${collapsed ? 'justify-center' : ''}`}>
            <div
              className="w-[34px] h-[34px] flex-none rounded-full flex items-center justify-center text-white font-bold text-sm"
              style={{ background: 'linear-gradient(140deg,#7B6CF5,#F571B0)' }}
            >
              {user?.username?.charAt(0).toUpperCase()}
            </div>
            {!collapsed && (
              <>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">{user?.username}</div>
                  <div className="text-[11px] text-muted capitalize truncate">{user?.role}</div>
                </div>
                <button onClick={logout} title="Esci" className="w-[30px] h-[30px] flex-none flex items-center justify-center rounded-lg text-muted hover:bg-ground hover:text-ink transition-colors">
                  <LogOut className="w-4 h-4" />
                </button>
              </>
            )}
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 bg-surface border-b border-line flex items-center px-4 gap-3 lg:hidden">
          <button className="p-2 hover:bg-ground rounded-lg text-ink" onClick={() => setSidebarOpen(true)} title="Menu">
            <Menu className="w-5 h-5" />
          </button>
          <Logo showText={true} />
        </header>

        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
