import { useCallback, useEffect, useRef, useState } from 'react';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import type { PartialBlock } from '@blocknote/core';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';

import { docsApi } from '../../api/endpoints';
import { resolveDocImageUrl } from '../../lib/docImageCache';
import type { DocPage } from '../../types';
import { useToast } from '../../ui/Toast';
import { apiError } from '../../lib/apiError';

interface Props {
  /** Mount one editor per page — give it `key={page.id}` so switching pages
   *  remounts with fresh content (useCreateBlockNote captures initialContent once). */
  page: DocPage;
  canWrite: boolean;
  onTitleSaved?: (title: string) => void;
}

export function DocEditor({ page, canWrite, onTitleSaved }: Props) {
  const toast = useToast();
  const [title, setTitle] = useState(page.title);
  const [saving, setSaving] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);
  const canWriteRef = useRef(canWrite);
  canWriteRef.current = canWrite;

  const editor = useCreateBlockNote({
    initialContent:
      Array.isArray(page.content) && page.content.length
        ? (page.content as PartialBlock[])
        : undefined,
    uploadFile: async (file: File) => {
      const { data } = await docsApi.uploadImage(page.id, file);
      return data.url; // /api/docs/images/<id> — turned into bytes by resolveFileUrl
    },
    resolveFileUrl: (url: string) => resolveDocImageUrl(url),
  });

  const persist = useCallback(async () => {
    const contentText = await editor.blocksToMarkdownLossy(
      editor.document as unknown as PartialBlock[],
    );
    await docsApi.updatePage(page.id, {
      content: editor.document as unknown[],
      contentText,
    });
    dirty.current = false;
  }, [editor, page.id]);

  const scheduleSave = useCallback(() => {
    if (!canWriteRef.current) return;
    dirty.current = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      setSaving(true);
      persist()
        .catch((err) => toast.push(apiError(err, 'Could not save'), 'error'))
        .finally(() => setSaving(false));
    }, 800);
  }, [persist, toast]);

  // Best-effort flush of pending edits when leaving the page.
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (dirty.current && canWriteRef.current) void persist().catch(() => undefined);
    };
  }, [persist]);

  const saveTitle = async () => {
    const t = title.trim() || 'Untitled';
    if (t === page.title) return;
    try {
      await docsApi.updatePage(page.id, { title: t });
      onTitleSaved?.(t);
    } catch (err) {
      toast.push(apiError(err, 'Could not rename'), 'error');
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="mx-auto w-full max-w-[960px] px-8 pb-24 pt-8">
          <div className="mb-3 flex h-4 items-center justify-end text-[11px] font-medium text-ink-subtle">
            {saving ? 'Saving…' : canWrite ? '' : 'Read-only'}
          </div>
          <article className="min-h-[72vh] animate-[docIn_240ms_ease-out] overflow-hidden rounded-[20px] bg-[#EAE9E5] pb-16 shadow-[0_2px_4px_rgba(0,0,0,0.18),0_30px_64px_-24px_rgba(0,0,0,0.55)]">
            <div className="px-[54px] pt-16 pb-1">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => void saveTitle()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                }}
                disabled={!canWrite}
                placeholder="Untitled"
                className="w-full bg-transparent font-display text-[34px] font-bold leading-[1.15] tracking-tight text-[#1c1e24] outline-none placeholder:text-[#b8b5ac]"
              />
            </div>
            <div className="doc-prose">
              <BlockNoteView
                editor={editor}
                editable={canWrite}
                theme="light"
                onChange={scheduleSave}
              />
            </div>
          </article>
        </div>
      </div>
    </div>
  );
}
