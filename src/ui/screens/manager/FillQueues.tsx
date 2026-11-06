import { useMemo, useRef, useState } from 'react';
import { Button, Notice, TextInput } from '../../components';
import { DEFAULT_PER_WEEK, planQueues, type Plan, type SkipReason } from '@/core/planner';
import { firstName, plural, type DirectoryRow, type Rules } from '@/core/summary';
import { chooseQueue, periodLabel, queueWeeksOf, withWeeks, type QueuePeriod } from '@/core/queues';
import { shortDate } from '@/core/summary';
import type { QueueInput } from '@/core/tracker';
import { DEFAULT_RULES, UserFacingError, type Assignment, type PostLogEntry } from '@/core/types';
import { LengthPicker } from './QueuePicker';
import { WeekPicker } from './WeekPicker';
import { Dialog } from './Dialog';
import './FillQueues.css';

export interface FillQueuesProps {
  /** The active interns, exactly as the Team tab spells them. All are ticked to start. */
  readonly interns: readonly string[];
  readonly properties: readonly DirectoryRow[];
  readonly posts: readonly PostLogEntry[];
  readonly assignments: readonly Assignment[];
  readonly rules: Rules;
  /** Today, yyyy-MM-dd. */
  readonly today: string;
  /** The week to start on, as its Monday: the one Assign shows. */
  readonly week: string;
  /** Saves every planned queue at once (tracker.saveQueues), each with when it runs. Resolves with how many rows were saved. */
  readonly onSave: (week: string, queues: readonly QueueInput[]) => Promise<number>;
  /** Saved: closes, with what to say. */
  readonly onSaved: (note: string) => void;
  readonly onClose: () => void;
}

export const SKIP_WORDS: Record<SkipReason, string> = {
  sold: 'Sold or not available',
  noSeparator: 'No separator',
  noDocument: 'No document',
  held: 'Held by another agent',
  cooldown: 'In cooldown',
};

/**
 * The queue each intern would get for `week` (v14, queues.chooseQueue): the
 * one they have running in it, else a new one of `weeks` weeks, shortened to
 * end before their next queue. Left out: a week gone by, or no room.
 */
export function fillPeriods(
  interns: readonly string[],
  week: string,
  assignments: readonly Assignment[],
  today: string,
  weeks: number,
): Map<string, QueuePeriod> {
  const out = new Map<string, QueuePeriod>();
  for (const name of interns) {
    const choice = chooseQueue(name, week, assignments, today, weeks);
    if (choice.past) continue;
    if (choice.saved) {
      out.set(name, choice.period);
      continue;
    }
    // A new queue: as long as asked, or as long as fits before the next one.
    for (let n = weeks; n >= 1; n--) {
      const period = withWeeks(choice.period, n);
      if (choice.latestDue === undefined || period.due <= choice.latestDue) {
        out.set(name, period);
        break;
      }
    }
  }
  return out;
}

/**
 * Fill several interns' queues at once: choose who, how many a week, which
 * week and how long a new queue runs, preview the plan, and save it in one
 * go. Someone with a queue running that week has it filled; anyone else gets
 * a new one. Nothing is written until Save all.
 */
