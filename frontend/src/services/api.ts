/**
 * API Service with automatic token handling
 */
import axios, { AxiosError } from 'axios';

const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json'
  }
});

// Add token to requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle 401 errors
api.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// Auth
export const authApi = {
  login: async (username: string, password: string) => {
    const { data } = await api.post('/auth/login', { username, password });
    localStorage.setItem('token', data.access_token);
    return data;
  },
  logout: () => {
    localStorage.removeItem('token');
    window.location.href = '/login';
  },
  getMe: async () => {
    const { data } = await api.get('/auth/me');
    return data;
  }
};

// Connections
export const connectionsApi = {
  list: async () => {
    const { data } = await api.get('/connections');
    return data;
  },
  create: async (conn: any) => {
    const { data } = await api.post('/connections', conn);
    return data;
  },
  update: async (id: number, conn: any) => {
    const { data } = await api.put(`/connections/${id}`, conn);
    return data;
  },
  delete: async (id: number) => {
    await api.delete(`/connections/${id}`);
  },
  test: async (id: number) => {
    const { data } = await api.post(`/connections/${id}/test`);
    return data;
  }
};

// Reports
export const reportsApi = {
  list: async () => {
    const { data } = await api.get('/reports');
    return data;
  },
  get: async (id: number) => {
    const { data } = await api.get(`/reports/${id}`);
    return data;
  },
  create: async (report: any) => {
    const { data } = await api.post('/reports', report);
    return data;
  },
  update: async (id: number, report: any) => {
    const { data } = await api.put(`/reports/${id}`, report);
    return data;
  },
  delete: async (id: number) => {
    await api.delete(`/reports/${id}`);
  },
  saveLayout: async (id: number, layout: any) => {
    const { data } = await api.put(`/reports/${id}/layout`, layout);
    return data;
  },
  refreshCache: async (id: number) => {
    const { data } = await api.post(`/reports/${id}/refresh-cache`);
    return data;
  },
  executeGrid: async (id: number, request: any) => {
    const { data } = await api.post(`/reports/${id}/grid`, request);
    return data;
  },
  executePivotDrill: async (id: number, request: any) => {
    const { data } = await api.post(`/reports/${id}/pivot-drill`, request);
    return data;
  }
};

// Pivot
export const pivotApi = {
  getSchema: async (reportId: number) => {
    const { data } = await api.get(`/pivot/${reportId}/schema`);
    return data;
  },
  execute: async (reportId: number, config: any) => {
    const response = await api.post(`/pivot/${reportId}`, config, {
      responseType: 'arraybuffer'
    });
    return {
      data: response.data,
      queryTime: parseFloat(response.headers['x-query-time'] || '0'),
      cached: response.headers['x-cache-hit'] === 'true',
      rowCount: response.headers['x-row-count']
    };
  }
};

// Dashboards
export const dashboardsApi = {
  list: async () => {
    const { data } = await api.get('/dashboards');
    return data;
  },
  get: async (id: number) => {
    const { data } = await api.get(`/dashboards/${id}`);
    return data;
  },
  create: async (dashboard: any) => {
    const { data } = await api.post('/dashboards', dashboard);
    return data;
  },
  delete: async (id: number) => {
    await api.delete(`/dashboards/${id}`);
  },
  addWidget: async (dashboardId: number, widget: any) => {
    const { data } = await api.post(`/dashboards/${dashboardId}/widgets`, widget);
    return data;
  },
  removeWidget: async (dashboardId: number, widgetId: number) => {
    await api.delete(`/dashboards/${dashboardId}/widgets/${widgetId}`);
  }
};

// Export
export const exportApi = {
  xlsx: (reportId: number) => `/api/export/${reportId}/xlsx`,
  csv: (reportId: number) => `/api/export/${reportId}/csv`
};

export default api;
