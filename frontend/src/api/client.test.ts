import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { api, tokenStorage } from './client';

/** Build the rejection a real axios adapter produces for a 401. */
function reject401(config: InternalAxiosRequestConfig): Promise<never> {
  const response = {
    data: { message: 'Unauthorized' },
    status: 401,
    statusText: 'Unauthorized',
    headers: {},
    config,
  };
  return Promise.reject(
    new AxiosError('Request failed with status code 401', 'ERR_BAD_REQUEST', config, null, response),
  );
}

function ok(config: InternalAxiosRequestConfig, data: unknown) {
  return Promise.resolve({
    data,
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
  });
}

describe('api client 401 auto-refresh', () => {
  const originalAdapter = api.defaults.adapter;

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    api.defaults.adapter = originalAdapter;
    vi.restoreAllMocks();
  });

  it('refreshes once for concurrent 401s and retries with the new token', async () => {
    tokenStorage.set('stale-access', 'refresh-1');

    // Bare axios.post is what refreshTokens() uses under the hood.
    const refreshSpy = vi
      .spyOn(axios, 'post')
      .mockResolvedValue({
        data: { accessToken: 'fresh-access', refreshToken: 'refresh-2' },
      });

    api.defaults.adapter = (config) =>
      config.headers?.Authorization === 'Bearer fresh-access'
        ? ok(config, { url: config.url })
        : reject401(config);

    const [r1, r2] = await Promise.all([api.get('/projects'), api.get('/activity')]);

    // Both calls succeeded after retry, but the refresh endpoint was hit once:
    // the second 401 must wait on the in-flight refresh, not start its own.
    expect(r1.data).toEqual({ url: '/projects' });
    expect(r2.data).toEqual({ url: '/activity' });
    expect(refreshSpy).toHaveBeenCalledTimes(1);
    expect(tokenStorage.getAccess()).toBe('fresh-access');
    expect(tokenStorage.getRefresh()).toBe('refresh-2');
  });

  it('does not try to refresh when login itself returns 401', async () => {
    const refreshSpy = vi.spyOn(axios, 'post');
    api.defaults.adapter = (config) => reject401(config);

    await expect(api.post('/auth/login', {})).rejects.toBeInstanceOf(AxiosError);
    expect(refreshSpy).not.toHaveBeenCalled();
  });

  it('clears stored tokens when the refresh attempt fails', async () => {
    tokenStorage.set('stale-access', 'dead-refresh');
    vi.spyOn(axios, 'post').mockRejectedValue(new Error('refresh failed'));
    api.defaults.adapter = (config) => reject401(config);

    await expect(api.get('/projects')).rejects.toThrow();
    expect(tokenStorage.getAccess()).toBeNull();
    expect(tokenStorage.getRefresh()).toBeNull();
  });
});
