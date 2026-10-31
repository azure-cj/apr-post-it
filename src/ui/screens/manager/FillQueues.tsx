import { useMemo, useRef, useState } from 'react';
import { Button, Notice, TextInput } from '../../components';
import { DEFAULT_PER_INTERN, planQueues, type Plan, type SkipReason } from '@/core/planner';
import { addDays, firstName, plural, shortDate, type DirectoryRow, type Rules } from '@/core/summary';
import type { QueueItemInput } from '@/core/tracker';
import { UserFacingError, type Assignment, type PostLogEntry } from '@/core/types';
import { DayPicker } from './DayPicker';
import { Dialog } from './Dialog';
import './FillQueues.css';

export interface FillQueuesProps {
  /** The active interns, exactly as the Team tab spells them. All are ticked to start. */
  readonly interns: readonly string[];
  readonly properties: readonly DirectoryRow[];
  readonly posts: readonly PostLogEntry[];
  readonly assignments: readonly Assignment[];
  readonly rules: Rules;
  /** Today, yyyy-MM-dd. The date starts on tomorrow. */
  readonly today: string;
  /** Saves every planned queue at once (tracker.saveQueues). Resolves with how many rows were saved. */
  readonly onSave: (date: string, queues: ReadonlyMap<string, readonly QueueItemInput[]>) => Promise<number>;
  /** Saved: closes, with what to say. */
  readonly onSaved: (note: string) => void;
  readonly onClose: () => void;
}

export const SKIP_WORDS: Record<SkipReason, string> = {
  sold: 'Sold or not available',
  noSeparator: 'No separator',
  noDocument: 'No document',
  queued: 'Already queued that day',
  cooldown: 'In cooldown',
};

/**
 * Fill several interns' queues for one day at once: choose who, how many and
 * which day, preview the plan, and save it in one go. Nothing is written
 * until Save all.
 */
export function FillQueues({ interns, properties, posts, assignments, rules, today, onSave, onSaved, onClose }: FillQueuesProps) {
  const [perText, setPerText] = useState(String(rules.perIntern ?? DEFAULT_PER_INTERN));
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set(interns));
  const [date, setDate] = useState(addDays(today, 1));
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
    setPlan(planQueues({ properties, posts, assignments, interns: who, perIntern: per, date, rules, keepExisting: keep }));
  };

  const save = async () => {
    if (!plan) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await onSave(date, plan.queues);
      onSaved(`Saved ${plural(plan.queues.size, 'queue', 'queues')} for ${shortDate(date)}, ${plural(saved, 'listing', 'listings')}.`);
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
          label="Per intern"
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
            Date
          </span>
          <DayPicker date={date} today={today} onChange={changed(setDate)} label="Date" quick={['today', 'tomorrow']} />
        </div>
        <label className="fill__check fill__keep">
          <input type="checkbox" checked={keep} disabled={saving} onChange={(e) => changed(setKeep)(e.target.checked)} />
          Keep existing queue
        </label>
      </div>

      <fieldset className="fill__who" disabled={saving}>
        <legend className="fill__label">
          Interns <span className="fill__count tabular">{who.length} of {interns.length}</span>
        </legend>
        {interns.length === 0 ? (
          <p className="fill__muted">No active interns.</p>
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
          {plural(plan.shortBy, 'listing', 'listings')} short of {per} each. Not enough listings are free.
        </Notice>
      ) : null}

      <ul className="fill__queues">
        {queues.map(([name, items]) => (
          <li key={name}>
            <details className="fill__queue">
              <summary>
                <span className="fill__name">{name}</span>
                <span className="fill__bar" aria-hidden="true">
                  <span style={{ transform: `scaleX(${Math.min(1, items.length / Math.max(per, 1))})` }} />
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
        ))}
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
