import type { CheckResult, CheckStatus } from '@/core/types';
import { Icon, type IconName } from './Icon';
import './CheckList.css';

export interface CheckListProps {
  readonly checks: readonly CheckResult[];
  /** Names the list for screen readers: "Pre-post checks". */
  readonly label?: string | undefined;
  /** Shown when there are no checks. */
  readonly emptyText?: string | undefined;
  readonly className?: string | undefined;
}

const icon: Record<CheckStatus, IconName> = {
  pass: 'pass',
  warn: 'warn',
  fail: 'fail',
};

/** Said to screen readers after the check's name, in place of the icon. */
const statusWord: Record<CheckStatus, string> = {
  pass: 'passed',
  warn: 'look again',
  fail: 'failed',
};

/**
 * The pre-post checks as lines: pass, warn, fail. Shown in the order given,
 * so a check is always in the same place. A fail blocks Copy, so its line is
 * tinted and found first; each status also has its own icon shape and word.
 */
export function CheckList({ checks, label = 'Checks', emptyText = 'No checks to show.', className }: CheckListProps) {
  if (checks.length === 0) {
    return <p className={['checklist-empty', className].filter(Boolean).join(' ')}>{emptyText}</p>;
  }

  return (
    <ul className={['checklist', className].filter(Boolean).join(' ')} aria-label={label}>
      {checks.map((check, index) => (
        <li key={`${index}-${check.name}`} className={`checklist__line checklist__line--${check.status}`}>
          <Icon name={icon[check.status]} className="checklist__icon" />
          <span className="checklist__text">
            <span className="checklist__name">
              {check.name}
              <span className="visually-hidden">: {statusWord[check.status]}.</span>
            </span>
            {check.detail ? <span className="checklist__detail">{check.detail}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
