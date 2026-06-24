import { BlockNoteEditor, type PartialBlock } from '@blocknote/core';

/**
 * Markdown import/export for doc pages.
 *
 * Conversion runs entirely in the browser via BlockNote's own
 * `tryParseMarkdownToBlocks` / `blocksToMarkdownLossy`. For pages that are not
 * open in the live editor (import of a new page, export from the tree) we use a
 * single detached, never-mounted editor: its conversion methods take explicit
 * blocks and don't mutate its own document, so one shared instance is safe and
 * avoids re-instantiating per call.
 */
let scratch: BlockNoteEditor | null = null;
function scratchEditor(): BlockNoteEditor {
  if (!scratch) scratch = BlockNoteEditor.create();
  return scratch;
}

/** Parse a Markdown string into BlockNote blocks (stored as `DocPage.content`). */
export async function markdownToBlocks(markdown: string): Promise<unknown[]> {
  return scratchEditor().tryParseMarkdownToBlocks(markdown);
}

/** Serialise BlockNote blocks to (lossy) Markdown. */
export async function blocksToMarkdown(blocks: unknown[]): Promise<string> {
  return scratchEditor().blocksToMarkdownLossy(blocks as PartialBlock[]);
}

/** Trigger a client-side download of `markdown` as a `.md` file. */
export function downloadMarkdown(stem: string, markdown: string): void {
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${stem}.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Safe, readable file stem derived from a page title. */
export function toFileStem(title: string): string {
  const t = (title || 'untitled').trim();
  return t.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').slice(0, 80) || 'untitled';
}

/** Title for an imported page: first `# H1` if present, else the file name. */
export function titleFromMarkdown(markdown: string, filename: string): string {
  const h1 = markdown.match(/^\s*#\s+(.+?)\s*$/m);
  if (h1) return h1[1].trim().slice(0, 200);
  return filename.replace(/\.(md|markdown|txt)$/i, '').trim().slice(0, 200) || 'Imported page';
}
