import type { Task } from '../../types';
import { Avatar } from '../../ui/Avatar';
import { LabelChip } from '../../ui/LabelChip';
import { PriorityFlag } from '../../ui/PriorityFlag';
import { Icon } from '../../ui/Icon';
import { formatDate } from '../../lib/format';
import { cn } from '../../lib/cn';

interface Props {
  task: Task;
  projectKey: string;
  onClick: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  dragging?: boolean;
}

export function TaskCard({
  task,
  projectKey,
  onClick,
  onDragStart,
  onDragEnd,
  dragging,
}: Props) {
  const overdue =
    task.dueDate && task.status !== 'DONE' && new Date(task.dueDate) < new Date();

  return (
    <article
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className={cn(
        'group cursor-grab rounded-md border border-line bg-surface p-3 text-left shadow-card transition hover:border-ink-muted',
        dragging && 'opacity-40',
      )}
    >
      <div className="flex items-center justify-between gap-2 text-[11px] text-ink-subtle">
        <span className="font-mono uppercase">
          {projectKey}-{task.number}
        </span>
        <PriorityFlag priority={task.priority} showLabel={false} />
      </div>

      <h4 className="mt-1.5 line-clamp-3 text-sm font-medium leading-snug text-ink">
        {task.title}
      </h4>

      {task.labels.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {task.labels.slice(0, 3).map((l) => (
            <LabelChip key={l.id} label={l} />
          ))}
          {task.labels.length > 3 && (
            <span className="chip bg-chip-gray text-ink-muted">
              +{task.labels.length - 3}
            </span>
          )}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-ink-muted">
        <div className="flex items-center gap-2.5">
          {task._count && task._count.subtasks > 0 && (
            <span className="inline-flex items-center gap-1" title="Subtasks">
              <Icon.Branch size={12} /> {task._count.subtasks}
            </span>
          )}
          {task._count && task._count.comments > 0 && (
            <span className="inline-flex items-center gap-1" title="Comments">
              <Icon.Activity size={12} /> {task._count.comments}
            </span>
          )}
          {task.dueDate && (
            <span
              className={cn(
                'inline-flex items-center gap-1',
                overdue && 'text-[#883128]',
              )}
              title={overdue ? 'Overdue' : 'Due date'}
            >
              <Icon.Calendar size={12} />
              {formatDate(task.dueDate)}
            </span>
          )}
        </div>
        {task.assignee ? (
          <Avatar
            name={task.assignee.name}
            color={task.assignee.avatarColor}
            size="xs"
          />
        ) : (
          <span className="text-ink-subtle">unassigned</span>
        )}
      </div>
    </article>
  );
}
