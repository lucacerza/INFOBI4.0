/** Test del theme store (toggle + persistenza). */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useThemeStore, initTheme } from './themeStore';

beforeEach(() => {
  const store: Record<string, string> = {};
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
  });
  useThemeStore.setState({ theme: 'light' });
});

describe('themeStore', () => {
  it('setTheme aggiorna lo stato e persiste', () => {
    useThemeStore.getState().setTheme('dark');
    expect(useThemeStore.getState().theme).toBe('dark');
    expect(localStorage.getItem('infobi-theme')).toBe('dark');
  });

  it('toggle alterna chiaro/scuro', () => {
    useThemeStore.getState().setTheme('light');
    useThemeStore.getState().toggle();
    expect(useThemeStore.getState().theme).toBe('dark');
    useThemeStore.getState().toggle();
    expect(useThemeStore.getState().theme).toBe('light');
  });

  it('initTheme legge la preferenza salvata', () => {
    localStorage.setItem('infobi-theme', 'dark');
    initTheme();
    expect(useThemeStore.getState().theme).toBe('dark');
  });
});
