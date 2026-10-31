import type { ReactElement } from 'react';

/**
 * Icons the manager screens need that the kit's Icon doesn't draw, in the
 * same hand: a 24px grid, a 1.75 stroke in currentColor, always decorative.
 * Whatever sits beside one, or the button's accessible name, says what it is.
 */
export type ManagerIconName = 'chevronLeft' | 'chevronRight' | 'chevronUp' | 'chevronDown' | 'grip';

const paths: Record<ManagerIconName, ReactElement> = {
  chevronLeft: <path d="m14.5 6-6 6 6 6" />,
  chevronRight: <path d="m9.5 6 6 6-6 6" />,
  chevronUp: <path d="m6 14.5 6-6 6 6" />,
  chevronDown: <path d="m6 9.5 6 6 6-6" />,
  grip: (
    <>
      <circle cx="9" cy="6.5" r="0.9" />
      <circle cx="15" cy="6.5" r="0.9" />
      <circle cx="9" cy="12" r="0.9" />
      <circle cx="15" cy="12" r="0.9" />
      <circle cx="9" cy="17.5" r="0.9" />
      <circle cx="15" cy="17.5" r="0.9" />
    </>
  ),
};

export interface ManagerIconProps {
  readonly name: ManagerIconName;
  readonly size?: number | undefined;
  readonly className?: string | undefined;
}

export function ManagerIcon({ name, size = 20, className }: ManagerIconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === 'grip' ? 2.25 : 1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name]}
    </svg>
  );
}
