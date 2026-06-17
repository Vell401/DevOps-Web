import type { EffectiveRole } from '../types';

const RANK: Record<EffectiveRole, number> = {
  VIEWER: 0,
  EDITOR: 1,
  ADMIN: 2,
  OWNER: 3,
};

/** Mirrors the backend role hierarchy: VIEWER < EDITOR < ADMIN < OWNER. */
export function roleAtLeast(
  role: EffectiveRole | null | undefined,
  min: EffectiveRole,
): boolean {
  return !!role && RANK[role] >= RANK[min];
}
