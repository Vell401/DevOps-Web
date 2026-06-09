import { cn } from '../lib/cn';
import { initialsOf } from '../lib/format';
import { AVATAR_TINTS } from '../lib/meta';

interface AvatarProps {
  name: string;
  color?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
  title?: string;
}

const SIZES = {
  xs: 'h-5 w-5 text-[10px]',
  sm: 'h-6 w-6 text-[11px]',
  md: 'h-8 w-8 text-xs',
  lg: 'h-16 w-16 text-xl',
};

export function Avatar({ name, color = 'gray', size = 'sm', className, title }: AvatarProps) {
  const tint = AVATAR_TINTS[color] ?? AVATAR_TINTS.gray;
  return (
    <span
      title={title ?? name}
      className={cn(
        'inline-flex select-none items-center justify-center rounded-full font-medium ring-1 ring-line',
        SIZES[size],
        tint,
        className,
      )}
    >
      {initialsOf(name)}
    </span>
  );
}

interface AvatarStackProps {
  users: { id: string; name: string; avatarColor?: string }[];
  max?: number;
  size?: 'xs' | 'sm' | 'md';
}

export function AvatarStack({ users, max = 3, size = 'sm' }: AvatarStackProps) {
  const visible = users.slice(0, max);
  const overflow = users.length - visible.length;
  return (
    <span className="inline-flex -space-x-1.5">
      {visible.map((u) => (
        <Avatar key={u.id} name={u.name} color={u.avatarColor} size={size} />
      ))}
      {overflow > 0 && (
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-surface text-[10px] text-ink-muted ring-1 ring-line">
          +{overflow}
        </span>
      )}
    </span>
  );
}
