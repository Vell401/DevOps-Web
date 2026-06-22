import { useState } from 'react';
import type { DocPageNode } from '../../types';
import { Icon } from '../../ui/Icon';
import { cn } from '../../lib/cn';

interface Props {
  pages: DocPageNode[];
  selectedId: string | null;
  canWrite: boolean;
  onSelect: (id: string) => void;
  onCreateChild: (parentId: string | null) => void;
  onDelete: (id: string) => void;
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

export function DocTree(props: Props) {
  const tree = buildTree(props.pages);
  return (
    <ul className="space-y-0.5">
      {tree.map((n) => (
        <TreeRow key={n.id} node={n} depth={0} {...props} />
      ))}
      {tree.length === 0 && (
        <li className="px-2 py-1.5 text-xs text-ink-subtle">No pages yet</li>
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
}: { node: TreeNode; depth: number } & Omit<Props, 'pages'>) {
  const [expanded, setExpanded] = useState(true);
  const hasKids = node.children.length > 0;
  const active = node.id === selectedId;

  return (
    <li>
      <div
        className={cn(
          'group flex items-center gap-1 rounded-md pr-1 text-sm transition',
          active
            ? 'bg-surface-hover text-ink'
            : 'text-ink-muted hover:bg-surface-hover/60 hover:text-ink',
        )}
        style={{ paddingLeft: 4 + depth * 14 }}
      >
        <button
          onClick={() => setExpanded((v) => !v)}
          className={cn(
            'shrink-0 rounded-sm p-0.5',
            hasKids ? 'text-ink-subtle hover:text-ink' : 'invisible',
          )}
          aria-label="Toggle"
        >
          <Icon.Caret
            size={10}
            className={cn('transition-transform', expanded ? 'rotate-0' : '-rotate-90')}
          />
        </button>
        <button
          onClick={() => onSelect(node.id)}
          className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left"
        >
          <span className="shrink-0 text-ink-subtle">
            {node.icon ? <span className="text-[13px]">{node.icon}</span> : <Icon.File size={13} />}
          </span>
          <span className="truncate">{node.title || 'Untitled'}</span>
        </button>
        {canWrite && (
          <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100">
            <button
              onClick={() => onCreateChild(node.id)}
              className="rounded-sm p-0.5 text-ink-subtle hover:text-ink"
              title="Add sub-page"
            >
              <Icon.Plus size={12} />
            </button>
            <button
              onClick={() => onDelete(node.id)}
              className="rounded-sm p-0.5 text-ink-subtle hover:text-[#883128]"
              title="Delete page"
            >
              <Icon.Trash size={12} />
            </button>
          </div>
        )}
      </div>
      {hasKids && expanded && (
        <ul className="space-y-0.5">
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
            />
          ))}
        </ul>
      )}
    </li>
  );
}
