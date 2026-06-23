import { api } from '../api/client';

/**
 * Doc images are served by the authenticated API, so a plain <img src> can't
 * load them (no Authorization header). BlockNote's `resolveFileUrl` hands us the
 * stored URL (/api/docs/images/<id>); we fetch the bytes once per id and return
 * a shared object URL. Mirrors lib/avatarCache.
 */
const cache = new Map<string, Promise<string>>();

const ID_IN_URL = /\/docs\/images\/([0-9a-fA-F-]{36})/;

/** Resolve a stored doc-image URL into a displayable object URL. Non-matching
 *  URLs (e.g. an external image pasted by URL) are returned unchanged. */
export function resolveDocImageUrl(stored: string): Promise<string> {
  const m = ID_IN_URL.exec(stored);
  if (!m) return Promise.resolve(stored);
  const id = m[1];
  let hit = cache.get(id);
  if (!hit) {
    hit = api
      .get<Blob>(`/docs/images/${id}`, { responseType: 'blob' })
      .then((r) => URL.createObjectURL(r.data))
      .catch((err) => {
        cache.delete(id); // allow a retry
        throw err;
      });
    cache.set(id, hit);
  }
  return hit;
}
