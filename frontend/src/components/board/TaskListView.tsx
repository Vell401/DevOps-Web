import type { Task } from '../../types';
import { AvatarStack } from '../../ui/Avatar';
import { StatusBadge } from '../../ui/StatusBadge';
import { PriorityFlag } from '../../ui/PriorityFlag';
import { LabelChip } from '../../ui/LabelChip';
import { Icon } from '../../ui/Icon';
import { formatDate } from '../../lib/format';
import { cn } from '../../lib/cn';

interface Props {
  tasks: Task[];
  projectKey: string;
  onOpen: (taskId: string) => void;
}

export function TaskListView({ tasks, projectKey, onOpen }: Props) {
  const visible = tasks.filter((t) => !t.parentId);
  return (
    <div className="flex-1 overflow-y-auto px-5 py-4">
      <div className="overflow-hidden rounded-lg border border-line bg-surface shadow-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-subtle">
              <Th className="w-20">Key</Th>
              <Th>Title</Th>
              <Th className="w-32">Status</Th>
              <Th className="w-28">Priority</Th>
              <Th className="w-44">Labels</Th>
              <Th className="w-36">Assignee</Th>
              <Th className="w-24">Due</Th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-sm text-ink-muted">
                  No tasks match the current filters.
                </td>
              </tr>
            )}
            {visible.map((t) => {
              const overdue =
                t.dueDate && t.status !== 'DONE' && new Date(t.dueDate) < new Date();
              return (
                <tr
                  key={t.id}
                  onClick={() => onOpen(t.id)}
                  className="cursor-pointer border-b border-line/70 transition last:border-0 hover:bg-surface-sunken/60"
                >
                  <Td>
                    <span className="font-mono text-xs uppercase text-ink-muted">
                      {projectKey}-{t.number}
                    </span>
                  </Td>
                  <Td>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-ink line-clamp-1">{t.title}</span>
                      {t._count && t._count.subtasks > 0 && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-ink-subtle">
                          <Icon.Branch size={11} /> {t._count.subtasks}
                        </span>
                      )}
                      {t._count && t._count.comments > 0 && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-ink-subtle">
                          <Icon.Activity size={11} /> {t._count.comments}
                        </span>
                      )}
                    </div>
                  </Td>
                  <Td>
                    <StatusBadge status={t.status} variant="inline" />
                  </Td>
                  <Td>
                    <PriorityFlag priority={t.priority} />
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {t.labels.slice(0, 3).map((l) => (
                        <LabelChip key={l.id} label={l} />
                      ))}
                      {t.labels.length > 3 && (
                        <span className="chip bg-chip-gray text-ink-muted">
                          +{t.labels.length - 3}
                        </span>
                      )}
                    </div>
                  </Td>
                  <Td>
                    {t.assignees.length > 0 ? (
                      <span className="inline-flex items-center gap-2">
                        <AvatarStack users={t.assignees} size="xs" max={3} />
                        {t.assignees.length === 1 && (
                          <span className="text-xs text-ink line-clamp-1">
                            {t.assignees[0].name}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-xs text-ink-subtle">Unassigned</span>
                    )}
                  </Td>
                  <Td>
                    <span
                      className={cn(
                        'text-xs',
                        overdue ? 'text-[#883128]' : 'text-ink-muted',
                      )}
                    >
                      {formatDate(t.dueDate)}
                    </span>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={cn('px-3 py-2 text-left font-medium', className)}>
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-2 align-middle">{children}</td>;
}
