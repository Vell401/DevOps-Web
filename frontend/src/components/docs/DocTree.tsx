import { useState, type DragEvent } from 'react';
import type { DocPageNode } from '../../types';
import { Icon } from '../../ui/Icon';
import { cn } from '../../lib/cn';

export type DropZone = 'before' | 'inside' | 'after';

interface Props {
  pages: DocPageNode[];
  selectedId: string | null;
  canWrite: boolean;
  onSelect: (id: string) => void;
  onCreateChild: (parentId: string | null) => void;
  onDelete: (id: string) => void;
  onMove: (dragId: string, targetId: string, zone: DropZone) => void;
}

interface TreeNode extends DocPageNode {
  children: TreeNode[];
}

function buildTree(pages: DocPageNode[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  pages.forEach((p) => byId.set(p.id, { ...p, children: [] }));
  const roots: TreeNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sortRec = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => a.position - b.position);
    nodes.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}

interface DragState {
  dragId: string | null;
  drop: { id: string; zone: DropZone } | null;
}

export function DocTree({
  pages,
  onMove,
  selectedId,
  canWrite,
  onSelect,
  onCreateChild,
  onDelete,
}: Props) {
  const tree = buildTree(pages);
  const [drag, setDrag] = useState<DragState>({ dragId: null, drop: null });
  const rowProps = { selectedId, canWrite, onSelect, onCreateChild, onDelete, onMove };

  return (
    <ul className="space-y-px" onDragEnd={() => setDrag({ dragId: null, drop: null })}>
      {tree.map((n) => (
        <TreeRow key={n.id} node={n} depth={0} drag={drag} setDrag={setDrag} {...rowProps} />
      ))}
      {tree.length === 0 && (
        <li className="px-3 py-4 text-center text-xs text-ink-subtle">No pages yet</li>
      )}
    </ul>
  );
}

function TreeRow({
  node,
  depth,
  selectedId,
  canWrite,
  onSelect,
  onCreateChild,
  onDelete,
  onMove,
  drag,
  setDrag,
}: {
  node: TreeNode;
  depth: number;
  drag: DragState;
  setDrag: (s: DragState) => void;
} & Omit<Props, 'pages'>) {
  const [expanded, setExpanded] = useState(true);
  const hasKids = node.children.length > 0;
  const active = node.id === selectedId;
  const isDragging = drag.dragId === node.id;
  const zone = drag.drop && drag.drop.id === node.id ? drag.drop.zone : null;
  const indent = 6 + depth * 14;

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!canWrite || !drag.dragId || drag.dragId === node.id) return;
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - r.top;
    const z: DropZone = y < r.height * 0.3 ? 'before' : y > r.height * 0.7 ? 'after' : 'inside';
    if (!drag.drop || drag.drop.id !== node.id || drag.drop.zone !== z) {
      setDrag({ dragId: drag.dragId, drop: { id: node.id, zone: z } });
    }
  };
  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    if (!canWrite || !drag.dragId || drag.dragId === node.id) return;
    e.preventDefault();
    const z = zone ?? 'inside';
    const dragId = drag.dragId;
    setDrag({ dragId: null, drop: null });
    onMove(dragId, node.id, z);
  };

  return (
    <li>
      <div className="relative">
        {zone === 'before' && (
          <div
            className="pointer-events-none absolute -top-px right-1 z-10 h-0.5 rounded-full bg-blurple"
            style={{ left: indent }}
          />
        )}
        <div
          draggable={canWrite}
          onDragStart={(e) => {
            setDrag({ dragId: node.id, drop: null });
            e.dataTransfer.effectAllowed = 'move';
          }}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onDragLeave={() => {
            if (drag.drop?.id === node.id) setDrag({ dragId: drag.dragId, drop: null });
          }}
          className={cn(
            'group flex items-center gap-1 rounded-md pr-1 text-sm transition-colors',
            canWrite && 'cursor-grab active:cursor-grabbing',
            isDragging && 'opacity-40',
            zone === 'inside' && 'bg-blurple-soft ring-1 ring-inset ring-blurple/60',
            active
              ? 'bg-surface-hover text-ink'
              : 'text-ink-muted hover:bg-surface-hover/50 hover:text-ink',
          )}
          style={{ paddingLeft: indent }}
        >
          <button
            onClick={() => setExpanded((v) => !v)}
            className={cn(
              'shrink-0 rounded-sm p-0.5 transition-transform',
              hasKids ? 'text-ink-subtle hover:text-ink' : 'pointer-events-none invisible',
            )}
            aria-label={expanded ? 'Collapse' : 'Expand'}
          >
            <Icon.Caret size={10} className={cn('transition-transform', expanded ? '' : '-rotate-90')} />
          </button>
          <button
            onClick={() => onSelect(node.id)}
            className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left"
          >
            <span className="shrink-0 text-ink-subtle">
              {node.icon ? (
                <span className="text-[13px] leading-none">{node.icon}</span>
              ) : (
                <Icon.File size={13} />
              )}
            </span>
            <span className="truncate">{node.title || 'Untitled'}</span>
          </button>
          {canWrite && (
            <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                onClick={() => onCreateChild(node.id)}
                className="rounded-sm p-0.5 text-ink-subtle hover:text-ink"
                title="Add sub-page"
              >
                <Icon.Plus size={12} />
              </button>
              <button
                onClick={() => onDelete(node.id)}
                className="rounded-sm p-0.5 text-ink-subtle hover:text-status-dnd"
                title="Delete page"
              >
                <Icon.Trash size={12} />
              </button>
            </div>
          )}
        </div>
        {zone === 'after' && (
          <div
            className="pointer-events-none absolute -bottom-px right-1 z-10 h-0.5 rounded-full bg-blurple"
            style={{ left: indent }}
          />
        )}
      </div>
      {hasKids && expanded && (
        <ul className="space-y-px">
          {node.children.map((c) => (
            <TreeRow
              key={c.id}
              node={c}
              depth={depth + 1}
              selectedId={selectedId}
              canWrite={canWrite}
              onSelect={onSelect}
              onCreateChild={onCreateChild}
              onDelete={onDelete}
              onMove={onMove}
              drag={drag}
              setDrag={setDrag}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
