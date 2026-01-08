/**
 * Auth Store - Zustand
 */
import { create } from 'zustand';
import { authApi } from '../services/api';

interface User {
  id: number;
  username: string;
  email: string | null;
  role: string;
}

interface AuthState {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  checkAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,
  isAuthenticated: false,
  
  login: async (username: string, password: string) => {
    const data = await authApi.login(username, password);
    set({ user: data.user, isAuthenticated: true });
  },
  
  logout: () => {
    authApi.logout();
    set({ user: null, isAuthenticated: false });
  },
  
  checkAuth: async () => {
    const token = localStorage.getItem('token');
    if (!token) {
      set({ isLoading: false, isAuthenticated: false });
      return;
    }
    
    try {
      const user = await authApi.getMe();
      set({ user, isAuthenticated: true, isLoading: false });
    } catch {
      localStorage.removeItem('token');
      set({ user: null, isAuthenticated: false, isLoading: false });
    }
  }
}));
