/**
 * Client API unico: un solo punto per base URL, token, 401/429 e parsing errori.
 * Basato su fetch (gestisce nativamente anche le risposte binarie es. Arrow IPC).
 */
const BASE = '/api';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

export function getToken(): string | null {
  return localStorage.getItem('token');
}

function resolveUrl(path: string): string {
  if (path.startsWith('/api')) return path;
  return `${BASE}${path.startsWith('/') ? path : '/' + path}`;
}

function onUnauthorized(path: string) {
  // Un login fallito NON deve forzare reload/redirect: lo gestisce il chiamante
  // (altrimenti la pagina si ricarica e l'utente deve riscrivere le credenziali).
  if (path.includes('/auth/login')) return;
  localStorage.removeItem('token');
  if (window.location.pathname !== '/login') {
    window.location.href = '/login';
  }
}

/** Esegue una fetch verso l'API iniettando il token e gestendo il 401. Ritorna la Response. */
export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers || {});
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(resolveUrl(path), { ...options, headers });
  if (res.status === 401) onUnauthorized(path);
  return res;
}

/** Come apiFetch ma ritorna JSON (lancia ApiError su risposta non ok). */
export async function apiJson<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await apiFetch(path, options);
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body?.detail || detail;
    } catch {
      /* corpo non JSON */
    }
    throw new ApiError(res.status, detail);
  }
  if (res.status === 204) return undefined as unknown as T;
  return res.json() as Promise<T>;
}

const jsonBody = (body: unknown) => (body !== undefined ? JSON.stringify(body) : undefined);

export const apiGet = <T = any>(path: string) => apiJson<T>(path);
export const apiPost = <T = any>(path: string, body?: unknown) =>
  apiJson<T>(path, { method: 'POST', body: jsonBody(body) });
export const apiPut = <T = any>(path: string, body?: unknown) =>
  apiJson<T>(path, { method: 'PUT', body: jsonBody(body) });
export const apiDelete = <T = any>(path: string) => apiJson<T>(path, { method: 'DELETE' });
