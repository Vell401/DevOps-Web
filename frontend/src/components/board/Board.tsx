import { useEffect, useState } from 'react';
import type { Task, TaskStatus } from '../../types';
import { STATUS_ORDER, STATUS_META } from '../../lib/meta';
import { TaskCard } from './TaskCard';
import { Icon } from '../../ui/Icon';
import { cn } from '../../lib/cn';

interface Props {
  tasks: Task[];
  projectKey: string;
  /** False for viewers / closed projects: cards aren't draggable at all. */
  canMove: boolean;
  onOpen: (taskId: string) => void;
  /**
   * Drop handler: `targetIndex` is the insertion index within the target
   * column's visible cards (the dragged card itself excluded).
   */
  onMove: (taskId: string, status: TaskStatus, targetIndex: number) => void;
  onQuickAdd: (status: TaskStatus) => void;
}

/**
 * Display order within a column — must mirror the server's orderBy
 * (position asc, createdAt desc, id asc) so optimistic position updates
 * re-render exactly like the next fetch would.
 */
export function byBoardOrder(a: Task, b: Task): number {
  return (
    a.position - b.position ||
    b.createdAt.localeCompare(a.createdAt) ||
    a.id.localeCompare(b.id)
  );
}

export function Board({ tasks, projectKey, canMove, onOpen, onMove, onQuickAdd }: Props) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [overColumn, setOverColumn] = useState<TaskStatus | null>(null);
  // Card-level hover position while dragging: insert before or after it.
  const [overCard, setOverCard] = useState<{ id: string; before: boolean } | null>(null);

  // Safety net: the optimistic re-render after onMove can re-parent the dragged
  // DOM node, so the source element's onDragEnd handler doesn't always fire.
  // Listening on window catches both `dragend` (cancelled drags) and `drop`
  // anywhere on the page, guaranteeing the visual state resets.
  useEffect(() => {
    const reset = () => {
      setDragging(null);
      setOverColumn(null);
      setOverCard(null);
    };
    window.addEventListener('dragend', reset);
    window.addEventListener('drop', reset);
    return () => {
      window.removeEventListener('dragend', reset);
      window.removeEventListener('drop', reset);
    };
  }, []);

  // include only top-level tasks on the board
  const visible = tasks.filter((t) => !t.parentId);

  return (
    <div className="flex h-full gap-3 overflow-x-auto px-5 py-4 scrollbar-thin">
      {STATUS_ORDER.map((status) => {
        const meta = STATUS_META[status];
        const items = visible.filter((t) => t.status === status).sort(byBoardOrder);
        const isOver = overColumn === status;
        const dropAt = (targetIndex: number) => {
          if (!dragging) return;
          onMove(dragging, status, targetIndex);
          setDragging(null);
          setOverColumn(null);
          setOverCard(null);
        };
        return (
          <section
            key={status}
            onDragOver={(e) => {
              e.preventDefault();
              setOverColumn(status);
            }}
            onDragLeave={() => setOverColumn((c) => (c === status ? null : c))}
            onDrop={(e) => {
              e.preventDefault();
              // Drop on column background → append at the end.
              dropAt(items.filter((t) => t.id !== dragging).length);
            }}
            className={cn(
              // Flex columns: grow to fill wide screens (no dead space on 2K),
              // shrink down to min-w so all six fit on 1080p without a scroll.
              // overflow-x-auto on the parent is the safety net below that floor.
              'flex h-full min-w-[15rem] flex-1 flex-col rounded-lg border border-line bg-paper/60 transition',
              isOver && 'border-ink-muted bg-surface-sunken',
            )}
          >
            <header className="flex items-center justify-between px-3 pt-3 pb-2">
              <div className="flex items-center gap-2 text-sm font-medium text-ink">
                <span className={cn('h-2 w-2 rounded-full', meta.dot)} />
                {meta.label}
                <span className="ml-1 font-mono text-[11px] text-ink-subtle">
                  {items.length}
                </span>
              </div>
              <button
                onClick={() => onQuickAdd(status)}
                className="rounded-sm p-0.5 text-ink-muted hover:bg-surface hover:text-ink"
                title="Add task in this column"
                aria-label="Add task"
              >
                <Icon.Plus size={14} />
              </button>
            </header>

            <div className="flex-1 space-y-2 overflow-y-auto px-2.5 pb-3 pt-1 scrollbar-thin">
              {items.map((task) => {
                const indicator =
                  dragging && dragging !== task.id && overCard?.id === task.id
                    ? overCard.before
                      ? 'above'
                      : 'below'
                    : null;
                return (
                  <div
                    key={task.id}
                    className="relative"
                    onDragOver={(e) => {
                      if (!dragging || dragging === task.id) return;
                      e.preventDefault();
                      e.stopPropagation();
                      const rect = e.currentTarget.getBoundingClientRect();
                      setOverColumn(status);
                      setOverCard({
                        id: task.id,
                        before: e.clientY < rect.top + rect.height / 2,
                      });
                    }}
                    onDrop={(e) => {
                      if (!dragging || dragging === task.id) return;
                      e.preventDefault();
                      e.stopPropagation();
                      const others = items.filter((t) => t.id !== dragging);
                      const idx = others.findIndex((t) => t.id === task.id);
                      const before = overCard?.id === task.id ? overCard.before : true;
                      dropAt(idx === -1 ? others.length : before ? idx : idx + 1);
                    }}
                  >
                    {indicator === 'above' && <DropLine className="-top-[5px]" />}
                    <TaskCard
                      task={task}
                      projectKey={projectKey}
                      draggable={canMove}
                      onClick={() => onOpen(task.id)}
                      onDragStart={() => setDragging(task.id)}
                      onDragEnd={() => setDragging(null)}
                      dragging={dragging === task.id}
                    />
                    {indicator === 'below' && <DropLine className="-bottom-[5px]" />}
                  </div>
                );
              })}
              {/* Always offer an add affordance at the bottom of the column —
                  not just when it's empty — so a populated column never hides
                  the way to create the next task. Taller when empty so it still
                  reads as the column's empty state. */}
              <button
                onClick={() => onQuickAdd(status)}
                className={cn(
                  'w-full rounded-md border border-dashed border-line text-xs text-ink-subtle transition hover:border-ink-muted hover:text-ink',
                  items.length === 0 ? 'py-6' : 'py-2',
                )}
              >
                + Add task
              </button>
            </div>
          </section>
        );
      })}
    </div>
  );
}

function DropLine({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'pointer-events-none absolute inset-x-1 z-10 h-0.5 rounded-full bg-blurple',
        className,
      )}
    />
  );
}
