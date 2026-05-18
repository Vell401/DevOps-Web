import axios, { AxiosError, AxiosRequestConfig } from 'axios';

const baseURL = import.meta.env.VITE_API_URL ?? '/api';

export const api = axios.create({ baseURL });

const ACCESS_KEY = 'tracker.accessToken';
const REFRESH_KEY = 'tracker.refreshToken';

export const tokenStorage = {
  getAccess: () => localStorage.getItem(ACCESS_KEY),
  getRefresh: () => localStorage.getItem(REFRESH_KEY),
  set: (access: string, refresh: string) => {
    localStorage.setItem(ACCESS_KEY, access);
    localStorage.setItem(REFRESH_KEY, refresh);
  },
  clear: () => {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

api.interceptors.request.use((config) => {
  const token = tokenStorage.getAccess();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let refreshPromise: Promise<string> | null = null;

async function refreshTokens(): Promise<string> {
  const refreshToken = tokenStorage.getRefresh();
  if (!refreshToken) throw new Error('No refresh token');
  const res = await axios.post(`${baseURL}/auth/refresh`, { refreshToken });
  tokenStorage.set(res.data.accessToken, res.data.refreshToken);
  return res.data.accessToken;
}

api.interceptors.response.use(
  (r) => r,
  async (error: AxiosError) => {
    const original = error.config as AxiosRequestConfig & { _retry?: boolean };
    // Refresh only when an *authenticated* call returned 401 — never on the refresh
    // endpoint itself (would loop) and not on login/register (those failures mean
    // bad credentials, not stale tokens).
    const url = original.url ?? '';
    const isAuthBootstrap =
      url.endsWith('/auth/login') ||
      url.endsWith('/auth/register') ||
      url.endsWith('/auth/refresh') ||
      url.endsWith('/auth/logout');

    if (error.response?.status === 401 && !original._retry && !isAuthBootstrap) {
      original._retry = true;
      try {
        refreshPromise ??= refreshTokens().finally(() => {
          refreshPromise = null;
        });
        const newAccess = await refreshPromise;
        original.headers = { ...original.headers, Authorization: `Bearer ${newAccess}` };
        return api(original);
      } catch (e) {
        tokenStorage.clear();
        throw e;
      }
    }
    throw error;
  },
);
