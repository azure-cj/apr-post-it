import './InternsParts.css';
import type { ReactNode } from 'react';
import { Pill, type Tone } from '../../components';
import { addDays, shortDate, type Pace, type WeekProgress } from '@/core/summary';
import type { PostLogEntry } from '@/core/types';
import { addWeeks, weekDays, weekdaysElapsed, weekOf } from '@/core/week';

/** The pace as one word on its tone. A week with no queue says so. */
export function PacePill({ progress }: { readonly progress: Pick<WeekProgress, 'pace' | 'target' | 'missed'> }) {
  const { tone, word } = paceWords(progress);
  return (
    <Pill tone={tone} dot className="pace-pill">
      {word}
    </Pill>
  );
}

const PACE: Record<Pace, { readonly tone: Tone; readonly word: string }> = {
  done: { tone: 'ok', word: 'Done' },
  'on-track': { tone: 'neutral', word: 'On track' },
  behind: { tone: 'warn', word: 'Behind' },
  'not-started': { tone: 'danger', word: 'Not started' },
  missed: { tone: 'danger', word: 'Missed' },
};

/** "Behind", "Missed 8", "No queue". */
export function paceWords({ pace, target, missed }: Pick<WeekProgress, 'pace' | 'target' | 'missed'>): {
  readonly tone: Tone;
  readonly word: string;
} {
  if (target === 0) return { tone: 'neutral', word: 'No queue' };
  const { tone, word } = PACE[pace];
  return { tone, word: pace === 'missed' ? `${word} ${missed}` : word };
}

/** Behind for the week: not started, behind, or (once it is over) missed. */
export function isBehind(progress: Pick<WeekProgress, 'pace' | 'target'>): boolean {
  return progress.target > 0 && (progress.pace === 'behind' || progress.pace === 'not-started' || progress.pace === 'missed');
}

/**
 * "12 / 40" over a bar: posted green, pending amber, on a neutral track. The
 * count is posted and pending together, as the pace counts them.
 */
export function WeekBar({
  progress,
  label,
}: {
  readonly progress: Pick<WeekProgress, 'target' | 'posted' | 'pending'>;
  /** Beside the count, on its line: the intern's name in a compact list. */
  readonly label?: ReactNode;
}) {
  const { target, posted, pending } = progress;
  if (target === 0)
    return label ? (
      <span className="week-bar">
        <span className="week-bar__top">{label}</span>
      </span>
    ) : (
      <span className="week-bar__none">
        <span aria-hidden="true">–</span>
        <span className="visually-hidden">Nothing assigned</span>
      </span>
    );
  const share = (n: number) => `${Math.min(100, (n / target) * 100)}%`;
  return (
    <span className="week-bar">
      <span className="week-bar__top">
        {label}
        <span className="week-bar__count tabular">
          {posted + pending}
          <span className="week-bar__of"> / {target}</span>
        </span>
      </span>
      <span className="week-bar__track" aria-hidden="true">
        <span className="week-bar__posted" style={{ width: share(posted) }} />
        <span className="week-bar__pending" style={{ width: share(pending) }} />
      </span>
    </span>
  );
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] as const;
export const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F'] as const;

/**
 * Posts on Monday to Friday as five small bars, scaled so a day's share of
 * the target fills one. Today has a ring; days still to come are faint. The
 * counts are said in words for screen readers.
 */
export function WeekDays({
  byDay,
  week,
  today,
  target,
}: {
  readonly byDay: readonly number[];
  readonly week: string;
  readonly today: string;
  readonly target: number;
}) {
  const days = weekDays(week);
  const scale = Math.max(1, Math.ceil(target / 5), ...byDay);
  const words = days
    .map((day, i) => (day > today ? null : `${DAY_NAMES[i]} ${byDay[i] ?? 0}`))
    .filter(Boolean)
    .join(', ');
  return (
    <span className="week-days">
      <span className="week-days__bars" aria-hidden="true">
        {days.map((day, i) => {
          const n = byDay[i] ?? 0;
          const state = day === today ? ' week-days__day--today' : day > today ? ' week-days__day--later' : '';
          return (
            <span key={day} className={`week-days__day${state}`} data-count={n}>
              <span className="week-days__fill" style={{ height: `${(Math.min(n, scale) / scale) * 100}%` }} />
            </span>
          );
        })}
      </span>
      <span className="visually-hidden">{words ? `Posts: ${words}` : 'Week not started'}</span>
    </span>
  );
}

/** "Today, 09:41", "Yesterday, 16:02", "Thu 29 Oct, 10:00". */
export function lastPostWords(post: Pick<PostLogEntry, 'date' | 'time'>, today: string): string {
  const when = post.date === today ? 'Today' : post.date === addDays(today, -1) ? 'Yesterday' : shortDate(post.date);
  return post.time ? `${when}, ${post.time}` : when;
}

/**
 * The week the monitor opens on: this work week once it has started, and on
 * a weekend the week that just ended (weekOf already counts the weekend
 * toward the coming week, which has nothing to show yet).
 */
export function monitorWeek(today: string): string {
  const week = weekOf(today);
  return weekdaysElapsed(week, today) === 0 ? addWeeks(week, -1) : week;
}
