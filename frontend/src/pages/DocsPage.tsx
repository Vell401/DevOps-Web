import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
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
import { DocTree, type DropZone } from '../components/docs/DocTree';
import { DocEditor } from '../components/docs/DocEditor';
import { DocSpaceSettingsDialog } from '../components/docs/DocSpaceSettingsDialog';

const TREE_W_KEY = 'tracker.docs.treeWidth';

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

  // Resizable tree panel — width persists across reloads, clamped to a sane range.
  const asideRef = useRef<HTMLElement | null>(null);
  const [treeWidth, setTreeWidth] = useState<number>(() => {
    const v = Number(localStorage.getItem(TREE_W_KEY));
    return Number.isFinite(v) && v >= 220 && v <= 520 ? v : 288;
  });
  const treeWidthRef = useRef(treeWidth);
  treeWidthRef.current = treeWidth;
  const startResize = (e: ReactMouseEvent) => {
    e.preventDefault();
    const left = asideRef.current?.getBoundingClientRect().left ?? 0;
    const onMove = (ev: MouseEvent) =>
      setTreeWidth(Math.min(520, Math.max(220, ev.clientX - left)));
    const onUp = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      try {
        localStorage.setItem(TREE_W_KEY, String(Math.round(treeWidthRef.current)));
      } catch {
        // ignore (private mode / quota)
      }
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

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

  // Drag-and-drop reorder / reparent in the tree.
  const movePage = async (dragId: string, targetId: string, zone: DropZone) => {
    if (!detail || !spaceId || dragId === targetId) return;
    const pages = detail.pages;
    const target = pages.find((p) => p.id === targetId);
    const dragged = pages.find((p) => p.id === dragId);
    if (!target || !dragged) return;

    const isAncestor = (ancestorId: string, nodeId: string | null): boolean => {
      let cur = nodeId;
      for (let i = 0; i < 1000 && cur; i++) {
        if (cur === ancestorId) return true;
        cur = pages.find((p) => p.id === cur)?.parentId ?? null;
      }
      return false;
    };

    let newParentId: string | null;
    let newPosition: number;
    if (zone === 'inside') {
      newParentId = targetId;
      const kids = pages
        .filter((p) => p.parentId === targetId)
        .sort((a, b) => a.position - b.position);
      newPosition = (kids.length ? kids[kids.length - 1].position : 0) + 1;
    } else {
      newParentId = target.parentId;
      const sibs = pages
        .filter((p) => p.parentId === target.parentId && p.id !== dragId)
        .sort((a, b) => a.position - b.position);
      const idx = sibs.findIndex((p) => p.id === targetId);
      if (zone === 'before') {
        const prev = sibs[idx - 1];
        newPosition = prev ? (prev.position + target.position) / 2 : target.position - 1;
      } else {
        const next = sibs[idx + 1];
        newPosition = next ? (target.position + next.position) / 2 : target.position + 1;
      }
    }

    if (newParentId && (newParentId === dragId || isAncestor(dragId, newParentId))) {
      toast.push("Can't move a page into its own sub-tree", 'error');
      return;
    }
    if (dragged.parentId === newParentId && dragged.position === newPosition) return;

    try {
      await docsApi.updatePage(dragId, { parentId: newParentId, position: newPosition });
      await loadSpace(spaceId);
    } catch (err) {
      toast.push(apiError(err, 'Could not move page'), 'error');
    }
  };

  const space = spaces.find((s) => s.id === spaceId) ?? null;

  return (
    <>
      <Topbar crumbs={[{ label: 'Docs' }]} />
      <div className="flex min-h-0 flex-1">
        <aside
          ref={asideRef}
          style={{ width: treeWidth }}
          className="relative flex shrink-0 flex-col bg-paper"
        >
          <div className="flex items-center gap-1 px-3 pb-2 pt-3">
            <Popover
              className="min-w-[244px]"
              trigger={({ toggle }) => (
                <button
                  onClick={toggle}
                  className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm font-semibold text-ink transition hover:bg-surface-hover/60"
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
                        setQuery('');
                        setSpaceId(s.id);
                      }}
                    >
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate">{s.name}</span>
                        <span className="text-[10px] text-ink-subtle">
                          {s.pageCount} page{s.pageCount === 1 ? '' : 's'} · {s.myRole.toLowerCase()}
                        </span>
                      </span>
                    </PopoverItem>
                  ))}
                  {spaces.length === 0 && (
                    <div className="px-2 py-1.5 text-xs text-ink-subtle">No spaces yet</div>
                  )}
                  <div className="my-1 h-px bg-line/60" />
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
                className="shrink-0 rounded-md p-1.5 text-ink-subtle transition hover:bg-surface-hover/60 hover:text-ink"
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
                    className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-subtle"
                  />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search this space…"
                    className="w-full rounded-lg bg-surface-deep py-2 pl-8 pr-2 text-xs text-ink placeholder:text-ink-subtle focus-visible:shadow-focus"
                  />
                </div>
              </div>
              <div className="flex items-center justify-between px-4 pb-1 pt-1">
                <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-subtle">
                  Pages
                </span>
                {canWrite && (
                  <button
                    onClick={() => void createPage(null)}
                    className="rounded-sm p-0.5 text-ink-muted transition hover:bg-surface-hover hover:text-ink"
                    title="New page"
                  >
                    <Icon.Plus size={14} />
                  </button>
                )}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4 scrollbar-thin">
                {results ? (
                  <ul className="space-y-px">
                    {results.length === 0 && (
                      <li className="px-2 py-2 text-xs text-ink-subtle">No matches</li>
                    )}
                    {results.map((r) => (
                      <li key={r.id}>
                        <button
                          onClick={() => {
                            setPageId(r.id);
                            setQuery('');
                          }}
                          className="w-full rounded-md px-2.5 py-1.5 text-left transition hover:bg-surface-hover/50"
                        >
                          <div className="flex items-center gap-1.5">
                            <Icon.File size={12} className="shrink-0 text-ink-subtle" />
                            <span className="truncate text-sm text-ink-muted">
                              {r.title || 'Untitled'}
                            </span>
                          </div>
                          {r.snippet && (
                            <div className="mt-0.5 truncate pl-[18px] text-[11px] text-ink-subtle">
                              {r.snippet}
                            </div>
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
                    onMove={(d, t, z) => void movePage(d, t, z)}
                  />
                )}
              </div>
            </>
          )}
          {/* Drag handle: resize the tree panel; the thin line doubles as the divider. */}
          <div
            onMouseDown={startResize}
            onDoubleClick={() => setTreeWidth(288)}
            title="Drag to resize · double-click to reset"
            className="group absolute -right-px top-0 z-20 h-full w-1.5 cursor-col-resize"
          >
            <div className="ml-auto h-full w-px bg-line/60 transition-colors group-hover:bg-blurple" />
          </div>
        </aside>

        <main className="min-w-0 flex-1 bg-[#d9dbe0]">
          {loading ? (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-[#6f747d]">
              <Spinner /> Loading…
            </div>
          ) : !detail ? (
            <EmptyState onCreate={() => setNewSpaceOpen(true)} hasSpaces={spaces.length > 0} />
          ) : !page ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-[#6f747d]">
              <p>Select a page{canWrite ? ' or create one' : ''}.</p>
              {canWrite && (
                <button onClick={() => void createPage(null)} className="btn-primary text-sm">
                  <Icon.Plus size={14} /> New page
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
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-[#aeb2bb] shadow-[0_1px_2px_rgba(16,18,23,0.05),0_12px_28px_-14px_rgba(16,18,23,0.25)]">
        <Icon.File size={24} />
      </div>
      <div>
        <div className="font-display text-lg font-semibold text-[#2c2f36]">
          {hasSpaces ? 'Pick a space' : 'No documentation yet'}
        </div>
        <p className="mt-1 text-sm text-[#6f747d]">
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
