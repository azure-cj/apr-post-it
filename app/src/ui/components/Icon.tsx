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
  | 'inbox';

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
