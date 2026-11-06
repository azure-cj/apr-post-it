import { Button, Chip } from '../../components';
import { QUEUE_WEEK_CHOICES, periodLabel, type QueuePeriod } from '@/core/queues';
import { ManagerIcon } from './ManagerIcon';
import './DayPicker.css';

export interface QueuePickerProps {
  /** The queue shown. */
  readonly period: Pick<QueuePeriod, 'start' | 'due'>;
  /** The week key of the queue before it, if any. */
  readonly prev: string | undefined;
  /** The week key of the queue after it (a saved one, or a new one), if any. */
  readonly next: string | undefined;
  /** The queue shown is the one running now (or the next to start). */
  readonly current: boolean;
  /** The week key of the current queue, for the Current chip. */
  readonly currentKey: string;
  /** Asks for another queue, by its week key. The caller decides whether to go there. */
  readonly onChange: (week: string) => void;
}

/**
 * ‹ 6–19 Nov › and Current: one person's queues, one at a time. A queue may
 * run 1 to 3 weeks, so the arrows step queue by queue, not week by week.
 */
export function QueuePicker({ period, prev, next, current, currentKey, onChange }: QueuePickerProps) {
  return (
    <div className="day-picker week-picker" role="group" aria-label="Queue">
      <div className="day-picker__stepper">
        <Button
          size="small"
          className="day-picker__step"
          icon={<ManagerIcon name="chevronLeft" size={20} />}
          disabled={prev === undefined}
          onClick={() => prev !== undefined && onChange(prev)}
        >
          <span className="visually-hidden">Queue before</span>
        </Button>
        <span className="day-picker__date week-picker__label tabular" aria-live="polite" aria-atomic="true">
          {periodLabel(period)}
        </span>
        <Button
          size="small"
          className="day-picker__step"
          icon={<ManagerIcon name="chevronRight" size={20} />}
          disabled={next === undefined}
          onClick={() => next !== undefined && onChange(next)}
        >
          <span className="visually-hidden">Queue after</span>
        </Button>
      </div>
      <div className="day-picker__quick">
        <Chip
          selected={current}
          onSelectedChange={() => {
            if (!current) onChange(currentKey);
          }}
        >
          Current
        </Chip>
      </div>
    </div>
  );
}

export interface LengthPickerProps {
  /** The length chosen, in weeks. */
  readonly weeks: number;
  /** The lengths that may be chosen now; the rest are shown, but off. */
  readonly allowed: (weeks: number) => boolean;
  readonly onChange: (weeks: number) => void;
  readonly disabled?: boolean | undefined;
}

/** Length: 1 wk, 2 wks, 3 wks. How long the queue runs, in weeks of working days. */
export function LengthPicker({ weeks, allowed, onChange, disabled = false }: LengthPickerProps) {
  return (
    <div className="queue-length" role="group" aria-label="Queue length">
      <span className="queue-length__label" aria-hidden="true">
        Length
      </span>
      {QUEUE_WEEK_CHOICES.map((n) => (
        <Chip
          key={n}
          className="queue-length__chip"
          selected={weeks === n}
          disabled={disabled || (weeks !== n && !allowed(n))}
          aria-label={n === 1 ? '1 week' : `${n} weeks`}
          onSelectedChange={() => {
            if (weeks !== n) onChange(n);
          }}
        >
          {n === 1 ? '1 wk' : `${n} wks`}
        </Chip>
      ))}
    </div>
  );
}
