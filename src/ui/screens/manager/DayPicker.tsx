import { Button, Chip } from '../../components';
import { addDays, longDate } from '@/core/summary';
import { ManagerIcon } from './ManagerIcon';
import './DayPicker.css';

export type QuickDay = 'today' | 'tomorrow';

export interface DayPickerProps {
  /** The day shown, yyyy-MM-dd. */
  readonly date: string;
  /** Today on the tracker's calendar, yyyy-MM-dd. */
  readonly today: string;
  /** Asks for another day. The caller decides whether to go there. */
  readonly onChange: (date: string) => void;
  /** Names the control for screen readers, and shows above it: "Day". */
  readonly label: string;
  /** Quick picks after the stepper. */
  readonly quick?: readonly QuickDay[] | undefined;
}

const quickLabels: Record<QuickDay, string> = { today: 'Today', tomorrow: 'Tomorrow' };

/**
 * A day, a step back, a step on, and a chip or two for the days people mean
 * most. The chip for the day shown is selected, so "tomorrow" is said in
 * words as well as by the date.
 */
export function DayPicker({ date, today, onChange, label, quick = ['today'] }: DayPickerProps) {
  const target = (q: QuickDay) => (q === 'today' ? today : addDays(today, 1));
  return (
    <div className="day-picker" role="group" aria-label={label}>
      <div className="day-picker__stepper">
        <Button
          size="small"
          className="day-picker__step"
          icon={<ManagerIcon name="chevronLeft" size={20} />}
          onClick={() => onChange(addDays(date, -1))}
        >
          <span className="visually-hidden">Previous day</span>
        </Button>
        <span className="day-picker__date tabular" aria-live="polite" aria-atomic="true">
          {longDate(date)}
        </span>
        <Button
          size="small"
          className="day-picker__step"
          icon={<ManagerIcon name="chevronRight" size={20} />}
          onClick={() => onChange(addDays(date, 1))}
        >
          <span className="visually-hidden">Next day</span>
        </Button>
      </div>
      {quick.length > 0 ? (
        <div className="day-picker__quick">
          {quick.map((q) => {
            const day = target(q);
            return (
              <Chip
                key={q}
                selected={date === day}
                onSelectedChange={() => {
                  if (date !== day) onChange(day);
                }}
              >
                {quickLabels[q]}
              </Chip>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
