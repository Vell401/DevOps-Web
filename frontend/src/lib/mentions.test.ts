import { describe, expect, it } from 'vitest';
import { mentionQueryAt, mentionSegments, mentionedIds } from './mentions';

const users = [
  { id: 'u-egor', name: 'Egor' },
  { id: 'u-egor-k', name: 'Egor Kiselman' },
  { id: 'u-anna', name: 'Anna' },
];

describe('mentionSegments / mentionedIds', () => {
  it('finds a simple mention and keeps surrounding text intact', () => {
    const segs = mentionSegments('hi @Anna, look', users);
    expect(segs).toEqual([
      { text: 'hi ' },
      { text: '@Anna', userId: 'u-anna' },
      { text: ', look' },
    ]);
  });

  it('prefers the longest matching name over its prefix', () => {
    // "@Egor Kiselman" must NOT additionally count as a mention of "Egor".
    expect(mentionedIds('ping @Egor Kiselman please', users)).toEqual(['u-egor-k']);
  });

  it('still matches the short name on its own', () => {
    expect(mentionedIds('ping @Egor please', users)).toEqual(['u-egor']);
  });

  it('does not match inside a longer word', () => {
    expect(mentionedIds('@Egorka is not a user', users)).toEqual([]);
  });

  it('dedupes repeated mentions of the same user', () => {
    expect(mentionedIds('@Anna and again @Anna', users)).toEqual(['u-anna']);
  });

  it('returns the whole text as one segment when nothing matches', () => {
    expect(mentionSegments('no mentions here', users)).toEqual([
      { text: 'no mentions here' },
    ]);
  });
});

describe('mentionQueryAt', () => {
  it('opens on @ at the start and tracks the query up to the caret', () => {
    const text = '@Eg';
    expect(mentionQueryAt(text, text.length)).toEqual({ start: 0, query: 'Eg' });
  });

  it('opens after whitespace and allows spaces inside the query', () => {
    const text = 'cc @Egor Ki';
    expect(mentionQueryAt(text, text.length)).toEqual({ start: 3, query: 'Egor Ki' });
  });

  it('ignores @ inside an email address', () => {
    const text = 'mail me at egor@tracker.local';
    expect(mentionQueryAt(text, text.length)).toBeNull();
  });

  it('closes once a line break follows the @', () => {
    const text = '@Egor\nnew line';
    expect(mentionQueryAt(text, text.length)).toBeNull();
  });
});
