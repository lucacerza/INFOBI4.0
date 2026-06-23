/**
 * Tema chiaro/scuro: toggle + persistenza in localStorage.
 * La classe `dark` viene applicata su <html> (Tailwind darkMode:'class').
 */
import { create } from 'zustand';

export type Theme = 'light' | 'dark';
const STORAGE_KEY = 'infobi-theme';

function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

function readStoredTheme(): Theme {
  if (typeof localStorage !== 'undefined') {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  }
  // Default: Pulse è dark-first
  return 'dark';
}

interface ThemeState {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: 'light',
  setTheme: (t) => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, t);
    applyTheme(t);
    set({ theme: t });
  },
  toggle: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),
}));

/** Inizializza il tema all'avvio (preferenza salvata o di sistema). */
export function initTheme(): void {
  useThemeStore.getState().setTheme(readStoredTheme());
}
