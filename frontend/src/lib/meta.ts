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

export const STATUS_META: Record<TaskStatus, StatusMeta> = {
  BACKLOG: {
    label: 'Backlog',
    dot: 'bg-ink-subtle',
    text: 'text-ink-muted',
    bg: 'bg-surface-sunken',
  },
  TODO: {
    label: 'To do',
    dot: 'bg-[#7C9BB8]',
    text: 'text-[#34526F]',
    bg: 'bg-chip-blue',
  },
  IN_PROGRESS: {
    label: 'In progress',
    dot: 'bg-sun-400',
    text: 'text-[#7D5E11]',
    bg: 'bg-sun-100',
  },
  IN_REVIEW: {
    label: 'In review',
    dot: 'bg-[#9F86C8]',
    text: 'text-[#54399A]',
    bg: 'bg-chip-purple',
  },
  BLOCKED: {
    label: 'Blocked',
    dot: 'bg-[#C7625A]',
    text: 'text-[#883128]',
    bg: 'bg-chip-red',
  },
  DONE: {
    label: 'Done',
    dot: 'bg-leaf-400',
    text: 'text-[#1B6A48]',
    bg: 'bg-chip-green',
  },
};

export const PRIORITY_ORDER: TaskPriority[] = ['URGENT', 'HIGH', 'MEDIUM', 'LOW'];

export const PRIORITY_META: Record<
  TaskPriority,
  { label: string; tone: string; rank: number }
> = {
  URGENT: { label: 'Urgent', tone: 'text-[#883128]', rank: 0 },
  HIGH: { label: 'High', tone: 'text-[#7D5E11]', rank: 1 },
  MEDIUM: { label: 'Medium', tone: 'text-ink-muted', rank: 2 },
  LOW: { label: 'Low', tone: 'text-ink-subtle', rank: 3 },
};

export const LABEL_COLORS: Record<
  LabelColor,
  { bg: string; text: string; dot: string }
> = {
  GRAY: { bg: 'bg-chip-gray', text: 'text-ink', dot: 'bg-ink-muted' },
  BROWN: { bg: 'bg-chip-brown', text: 'text-[#6B4626]', dot: 'bg-[#A06B3F]' },
  ORANGE: { bg: 'bg-chip-orange', text: 'text-[#8A4B11]', dot: 'bg-[#D38133]' },
  YELLOW: { bg: 'bg-chip-yellow', text: 'text-[#7D5E11]', dot: 'bg-sun-400' },
  GREEN: { bg: 'bg-chip-green', text: 'text-[#1B6A48]', dot: 'bg-leaf-400' },
  BLUE: { bg: 'bg-chip-blue', text: 'text-[#34526F]', dot: 'bg-[#7C9BB8]' },
  PURPLE: { bg: 'bg-chip-purple', text: 'text-[#54399A]', dot: 'bg-[#9F86C8]' },
  PINK: { bg: 'bg-chip-pink', text: 'text-[#8C3B5B]', dot: 'bg-[#C97D9C]' },
  RED: { bg: 'bg-chip-red', text: 'text-[#883128]', dot: 'bg-[#C7625A]' },
};

export const AVATAR_TINTS: Record<string, string> = {
  gray: 'bg-chip-gray text-ink',
  green: 'bg-chip-green text-[#1B6A48]',
  orange: 'bg-chip-orange text-[#8A4B11]',
  purple: 'bg-chip-purple text-[#54399A]',
  blue: 'bg-chip-blue text-[#34526F]',
  pink: 'bg-chip-pink text-[#8C3B5B]',
  yellow: 'bg-chip-yellow text-[#7D5E11]',
  red: 'bg-chip-red text-[#883128]',
};
