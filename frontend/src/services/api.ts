/**
 * API tipizzata per dominio. Tutte le chiamate passano dal client unico (apiClient):
 * token, 401/429 e parsing errori sono centralizzati lì.
 */
import { apiFetch, apiGet, apiPost, apiPut, apiDelete } from './apiClient';

// Auth
export const authApi = {
  login: async (username: string, password: string) => {
    const data = await apiPost('/auth/login', { username, password });
    localStorage.setItem('token', data.access_token);
    return data;
  },
  logout: () => {
    localStorage.removeItem('token');
    window.location.href = '/login';
  },
  getMe: () => apiGet('/auth/me'),
};

// Connections
export const connectionsApi = {
  list: () => apiGet('/connections'),
  create: (conn: any) => apiPost('/connections', conn),
  update: (id: number, conn: any) => apiPut(`/connections/${id}`, conn),
  delete: (id: number) => apiDelete(`/connections/${id}`),
  test: (id: number) => apiPost(`/connections/${id}/test`),
};

// Reports
export const reportsApi = {
  list: () => apiGet('/reports'),
  get: (id: number) => apiGet(`/reports/${id}`),
  create: (report: any) => apiPost('/reports', report),
  update: (id: number, report: any) => apiPut(`/reports/${id}`, report),
  delete: (id: number) => apiDelete(`/reports/${id}`),
  saveLayout: (id: number, layout: any) => apiPut(`/reports/${id}/layout`, layout),
  refreshCache: (id: number) => apiPost(`/reports/${id}/refresh-cache`),
  executeGrid: (id: number, request: any) => apiPost(`/reports/${id}/grid`, request),
  executePivotDrill: (id: number, request: any) => apiPost(`/reports/${id}/pivot-drill`, request),
};

// Pivot
export const pivotApi = {
  getSchema: (reportId: number) => apiGet(`/pivot/${reportId}/schema`),
  execute: async (reportId: number, config: any) => {
    const res = await apiFetch(`/pivot/${reportId}`, {
      method: 'POST',
      body: JSON.stringify(config),
    });
    if (!res.ok) throw new Error(`Pivot fallito: ${res.status}`);
    return {
      data: await res.arrayBuffer(),
      queryTime: parseFloat(res.headers.get('x-query-time') || '0'),
      cached: res.headers.get('x-cache-hit') === 'true',
      rowCount: res.headers.get('x-row-count'),
    };
  },
};

// Dashboards
export const dashboardsApi = {
  list: () => apiGet('/dashboards'),
  get: (id: number) => apiGet(`/dashboards/${id}`),
  create: (dashboard: any) => apiPost('/dashboards', dashboard),
  delete: (id: number) => apiDelete(`/dashboards/${id}`),
  addWidget: (dashboardId: number, widget: any) => apiPost(`/dashboards/${dashboardId}/widgets`, widget),
  removeWidget: (dashboardId: number, widgetId: number) =>
    apiDelete(`/dashboards/${dashboardId}/widgets/${widgetId}`),
};

// Export (URL builder — il download avviene via navigazione/anchor)
export const exportApi = {
  xlsx: (reportId: number) => `/api/export/${reportId}/xlsx`,
  csv: (reportId: number) => `/api/export/${reportId}/csv`,
};
