/**
 * @-mention helpers. Comments are stored as plain text with human-readable
 * "@Name" tokens; the ids of mentioned users travel separately in the create
 * request, so notification fan-out never depends on parsing names back out of
 * free text. These helpers power the composer autocomplete, the id extraction
 * on submit, and the cosmetic highlight when rendering.
 */

export interface MentionUser {
  id: string;
  name: string;
}

export interface MentionSegment {
  text: string;
  /** Set when this segment is a recognised "@Name" mention. */
  userId?: string;
}

/**
 * Split text into plain / mention segments by literal "@Name" matches for the
 * known users. Longer names claim their span first so "@Egor Kiselman" never
 * double-counts as a mention of a user named "Egor"; a word-boundary check
 * keeps "@Egor" from firing inside "@Egorka".
 */
export function mentionSegments(text: string, users: MentionUser[]): MentionSegment[] {
  const spans: Array<{ start: number; end: number; userId: string }> = [];
  const byLength = [...users].sort((a, b) => b.name.length - a.name.length);
  for (const u of byLength) {
    if (!u.name) continue;
    const token = `@${u.name}`;
    let from = 0;
    for (;;) {
      const start = text.indexOf(token, from);
      if (start === -1) break;
      const end = start + token.length;
      from = end;
      const next = text[end];
      if (next !== undefined && /[\p{L}\p{N}_]/u.test(next)) continue;
      if (spans.some((s) => start < s.end && end > s.start)) continue;
      spans.push({ start, end, userId: u.id });
    }
  }
  if (!spans.length) return [{ text }];
  spans.sort((a, b) => a.start - b.start);

  const out: MentionSegment[] = [];
  let pos = 0;
  for (const s of spans) {
    if (s.start > pos) out.push({ text: text.slice(pos, s.start) });
    out.push({ text: text.slice(s.start, s.end), userId: s.userId });
    pos = s.end;
  }
  if (pos < text.length) out.push({ text: text.slice(pos) });
  return out;
}

/** Distinct ids of users whose "@Name" appears in the text. */
export function mentionedIds(text: string, users: MentionUser[]): string[] {
  return [
    ...new Set(
      mentionSegments(text, users).flatMap((s) => (s.userId ? [s.userId] : [])),
    ),
  ];
}

/**
 * The "@query" token the caret currently sits in, or null. An "@" only opens
 * a mention when it starts the text or follows whitespace/brackets, so email
 * addresses don't trigger the autocomplete. The query may contain spaces
 * (names do) but never line breaks.
 */
export function mentionQueryAt(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  const upto = text.slice(0, caret);
  const at = upto.lastIndexOf('@');
  if (at === -1) return null;
  const prev = upto[at - 1];
  if (prev !== undefined && !/[\s([{]/.test(prev)) return null;
  const query = upto.slice(at + 1);
  if (query.length > 40 || /[\n@]/.test(query)) return null;
  return { start: at, query };
}
