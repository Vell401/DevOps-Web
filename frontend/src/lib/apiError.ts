/**
 * Pull a human-readable message out of an Axios error so a toast can say *why*
 * an action was blocked (e.g. "Project is closed", "Forbidden") instead of a
 * generic failure. Nest's ValidationPipe returns `message` as a string array;
 * we surface the first entry. Falls back to the supplied default.
 */
export function apiError(err: unknown, fallback: string): string {
  const raw = (err as { response?: { data?: { message?: string | string[] } } })
    ?.response?.data?.message;
  if (Array.isArray(raw)) return raw[0] ?? fallback;
  return typeof raw === 'string' && raw.length > 0 ? raw : fallback;
}
