export type DiffRow = { type: 'same' | 'add' | 'del'; text: string };

/**
 * Line-level diff (LCS) between two texts, returned as a unified sequence:
 * `del` = line present only in `oldText`, `add` = line present only in
 * `newText`, `same` = unchanged context. Used by the doc version history to
 * highlight what a save added (green) / removed (red).
 *
 * Guarded against pathological inputs: the O(n·m) table is skipped for very
 * large pages (everything renders as unchanged context rather than freezing).
 */
const MAX_CELLS = 4_000_000; // ~2000×2000 lines

export function diffLines(oldText: string, newText: string): DiffRow[] {
  const a = oldText.replace(/\s+$/, '').split('\n');
  const b = newText.replace(/\s+$/, '').split('\n');
  const n = a.length;
  const m = b.length;

  if ((n + 1) * (m + 1) > MAX_CELLS) {
    return b.map((text) => ({ type: 'same', text }));
  }

  // LCS length table (flat Int32Array, filled bottom-up).
  const w = m + 1;
  const dp = new Int32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] =
        a[i] === b[j]
          ? dp[(i + 1) * w + (j + 1)] + 1
          : Math.max(dp[(i + 1) * w + j], dp[i * w + (j + 1)]);
    }
  }

  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rows.push({ type: 'same', text: a[i] });
      i++;
      j++;
    } else if (dp[(i + 1) * w + j] >= dp[i * w + (j + 1)]) {
      rows.push({ type: 'del', text: a[i] });
      i++;
    } else {
      rows.push({ type: 'add', text: b[j] });
      j++;
    }
  }
  while (i < n) rows.push({ type: 'del', text: a[i++] });
  while (j < m) rows.push({ type: 'add', text: b[j++] });
  return rows;
}
