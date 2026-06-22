import { useCallback, useEffect, useState } from 'react';
import { docsApi } from '../api/endpoints';
import type {
  DocPage,
  DocSearchHit,
  DocSpaceDetail,
  DocSpaceLite,
} from '../types';
import { Topbar } from '../components/Topbar';
import { Spinner } from '../ui/Spinner';
import { Icon } from '../ui/Icon';
import { Popover, PopoverItem } from '../ui/Popover';
import { Dialog } from '../ui/Dialog';
import { useToast } from '../ui/Toast';
import { apiError } from '../lib/apiError';
import { useDocSpaceRealtime, useUserRealtime } from '../lib/realtime';
import { DocTree } from '../components/docs/DocTree';
import { DocEditor } from '../components/docs/DocEditor';
import { DocSpaceSettingsDialog } from '../components/docs/DocSpaceSettingsDialog';

export function DocsPage() {
  const toast = useToast();
  const [spaces, setSpaces] = useState<DocSpaceLite[]>([]);
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DocSpaceDetail | null>(null);
  const [pageId, setPageId] = useState<string | null>(null);
  const [page, setPage] = useState<DocPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newSpaceOpen, setNewSpaceOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<DocSearchHit[] | null>(null);

  const canWrite = detail ? detail.myRole !== 'READER' : false;

  const loadSpaces = useCallback(
    async (selectId?: string) => {
      try {
        const { data } = await docsApi.listSpaces();
        setSpaces(data);
        setSpaceId((cur) => selectId ?? cur ?? data[0]?.id ?? null);
      } catch (err) {
        toast.push(apiError(err, 'Could not load spaces'), 'error');
      } finally {
        setLoading(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    void loadSpaces();
  }, [loadSpaces]);

  const loadSpace = useCallback(
    async (id: string) => {
      try {
        const { data } = await docsApi.getSpace(id);
        setDetail(data);
        setPageId((cur) =>
          cur && data.pages.some((p) => p.id === cur) ? cur : data.pages[0]?.id ?? null,
        );
      } catch (err) {
        toast.push(apiError(err, 'Could not load space'), 'error');
      }
    },
    [toast],
  );

  useEffect(() => {
    if (spaceId) void loadSpace(spaceId);
    else setDetail(null);
  }, [spaceId, loadSpace]);

  useEffect(() => {
    if (!pageId) {
      setPage(null);
      return;
    }
    let alive = true;
    docsApi
      .getPage(pageId)
      .then((r) => alive && setPage(r.data))
      .catch(() => alive && setPage(null));
    return () => {
      alive = false;
    };
  }, [pageId]);

  // Realtime: tree changes for the open space, space-list changes for the user.
  const onTree = useCallback(() => {
    if (spaceId) void loadSpace(spaceId);
  }, [spaceId, loadSpace]);
  useDocSpaceRealtime(spaceId ?? undefined, { 'doc-tree-changed': onTree });
  const onSpaces = useCallback(() => {
    void loadSpaces();
  }, [loadSpaces]);
  useUserRealtime({ 'docspaces-changed': onSpaces });

  // Debounced space-scoped search.
  useEffect(() => {
    if (!spaceId) return;
    const q = query.trim();
    if (!q) {
      setResults(null);
      return;
    }
    const t = setTimeout(() => {
      docsApi
        .search(spaceId, q)
        .then((r) => setResults(r.data))
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [query, spaceId]);

  const createPage = async (parentId: string | null) => {
    if (!spaceId) return;
    try {
      const { data } = await docsApi.createPage(spaceId, parentId ? { parentId } : {});
      await loadSpace(spaceId);
      setPageId(data.id);
    } catch (err) {
      toast.push(apiError(err, 'Could not create page'), 'error');
    }
  };
  const deletePage = async (id: string) => {
    if (!confirm('Delete this page and its sub-pages? This cannot be undone.')) return;
    try {
      await docsApi.deletePage(id);
      if (pageId === id) setPageId(null);
      if (spaceId) await loadSpace(spaceId);
    } catch (err) {
      toast.push(apiError(err, 'Could not delete page'), 'error');
    }
  };

  const space = spaces.find((s) => s.id === spaceId) ?? null;

  return (
    <>
      <Topbar crumbs={[{ label: 'Docs' }]} />
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-72 shrink-0 flex-col border-r border-line bg-surface-sunken">
          <div className="flex items-center gap-1 px-3 py-3">
            <Popover
              className="min-w-[240px]"
              trigger={({ toggle }) => (
                <button
                  onClick={toggle}
                  className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm font-medium text-ink hover:bg-surface-hover"
                >
                  <Icon.File size={14} className="shrink-0 text-ink-subtle" />
                  <span className="truncate">{space?.name ?? 'Documentation'}</span>
                  <Icon.Caret size={12} className="ml-auto shrink-0 text-ink-subtle" />
                </button>
              )}
            >
              {(close) => (
                <>
                  {spaces.map((s) => (
                    <PopoverItem
                      key={s.id}
                      active={s.id === spaceId}
                      onClick={() => {
                        close();
                        setPageId(null);
                        setSpaceId(s.id);
                      }}
                    >
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate">{s.name}</span>
                        <span className="text-[10px] text-ink-subtle">
                          {s.pageCount} page{s.pageCount === 1 ? '' : 's'}
                        </span>
                      </span>
                    </PopoverItem>
                  ))}
                  {spaces.length === 0 && (
                    <div className="px-2 py-1.5 text-xs text-ink-subtle">No spaces yet</div>
                  )}
                  <div className="my-1 border-t border-line" />
                  <PopoverItem
                    onClick={() => {
                      close();
                      setNewSpaceOpen(true);
                    }}
                    icon={<Icon.Plus size={13} />}
                  >
                    New space
                  </PopoverItem>
                </>
              )}
            </Popover>
            {detail && (
              <button
                onClick={() => setSettingsOpen(true)}
                className="rounded-md p-1.5 text-ink-subtle hover:bg-surface-hover hover:text-ink"
                title="Space settings"
              >
                <Icon.Dots size={14} />
              </button>
            )}
          </div>

          {detail && (
            <>
              <div className="px-3 pb-2">
                <div className="relative">
                  <Icon.Search
                    size={13}
                    className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-subtle"
                  />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search this space…"
                    className="w-full rounded-md bg-surface-deep py-1.5 pl-7 pr-2 text-xs text-ink placeholder:text-ink-subtle focus-visible:shadow-focus"
                  />
                </div>
              </div>
              <div className="flex items-center justify-between px-4 pb-1">
                <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-subtle">
                  Pages
                </span>
                {canWrite && (
                  <button
                    onClick={() => void createPage(null)}
                    className="rounded-sm p-0.5 text-ink-muted hover:bg-surface-hover hover:text-ink"
                    title="New page"
                  >
                    <Icon.Plus size={14} />
                  </button>
                )}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 scrollbar-thin">
                {results ? (
                  <ul className="space-y-0.5">
                    {results.length === 0 && (
                      <li className="px-2 py-1.5 text-xs text-ink-subtle">No matches</li>
                    )}
                    {results.map((r) => (
                      <li key={r.id}>
                        <button
                          onClick={() => {
                            setPageId(r.id);
                            setQuery('');
                          }}
                          className="w-full rounded-md px-2 py-1.5 text-left hover:bg-surface-hover/60"
                        >
                          <div className="truncate text-sm text-ink">{r.title || 'Untitled'}</div>
                          {r.snippet && (
                            <div className="truncate text-[11px] text-ink-subtle">{r.snippet}</div>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <DocTree
                    pages={detail.pages}
                    selectedId={pageId}
                    canWrite={canWrite}
                    onSelect={setPageId}
                    onCreateChild={(pid) => void createPage(pid)}
                    onDelete={(id) => void deletePage(id)}
                  />
                )}
              </div>
            </>
          )}
        </aside>

        <main className="min-w-0 flex-1">
          {loading ? (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-ink-muted">
              <Spinner /> Loading…
            </div>
          ) : !detail ? (
            <EmptyState onCreate={() => setNewSpaceOpen(true)} hasSpaces={spaces.length > 0} />
          ) : !page ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-ink-muted">
              <p>Select a page{canWrite ? ' or create one' : ''}.</p>
              {canWrite && (
                <button onClick={() => void createPage(null)} className="btn-secondary text-xs">
                  <Icon.Plus size={13} /> New page
                </button>
              )}
            </div>
          ) : (
            <DocEditor
              key={page.id}
              page={page}
              canWrite={canWrite}
              onTitleSaved={() => {
                if (spaceId) void loadSpace(spaceId);
              }}
            />
          )}
        </main>
      </div>

      {detail && (
        <DocSpaceSettingsDialog
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          space={detail}
          onChanged={() => {
            if (spaceId) void loadSpace(spaceId);
            void loadSpaces();
          }}
          onDeleted={() => {
            setSettingsOpen(false);
            setDetail(null);
            setPageId(null);
            const next = spaces.find((s) => s.id !== spaceId);
            setSpaceId(next?.id ?? null);
            void loadSpaces();
          }}
        />
      )}

      <NewSpaceDialog
        open={newSpaceOpen}
        onClose={() => setNewSpaceOpen(false)}
        onCreate={async (n) => {
          try {
            const { data } = await docsApi.createSpace(n);
            setNewSpaceOpen(false);
            setPageId(null);
            await loadSpaces(data.id);
          } catch (err) {
            toast.push(apiError(err, 'Could not create space'), 'error');
          }
        }}
      />
    </>
  );
}

function EmptyState({ onCreate, hasSpaces }: { onCreate: () => void; hasSpaces: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <Icon.File size={28} className="text-ink-subtle" />
      <div>
        <div className="font-display text-lg text-ink">
          {hasSpaces ? 'Pick a space' : 'No documentation yet'}
        </div>
        <p className="mt-1 text-sm text-ink-muted">
          {hasSpaces
            ? 'Choose a space from the switcher on the left.'
            : 'Create a space to start writing docs.'}
        </p>
      </div>
      <button onClick={onCreate} className="btn-primary text-sm">
        <Icon.Plus size={14} /> New space
      </button>
    </div>
  );
}

function NewSpaceDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setName('');
  }, [open]);
  return (
    <Dialog open={open} onClose={onClose} title="New space" width={400}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          setBusy(true);
          try {
            await onCreate(name.trim());
          } finally {
            setBusy(false);
          }
        }}
        className="space-y-3"
      >
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Space name"
          maxLength={120}
          className="input"
        />
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-ghost">
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={busy || !name.trim()}>
            {busy && <Spinner className="border-paper border-t-paper/40" />}
            Create
          </button>
        </div>
      </form>
    </Dialog>
  );
}
