import { useEffect, useState } from 'react';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import type { PartialBlock } from '@blocknote/core';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';

import { docsApi } from '../../api/endpoints';
import { resolveDocImageUrl } from '../../lib/docImageCache';
import type { DocRevision, DocRevisionMeta } from '../../types';
import { Dialog } from '../../ui/Dialog';
import { Avatar } from '../../ui/Avatar';
import { Spinner } from '../../ui/Spinner';
import { useToast } from '../../ui/Toast';
import { apiError } from '../../lib/apiError';
import { timeAgo, formatDateTime } from '../../lib/format';
import { cn } from '../../lib/cn';

interface Props {
  open: boolean;
  onClose: () => void;
  pageId: string | null;
  canWrite: boolean;
  onRestored: () => void;
}

export function DocHistoryDialog({ open, onClose, pageId, canWrite, onRestored }: Props) {
  const toast = useToast();
  const [revs, setRevs] = useState<DocRevisionMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<DocRevision | null>(null);
  const [restoring, setRestoring] = useState(false);

  const pick = async (revId: string) => {
    setSelectedId(revId);
    setSelected(null);
    try {
      const { data } = await docsApi.getRevision(revId);
      setSelected(data);
    } catch (err) {
      toast.push(apiError(err, 'Could not load version'), 'error');
    }
  };

  const restore = async () => {
    if (!pageId || !selectedId) return;
    if (
      !confirm('Restore this version? The current content is replaced (and kept in history).')
    ) {
      return;
    }
    setRestoring(true);
    try {
      await docsApi.restoreRevision(pageId, selectedId);
      toast.push('Version restored', 'success');
      onRestored();
      onClose();
    } catch (err) {
      toast.push(apiError(err, 'Could not restore'), 'error');
    } finally {
      setRestoring(false);
    }
  };

  useEffect(() => {
    if (!open || !pageId) return;
    let alive = true;
    setLoading(true);
    setSelected(null);
    setSelectedId(null);
    docsApi
      .listRevisions(pageId)
      .then((r) => {
        if (!alive) return;
        setRevs(r.data);
        if (r.data[0]) void pick(r.data[0].id);
      })
      .catch(() => alive && toast.push('Could not load history', 'error'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pageId]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Version history"
      description="Each save creates a version. Pick one to preview, then restore it."
      width={780}
    >
      {loading ? (
        <div className="flex items-center gap-2 py-10 text-sm text-ink-muted">
          <Spinner /> Loading…
        </div>
      ) : revs.length === 0 ? (
        <p className="py-10 text-sm text-ink-subtle">No saved versions yet.</p>
      ) : (
        <div className="flex h-[60vh] gap-4">
          <ul className="w-56 shrink-0 space-y-1 overflow-y-auto pr-1 scrollbar-thin">
            {revs.map((r, i) => (
              <li key={r.id}>
                <button
                  onClick={() => void pick(r.id)}
                  className={cn(
                    'w-full rounded-md px-2.5 py-2 text-left transition',
                    r.id === selectedId ? 'bg-surface-hover' : 'hover:bg-surface-hover/50',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Avatar
                      name={r.editor?.name ?? '?'}
                      color={r.editor?.avatarColor}
                      userId={r.editor?.id}
                      avatarKey={r.editor?.avatarKey}
                      size="xs"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-ink">
                        {r.editor?.name ?? 'Unknown'}
                      </span>
                      <span
                        className="block text-[11px] text-ink-subtle"
                        title={formatDateTime(r.createdAt)}
                      >
                        {timeAgo(r.createdAt)}
                      </span>
                    </span>
                    {i === 0 && (
                      <span className="chip bg-chip-green text-[#1B6A48]">current</span>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>

          <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg bg-white">
            <div className="flex items-center justify-between gap-2 border-b border-black/[0.06] px-4 py-2.5">
              <span className="truncate font-display text-sm font-semibold text-[#1c1e24]">
                {selected?.title ?? '…'}
              </span>
              {canWrite && selectedId && (
                <button
                  onClick={() => void restore()}
                  disabled={restoring}
                  className="btn-primary h-7 shrink-0 px-3 text-xs"
                >
                  {restoring && <Spinner className="border-paper border-t-paper/40" />}
                  Restore
                </button>
              )}
            </div>
            <div className="doc-prose min-h-0 flex-1 overflow-y-auto py-2 scrollbar-thin">
              {selected ? (
                <RevisionPreview key={selected.id} content={selected.content} />
              ) : (
                <div className="flex h-full items-center justify-center text-ink-subtle">
                  <Spinner />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function RevisionPreview({ content }: { content: unknown[] | null }) {
  const editor = useCreateBlockNote({
    initialContent:
      Array.isArray(content) && content.length ? (content as PartialBlock[]) : undefined,
    resolveFileUrl: (url: string) => resolveDocImageUrl(url),
  });
  return <BlockNoteView editor={editor} editable={false} theme="light" />;
}
