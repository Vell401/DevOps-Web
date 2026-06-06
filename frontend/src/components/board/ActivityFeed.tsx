import type { Activity, Label } from '../../types';
import { Avatar } from '../../ui/Avatar';
import { Icon } from '../../ui/Icon';
import { LabelChip } from '../../ui/LabelChip';
import { STATUS_META, PRIORITY_META } from '../../lib/meta';
import type { TaskPriority, TaskStatus, UserLite } from '../../types';
import { timeAgo } from '../../lib/format';

interface Props {
  events: Activity[];
  showTaskRef?: boolean;
  projectKey?: string;
  users?: UserLite[];
  labels?: Label[];
  empty?: string;
}

export function ActivityFeed({
  events,
  showTaskRef = false,
  projectKey,
  users = [],
  labels = [],
  empty = 'No activity yet.',
}: Props) {
  if (!events.length) {
    return <p className="px-2 py-6 text-center text-xs text-ink-subtle">{empty}</p>;
  }
  const userById = new Map(users.map((u) => [u.id, u]));
  const labelById = new Map(labels.map((l) => [l.id, l]));

  return (
    <ol className="space-y-1.5">
      {events.map((ev) => {
        const verb = renderVerb(ev, userById, labelById);
        return (
          <li key={ev.id} className="flex items-start gap-2.5 px-1 py-1.5">
            <Avatar
              name={ev.actor?.name ?? '?'}
              color={ev.actor?.avatarColor}
              size="xs"
              className="mt-0.5"
            />
            <div className="min-w-0 flex-1 text-xs text-ink">
              <p className="leading-relaxed">
                <span className="font-medium">{ev.actor?.name ?? 'Someone'}</span>{' '}
                <span className="text-ink-muted">{verb}</span>
                {showTaskRef && ev.task && projectKey && (
                  <>
                    {' '}
                    <span className="font-mono text-[11px] uppercase text-ink-subtle">
                      {projectKey}-{ev.task.number}
                    </span>
                  </>
                )}
              </p>
              <p className="mt-0.5 text-[11px] text-ink-subtle">{timeAgo(ev.createdAt)}</p>
            </div>
            <Icon.Activity size={12} className="mt-1.5 text-ink-subtle" />
          </li>
        );
      })}
    </ol>
  );
}

function renderVerb(
  ev: Activity,
  userById: Map<string, UserLite>,
  labelById: Map<string, Label>,
): React.ReactNode {
  switch (ev.type) {
    case 'CREATED':
      return 'created the task';
    case 'STATUS_CHANGED':
      return (
        <>
          moved from{' '}
          <span className="text-ink">
            {STATUS_META[(ev.fromValue ?? 'TODO') as TaskStatus]?.label ?? ev.fromValue}
          </span>{' '}
          to{' '}
          <span className="text-ink">
            {STATUS_META[(ev.toValue ?? 'TODO') as TaskStatus]?.label ?? ev.toValue}
          </span>
        </>
      );
    case 'ASSIGNEE_CHANGED': {
      const fromUser = ev.fromValue ? userById.get(ev.fromValue) : undefined;
      const toUser = ev.toValue ? userById.get(ev.toValue) : undefined;
      if (!ev.toValue) return <>unassigned the task</>;
      return (
        <>
          assigned to{' '}
          <span className="text-ink">{toUser?.name ?? 'someone'}</span>
          {fromUser && <> (was {fromUser.name})</>}
        </>
      );
    }
    case 'PRIORITY_CHANGED':
      return (
        <>
          set priority to{' '}
          <span className="text-ink">
            {PRIORITY_META[(ev.toValue ?? 'MEDIUM') as TaskPriority]?.label ?? ev.toValue}
          </span>
        </>
      );
    case 'TITLE_CHANGED':
      return <>renamed the task</>;
    case 'DESCRIPTION_CHANGED':
      return 'edited the description';
    case 'DUE_DATE_CHANGED':
      return ev.toValue ? `set due date to ${new Date(ev.toValue).toLocaleDateString()}` : 'cleared due date';
    case 'LABEL_ADDED': {
      const lbl = ev.toValue ? labelById.get(ev.toValue) : undefined;
      return (
        <>
          added label{' '}
          {lbl ? (
            <LabelChip label={lbl} />
          ) : (
            <span className="text-ink">{ev.toValue}</span>
          )}
        </>
      );
    }
    case 'LABEL_REMOVED': {
      const lbl = ev.fromValue ? labelById.get(ev.fromValue) : undefined;
      return (
        <>
          removed label{' '}
          {lbl ? (
            <LabelChip label={lbl} />
          ) : (
            <span className="text-ink">{ev.fromValue}</span>
          )}
        </>
      );
    }
    case 'PARENT_CHANGED':
      return ev.toValue ? 'moved task under another task' : 'detached task from its parent';
    case 'COMMENT_ADDED':
      return (
        <>
          commented{ev.toValue && ': '}
          {ev.toValue && (
            <span className="italic text-ink">“{ev.toValue}”</span>
          )}
        </>
      );
    default:
      return 'made a change';
  }
}
