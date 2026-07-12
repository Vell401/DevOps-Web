import { api } from '../api/client';

/**
 * Avatars are served by the authenticated API, so a plain <img src> cannot
 * load them (no Authorization header). We fetch the bytes once per
 * (user, avatarKey) pair and hand out a shared object URL. The avatarKey
 * changes on every upload, which makes it a natural cache-buster; entries are
 * kept for the lifetime of the tab (a handful of small images at most).
 */
const cache = new Map<string, Promise<string>>();

export function fetchAvatarUrl(userId: string, avatarKey: string): Promise<string> {
  const cacheKey = `${userId}:${avatarKey}`;
  let hit = cache.get(cacheKey);
  if (!hit) {
    hit = api
      .get<Blob>(`/users/${userId}/avatar`, { responseType: 'blob' })
      .then((r) => URL.createObjectURL(r.data))
      .catch((err) => {
        cache.delete(cacheKey); // allow a retry on the next render
        throw err;
      });
    cache.set(cacheKey, hit);
  }
  return hit;
}
