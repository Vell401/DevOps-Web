import { useEffect, useState } from 'react';
import type { Task, TaskStatus } from '../../types';
import { STATUS_ORDER, STATUS_META } from '../../lib/meta';
import { TaskCard } from './TaskCard';
import { Icon } from '../../ui/Icon';
import { cn } from '../../lib/cn';

interface Props {
  tasks: Task[];
  projectKey: string;
  onOpen: (taskId: string) => void;
  onMove: (taskId: string, status: TaskStatus) => void;
  onQuickAdd: (status: TaskStatus) => void;
}

export function Board({ tasks, projectKey, onOpen, onMove, onQuickAdd }: Props) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [overColumn, setOverColumn] = useState<TaskStatus | null>(null);

  // Safety net: the optimistic re-render after onMove can re-parent the dragged
  // DOM node, so the source element's onDragEnd handler doesn't always fire.
  // Listening on window catches both `dragend` (cancelled drags) and `drop`
  // anywhere on the page, guaranteeing the visual state resets.
  useEffect(() => {
    const reset = () => {
      setDragging(null);
      setOverColumn(null);
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
        const items = visible.filter((t) => t.status === status);
        const isOver = overColumn === status;
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
              setOverColumn(null);
              if (dragging) onMove(dragging, status);
              setDragging(null);
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
              {items.length === 0 && (
                <button
                  onClick={() => onQuickAdd(status)}
                  className="w-full rounded-md border border-dashed border-line py-6 text-xs text-ink-subtle hover:border-ink-muted hover:text-ink"
                >
                  + Add task
                </button>
              )}
              {items.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  projectKey={projectKey}
                  onClick={() => onOpen(task.id)}
                  onDragStart={() => setDragging(task.id)}
                  onDragEnd={() => setDragging(null)}
                  dragging={dragging === task.id}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