export function FillQueues({ interns, properties, posts, assignments, rules, today, week: startWeek, onSave, onSaved, onClose }: FillQueuesProps) {
  const [perText, setPerText] = useState(String(rules.perWeek ?? rules.perIntern ?? DEFAULT_PER_WEEK));
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set(interns));
  const [week, setWeek] = useState(startWeek);
  const [weeks, setWeeks] = useState(() => queueWeeksOf(rules.queueWeeks ?? DEFAULT_RULES.queueWeeks));
  const [keep, setKeep] = useState(true);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const perRef = useRef<HTMLInputElement>(null);

  const per = Number(perText);
  const perOk = Number.isInteger(per) && per >= 1 && per <= 200;
  const who = useMemo(() => interns.filter((n) => chosen.has(n)), [interns, chosen]);

  // Any change makes the preview stale: it is shown again on Preview.
  const changed = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPlan(null);
    setError(null);
  };

  const preview = () => {
    if (!perOk) {
      perRef.current?.focus();
      return;
    }
    const periods = fillPeriods(who, week, assignments, today, weeks);
    const planned = who.filter((name) => periods.has(name));
    setPlan(planQueues({ properties, posts, assignments, interns: planned, perWeek: per, week, today, rules, keepExisting: keep, periods }));
  };

  const save = async () => {
    if (!plan) return;
    setSaving(true);
    setError(null);
    try {
      const queues: QueueInput[] = [...plan.queues].map(([assignedTo, items]) => {
        const period = plan.periods.get(assignedTo);
        return { assignedTo, items, ...(period ? { when: { start: period.start, due: period.due } } : {}) };
      });
      const saved = await onSave(plan.week, queues);
      onSaved(`Saved ${plural(plan.queues.size, 'queue', 'queues')}, ${plural(saved, 'listing', 'listings')}.`);
    } catch (err) {
      setError(err instanceof UserFacingError ? err.message : "Couldn't save the queues. Check your connection, then try again.");
      setSaving(false);
    }
  };

  const toggle = (name: string) =>
    changed<ReadonlySet<string>>(setChosen)(
      chosen.has(name) ? new Set([...chosen].filter((n) => n !== name)) : new Set([...chosen, name]),
    );

  const total = plan ? [...plan.queues.values()].reduce((sum, items) => sum + items.length, 0) : 0;

  return (
    <Dialog
      title="Fill queues"
      size="wide"
      onClose={onClose}
      busy={saving}
      initialFocus={perRef}
      actions={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={preview} disabled={saving || who.length === 0}>
            Preview
          </Button>
          <Button variant="primary" busy={saving} disabled={!plan || total === 0} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save all'}
          </Button>
        </>
      }
    >
      <div className="fill__settings">
        <TextInput
          ref={perRef}
          className="fill__per"
          label="Per week"
          type="number"
          inputMode="numeric"
          min={1}
          max={200}
          value={perText}
          readOnly={saving}
          error={perOk ? undefined : 'A number from 1 to 200.'}
          onChange={(e) => changed(setPerText)(e.target.value)}
        />
        <div className="fill__field">
          <span className="fill__label" aria-hidden="true">
            Week
          </span>
          <WeekPicker week={week} today={today} onChange={changed(setWeek)} />
        </div>
        <div className="fill__field">
          <LengthPicker weeks={weeks} allowed={() => true} disabled={saving} onChange={changed(setWeeks)} />
        </div>
        <label className="fill__check fill__keep">
          <input type="checkbox" checked={keep} disabled={saving} onChange={(e) => changed(setKeep)(e.target.checked)} />
          Keep existing queues
        </label>
      </div>

      <fieldset className="fill__who" disabled={saving}>
        <legend className="fill__label">
          Interns <span className="fill__count tabular">{who.length} of {interns.length}</span>
        </legend>
        {interns.length === 0 ? (
          <p className="fill__muted">No active agents.</p>
        ) : (
          <div className="fill__interns">
            {interns.map((name) => (
              <label key={name} className="fill__check">
                <input type="checkbox" checked={chosen.has(name)} onChange={() => toggle(name)} />
                {name}
              </label>
            ))}
          </div>
        )}
      </fieldset>

      {plan ? <PlanPreview plan={plan} per={per} total={total} /> : null}
      {plan && plan.queues.size < who.length ? (
        <Notice tone="warn" live>
          {plural(who.length - plan.queues.size, 'agent has', 'agents have')} no room for a queue that week.
        </Notice>
      ) : null}

      {error ? (
        <Notice tone="danger" live>
          {error}
        </Notice>
      ) : null}
    </Dialog>
  );
}

function PlanPreview({ plan, per, total }: { readonly plan: Plan; readonly per: number; readonly total: number }) {
  const queues = [...plan.queues];
  return (
    <section className="fill__plan" aria-label="Preview">
      <div className="fill__plan-head">
        <h3 className="fill__plan-title">Preview</h3>
        <span className="fill__muted tabular">{plural(total, 'listing', 'listings')}</span>
      </div>

      {plan.shortBy > 0 ? (
        <Notice tone="warn" live>
          {plural(plan.shortBy, 'listing', 'listings')} short of {per} a week each. Not enough are free.
        </Notice>
      ) : null}

      <ul className="fill__queues">
        {queues.map(([name, items]) => {
          const period = plan.periods.get(name);
          const aim = per * (period?.weeks ?? 1);
          return (
          <li key={name}>
            <details className="fill__queue">
              <summary>
                <span className="fill__name">
                  {name}
                  {period ? (
                    <span className="fill__muted tabular">
                      {' '}
                      {periodLabel(period)} · due {shortDate(period.due)}
                    </span>
                  ) : null}
                </span>
                <span className="fill__bar" aria-hidden="true">
                  <span style={{ transform: `scaleX(${Math.min(1, items.length / Math.max(aim, 1))})` }} />
                </span>
                <span className="tabular">{items.length}</span>
              </summary>
              {items.length === 0 ? (
                <p className="fill__muted fill__list">Nothing free for {firstName(name)}.</p>
              ) : (
                <ol className="fill__list" aria-label={`${firstName(name)}'s queue`}>
                  {items.map((item, i) => (
                    <li key={`${i}-${item.propertyId ?? item.propertyName}`}>{item.propertyName}</li>
                  ))}
                </ol>
              )}
            </details>
          </li>
          );
        })}
      </ul>

      {plan.skipped.length > 0 ? (
        <div className="fill__skipped">
          <h4 className="fill__label">Skipped</h4>
          <ul>
            {plan.skipped.map((s) => (
              <li key={s.reason}>
                <span>{SKIP_WORDS[s.reason]}</span>
                <span className="tabular">{s.count.toLocaleString('en-PH')}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
