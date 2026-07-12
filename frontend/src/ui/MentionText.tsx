import { useMemo } from 'react';
import { mentionSegments, type MentionUser } from '../lib/mentions';

/** Plain text with recognised "@Name" tokens highlighted as mention chips. */
export function MentionText({ text, users }: { text: string; users: MentionUser[] }) {
  const segments = useMemo(() => mentionSegments(text, users), [text, users]);
  return (
    <>
      {segments.map((s, i) =>
        s.userId ? (
          <span
            key={i}
            className="rounded bg-blurple-soft px-0.5 font-medium text-[#A8B0F8]"
          >
            {s.text}
          </span>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}
