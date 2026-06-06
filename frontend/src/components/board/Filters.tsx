import type { Label, TaskPriority, UserLite } from '../../types';
import { Icon } from '../../ui/Icon';
import { Avatar } from '../../ui/Avatar';
import { Popover, PopoverItem } from '../../ui/Popover';
import { LabelChip } from '../../ui/LabelChip';
import { PRIORITY_META, PRIORITY_ORDER } from '../../lib/meta';
import { cn } from '../../lib/cn';

export interface FilterState {
  q: string;
  assigneeId?: string;
  labelIds: string[];
  priority?: TaskPriority;
}

interface Props {
  filters: FilterState;
  onChange: (f: FilterState) => void;
  users: UserLite[];
  labels: Label[];
}

export function Filters({ filters, onChange, users, labels }: Props) {
  const assignee = users.find((u) => u.id === filters.assigneeId);
  const activeLabels = labels.filter((l) => filters.labelIds.includes(l.id));

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line bg-paper/60 px-5 py-2.5">
      <div className="relative">
        <Icon.Search
          size={14}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-subtle"
        />
        <input
          value={filters.q}
          onChange={(e) => onChange({ ...filters, q: e.target.value })}
          placeholder="Filter by text…"
          className="h-7 w-56 rounded-md border border-line bg-surface pl-7 pr-2 text-xs text-ink placeholder:text-ink-subtle focus:border-ink-muted focus-visible:shadow-focus"
        />
      </div>

      <Popover
        trigger={({ toggle, open }) => (
          <button
            onClick={toggle}
            className={cn(
              'btn-secondary h-7 px-2 text-xs',
              (assignee || open) && 'border-ink-muted',
            )}
          >
            <Icon.User size={12} />
            {assignee ? assignee.name : 'Assignee'}
            {assignee && (
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  onChange({ ...filters, assigneeId: undefined });
                }}
                className="ml-1 cursor-pointer text-ink-subtle hover:text-ink"
              >
                ×
              </span>
            )}
          </button>
        )}
      >
        {(close) => (
          <>
            <PopoverItem
              onClick={() => {
                onChange({ ...filters, assigneeId: undefined });
                close();
              }}
            >
              Any assignee
            </PopoverItem>
            {users.map((u) => (
              <PopoverItem
                key={u.id}
                onClick={() => {
                  onChange({ ...filters, assigneeId: u.id });
                  close();
                }}
                active={filters.assigneeId === u.id}
                icon={<Avatar name={u.name} color={u.avatarColor} size="xs" />}
              >
                {u.name}
              </PopoverItem>
            ))}
          </>
        )}
      </Popover>

      <Popover
        trigger={({ toggle, open }) => (
          <button
            onClick={toggle}
            className={cn(
              'btn-secondary h-7 px-2 text-xs',
              (activeLabels.length > 0 || open) && 'border-ink-muted',
            )}
          >
            <Icon.Tag size={12} />
            {activeLabels.length === 0
              ? 'Labels'
              : activeLabels.length === 1
                ? activeLabels[0].name
                : `${activeLabels.length} labels`}
          </button>
        )}
      >
        {(close) => (
          <>
            {labels.length === 0 && (
              <div className="px-2 py-1.5 text-xs text-ink-subtle">No labels yet</div>
            )}
            {labels.map((l) => {
              const active = filters.labelIds.includes(l.id);
              return (
                <PopoverItem
                  key={l.id}
                  active={active}
                  onClick={() => {
                    const next = active
                      ? filters.labelIds.filter((x) => x !== l.id)
                      : [...filters.labelIds, l.id];
                    onChange({ ...filters, labelIds: next });
                  }}
                  icon={
                    <span className="inline-flex h-4 w-4 items-center justify-center">
                      {active ? <Icon.Check size={12} /> : null}
                    </span>
                  }
                >
                  <LabelChip label={l} />
                </PopoverItem>
              );
            })}
            {activeLabels.length > 0 && (
              <>
                <hr className="my-1 border-line" />
                <PopoverItem
                  onClick={() => {
                    onChange({ ...filters, labelIds: [] });
                    close();
                  }}
                  danger
                >
                  Clear labels
                </PopoverItem>
              </>
            )}
          </>
        )}
      </Popover>

      <Popover
        trigger={({ toggle, open }) => (
          <button
            onClick={toggle}
            className={cn(
              'btn-secondary h-7 px-2 text-xs',
              (filters.priority || open) && 'border-ink-muted',
            )}
          >
            <Icon.Flag size={12} />
            {filters.priority ? PRIORITY_META[filters.priority].label : 'Priority'}
            {filters.priority && (
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  onChange({ ...filters, priority: undefined });
                }}
                className="ml-1 cursor-pointer text-ink-subtle hover:text-ink"
              >
                ×
              </span>
            )}
          </button>
        )}
      >
        {(close) => (
          <>
            <PopoverItem
              onClick={() => {
                onChange({ ...filters, priority: undefined });
                close();
              }}
            >
              Any priority
            </PopoverItem>
            {PRIORITY_ORDER.map((p) => (
              <PopoverItem
                key={p}
                active={filters.priority === p}
                onClick={() => {
                  onChange({ ...filters, priority: p });
                  close();
                }}
              >
                {PRIORITY_META[p].label}
              </PopoverItem>
            ))}
          </>
        )}
      </Popover>

      {(filters.q ||
        filters.assigneeId ||
        filters.priority ||
        filters.labelIds.length > 0) && (
        <button
          onClick={() =>
            onChange({ q: '', assigneeId: undefined, labelIds: [], priority: undefined })
          }
          className="btn-ghost h-7 px-2 text-xs"
        >
          Reset
        </button>
      )}
    </div>
  );
}
