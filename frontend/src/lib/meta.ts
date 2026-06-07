import type { LabelColor, TaskPriority, TaskStatus } from '../types';

export const STATUS_ORDER: TaskStatus[] = [
  'BACKLOG',
  'TODO',
  'IN_PROGRESS',
  'IN_REVIEW',
  'BLOCKED',
  'DONE',
];

interface StatusMeta {
  label: string;
  dot: string;
  text: string;
  bg: string;
}

// Discord-flavoured semantic colours:
//   TODO        = blurple (work to do, primary)
//   IN_PROGRESS = idle yellow
//   IN_REVIEW   = purple (review/check)
//   BLOCKED     = dnd red
//   DONE        = online green
//   BACKLOG     = offline grey
export const STATUS_META: Record<TaskStatus, StatusMeta> = {
  BACKLOG: {
    label: 'Backlog',
    dot: 'bg-status-offline',
    text: 'text-ink-subtle',
    bg: 'bg-surface-deep',
  },
  TODO: {
    label: 'To do',
    dot: 'bg-blurple',
    text: 'text-[#A8B0F8]',
    bg: 'bg-chip-blue',
  },
  IN_PROGRESS: {
    label: 'In progress',
    dot: 'bg-status-idle',
    text: 'text-[#F0B232]',
    bg: 'bg-chip-yellow',
  },
  IN_REVIEW: {
    label: 'In review',
    dot: 'bg-[#A78BF7]',
    text: 'text-[#C4B5F7]',
    bg: 'bg-chip-purple',
  },
  BLOCKED: {
    label: 'Blocked',
    dot: 'bg-status-dnd',
    text: 'text-[#F58A8C]',
    bg: 'bg-chip-red',
  },
  DONE: {
    label: 'Done',
    dot: 'bg-status-online',
    text: 'text-[#5DC97A]',
    bg: 'bg-chip-green',
  },
};

export const PRIORITY_ORDER: TaskPriority[] = ['URGENT', 'HIGH', 'MEDIUM', 'LOW'];

export const PRIORITY_META: Record<
  TaskPriority,
  { label: string; tone: string; rank: number }
> = {
  URGENT: { label: 'Urgent', tone: 'text-status-dnd', rank: 0 },
  HIGH: { label: 'High', tone: 'text-status-idle', rank: 1 },
  MEDIUM: { label: 'Medium', tone: 'text-ink-muted', rank: 2 },
  LOW: { label: 'Low', tone: 'text-ink-subtle', rank: 3 },
};

// Chips render as Discord-style role tags:
// dark tinted pad + bright text in the same hue.
export const LABEL_COLORS: Record<
  LabelColor,
  { bg: string; text: string; dot: string }
> = {
  GRAY: { bg: 'bg-chip-gray', text: 'text-ink-muted', dot: 'bg-ink-subtle' },
  BROWN: { bg: 'bg-chip-brown', text: 'text-[#C19A6B]', dot: 'bg-[#A06B3F]' },
  ORANGE: { bg: 'bg-chip-orange', text: 'text-[#F0AE51]', dot: 'bg-[#E07A1A]' },
  YELLOW: { bg: 'bg-chip-yellow', text: 'text-status-idle', dot: 'bg-status-idle' },
  GREEN: { bg: 'bg-chip-green', text: 'text-status-online', dot: 'bg-status-online' },
  BLUE: { bg: 'bg-chip-blue', text: 'text-[#7983F5]', dot: 'bg-blurple' },
  PURPLE: { bg: 'bg-chip-purple', text: 'text-[#A78BF7]', dot: 'bg-[#9B6FE5]' },
  PINK: { bg: 'bg-chip-pink', text: 'text-[#EB6FA5]', dot: 'bg-[#EB459F]' },
  RED: { bg: 'bg-chip-red', text: 'text-status-dnd', dot: 'bg-status-dnd' },
};

// Discord uses solid coloured avatar circles. Saturated mid-tone bg + white text.
export const AVATAR_TINTS: Record<string, string> = {
  gray: 'bg-[#4E5058] text-white',
  green: 'bg-status-online text-white',
  orange: 'bg-[#E0721A] text-white',
  purple: 'bg-[#9B6FE5] text-white',
  blue: 'bg-blurple text-white',
  pink: 'bg-[#EB459F] text-white',
  yellow: 'bg-status-idle text-[#1E1F22]',
  red: 'bg-status-dnd text-white',
};
