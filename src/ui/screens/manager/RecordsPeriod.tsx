import { useId } from 'react';
import { Button, Chip } from '../../components';
import {
  canStepForward,
  customPeriod,
  PERIOD_PRESETS,
  periodLabel,
  presetOf,
  presetPeriod,
  stepPeriod,
  type Period,
} from '@/core/records';
import { isDate } from '@/core/summary';
import { ManagerIcon } from './ManagerIcon';
import './DayPicker.css';

export interface RecordsPeriodProps {
  readonly period: Period;
  readonly today: string;
  readonly onChange: (period: Period) => void;
}

const STEP_WORDS: Record<Period['kind'], readonly [string, string]> = {
  week: ['Week before', 'Week after'],
  month: ['Month before', 'Month after'],
  days: ['30 days before', '30 days after'],
  custom: ['Period before', 'Period after'],
};

/**
 * ‹ "2–6 Nov" ›, then the presets as chips, the one shown selected. Custom
 * adds two dates. The arrows step the period the way it was chosen.
 */
export function RecordsPeriod({ period, today, onChange }: RecordsPeriodProps) {
  const preset = presetOf(period, today);
  const fromId = useId();
  const toId = useId();
  const [before, after] = STEP_WORDS[period.kind];
  const forward = canStepForward(period, today);

  const setDate = (which: 'from' | 'to', value: string) => {
    if (!isDate(value)) return;
    onChange(which === 'from' ? customPeriod(value, period.to) : customPeriod(period.from, value));
  };

  return (
    <div className="records-period" role="group" aria-label="Period">
      <div className="day-picker__stepper">
        <Button
          size="small"
          className="day-picker__step"
          icon={<ManagerIcon name="chevronLeft" size={20} />}
          onClick={() => onChange(stepPeriod(period, -1))}
        >
          <span className="visually-hidden">{before}</span>
        </Button>
        <span className="day-picker__date records-period__label" aria-live="polite" aria-atomic="true">
          {periodLabel(period)}
        </span>
        <Button
          size="small"
          className="day-picker__step"
          icon={<ManagerIcon name="chevronRight" size={20} />}
          disabled={!forward}
          onClick={() => onChange(stepPeriod(period, 1))}
        >
          <span className="visually-hidden">{after}</span>
        </Button>
      </div>
      <div className="records-period__presets">
        {PERIOD_PRESETS.map((p) => (
          <Chip
            key={p.key}
            selected={preset === p.key}
            onSelectedChange={() => {
              if (preset === p.key) return;
              // Custom starts from the period on screen, ready to change.
              onChange(p.key === 'custom' ? { ...period, kind: 'custom' } : presetPeriod(p.key, today));
            }}
          >
            {p.label}
          </Chip>
        ))}
      </div>
      {period.kind === 'custom' ? (
        <div className="records-period__dates">
          <label className="records-period__field" htmlFor={fromId}>
            <span>From</span>
            <input
              id={fromId}
              type="date"
              className="records-period__input"
              value={period.from}
              max={today}
              onChange={(e) => setDate('from', e.target.value)}
            />
          </label>
          <label className="records-period__field" htmlFor={toId}>
            <span>To</span>
            <input
              id={toId}
              type="date"
              className="records-period__input"
              value={period.to}
              min={period.from}
              onChange={(e) => setDate('to', e.target.value)}
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}
