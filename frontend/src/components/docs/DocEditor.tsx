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
import { Icon } from '../../ui/Icon';
import { Spinner } from '../../ui/Spinner';
import { apiError } from '../../lib/apiError';

const ZOOM_KEY = 'tracker.docs.zoom';
const clampZoom = (z: number) => Math.min(2, Math.max(0.5, Math.round(z * 10) / 10));

interface Props {
  /** Mount one editor per page — give it `key={page.id}` so switching pages
   *  remounts with fresh content (useCreateBlockNote captures initialContent once). */
  page: DocPage;
  canWrite: boolean;
  /** Start in edit mode (e.g. opened from the tree's "Edit" action). */
  defaultEditing?: boolean;
  /** Called after a successful save so the tree can refresh titles. */
  onSaved?: () => void;
}

export function DocEditor({ page, canWrite, defaultEditing, onSaved }: Props) {
  const toast = useToast();
  const [title, setTitle] = useState(page.title);
  const [editing, setEditing] = useState(Boolean(defaultEditing) && canWrite);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const [zoom, setZoom] = useState<number>(() => {
    const v = Number(localStorage.getItem(ZOOM_KEY));
    return Number.isFinite(v) && v >= 0.5 && v <= 2 ? v : 1;
  });
  useEffect(() => {
    try {
      localStorage.setItem(ZOOM_KEY, String(zoom));
    } catch {
      // ignore (private mode / quota)
    }
  }, [zoom]);

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

  // Refs for the save-on-leave safety net (manual Save is the primary path).
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const titleRef = useRef(title);
  titleRef.current = title;

  const persist = useCallback(async () => {
    const contentText = await editor.blocksToMarkdownLossy(
      editor.document as unknown as PartialBlock[],
    );
    await docsApi.updatePage(page.id, {
      title: titleRef.current.trim() || 'Untitled',
      content: editor.document as unknown[],
      contentText,
    });
  }, [editor, page.id]);

  const save = async () => {
    setSaving(true);
    try {
      await persist();
      setDirty(false);
      setEditing(false);
      onSaved?.();
      toast.push('Saved', 'success');
    } catch (err) {
      toast.push(apiError(err, 'Could not save'), 'error');
    } finally {
      setSaving(false);
    }
  };

  // Save-on-leave safety: if you navigate away mid-edit with unsaved changes.
  useEffect(() => {
    return () => {
      if (editingRef.current && dirtyRef.current) void persist().catch(() => undefined);
    };
  }, [persist]);

  return (
    <div className="relative flex h-full flex-col">
      <div className="flex-1 overflow-y-auto [scrollbar-gutter:stable] scrollbar-thin">
        <div className="mx-auto w-full max-w-[920px] px-6 pb-20 pt-8" style={{ zoom }}>
          <article className="animate-[docIn_240ms_ease-out] overflow-hidden rounded-[18px] bg-white pb-16 shadow-[0_1px_2px_rgba(16,18,23,0.05),0_24px_50px_-22px_rgba(16,18,23,0.28)]">
            <div className="px-[54px] pt-14 pb-1">
              <input
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setDirty(true);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                }}
                disabled={!editing}
                placeholder="Untitled"
                className="w-full bg-transparent font-display text-[34px] font-bold leading-[1.15] tracking-tight text-[#1c1e24] outline-none placeholder:text-[#c7cad1] disabled:cursor-default"
              />
            </div>
            <div className="doc-prose">
              <BlockNoteView
                editor={editor}
                editable={editing}
                theme="light"
                onChange={() => {
                  if (editing) setDirty(true);
                }}
              />
            </div>
          </article>
        </div>
      </div>

      {/* Edit / Save — top-right, fixed while the page scrolls. */}
      <div className="absolute right-4 top-4 z-10 flex items-center gap-2">
        {!canWrite ? (
          <span className="rounded-lg bg-surface/95 px-3 py-1.5 text-[11px] font-medium text-ink-subtle shadow-card ring-1 ring-black/10 backdrop-blur">
            Read-only
          </span>
        ) : editing ? (
          <>
            <span className="text-[11px] font-medium text-[#5b6069]">
              {saving ? 'Saving…' : dirty ? 'Unsaved changes' : 'Saved'}
            </span>
            <button
              onClick={() => void save()}
              disabled={!dirty || saving}
              className="btn-primary h-8 px-3.5 text-xs shadow-card disabled:opacity-50"
            >
              {saving && <Spinner className="border-paper border-t-paper/40" />}
              Save
            </button>
          </>
        ) : (
          <button
            onClick={() => setEditing(true)}
            className="btn-secondary h-8 px-3.5 text-xs shadow-card"
          >
            <Icon.Edit size={13} /> Edit
          </button>
        )}
      </div>

      {/* Canvas zoom — bottom-right, fixed while the page scrolls. */}
      <div className="absolute bottom-4 right-4 z-10 flex items-center gap-0.5 rounded-lg bg-surface/95 p-1 shadow-card ring-1 ring-black/10 backdrop-blur">
        <button
          onClick={() => setZoom((z) => clampZoom(z - 0.1))}
          disabled={zoom <= 0.5}
          className="flex h-6 w-6 items-center justify-center rounded-md text-lg leading-none text-ink-muted transition hover:bg-surface-hover hover:text-ink disabled:opacity-40"
          title="Zoom out"
        >
          −
        </button>
        <button
          onClick={() => setZoom(1)}
          className="min-w-[46px] rounded-md px-1 py-1 text-center text-xs tabular-nums text-ink-muted transition hover:bg-surface-hover hover:text-ink"
          title="Reset to 100%"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          onClick={() => setZoom((z) => clampZoom(z + 0.1))}
          disabled={zoom >= 2}
          className="flex h-6 w-6 items-center justify-center rounded-md text-lg leading-none text-ink-muted transition hover:bg-surface-hover hover:text-ink disabled:opacity-40"
          title="Zoom in"
        >
          +
        </button>
      </div>
    </div>
  );
}
