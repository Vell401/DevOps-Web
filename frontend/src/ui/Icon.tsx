import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Base({ size = 16, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...rest}
    >
      {children}
    </svg>
  );
}

export const Icon = {
  Plus: (p: IconProps) => (
    <Base {...p}>
      <path d="M12 5v14M5 12h14" />
    </Base>
  ),
  Close: (p: IconProps) => (
    <Base {...p}>
      <path d="M6 6l12 12M6 18L18 6" />
    </Base>
  ),
  Check: (p: IconProps) => (
    <Base {...p}>
      <path d="M5 12l5 5L20 7" />
    </Base>
  ),
  Search: (p: IconProps) => (
    <Base {...p}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </Base>
  ),
  Filter: (p: IconProps) => (
    <Base {...p}>
      <path d="M4 5h16M7 12h10M10 19h4" />
    </Base>
  ),
  Board: (p: IconProps) => (
    <Base {...p}>
      <rect x="3" y="4" width="5" height="16" rx="1.5" />
      <rect x="10" y="4" width="5" height="10" rx="1.5" />
      <rect x="17" y="4" width="4" height="6" rx="1.5" />
    </Base>
  ),
  List: (p: IconProps) => (
    <Base {...p}>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </Base>
  ),
  Activity: (p: IconProps) => (
    <Base {...p}>
      <path d="M3 12h4l3-9 4 18 3-9h4" />
    </Base>
  ),
  Layers: (p: IconProps) => (
    <Base {...p}>
      <path d="M12 3l9 5-9 5-9-5 9-5z" />
      <path d="M3 13l9 5 9-5" />
    </Base>
  ),
  ArrowLeft: (p: IconProps) => (
    <Base {...p}>
      <path d="M19 12H5M12 19l-7-7 7-7" />
    </Base>
  ),
  ArrowRight: (p: IconProps) => (
    <Base {...p}>
      <path d="M5 12h14M12 5l7 7-7 7" />
    </Base>
  ),
  Caret: (p: IconProps) => (
    <Base {...p}>
      <path d="M6 9l6 6 6-6" />
    </Base>
  ),
  Dots: (p: IconProps) => (
    <Base {...p}>
      <circle cx="5" cy="12" r="1.2" fill="currentColor" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" />
      <circle cx="19" cy="12" r="1.2" fill="currentColor" />
    </Base>
  ),
  Trash: (p: IconProps) => (
    <Base {...p}>
      <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
    </Base>
  ),
  User: (p: IconProps) => (
    <Base {...p}>
      <circle cx="12" cy="8" r="4" />
      <path d="M3 21c2-4 6-6 9-6s7 2 9 6" />
    </Base>
  ),
  Calendar: (p: IconProps) => (
    <Base {...p}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </Base>
  ),
  Flag: (p: IconProps) => (
    <Base {...p}>
      <path d="M5 21V4l14 2-3 4 3 4-14-2" />
    </Base>
  ),
  Tag: (p: IconProps) => (
    <Base {...p}>
      <path d="M3 12V4h8l10 10-8 8L3 12z" />
      <circle cx="8" cy="8" r="1.5" />
    </Base>
  ),
  Branch: (p: IconProps) => (
    <Base {...p}>
      <circle cx="6" cy="5" r="2" />
      <circle cx="6" cy="19" r="2" />
      <circle cx="18" cy="12" r="2" />
      <path d="M6 7v10M6 12c0-4 6-3 10-3" />
    </Base>
  ),
  Sparkle: (p: IconProps) => (
    <Base {...p}>
      <path d="M12 3l1.8 4.6L18 9.5l-4.2 1.9L12 16l-1.8-4.6L6 9.5l4.2-1.9L12 3z" />
      <path d="M19 16l.9 1.9L22 19l-2.1 1.1L19 22l-.9-1.9L16 19l2.1-1.1L19 16z" />
    </Base>
  ),
  Logout: (p: IconProps) => (
    <Base {...p}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5M21 12H9" />
    </Base>
  ),
  Bell: (p: IconProps) => (
    <Base {...p}>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </Base>
  ),
  Paperclip: (p: IconProps) => (
    <Base {...p}>
      <path d="M21 11.5l-8.6 8.6a5 5 0 0 1-7.1-7.1l9-9a3.5 3.5 0 0 1 5 5l-9 9a2 2 0 0 1-2.9-2.9l8.1-8.1" />
    </Base>
  ),
  Download: (p: IconProps) => (
    <Base {...p}>
      <path d="M12 4v11M7 11l5 5 5-5M5 20h14" />
    </Base>
  ),
  File: (p: IconProps) => (
    <Base {...p}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z" />
      <path d="M14 3v5h5" />
    </Base>
  ),
};
