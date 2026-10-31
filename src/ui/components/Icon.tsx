import type { ReactElement } from 'react';

/**
 * The few line icons the components need, drawn on a 24px grid with a 1.75
 * stroke in `currentColor`. Always decorative: whatever the icon sits beside
 * names the thing. Status icons differ in shape as well as colour (a circle
 * with a tick, a triangle, a circle with a cross), so status never rests on
 * colour alone.
 */
export type IconName =
  | 'search'
  | 'close'
  | 'check'
  | 'pass'
  | 'warn'
  | 'fail'
  | 'info'
  | 'signOut'
  | 'inbox'
  | 'tracker'
  | 'assign'
  | 'interns'
  | 'settings'
  | 'sidebar'
  | 'refresh';

const paths: Record<IconName, ReactElement> = {
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.35-4.35" />
    </>
  ),
  close: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  pass: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.25 12.25 2.5 2.5 5-5.25" />
    </>
  ),
  warn: (
    <>
      <path d="M10.29 4.21 2.82 17.14A2 2 0 0 0 4.55 20.14h14.9a2 2 0 0 0 1.73-3L13.71 4.21a2 2 0 0 0-3.42 0Z" />
      <path d="M12 9.5v4" />
      <path d="M12 17h.01" />
    </>
  ),
  fail: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m9.25 9.25 5.5 5.5M14.75 9.25l-5.5 5.5" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </>
  ),
  signOut: (
    <>
      <path d="M9.5 20H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h3.5" />
      <path d="m15.5 16.5 4.5-4.5-4.5-4.5" />
      <path d="M20 12H9.5" />
    </>
  ),
  inbox: (
    <>
      <path d="M3.5 13.5h5l1.5 2.5h4l1.5-2.5h5" />
      <path d="M5.6 5.6 3.5 13.5V18a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-4.5l-2.1-7.9A2 2 0 0 0 16.47 4H7.53a2 2 0 0 0-1.93 1.6Z" />
    </>
  ),
  tracker: (
    <>
      <path d="M4 20h16" />
      <path d="M7 16v-5" />
      <path d="M12 16V6" />
      <path d="M17 16v-3" />
    </>
  ),
  assign: (
    <>
      <path d="M4 6h11" />
      <path d="M4 12h11" />
      <path d="M4 18h7" />
      <path d="M18 14.5v7" />
      <path d="M14.5 18h7" />
    </>
  ),
  interns: (
    <>
      <circle cx="9" cy="8.5" r="3.25" />
      <path d="M3.5 19.5v-.75A4.75 4.75 0 0 1 8.25 14h1.5a4.75 4.75 0 0 1 4.75 4.75v.75" />
      <path d="M15.75 5.6a3.25 3.25 0 0 1 0 5.8" />
      <path d="M17.75 14.25a4.75 4.75 0 0 1 2.75 4.5v.75" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h8.5" />
      <path d="M17.5 7H20" />
      <circle cx="15" cy="7" r="2.5" />
      <path d="M4 17h2.5" />
      <path d="M11.5 17H20" />
      <circle cx="9" cy="17" r="2.5" />
    </>
  ),
  sidebar: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M9.5 4.5v15" />
    </>
  ),
  refresh: (
    <>
      <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
      <path d="M19.5 4.5v4h-4" />
    </>
  ),
};

export interface IconProps {
  readonly name: IconName;
  /** Square size in px. 20 by default; 16 beside small text, 24 in an empty state. */
  readonly size?: number | undefined;
  readonly className?: string | undefined;
}

export function Icon({ name, size = 20, className }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name]}
    </svg>
  );
}
