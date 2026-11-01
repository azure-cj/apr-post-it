import { Button, Chip } from '../../components';
import { addWeeks, weekLabel, weekOf } from '@/core/week';
import { ManagerIcon } from './ManagerIcon';
import './DayPicker.css';

export interface WeekPickerProps {
  /** The week shown: its Monday, yyyy-MM-dd. */
  readonly week: string;
  /** Today on the tracker's calendar, yyyy-MM-dd. From Saturday, "This week" is the coming one. */
  readonly today: string;
  /** Asks for another week (a Monday). The caller decides whether to go there. */
  readonly onChange: (week: string) => void;
  /** Names the control for screen readers: "Week". */
  readonly label?: string | undefined;
}

/**
 * ‹ 2–6 Nov ›, then This week and Next week. The chip for the week shown is
 * selected, so "next week" is said in words as well as by the dates.
 */
export function WeekPicker({ week, today, onChange, label = 'Week' }: WeekPickerProps) {
  const current = weekOf(today);
  const quick = [
    { label: 'This week', week: current },
    { label: 'Next week', week: addWeeks(current, 1) },
  ];
  return (
    <div className="day-picker week-picker" role="group" aria-label={label}>
      <div className="day-picker__stepper">
        <Button
          size="small"
          className="day-picker__step"
          icon={<ManagerIcon name="chevronLeft" size={20} />}
          onClick={() => onChange(addWeeks(week, -1))}
        >
          <span className="visually-hidden">Week before</span>
        </Button>
        <span className="day-picker__date week-picker__label tabular" aria-live="polite" aria-atomic="true">
          {weekLabel(week)}
        </span>
        <Button
          size="small"
          className="day-picker__step"
          icon={<ManagerIcon name="chevronRight" size={20} />}
          onClick={() => onChange(addWeeks(week, 1))}
        >
          <span className="visually-hidden">Week after</span>
        </Button>
      </div>
      <div className="day-picker__quick">
        {quick.map((q) => (
          <Chip
            key={q.label}
            selected={week === q.week}
            onSelectedChange={() => {
              if (week !== q.week) onChange(q.week);
            }}
          >
            {q.label}
          </Chip>
        ))}
      </div>
    </div>
  );
}
