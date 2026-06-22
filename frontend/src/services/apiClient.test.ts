/**
 * Test del client API unico: iniezione token, risoluzione URL, errori.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { apiGet, apiPost, ApiError } from './apiClient';

beforeEach(() => {
  const store: Record<string, string> = { token: 'abc123' };
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
  });
});

describe('apiClient', () => {
  it('inietta il bearer token e prefissa /api', async () => {
    const calls: any[] = [];
    vi.stubGlobal('fetch', async (url: string, opts: any) => {
      calls.push({ url, opts });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    });

    const data = await apiGet('/reports');
    expect(calls[0].url).toBe('/api/reports');
    expect(calls[0].opts.headers.get('Authorization')).toBe('Bearer abc123');
    expect(data).toEqual({ ok: true });
  });

  it('imposta Content-Type JSON sulle POST con body', async () => {
    const calls: any[] = [];
    vi.stubGlobal('fetch', async (url: string, opts: any) => {
      calls.push({ url, opts });
      return new Response(JSON.stringify({ id: 1 }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    });

    await apiPost('/dashboards', { name: 'X' });
    expect(calls[0].opts.method).toBe('POST');
    expect(calls[0].opts.headers.get('Content-Type')).toBe('application/json');
    expect(calls[0].opts.body).toBe(JSON.stringify({ name: 'X' }));
  });

  it('lancia ApiError con il detail del backend su risposta non ok', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify({ detail: 'Vietato' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(apiGet('/reports')).rejects.toMatchObject({
      name: 'ApiError',
      status: 400,
      message: 'Vietato',
    });
  });
});
